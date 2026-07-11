import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { logger } from '../../infrastructure/logger';

@injectable()
export class MercadoPagoWebhookController {
    constructor(
        @inject(Pool) private readonly dbPool: Pool
    ) {}

    async handleWebhook(req: Request, res: Response): Promise<Response> {
        const id = req.query['data.id'] || req.body?.data?.id || req.body?.id;
        const type = req.query.type || req.body?.type;
        const action = req.body?.action;
        
        // MercadoPago requires immediate 200 OK
        res.status(200).send('OK');

        if (!id || (type !== 'payment' && action !== 'payment.created' && action !== 'payment.updated')) {
            return res;
        }

        try {
            // Check Idempotency
            const eventCheck = await this.dbPool.query('SELECT id FROM mp_events WHERE id = $1', [String(id)]);
            if (eventCheck.rows.length > 0) {
                logger.info({ paymentId: id }, 'MercadoPago webhook event already processed');
                return res;
            }

            const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '' });
            const paymentClient = new Payment(client);
            const paymentInfo = await paymentClient.get({ id: id as string });

            const status = paymentInfo.status;
            const externalReference = paymentInfo.external_reference;

            if (status === 'approved' && externalReference) {
                // Try to parse external_reference. It could be a UUID or a JSON string.
                let targetId: string | null = null;
                let targetType: string | null = null;

                try {
                    const parsed = JSON.parse(externalReference);
                    targetId = parsed.id;
                    targetType = parsed.type;
                } catch {
                    // Fallback to raw string if it's just a UUID
                    targetId = externalReference;
                }

                if (targetId) {
                    // We assume it's a monthly record for now if not specified.
                    // Let's check if it exists in psychotherapy_monthly_records
                    const recordCheck = await this.dbPool.query(`
                        UPDATE psychotherapy_monthly_records
                        SET payment_status = 'paid', updated_at = NOW()
                        WHERE id = $1 AND payment_status != 'paid'
                        RETURNING id, tenant_id;
                    `, [targetId]);

                    if (recordCheck.rows.length > 0) {
                        logger.info({ monthly_record_id: targetId, paymentId: id }, '✅ Registro mensal marcado como pago via MercadoPago');
                    } else {
                        // Also check group_payments if not found? 
                        // Wait, group_payments are created when paid. If we generate a preference for a group, we might insert a pending record?
                        // Let's just log if not found.
                        logger.warn({ paymentId: id, externalReference }, 'No pending monthly record found for this MercadoPago payment');
                    }
                }
            }

            // Save event for idempotency
            await this.dbPool.query('INSERT INTO mp_events (id) VALUES ($1) ON CONFLICT DO NOTHING', [String(id)]);

        } catch (error) {
            logger.error({ error, paymentId: id }, 'Erro ao processar webhook do MercadoPago');
        }

        return res;
    }
}
