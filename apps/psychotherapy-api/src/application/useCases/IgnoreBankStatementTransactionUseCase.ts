import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class IgnoreBankStatementTransactionUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(params: { tenantId: string; transactionId: string }): Promise<void> {
        const { tenantId, transactionId } = params;

        const result = await this.dbPool.query(
            `UPDATE psychotherapy_bank_statement_transactions
             SET status = 'ignored', ignored_at = NOW(), ignored_by = $1
             WHERE id = $2 AND tenant_id = $1 AND status = 'pending'
             RETURNING id`,
            [tenantId, transactionId]
        );

        if (result.rowCount === 0) {
            throw new AppError('Transação já confirmada ou ignorada por outra requisição.', 409);
        }
    }
}
