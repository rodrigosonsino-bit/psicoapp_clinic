import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { CreatePixChargeUseCase } from '../../application/useCases/CreatePixChargeUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';
import { Pool } from 'pg';
import { inject } from 'tsyringe';
import { logger } from '../../infrastructure/logger';

@injectable()
export class PixController {
    constructor(
        private readonly createChargeUseCase: CreatePixChargeUseCase,
        @inject(Pool) private readonly dbPool: Pool
    ) {}

    async createCharge(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const charge = await this.createChargeUseCase.execute({ tenantId, ...req.body });
        return res.status(201).json({ data: charge });
    }

    async listCharges(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { patientId, status } = req.query as any;

        let query = `SELECT * FROM psychotherapy_pix_charges WHERE tenant_id = $1`;
        const params: any[] = [tenantId];

        if (patientId) { params.push(patientId); query += ` AND patient_id = $${params.length}`; }
        if (status) { params.push(status); query += ` AND status = $${params.length}`; }

        query += ' ORDER BY created_at DESC LIMIT 100;';
        const result = await this.dbPool.query(query, params);

        return res.status(200).json({ data: result.rows });
    }

    async handleWebhook(req: Request, res: Response): Promise<Response> {
        const { pix } = req.body;
        if (!pix || !Array.isArray(pix)) {
            return res.status(200).json({ ok: true });
        }

        const client = await this.dbPool.connect();
        try {
            for (const payment of pix) {
                const txid: string = payment.txid;
                const endToEndId: string = payment.endToEndId;
                const valorStr: string = payment.valor;
                const horario: string = payment.horario;
                const amountCents = Math.round(parseFloat(valorStr) * 100);

                await client.query('BEGIN');

                // 1. Inbox deduplicação com ON CONFLICT DO NOTHING
                const inboxResult = await client.query(`
                    INSERT INTO pix_webhook_inbox (end_to_end_id, txid, amount_cents, payload)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (end_to_end_id) DO NOTHING;
                `, [endToEndId, txid, amountCents, JSON.stringify(payment)]);

                if (inboxResult.rowCount === 0) {
                    // Já inserido/processado anteriormente. Comita e pula.
                    await client.query('COMMIT');
                    logger.info({ endToEndId, txid }, '⏭️ Webhook Pix duplicado ignorado (inbox)');
                    continue;
                }

                // 2. CAS update da cobrança Pix (apenas se pendente)
                const chargeResult = await client.query(`
                    UPDATE psychotherapy_pix_charges
                    SET status = 'paid', paid_at = $2, updated_at = NOW()
                    WHERE provider_txid = $1 AND status = 'pending'
                    RETURNING id, tenant_id, monthly_record_id;
                `, [txid, new Date(horario)]);

                if (chargeResult.rowCount === 1) {
                    const { monthly_record_id, tenant_id } = chargeResult.rows[0];
                    logger.info({ txid, endToEndId, valor: valorStr, tenant_id }, '💸 Pix confirmado via webhook e gravado');

                    // 3. Atualizar faturamento mensal vinculado se houver
                    if (monthly_record_id) {
                        await client.query(`
                            UPDATE psychotherapy_monthly_records
                            SET payment_status = 'paid', updated_at = NOW()
                            WHERE id = $1 AND tenant_id = $2;
                        `, [monthly_record_id, tenant_id]);
                        logger.info({ monthly_record_id }, '✅ Registro mensal marcado como pago via Pix (webhook)');
                    }
                } else {
                    logger.warn({ txid, endToEndId }, '⚠️ Cobrança Pix correspondente não estava pendente ou não foi encontrada');
                }

                await client.query('COMMIT');
            }
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch (_) {}
            logger.error({ err }, '❌ Erro ao processar webhook Pix');
            return res.status(500).json({ error: 'Erro interno ao processar webhook Pix' });
        } finally {
            client.release();
        }

        return res.status(200).json({ ok: true });
    }

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }
}
