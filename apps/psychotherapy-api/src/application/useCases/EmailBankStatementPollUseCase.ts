import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { google, gmail_v1 } from 'googleapis';
import { GmailAuthService } from '../../infrastructure/google/GmailAuthService';
import { ImportBankStatementUseCase } from './ImportBankStatementUseCase';
import { logger } from '../../infrastructure/logger';

const RECLAIM_TIMEOUT_MINUTES = 30;
const ALLOWED_ATTACHMENT_EXTENSIONS = ['.csv', '.ofx', '.pdf'];
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGES_PER_TENANT_PER_CYCLE = 20;

interface ClaimedMessage {
    id: string; // id da linha em psychotherapy_bank_statement_email_imports
    gmailMessageId: string;
    claimToken: string;
}

interface AttachmentPart {
    filename: string;
    attachmentId: string;
    size?: number | null;
}

/**
 * Job de polling do e-mail do extrato bancário (Gmail API). Ver
 * docs/email-bank-statement-ingestion-plan.md, seção "Job de polling" —
 * processa 2 filas (mensagens novas + reclaim de mensagens travadas)
 * alimentando o mesmo loop de tratamento de 6 passos, com toda escrita de
 * status condicionada ao claim_token do worker atual.
 */
@injectable()
export class EmailBankStatementPollUseCase {
    constructor(
        @inject(Pool) private readonly dbPool: Pool,
        private readonly gmailAuth: GmailAuthService,
        private readonly importUseCase: ImportBankStatementUseCase
    ) {}

    async execute(): Promise<void> {
        const tenants = await this.dbPool.query<{ tenant_id: string }>(
            `SELECT tenant_id FROM gmail_oauth_tokens`
        );

        for (const { tenant_id: tenantId } of tenants.rows) {
            try {
                await this.pollTenant(tenantId);
            } catch (err) {
                logger.error({ err, tenantId }, '[EmailBankStatementPoll] Erro ao processar tenant — seguindo pros próximos');
            }
        }
    }

