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
        // Efí Bank envia POST com o pagamento confirmado
        const { pix } = req.body;
        if (!pix || !Array.isArray(pix)) {
            return res.status(200).json({ ok: true });
        }

        for (const payment of pix) {
            const txid: string = payment.txid;
            const endToEndId: string = payment.endToEndId;
            const valor: string = payment.valor;
            const horario: string = payment.horario;

            try {
                const result = await this.dbPool.query(`
                    UPDATE psychotherapy_pix_charges
                    SET status = 'paid', paid_at = $2, updated_at = NOW()
                    WHERE provider_txid = $1 AND status = 'pending'
                    RETURNING id, tenant_id, monthly_record_id;
                `, [txid, new Date(horario)]);

                if (result.rows.length > 0) {
                    const { monthly_record_id, tenant_id } = result.rows[0];

                    logger.info({ txid, endToEndId, valor, tenant_id }, '💸 Pix confirmado via webhook');

                    // Se há registro mensal vinculado, marca como pago
                    if (monthly_record_id) {
                        await this.dbPool.query(`
                            UPDATE psychotherapy_monthly_records
                            SET payment_status = 'paid', updated_at = NOW()
                            WHERE id = $1 AND tenant_id = $2;
                        `, [monthly_record_id, tenant_id]);

                        logger.info({ monthly_record_id }, '✅ Registro mensal marcado como pago via Pix');
                    }
                }
            } catch (err) {
                logger.error({ err, txid }, 'Erro ao processar webhook Pix');
            }
        }

        return res.status(200).json({ ok: true });
    }

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }
}
