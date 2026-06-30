import { Request, Response } from 'express';
import { Pool } from 'pg';
import { injectable, inject } from 'tsyringe';

@injectable()
export class HealthController {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async liveness(req: Request, res: Response): Promise<Response> {
        return res.status(200).json({
            status: 'ok',
            service: 'psychotherapy-backend',
            timestamp: new Date().toISOString()
        });
    }

    async readiness(req: Request, res: Response): Promise<Response> {
        const requiredSchema = process.env.REQUIRED_SCHEMA_VERSION || '034_idx_groups_concurrently.sql';
        const requiredDataMigration = process.env.REQUIRED_DATA_MIGRATION; // e.g. 'calendar_events_v1'

        try {
            // 1. Verificar conexão com o banco
            await this.dbPool.query('SELECT 1');

            // 2. Verificar migração de schema mínima obrigatória
            const schemaRes = await this.dbPool.query(
                'SELECT 1 FROM schema_migrations WHERE filename = $1;',
                [requiredSchema]
            );

            if (schemaRes.rowCount === 0) {
                return res.status(503).json({
                    status: 'error',
                    service: 'psychotherapy-backend',
                    database: 'connected',
                    schema: 'outdated',
                    error: `A migração obrigatória '${requiredSchema}' não foi aplicada.`,
                    timestamp: new Date().toISOString()
                });
            }

            // 3. Verificar migração de dados se aplicável (ex: cutover release)
            if (requiredDataMigration) {
                const dataMigRes = await this.dbPool.query(
                    "SELECT status FROM data_migrations WHERE name = $1;",
                    [requiredDataMigration]
                );

                const status = dataMigRes.rows[0]?.status;
                if (status !== 'completed') {
                    return res.status(503).json({
                        status: 'error',
                        service: 'psychotherapy-backend',
                        database: 'connected',
                        schema: 'up-to-date',
                        data_migration: requiredDataMigration,
                        data_migration_status: status || 'pending',
                        error: `A migração de dados '${requiredDataMigration}' não está concluída (Status: ${status || 'pending'}).`,
                        timestamp: new Date().toISOString()
                    });
                }
            }

            return res.status(200).json({
                status: 'ok',
                service: 'psychotherapy-backend',
                database: 'connected',
                schema: 'up-to-date',
                timestamp: new Date().toISOString()
            });

        } catch (error: any) {
            return res.status(503).json({
                status: 'error',
                service: 'psychotherapy-backend',
                database: 'disconnected',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Mantido por compatibilidade de rotas legadas
    async check(req: Request, res: Response): Promise<Response> {
        return this.readiness(req, res);
    }
}
