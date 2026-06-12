import { Pool } from 'pg';
import { IUsageTracker } from '@antigravity/whatsapp-core';
import { logger } from '../logger/logger';

export class PostgresUsageTracker implements IUsageTracker {
    private readonly currentMonth = () => new Date().toISOString().slice(0, 7);

    constructor(private readonly dbPool: Pool) {}

    async checkAndIncrement(tenantId: string): Promise<{ allowed: boolean }> {
        const month = this.currentMonth();

        const usageResult = await this.dbPool.query(`
            INSERT INTO usage_tracking (tenant_id, month, messages_sent)
            VALUES ($1::uuid, $2, 1)
            ON CONFLICT (tenant_id, month)
            DO UPDATE SET messages_sent = usage_tracking.messages_sent + 1
            RETURNING messages_sent
        `, [tenantId, month]);

        const currentUsage = usageResult.rows[0].messages_sent;

        const tenantResult = await this.dbPool.query(
            'SELECT max_messages_per_month FROM tenants WHERE id = $1::uuid',
            [tenantId]
        );
        const limit = tenantResult.rows[0]?.max_messages_per_month || 200;

        if (currentUsage > limit) {
            await this.rollback(tenantId);
            logger.warn({ tenantId, currentUsage, limit }, 'Limite do plano atingido para o tenant');
            return { allowed: false };
        }

        return { allowed: true };
    }

    async rollback(tenantId: string): Promise<void> {
        await this.dbPool.query(`
            UPDATE usage_tracking
            SET messages_sent = GREATEST(0, messages_sent - 1)
            WHERE tenant_id = $1::uuid AND month = $2
        `, [tenantId, this.currentMonth()]);
    }

    async markFailed(tenantId: string): Promise<void> {
        await this.dbPool.query(`
            UPDATE usage_tracking
            SET messages_sent = GREATEST(0, messages_sent - 1),
                messages_failed = messages_failed + 1
            WHERE tenant_id = $1::uuid AND month = $2
        `, [tenantId, this.currentMonth()]);
    }
}
