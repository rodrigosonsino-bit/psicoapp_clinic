import { Request, Response } from 'express';
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

    /**
     * POST /api/psychotherapy/sessions/:id/transcribe
     * Recebe um arquivo de áudio via multipart, transcreve com IA (Gemini/Deepgram/Whisper)
     * e gera o rascunho de prontuário SOAP com o Gemini.
     */
    async transcribeSession(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const { id: sessionId } = req.params;

        if (!req.file) {
            throw new AppError('Nenhum arquivo de áudio enviado.', 400);
        }

        logger.info({ tenantId, sessionId }, 'Iniciando processamento de transcrição da sessão');

        try {
            // 1. Transcrever áudio → texto
            const rawTranscript = await this.transcriptionService.transcribe(
                req.file.buffer,
                req.file.mimetype
            );

            // 2. Gerar rascunho SOAP com Gemini
            const soapDraft = await this.clinicalAIService.generateSummaryDraft(rawTranscript);

            // 3. Persistir no banco (upsert — roda novamente se já existir)
            await this.dbPool.query(`
                INSERT INTO session_transcripts (tenant_id, session_id, raw_transcript, summary_draft)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (tenant_id, session_id)
                DO UPDATE SET
                    raw_transcript = EXCLUDED.raw_transcript,
                    summary_draft  = EXCLUDED.summary_draft,
                    updated_at     = NOW();
            `, [tenantId, sessionId, rawTranscript, soapDraft]);

            res.status(200).json({
                rawTranscript,
                soapDraft,
                status: 'completed',
            });
        } catch (err: any) {
            logger.error({ err, tenantId, sessionId }, 'Erro no fluxo de transcrição/resumo');
            throw new AppError(err.message || 'Erro ao transcrever a sessão', 500);
        }
    }

    /**
     * POST /api/psychotherapy/sessions/:id/transcribe/text
     * Recebe uma transcrição em texto puro (paste manual) e gera apenas
     * o rascunho SOAP com o Gemini — sem STT.
     */
    async transcribeFromText(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const { id: sessionId } = req.params;
        const { text } = req.body as { text?: string };

        if (!text || text.trim().length < 10) {
            throw new AppError('O texto da transcrição precisa ter ao menos 10 caracteres.', 400);
        }

        logger.info({ tenantId, sessionId }, 'Gerando prontuário SOAP a partir de texto manual');

        try {
            // Gera apenas o rascunho SOAP — sem STT
            const soapDraft = await this.clinicalAIService.generateSummaryDraft(text.trim());

            await this.dbPool.query(`
                INSERT INTO session_transcripts (tenant_id, session_id, raw_transcript, summary_draft)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (tenant_id, session_id)
                DO UPDATE SET
                    raw_transcript = EXCLUDED.raw_transcript,
                    summary_draft  = EXCLUDED.summary_draft,
                    updated_at     = NOW();
            `, [tenantId, sessionId, text.trim(), soapDraft]);

            res.status(200).json({
                rawTranscript: text.trim(),
                soapDraft,
                status: 'completed',
            });
        } catch (err: any) {
            logger.error({ err, tenantId, sessionId }, 'Erro ao gerar prontuário a partir de texto');
            throw new AppError(err.message || 'Erro ao processar texto da sessão', 500);
        }
    }

    /**
     * GET /api/psychotherapy/sessions/:id/transcription
     * Retorna a transcrição e rascunho SOAP já salvos para esta sessão.
     */
    async getTranscription(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const { id: sessionId } = req.params;

        const result = await this.dbPool.query(`
            SELECT id, tenant_id, session_id, raw_transcript, summary_draft, created_at, updated_at
            FROM session_transcripts
            WHERE tenant_id = $1 AND session_id = $2;
        `, [tenantId, sessionId]);

        if (result.rows.length === 0) {
            res.status(404).json({ message: 'Nenhuma transcrição encontrada para esta sessão.' });
            return;
        }

        const row = result.rows[0];
        res.status(200).json({
            id:            row.id,
            appointmentId: row.session_id,
            rawTranscript: row.raw_transcript,
            soapDraft:     row.summary_draft,
            status:        'completed',
            createdAt:     row.created_at,
            updatedAt:     row.updated_at,
        });
    }
}
