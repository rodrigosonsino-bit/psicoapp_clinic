import { Pool } from 'pg';
import { IMessageRepository, UpdateMessageDTO, MessageFilters } from '../../domain/repositories/IMessageRepository';
import { ScheduledMessage, MessageStatus } from '../../domain/models/ScheduledMessage';

export class PostgresMessageRepository implements IMessageRepository {
    constructor(private readonly dbPool: Pool) {}

    async save(message: ScheduledMessage): Promise<ScheduledMessage> {
        const query = `
            INSERT INTO scheduled_messages (user_id, content, recipient_id, send_at, status, platform, created_at, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_TIMESTAMP), $8)
            RETURNING *;
        `;
        const values = [
            message.userId,
            message.content,
            message.recipientId,
            message.sendAt,
            message.status,
            message.platform,
            message.createdAt,
            message.metadata ? JSON.stringify(message.metadata) : null
        ];
        const result = await this.dbPool.query(query, values);
        const row = result.rows[0];
        return new ScheduledMessage(
            row.id, row.user_id, row.content, row.recipient_id, new Date(row.send_at), row.status, row.platform, new Date(row.created_at), row.metadata
        );
    }

    async update(id: string, userId: string, fields: UpdateMessageDTO): Promise<ScheduledMessage> {
        const setClauses: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (fields.content !== undefined) { setClauses.push(`content = $${idx++}`); values.push(fields.content); }
        if (fields.recipientId !== undefined) { setClauses.push(`recipient_id = $${idx++}`); values.push(fields.recipientId); }
        if (fields.sendAt !== undefined) { setClauses.push(`send_at = $${idx++}`); values.push(fields.sendAt); }
        if (fields.platform !== undefined) { setClauses.push(`platform = $${idx++}`); values.push(fields.platform); }
        if (fields.metadata !== undefined) { 
            const newMetadata = fields.metadata ? JSON.stringify(fields.metadata) : null;
            setClauses.push(`metadata = $${idx++}`); 
            values.push(newMetadata); 
        }

        if (setClauses.length === 0) throw new Error('No fields to update');

        values.push(id);
        const idIdx = idx++;
        values.push(userId);
        const userIdIdx = idx;

        const query = `
            UPDATE scheduled_messages
            SET ${setClauses.join(', ')}, status = 'pending'
            WHERE id = $${idIdx}::uuid AND user_id = $${userIdIdx}
            RETURNING *;
        `;
        const result = await this.dbPool.query(query, values);
        if (result.rows.length === 0) {
            throw new Error('Message not found or unauthorized');
        }
        const row = result.rows[0];
        return new ScheduledMessage(
            row.id, row.user_id, row.content, row.recipient_id, new Date(row.send_at), row.status, row.platform, new Date(row.created_at), row.metadata
        );
    }

    async updateStatus(id: string, status: MessageStatus): Promise<void> {
        const query = `UPDATE scheduled_messages SET status = $1 WHERE id = $2;`;
        await this.dbPool.query(query, [status, id]);
    }

    async findById(id: string, userId?: string): Promise<ScheduledMessage | null> {
        const query = userId 
            ? `SELECT * FROM scheduled_messages WHERE id = $1 AND user_id = $2;`
            : `SELECT * FROM scheduled_messages WHERE id = $1;`;
        const params = userId ? [id, userId] : [id];
        
        const result = await this.dbPool.query(query, params);
        if (result.rows.length === 0) return null;
        const row = result.rows[0];
        return new ScheduledMessage(
            row.id, row.user_id, row.content, row.recipient_id, new Date(row.send_at), row.status, row.platform, new Date(row.created_at), row.metadata
        );
    }

    async findAll(userId: string, limit: number = 20, offset: number = 0, filters?: MessageFilters): Promise<ScheduledMessage[]> {
        const conditions: string[] = ['sm.user_id = $1'];
        const values: any[] = [userId];
        let idx = 2;

        if (filters?.startDate) {
            conditions.push(`sm.send_at >= $${idx++}`);
            values.push(filters.startDate);
        }

        if (filters?.endDate) {
            conditions.push(`sm.send_at <= $${idx++}`);
            values.push(filters.endDate);
        }

        if (filters?.recipientId) {
            conditions.push(`sm.recipient_id LIKE $${idx++}`);
            values.push(`%${filters.recipientId}%`);
        }

        const limitIdx = idx++;
        const offsetIdx = idx++;
        values.push(limit, offset);

        const orderBy = (filters?.startDate || filters?.endDate)
            ? 'sm.send_at ASC, sm.created_at DESC'
            : 'sm.created_at DESC';

        const query = `
            SELECT sm.*, wc.name AS recipient_name
            FROM scheduled_messages sm
            LEFT JOIN whatsapp_contacts wc
              ON wc.id = sm.recipient_id OR wc.id = sm.recipient_id || '@s.whatsapp.net'
            WHERE ${conditions.join(' AND ')}
            ORDER BY ${orderBy}
            LIMIT $${limitIdx} OFFSET $${offsetIdx};
        `;
        const result = await this.dbPool.query(query, values);
        return result.rows.map(row => new ScheduledMessage(
            row.id, row.user_id, row.content, row.recipient_id, new Date(row.send_at), row.status, row.platform, new Date(row.created_at), row.metadata, row.recipient_name ?? null
        ));
    }

    async findAllPending(): Promise<ScheduledMessage[]> {
        const query = `
            SELECT * FROM scheduled_messages 
            WHERE status = 'pending' 
            ORDER BY send_at ASC 
            LIMIT 1000;
        `;
        const result = await this.dbPool.query(query);
        return result.rows.map(row => new ScheduledMessage(
            row.id, row.user_id, row.content, row.recipient_id, new Date(row.send_at), row.status, row.platform, new Date(row.created_at), row.metadata
        ));
    }

    /**
     * Retorna mensagens com status 'failed' cujo send_at seja dentro da janela de horas informada.
     * Usado pelo ReconciliationJob para reagendar automaticamente falhas por desconexão.
     */
    async findRecentFailed(withinHours: number = 2): Promise<ScheduledMessage[]> {
        const query = `
            SELECT * FROM scheduled_messages 
            WHERE status = 'failed'
              AND send_at >= NOW() - INTERVAL '${withinHours} hours'
            ORDER BY send_at ASC
            LIMIT 200;
        `;
        const result = await this.dbPool.query(query);
        return result.rows.map(row => new ScheduledMessage(
            row.id, row.user_id, row.content, row.recipient_id, new Date(row.send_at), row.status, row.platform, new Date(row.created_at), row.metadata
        ));
    }

    async delete(id: string, userId: string): Promise<void> {
        const query = `DELETE FROM scheduled_messages WHERE id = $1 AND user_id = $2;`;
        await this.dbPool.query(query, [id, userId]);
    }
}
