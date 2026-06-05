import { Request, Response } from 'express';
import { Pool } from 'pg';
import { injectable, inject } from 'tsyringe';

@injectable()
export class HealthController {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async check(req: Request, res: Response): Promise<Response> {
        try {
            await this.dbPool.query('SELECT 1');
            return res.status(200).json({
                status: 'ok',
                service: 'psychotherapy-backend',
                database: 'connected',
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
}
