import { Pool } from 'pg';
import 'reflect-metadata';
import 'dotenv/config';
import { container } from '../container';
import { IPixProvider } from '../domain/services/IPixProvider';
import { logger } from '../infrastructure/logger';

async function reconcilePixCharges() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required.');

    const pool = container.resolve(Pool);
    const pixProvider = container.resolve<IPixProvider>('IPixProvider');
    const client = await pool.connect();

    try {
        logger.info('🔄 Iniciando rotina ativa de conciliação de cobranças Pix...');

        // 1. Busca todas as cobranças com status 'pending' criadas nos últimos 30 dias
        const pendingCharges = await client.query(`
            SELECT id, tenant_id, provider_txid, monthly_record_id, amount_cents
            FROM psychotherapy_pix_charges
            WHERE status = 'pending' AND created_at >= NOW() - INTERVAL '30 days';
        `);

        logger.info(`Encontradas ${pendingCharges.rows.length} cobranças pendentes para conciliação.`);

        for (const charge of pendingCharges.rows) {
            const { id: chargeId, tenant_id: tenantId, provider_txid: txid, monthly_record_id: monthlyRecordId, amount_cents: amountCents } = charge;

            try {
                // 2. Consulta o status diretamente no provedor (Efí Bank / Mock)
                const providerStatus = await pixProvider.getChargeStatus(txid);

                if (providerStatus === 'paid') {
                    logger.info({ txid, chargeId }, '💸 Cobrança identificada como PAGA no provedor. Conciliando...');

                    await client.query('BEGIN');

                    // Insere no inbox para evitar race conditions com webhook
                    const fakeEndToEndId = `reconcile_${txid}`;
                    const inboxRes = await client.query(`
                        INSERT INTO pix_webhook_inbox (end_to_end_id, txid, amount_cents, payload)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (end_to_end_id) DO NOTHING;
                    `, [fakeEndToEndId, txid, amountCents, JSON.stringify({ source: 'reconciliation_job', status: 'paid' })]);

                    if (inboxRes.rowCount === 0) {
                        // Já foi processada por outra thread ou webhook
                        await client.query('COMMIT');
                        logger.info({ txid }, '⏭️ Conciliação pulada: inbox já contém este registro.');
                        continue;
                    }

                    // CAS update
                    const updateRes = await client.query(`
                        UPDATE psychotherapy_pix_charges
                        SET status = 'paid', paid_at = NOW(), updated_at = NOW()
                        WHERE id = $1 AND status = 'pending'
                        RETURNING id;
                    `, [chargeId]);

                    if (updateRes.rowCount === 1) {
                        if (monthlyRecordId) {
                            await client.query(`
                                UPDATE psychotherapy_monthly_records
                                SET payment_status = 'paid', updated_at = NOW()
                                WHERE id = $1 AND tenant_id = $2;
                            `, [monthlyRecordId, tenantId]);
                            logger.info({ monthlyRecordId }, '✅ Registro mensal de faturamento conciliado como pago.');
                        }
                    }

                    await client.query('COMMIT');
                    logger.info({ txid }, '✅ Conciliação concluída com sucesso.');

                } else if (providerStatus === 'canceled') {
                    logger.info({ txid }, '❌ Cobrança cancelada ou expirada no provedor.');
                    await client.query(`
                        UPDATE psychotherapy_pix_charges
                        SET status = 'canceled', updated_at = NOW()
                        WHERE id = $1 AND status = 'pending';
                    `, [chargeId]);
                }

            } catch (err) {
                logger.error({ err, txid }, 'Erro ao conciliar cobrança Pix individual.');
            }
        }

        logger.info('✅ Rotina de conciliação concluída.');
    } finally {
        client.release();
    }
}

if (require.main === module) {
    reconcilePixCharges().catch(err => {
        logger.error({ err }, 'Erro crítico na rotina de conciliação Pix');
        process.exit(1);
    });
}
export { reconcilePixCharges };
