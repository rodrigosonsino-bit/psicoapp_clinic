import { Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { TranscriptionService } from '../../infrastructure/services/TranscriptionService';
import { ClinicalAIService } from '../../infrastructure/services/ClinicalAIService';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

@injectable()
export class TranscriptionController {
    constructor(
        @inject(TranscriptionService) private readonly transcriptionService: TranscriptionService,
        @inject(ClinicalAIService) private readonly clinicalAIService: ClinicalAIService,
        @inject(Pool) private readonly dbPool: Pool
    ) {}

    async transcribeSession(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const { id: sessionId } = req.params;

        if (!req.file) {
            throw new AppError('Nenhum arquivo de áudio enviado.', 400);
        }

        logger.info({ tenantId, sessionId }, 'Iniciando processamento de transcrição da sessão');

        try {
            // 1. Transcrever áudio bruto
            const transcript = await this.transcriptionService.transcribe(req.file.buffer, req.file.mimetype);

            // 2. Gerar rascunho de prontuário com Gemini
            const summary = await this.clinicalAIService.generateSummaryDraft(transcript);

            // 3. Persistir no banco de dados
            await this.dbPool.query(`
                INSERT INTO session_transcripts (tenant_id, session_id, raw_transcript, summary_draft)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (tenant_id, session_id) 
                DO UPDATE SET raw_transcript = EXCLUDED.raw_transcript, 
                              summary_draft = EXCLUDED.summary_draft, 
                              updated_at = NOW();
            `, [tenantId, sessionId, transcript, summary]);

            res.status(200).json({ transcript, summary });
        } catch (err: any) {
            logger.error({ err, tenantId, sessionId }, 'Erro no fluxo de transcrição/resumo');
            throw new AppError(err.message || 'Erro ao transcrever a sessão', 500);
        }
    }

    async getTranscription(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const { id: sessionId } = req.params;

        const result = await this.dbPool.query(`
            SELECT raw_transcript, summary_draft 
            FROM session_transcripts 
            WHERE tenant_id = $1 AND session_id = $2;
        `, [tenantId, sessionId]);

        if (result.rows.length === 0) {
            res.status(404).json({ message: 'Nenhuma transcrição encontrada para esta sessão.' });
            return;
        }

        res.status(200).json({
            transcript: result.rows[0].raw_transcript,
            summary: result.rows[0].summary_draft
        });
    }
}
