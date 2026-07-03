import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';
import { NotFoundError } from '../../domain/errors/NotFoundError';

export interface CancelReceiptRequestDTO {
    tenantId: string;
    receiptId: string;
    cancellationReason: string;
    operatorId: string;
}

@injectable()
export class CancelPsychotherapyReceiptUseCase {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject(Pool) private readonly dbPool: Pool
    ) {}

    async execute(data: CancelReceiptRequestDTO): Promise<void> {
        if (!data.tenantId || !data.receiptId || !data.cancellationReason || !data.cancellationReason.trim()) {
            throw new AppError('Dados incompletos para cancelamento de recibo. Justificativa é obrigatória.', 400);
        }

        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            // 1. Obter recibo e bloquear para atualização
            const recRes = await client.query(`
                SELECT * FROM psychotherapy_receipts
                WHERE id = $1 AND tenant_id = $2 FOR UPDATE;
            `, [data.receiptId, data.tenantId]);

            if (recRes.rows.length === 0) {
                throw new NotFoundError('Recibo não encontrado');
            }

            const receipt = recRes.rows[0];
            if (receipt.status === 'cancelled') {
                throw new AppError('Este recibo já foi cancelado.', 400);
            }

            // 2. Se houver pagamento associado no ledger, estornar o pagamento
            const paymentId = receipt.payment_id;
            if (paymentId) {
                await this.repository.voidPayment(data.tenantId, paymentId, data.operatorId, data.cancellationReason);
            }

            // 3. Atualizar status do recibo para cancelado
            await client.query(`
                UPDATE psychotherapy_receipts
                SET status = 'cancelled',
                    cancellation_reason = $1,
                    cancelled_at = NOW(),
                    cancelled_by = $2,
                    updated_at = NOW()
                WHERE id = $3 AND tenant_id = $4;
            `, [data.cancellationReason, data.operatorId, data.receiptId, data.tenantId]);

            // 4. Logar ação de auditoria
            await client.query(`
                INSERT INTO audit_logs (id, tenant_id, action, target_type, target_id, payload, created_by)
                VALUES (gen_random_uuid(), $1, 'cancel_receipt', 'psychotherapy_receipt', $2, $3, $4);
            `, [
                data.tenantId, data.receiptId,
                JSON.stringify({ reason: data.cancellationReason, paymentId }),
                data.operatorId
            ]);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