    private async pollTenant(tenantId: string): Promise<void> {
        const alias = process.env.GMAIL_BANK_STATEMENT_ALIAS;
        if (!alias) {
            logger.warn({ tenantId }, '[EmailBankStatementPoll] GMAIL_BANK_STATEMENT_ALIAS não configurado — pulando tenant');
            return;
        }

        const auth = await this.gmailAuth.getAuthenticatedClient(tenantId);
        if (!auth) return;
        const gmail = google.gmail({ version: 'v1', auth });

        const claimed: ClaimedMessage[] = [];

        // Fila de mensagens novas — claim atômico por gmail_message_id.
        // Restringe por from:domínio também na query, não só depois de buscar —
        // achado real (2026-07-13): o Nubank não envia o extrato recorrente pro
        // alias +nubank, manda pro e-mail principal (só o de confirmação de
        // cadastro veio pro alias). Sem esse from: na query, alias=e-mail
        // principal faria a busca varrer a caixa inteira, não só e-mails do
        // Nubank — o from: aqui é só otimização de escopo da busca (o
        // filtro de segurança de verdade continua sendo o DMARC/DKIM
        // pós-fetch em processMessage, inalterado).
        const senderDomain = process.env.GMAIL_NUBANK_SENDER_DOMAIN;
        const query = senderDomain
            ? `to:${alias} from:${senderDomain} -in:spam -in:trash`
            : `to:${alias} -in:spam -in:trash`;
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: MAX_MESSAGES_PER_TENANT_PER_CYCLE,
        });
        for (const m of listRes.data.messages ?? []) {
            if (!m.id) continue;
            const claim = await this.claimMessage(tenantId, m.id);
            if (claim) claimed.push({ id: claim.id, gmailMessageId: m.id, claimToken: claim.claim_token });
        }

        // Fila de reclaim — mensagens travadas em 'processing' há mais de 30min.
        const stuck = await this.dbPool.query<{ id: string; gmail_message_id: string }>(
            `SELECT id, gmail_message_id FROM psychotherapy_bank_statement_email_imports
             WHERE tenant_id = $1 AND status = 'processing'
               AND claimed_at < NOW() - INTERVAL '${RECLAIM_TIMEOUT_MINUTES} minutes'`,
            [tenantId]
        );
        for (const row of stuck.rows) {
            const reclaim = await this.reclaimMessage(tenantId, row.gmail_message_id);
            if (reclaim) claimed.push({ id: reclaim.id, gmailMessageId: row.gmail_message_id, claimToken: reclaim.claim_token });
        }

        for (const msg of claimed) {
            await this.processMessage(tenantId, gmail, msg);
        }
    }

    private async claimMessage(tenantId: string, gmailMessageId: string): Promise<{ id: string; claim_token: string } | null> {
        const res = await this.dbPool.query<{ id: string; claim_token: string }>(
            `INSERT INTO psychotherapy_bank_statement_email_imports (tenant_id, gmail_message_id, status)
             VALUES ($1, $2, 'processing')
             ON CONFLICT (tenant_id, gmail_message_id) DO NOTHING
             RETURNING id, claim_token`,
            [tenantId, gmailMessageId]
        );
        return res.rows[0] ?? null;
    }

    private async reclaimMessage(tenantId: string, gmailMessageId: string): Promise<{ id: string; claim_token: string } | null> {
        const res = await this.dbPool.query<{ id: string; claim_token: string }>(
            `UPDATE psychotherapy_bank_statement_email_imports
             SET status = 'processing', claimed_at = NOW(), claim_token = gen_random_uuid(),
                 attempt_count = attempt_count + 1
             WHERE tenant_id = $1 AND gmail_message_id = $2
               AND status = 'processing' AND claimed_at < NOW() - INTERVAL '${RECLAIM_TIMEOUT_MINUTES} minutes'
             RETURNING id, claim_token`,
            [tenantId, gmailMessageId]
        );
        return res.rows[0] ?? null;
    }

    /**
     * Regra geral do plano: toda escrita de status (sucesso, rejeição,
     * no_attachment, error) passa por este mesmo UPDATE condicionado ao
     * claim_token. rowCount=0 → outro worker já assumiu (reclaim), este
     * worker não escreve por nenhuma via alternativa.
     */
    private async finalizeStatus(params: {
        id: string;
        claimToken: string;
        status: string;
        errorDetail?: string | null;
        importId?: string | null;
        senderNormalized?: string | null;
    }): Promise<boolean> {
        const res = await this.dbPool.query(
            `UPDATE psychotherapy_bank_statement_email_imports
             SET status = $1, error_detail = $2, import_id = $3, sender_normalized = $4, processed_at = NOW()
             WHERE id = $5 AND status = 'processing' AND claim_token = $6`,
            [
                params.status, params.errorDetail ?? null, params.importId ?? null,
                params.senderNormalized ?? null, params.id, params.claimToken
            ]
        );
        if ((res.rowCount ?? 0) === 0) {
            logger.warn({ id: params.id }, '[EmailBankStatementPoll] claim perdido — mensagem já sendo tratada por outro worker');
            return false;
        }
        return true;
    }

    private async processMessage(tenantId: string, gmail: gmail_v1.Gmail, msg: ClaimedMessage): Promise<void> {
        try {
            const detail = await gmail.users.messages.get({ userId: 'me', id: msg.gmailMessageId, format: 'full' });
            const headers = detail.data.payload?.headers ?? [];
            const getHeader = (name: string): string | null =>
                headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

            const deliveredTo = getHeader('Delivered-To');
            const from = getHeader('From');
            const authResults = headers
                .filter(h => h.name?.toLowerCase() === 'authentication-results')
                .map(h => h.value ?? '');

            const senderNormalized = this.extractEmailAddress(from);

            // Passo 1: filtros de segurança (seção "Filtro de mensagens").
            const alias = process.env.GMAIL_BANK_STATEMENT_ALIAS ?? '';
            if (deliveredTo && !deliveredTo.toLowerCase().includes(alias.toLowerCase())) {
                await this.finalizeStatus({
                    id: msg.id, claimToken: msg.claimToken, status: 'rejected_sender',
                    errorDetail: 'Delivered-To não bate com o alias configurado.', senderNormalized
                });
                return;
            }

            const senderDomain = process.env.GMAIL_NUBANK_SENDER_DOMAIN;
            if (!senderDomain) {
                // Fail-closed (Riscos e assunções #2 do plano): sem domínio
                // confirmado, o filtro de segurança não pode ser aplicado —
                // nunca processar sem essa checagem.
                await this.finalizeStatus({
                    id: msg.id, claimToken: msg.claimToken, status: 'error',
                    errorDetail: 'GMAIL_NUBANK_SENDER_DOMAIN não configurado — filtro de segurança indisponível.',
                    senderNormalized
                });
                return;
            }

            const fromDomain = this.extractDomain(senderNormalized);
            if (!this.isDomainAligned(fromDomain, senderDomain)) {
                await this.finalizeStatus({
                    id: msg.id, claimToken: msg.claimToken, status: 'rejected_sender',
                    errorDetail: 'Domínio do remetente (From) não confere com o domínio configurado.', senderNormalized
                });
                return;
            }

            const gmailAuthservId = (process.env.GMAIL_AUTHSERV_ID ?? 'mx.google.com').toLowerCase();
            const trustedAuthResult = authResults.find(v => v.toLowerCase().trim().startsWith(gmailAuthservId));
            const authAligned = trustedAuthResult ? this.isAuthResultAligned(trustedAuthResult, senderDomain) : false;
            if (!authAligned) {
                await this.finalizeStatus({
                    id: msg.id, claimToken: msg.claimToken, status: 'rejected_auth',
                    errorDetail: 'DMARC/DKIM não alinhado (ou header Authentication-Results do Gmail ausente).',
                    senderNormalized
                });
                return;
            }

            // Passo 2: identificar o anexo .csv entre a allowlist conhecida.
            const attachments = this.collectAttachmentParts(detail.data.payload);
            const isAllowedExt = (filename: string) =>
                ALLOWED_ATTACHMENT_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
            const csvAttachments = attachments.filter(a => a.filename.toLowerCase().endsWith('.csv'));
            const disallowedAttachments = attachments.filter(a => !isAllowedExt(a.filename));

            if (csvAttachments.length === 0) {
                await this.finalizeStatus({
                    id: msg.id, claimToken: msg.claimToken, status: 'no_attachment',
                    errorDetail: 'Nenhum anexo .csv encontrado na mensagem.', senderNormalized
                });
                return;
            }
            if (csvAttachments.length > 1 || disallowedAttachments.length > 0) {
                await this.finalizeStatus({
                    id: msg.id, claimToken: msg.claimToken, status: 'error',
                    errorDetail: csvAttachments.length > 1
                        ? 'Mais de 1 anexo .csv na mensagem.'
                        : 'Anexo fora da allowlist esperada (.csv/.ofx/.pdf).',
                    senderNormalized
                });
                return;
            }

            const attachment = csvAttachments[0];
            if (attachment.size && attachment.size > MAX_ATTACHMENT_SIZE_BYTES) {
                await this.finalizeStatus({
                    id: msg.id, claimToken: msg.claimToken, status: 'error',
                    errorDetail: 'Anexo .csv excede o limite de 5MB.', senderNormalized
                });
                return;
            }

            // Passo 3: checagem de idempotência real via source_gmail_message_id.
            const existing = await this.dbPool.query<{ id: string }>(
                `SELECT id FROM psychotherapy_bank_statement_imports
                 WHERE tenant_id = $1 AND source_gmail_message_id = $2`,
                [tenantId, msg.gmailMessageId]
            );

            let importId: string;
            if (existing.rows[0]) {
                importId = existing.rows[0].id;
            } else {
                const attachmentData = await gmail.users.messages.attachments.get({
                    userId: 'me', messageId: msg.gmailMessageId, id: attachment.attachmentId
                });
                const fileBuffer = this.decodeBase64Url(attachmentData.data.data ?? '');

                try {
                    const result = await this.importUseCase.execute({
                        tenantId,
                        importedBy: tenantId,
                        fileName: attachment.filename,
                        fileBuffer,
                        sourceGmailMessageId: msg.gmailMessageId
                    });
                    importId = result.importId;
                } catch (err) {
                    // Passo 4: CSV detectado mas parse estrito falhou — nunca
                    // sucesso silencioso.
                    const detail = err instanceof Error ? err.message : 'Erro desconhecido ao processar o CSV.';
                    await this.finalizeStatus({
                        id: msg.id, claimToken: msg.claimToken, status: 'error',
                        errorDetail: detail, senderNormalized
                    });
                    return;
                }
            }

            // Passo 5: único caso de sucesso.
            await this.finalizeStatus({
                id: msg.id, claimToken: msg.claimToken, status: 'processed',
                importId, senderNormalized
            });
        } catch (err) {
            logger.error({ err, tenantId, gmailMessageId: msg.gmailMessageId }, '[EmailBankStatementPoll] Erro inesperado processando mensagem');
            await this.finalizeStatus({
                id: msg.id, claimToken: msg.claimToken, status: 'error',
                errorDetail: 'Erro interno inesperado ao processar a mensagem.'
            }).catch(() => {});
        }
    }

    private extractEmailAddress(fromHeader: string | null): string | null {
        if (!fromHeader) return null;
        const match = /<([^>]+)>/.exec(fromHeader);
        return (match ? match[1] : fromHeader).trim().toLowerCase();
    }

    private extractDomain(email: string | null): string | null {
        if (!email) return null;
        const at = email.lastIndexOf('@');
        return at === -1 ? null : email.slice(at + 1).toLowerCase();
    }

    /** Domínio bate exato, ou é subdomínio do domínio configurado. */
    private isDomainAligned(actualDomain: string | null, expectedDomain: string): boolean {
        if (!actualDomain) return false;
        const expected = expectedDomain.toLowerCase();
        return actualDomain === expected || actualDomain.endsWith('.' + expected);
    }

    /** Exige dmarc=pass com header.from alinhado, OU dkim=pass com header.d alinhado. */
    private isAuthResultAligned(authResultHeaderValue: string, expectedDomain: string): boolean {
        const dmarcMatch = /dmarc=pass[^;]*header\.from=([a-z0-9.-]+)/i.exec(authResultHeaderValue);
        if (dmarcMatch && this.isDomainAligned(dmarcMatch[1].toLowerCase(), expectedDomain)) return true;

        const dkimMatch = /dkim=pass[^;]*header\.d=([a-z0-9.-]+)/i.exec(authResultHeaderValue);
        if (dkimMatch && this.isDomainAligned(dkimMatch[1].toLowerCase(), expectedDomain)) return true;

        return false;
    }

    private collectAttachmentParts(
        payload: gmail_v1.Schema$MessagePart | undefined,
        results: AttachmentPart[] = []
    ): AttachmentPart[] {
        if (!payload) return results;
        if (payload.filename && payload.body?.attachmentId) {
            results.push({ filename: payload.filename, attachmentId: payload.body.attachmentId, size: payload.body.size });
        }
        for (const part of payload.parts ?? []) {
            this.collectAttachmentParts(part, results);
        }
        return results;
    }

    /** Gmail retorna anexos em base64url — nunca `Buffer.from(x, 'base64')` direto. */
    private decodeBase64Url(data: string): Buffer {
        const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(normalized, 'base64');
    }
}
