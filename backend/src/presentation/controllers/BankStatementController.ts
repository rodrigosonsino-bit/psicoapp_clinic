import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';
import { ImportBankStatementUseCase } from '../../application/useCases/ImportBankStatementUseCase';
import { ConfirmBankStatementTransactionUseCase } from '../../application/useCases/ConfirmBankStatementTransactionUseCase';
import { IgnoreBankStatementTransactionUseCase } from '../../application/useCases/IgnoreBankStatementTransactionUseCase';
import { EmailBankStatementPollUseCase } from '../../application/useCases/EmailBankStatementPollUseCase';
import { logger } from '../../infrastructure/logger';

interface MulterRequest extends AuthenticatedRequest {
    file?: Express.Multer.File;
}

@injectable()
export class BankStatementController {
    constructor(
        private readonly importUseCase: ImportBankStatementUseCase,
        private readonly confirmUseCase: ConfirmBankStatementTransactionUseCase,
        private readonly ignoreUseCase: IgnoreBankStatementTransactionUseCase,
        private readonly emailPollUseCase: EmailBankStatementPollUseCase,
        @inject(Pool) private readonly dbPool: Pool
    ) {}

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }

    async import(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const file = (req as MulterRequest).file;

        if (!file) {
            throw new AppError('Nenhum arquivo enviado (campo "file").', 400);
        }

        const originalName = file.originalname || '';
        const isCsv = originalName.toLowerCase().endsWith('.csv');
        const isOfx = originalName.toLowerCase().endsWith('.ofx');

        if (isOfx) {
            throw new AppError('OFX ainda não suportado nesta versão — exporte em CSV.', 415);
        }
        if (!isCsv) {
            throw new AppError('Formato de arquivo não suportado — envie um .csv.', 415);
        }

        // Assinatura mínima: cabeçalho reconhecível (checagem mais completa
        // acontece no parser). Rejeita cedo um arquivo claramente não-CSV.
        const headSample = file.buffer.subarray(0, 4096).toString('utf8');
        if (!/data\s*,\s*valor\s*,\s*identificador\s*,\s*descri/i.test(headSample)) {
            throw new AppError(
                'Cabeçalho do CSV não reconhecido — esperado "Data,Valor,Identificador,Descrição".',
                422
            );
        }

        try {
            const result = await this.importUseCase.execute({
                tenantId,
                importedBy: tenantId,
                fileName: originalName,
                fileBuffer: file.buffer
            });

            logger.info({ tenantId, ...result }, '[BankStatement] Import concluído');
            return res.status(201).json({ data: result });
        } catch (err) {
            if (err instanceof Error && err.message.includes('Cabeçalho do CSV não reconhecido')) {
                throw new AppError(err.message, 422);
            }
            throw err;
        }
    }

    /**
     * Tela de e-mails rejeitados (extensão da Conciliação Bancária, ver
     * docs/email-bank-statement-ingestion-plan.md) — mostra só o mínimo
     * necessário (remetente normalizado, motivo técnico), nunca
     * corpo/assunto do e-mail.
     */
    async listEmailImports(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);

        const result = await this.dbPool.query<{
            id: string; gmail_message_id: string; status: string; error_detail: string | null;
            sender_normalized: string | null; import_id: string | null;
            processed_at: string | null; created_at: string;
        }>(
            `SELECT id, gmail_message_id, status, error_detail, sender_normalized, import_id,
                    processed_at, created_at
             FROM psychotherapy_bank_statement_email_imports
             WHERE tenant_id = $1
             ORDER BY created_at DESC
             LIMIT 50`,
            [tenantId]
        );

        return res.status(200).json({ data: result.rows });
    }

    async getLatestImport(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);

        const result = await this.dbPool.query<{
            id: string; file_name: string; created_at: string; transaction_count: number;
            skipped_line_count: number; duplicate_fitid_count: number;
        }>(
            `SELECT id, file_name, created_at, transaction_count, skipped_line_count, duplicate_fitid_count
             FROM psychotherapy_bank_statement_imports
             WHERE tenant_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [tenantId]
        );

        return res.status(200).json({ data: result.rows[0] ?? null });
    }

    async listTransactions(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { importId } = req.params;
        const { status } = req.query as { status?: string };

        const params: unknown[] = [tenantId];
        let query = `
            SELECT id, fitid, posted_at, amount_cents, raw_description, payer_name_guess,
                   suggested_patient_id, suggested_month, suggested_sessions, match_confidence,
                   possible_pix_duplicate, status, confirmed_patient_id, confirmed_month,
                   confirmed_sessions, confirmed_at, ignored_at, created_at
            FROM psychotherapy_bank_statement_transactions
            WHERE tenant_id = $1
        `;

        if (importId !== 'all') {
            params.push(importId);
            query += ` AND import_id = $${params.length}`;
        }

        if (status) {
            params.push(status);
            query += ` AND status = $${params.length}`;
        }

        query += ' ORDER BY posted_at ASC, created_at ASC';

        const result = await this.dbPool.query(query, params);
        return res.status(200).json({ data: result.rows });
    }

    async confirm(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { id } = req.params;
        const { patientId, month } = req.body as { patientId: string; month: string };

        const result = await this.confirmUseCase.execute({ tenantId, transactionId: id, patientId, month });
        return res.status(200).json({ data: result });
    }

    async ignore(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { id } = req.params;

        await this.ignoreUseCase.execute({ tenantId, transactionId: id });
        return res.status(200).json({ data: { id, status: 'ignored' } });
    }

    async confirmBatch(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { ids } = req.body as { ids: string[] };

        const results: Array<{ id: string; success: boolean; reason?: string }> = [];

        for (const id of ids) {
            try {
                // Só confirma o que ainda está pending E de alta confiança no
                // momento do clique — revalidado aqui, não confiado do payload.
                const candidateRes = await this.dbPool.query<{
                    suggested_patient_id: string | null; suggested_month: string | null;
                }>(
                    `SELECT suggested_patient_id, suggested_month
                     FROM psychotherapy_bank_statement_transactions
                     WHERE id = $1 AND tenant_id = $2 AND status = 'pending' AND match_confidence = 'high'`,
                    [id, tenantId]
                );
                const candidate = candidateRes.rows[0];
                if (!candidate || !candidate.suggested_patient_id || !candidate.suggested_month) {
                    results.push({ id, success: false, reason: 'Não é mais uma sugestão de alta confiança pendente.' });
                    continue;
                }

                await this.confirmUseCase.execute({
                    tenantId,
                    transactionId: id,
                    patientId: candidate.suggested_patient_id,
                    month: candidate.suggested_month
                });
                results.push({ id, success: true });
            } catch (err) {
                results.push({ id, success: false, reason: err instanceof Error ? err.message : 'Erro desconhecido' });
            }
        }

        return res.status(200).json({
            data: {
                total: ids.length,
                success: results.filter(r => r.success).length,
                results
            }
        });
    }

    async pollEmailImportsNow(_req: Request, res: Response): Promise<Response> {
        await this.emailPollUseCase.execute();
        logger.info('[BankStatement] Manual email poll triggered');
        return res.status(200).json({ data: { message: 'Email polling executado' } });
    }
}
