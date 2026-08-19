import * as cron from 'node-cron';
import { Pool } from 'pg';
import { google } from 'googleapis';
import { logger as rootLogger } from '../logger';
import pino from 'pino';
import { decrypt } from '../auth/cryptoHelper';
import * as crypto from 'crypto';

// ── Constantes ─────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 5 * 60 * 1000; // 5 minutos
const MAX_BACKOFF_MS = 4 * 60 * 60 * 1000; // 4 horas
const LEASE_MINUTES = 30; // Atualizado para 30 min por segurança
const LLM_MAX_CHARS = 80_000; // limite conservador antes de truncar

// ── Tipos ───────────────────────────────────────────────────────────────────────

interface TranscriptionJob {
    id: string;
    tenant_id: string;
    appointment_id: string;
    meet_space_name: string;
    attempt_count: number;
    lease_token: string;
}

interface OAuthRow {
    access_token: string;
    refresh_token: string;
    expiry_date: number | null;
}

// ── Worker principal ────────────────────────────────────────────────────────────

export class TranscriptionJobScheduler {
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectUri: string;

    constructor(
        private readonly dbPool: Pool,
        private readonly invokeLlm: (transcript: string, appointmentId: string) => Promise<string>
    ) {
        this.clientId = process.env.GOOGLE_CLIENT_ID ?? '';
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI ?? '';
    }

    start(): void {
        // Roda a cada 5 minutos
        cron.schedule('*/5 * * * *', () => {
            this.run().catch(err =>
                rootLogger.error({ err }, '[TranscriptionJobScheduler] Erro inesperado no ciclo')
            );
        });
        
        // Roda a cada 15 minutos para enfileirar novos jobs de reuniões finalizadas
        cron.schedule('*/15 * * * *', () => {
            this.queueJobs().catch(err =>
                rootLogger.error({ err }, '[TranscriptionJobScheduler] Erro ao enfileirar novos jobs')
            );
        });

        rootLogger.info('[TranscriptionJobScheduler] Iniciado');
    }

    /** 
     * Busca agendamentos finalizados com Google Meet e preferência nativa, 
     * que ainda não tenham job nem nota, e enfileira.
     */
    public async queueJobs(): Promise<void> {
        const client = await this.dbPool.connect();
        try {
            const result = await client.query(`
                INSERT INTO transcription_jobs (tenant_id, appointment_id, integration_id, provider, meet_space_name, status)
                SELECT a.tenant_id, a.id, ti.id, 'google_meet_native', a.meet_space_name, 'pending'
                FROM psychotherapy_appointments a
                JOIN tenants t ON a.tenant_id = t.id
                JOIN transcription_integrations ti ON ti.tenant_id = a.tenant_id AND ti.provider = 'google_meet_native' AND ti.status = 'active'
                WHERE a.meet_space_name IS NOT NULL
                  AND a.status != 'canceled'
                  AND t.transcription_preference = 'google_meet_native'
                  AND (a.scheduled_at + (a.duration_minutes || ' minutes')::interval) < NOW()
                  AND NOT EXISTS (
                      SELECT 1 FROM transcription_jobs tj WHERE tj.appointment_id = a.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM psychotherapy_clinical_notes cn WHERE cn.appointment_id = a.id
                  )
                ON CONFLICT DO NOTHING;
            `);
            if (result.rowCount && result.rowCount > 0) {
                rootLogger.info({ count: result.rowCount }, '[TranscriptionJobScheduler] Novos jobs enfileirados');
            }
        } finally {
            client.release();
        }
    }

    /** Ciclo principal: busca e processa jobs elegíveis com lease. */
    async run(): Promise<void> {
        const jobs = await this.claimPendingJobs();
        for (const job of jobs) {
            await this.processJob(job);
        }
    }

    /**
     * Adquire exclusividade (lease pattern) sobre jobs elegíveis de forma atômica.
     * Retorna apenas os jobs que este worker conseguiu travar.
     */
    private async claimPendingJobs(): Promise<TranscriptionJob[]> {
        const leaseToken = crypto.randomUUID();
        const result = await this.dbPool.query<TranscriptionJob>(
            `UPDATE transcription_jobs
             SET status = 'processing',
                 locked_at = NOW(),
                 lease_expires_at = NOW() + INTERVAL '${LEASE_MINUTES} minutes',
                 lease_token = $2,
                 started_at = COALESCE(started_at, NOW()),
                 updated_at = NOW()
             WHERE id IN (
                 SELECT id FROM transcription_jobs
                 WHERE status IN ('pending', 'waiting_artifact', 'processing')
                   AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
                   AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
                   AND attempt_count < $1
                 ORDER BY next_attempt_at ASC NULLS FIRST
                 LIMIT 5
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING id, tenant_id, appointment_id, meet_space_name, attempt_count, lease_token`,
            [MAX_ATTEMPTS, leaseToken]
        );
        return result.rows;
    }

    private async processJob(job: TranscriptionJob): Promise<void> {
        const log: pino.Logger = rootLogger.child({ jobId: job.id, tenantId: job.tenant_id, appointmentId: job.appointment_id });
        log.info('[TranscriptionJobScheduler] Processando job');

        try {
            const apptRes = await this.dbPool.query<{scheduled_at: Date}>(`SELECT scheduled_at FROM psychotherapy_appointments WHERE id = $1`, [job.appointment_id]);
            const scheduledAtMs = apptRes.rows[0]?.scheduled_at?.getTime() ?? 0;

            // 1. Buscar credenciais OAuth do tenant (criptografadas em repouso)
            const oauthRow = await this.getOAuthTokens(job.tenant_id);
            if (!oauthRow) {
                log.warn('[TranscriptionJobScheduler] Token OAuth não encontrado — integracao revogada');
                await this.failJob(job, 'OAUTH_NOT_FOUND', true);
                return;
            }

            // 2. Criar cliente Google autenticado
            const oauth2Client = this.buildOAuth2Client(oauthRow);

            // 3. Buscar transcrição no Google Meet
            const transcript = await this.fetchTranscript(oauth2Client, job.meet_space_name, scheduledAtMs, log);

            if (transcript === null) {
                // Transcrição ainda não disponível — retry
                log.info('[TranscriptionJobScheduler] Transcrição não disponível ainda — reagendando');
                await this.waitingArtifact(job);
                return;
            }

            // 4. Enviar para LLM em memória (nunca escreve em disco)
            const chunked = transcript.slice(0, LLM_MAX_CHARS);
            const clinicalNote = await this.invokeLlm(chunked, job.appointment_id);

            // 5. Persistir nota como RASCUNHO + marcar job completed — tudo em uma transação
            await this.commitDraft(job, clinicalNote);
            log.info('[TranscriptionJobScheduler] Job concluído com sucesso');

        } catch (err: unknown) {
            const errorCode = classifyError(err);
            const isPermanent = errorCode === 'AUTH_REVOKED' || errorCode === 'NOT_ORGANIZER' || errorCode === 'FENCING_ERROR' || errorCode === 'INVALID_TENANT_APPOINTMENT';
            log.error({ err, errorCode, isPermanent }, '[TranscriptionJobScheduler] Erro ao processar job');
            await this.failJob(job, errorCode, isPermanent);
        }
    }

    /** Busca credenciais descriptografadas. */
    private async getOAuthTokens(tenantId: string): Promise<OAuthRow | null> {
        const result = await this.dbPool.query<{ access_token: string; refresh_token: string; expiry_date: number | null }>(
            `SELECT access_token, refresh_token, expiry_date FROM google_oauth_tokens WHERE tenant_id = $1`,
            [tenantId]
        );
        if (!result.rows[0]) return null;
        const row = result.rows[0];
        return {
            access_token: decrypt(row.access_token),
            refresh_token: decrypt(row.refresh_token),
            expiry_date: row.expiry_date ? Number(row.expiry_date) : null
        };
    }

    /** Cria um OAuth2Client com as credenciais descriptografadas. */
    private buildOAuth2Client(tokens: OAuthRow) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const oauth2Client: any = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
        oauth2Client.setCredentials({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date
        });
        return oauth2Client;
    }

    /**
     * Busca a transcrição via Google Meet REST API.
     * Filtra por `space.name` (identidade estável da sala) — não usa Drive nem nome de arquivo.
     * Retorna null se ainda não disponível.
     */
    private async fetchTranscript(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oauth2Client: any,
        meetSpaceName: string,
        scheduledAtMs: number,
        log: pino.Logger
    ): Promise<string | null> {
        // google.meet é a REST API v2 (requer googleapiclient ou googleapis >= 108)
        const meetClient = google.meet({ version: 'v2', auth: oauth2Client });

        // meet_space_name no banco é montado em extractMeetInfo()/GoogleCalendarService a
        // partir de conferenceData.conferenceId da Calendar API — que é o CÓDIGO da reunião
        // (ex: "spaces/eqp-uqmk-kgs"), não o nome canônico do recurso que a Meet API v2 exige
        // no filtro de conferenceRecords.list (ex: "spaces/V9UtzWD_lT8B"). São dois sistemas
        // de ID diferentes do próprio Google. spaces.get() aceita o código como alias e
        // devolve o nome canônico — resolve aqui em vez de mudar o valor salvo no banco (que
        // já existe pra todas as sessões antigas). Achado real: sessão da Lucilene
        // (2026-08-19) tinha transcrição pronta no Google, mas o filtro nunca batia.
        let canonicalSpaceName = meetSpaceName;
        try {
            const space = await meetClient.spaces.get({ name: meetSpaceName });
            if (space.data.name) {
                canonicalSpaceName = space.data.name;
            }
        } catch (err: any) {
            log.warn({ err, meetSpaceName }, '[TranscriptionJobScheduler] Falha ao resolver nome canônico do space — tentando com o valor salvo mesmo assim');
        }

        // Listar conference records filtrando por space.name
        const records = await meetClient.conferenceRecords.list({
            filter: `space.name="${canonicalSpaceName}"`,
            pageSize: 10
        });

        const conferenceRecords = records.data.conferenceRecords ?? [];
        if (conferenceRecords.length === 0) {
            return null; // Reunião ainda não encerrada ou transcrição pendente
        }

        // Pegar o record mais compatível com o horário do agendamento
        let bestRecord = conferenceRecords[0];
        let minDiff = Infinity;
        
        for (const record of conferenceRecords) {
            const startMs = record.startTime ? new Date(record.startTime).getTime() : 0;
            const endMs = record.endTime ? new Date(record.endTime).getTime() : Infinity;
            
            // Se o agendamento cai dentro do intervalo da reunião, é um match perfeito
            if (scheduledAtMs >= startMs && scheduledAtMs <= endMs) {
                bestRecord = record;
                break;
            }
            
            // Senão, pega a reunião com horário mais próximo
            const diff = Math.min(Math.abs(scheduledAtMs - startMs), Math.abs(scheduledAtMs - endMs));
            if (diff < minDiff) {
                minDiff = diff;
                bestRecord = record;
            }
        }

        const conferenceRecordName = bestRecord?.name;
        if (!conferenceRecordName) return null;

        // Listar transcripts do conference record
        const transcriptsResp = await meetClient.conferenceRecords.transcripts.list({
            parent: conferenceRecordName,
            pageSize: 10
        });

        const transcripts = transcriptsResp.data.transcripts ?? [];
        if (transcripts.length === 0) return null;

        // Pegar entradas do primeiro transcript (paginação completa)
        const allEntries: string[] = [];
        let pageToken: string | undefined = undefined;

        do {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const entriesResp: any = await meetClient.conferenceRecords.transcripts.entries.list({
                parent: transcripts[0].name!,
                pageSize: 100,
                pageToken
            });

            const entries = entriesResp.data.transcriptEntries ?? [];
            for (const entry of entries) {
                if (entry.text) {
                    const speaker = entry.participantSession ?? 'Participante';
                    allEntries.push(`[${speaker}]: ${entry.text}`);
                }
            }

            pageToken = entriesResp.data.nextPageToken ?? undefined;
        } while (pageToken);

        if (allEntries.length === 0) return null;

        log.info({ entryCount: allEntries.length }, '[TranscriptionJobScheduler] Transcrição lida com sucesso');
        return allEntries.join('\n');
    }

    /** Persiste a nota clínica como RASCUNHO e marca o job como concluído na mesma transação. */
    private async commitDraft(
        job: TranscriptionJob,
        content: string
    ): Promise<void> {
        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            // 1. Obter info do appointment. Achado real (2026-08-19, sessão da Lucilene):
            // essa query referenciava `t.timezone`, coluna que nunca existiu em `tenants` —
            // toda tentativa de commitDraft falhava com "column t.timezone does not exist" e
            // o job era abandonado depois de MAX_ATTEMPTS, então nenhuma nota clínica automática
            // jamais foi criada por essa pipeline até esta correção. App é single-region
            // (America/Sao_Paulo), mesmo fuso hardcoded já usado em todo o resto do backend
            // (ver PostgresExpenseRepository, shared.ts) — não precisa de JOIN com tenants.
            const aptResult = await client.query(
                `SELECT patient_id, (scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date as note_date
                 FROM psychotherapy_appointments
                 WHERE id = $1 AND tenant_id = $2`,
                [job.appointment_id, job.tenant_id]
            );

            if (aptResult.rows.length === 0) {
                const err: any = new Error('Appointment não encontrado ou tenant inválido');
                err.code = 'INVALID_TENANT_APPOINTMENT';
                throw err;
            }
            const { patient_id, note_date } = aptResult.rows[0];

            // 2. Inserir nota clínica como rascunho com UPDATE atômico em caso de conflito
            const noteResult = await client.query(
                `INSERT INTO psychotherapy_clinical_notes
                    (tenant_id, appointment_id, patient_id, note_date, content, status, source, version, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, 'draft', 'meet_transcript', 1, NOW(), NOW())
                 ON CONFLICT (tenant_id, appointment_id) WHERE status = 'draft'
                 DO UPDATE SET content = EXCLUDED.content, version = psychotherapy_clinical_notes.version + 1, updated_at = NOW()
                 RETURNING id`,
                [job.tenant_id, job.appointment_id, patient_id, note_date, content]
            );

            const noteId = noteResult.rows[0].id;

            // 3. Marcar job como completed (aplica o fencing)
            const jobResult = await client.query(
                `UPDATE transcription_jobs
                 SET status = 'completed',
                     draft_note_id = $3,
                     completed_at = NOW(),
                     lease_token = NULL,
                     updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2 AND lease_token = $4`,
                [job.id, job.tenant_id, noteId, job.lease_token]
            );

            if (jobResult.rowCount !== 1) {
                const err: any = new Error('Falha ao concluir job: lease_token inválido ou job não encontrado');
                err.code = 'FENCING_ERROR';
                throw err;
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    /** Coloca o job de volta para waiting_artifact com backoff exponencial, ou abandona se exceder MAX_ATTEMPTS. */
    private async waitingArtifact(job: TranscriptionJob): Promise<void> {
        const nextAttemptCount = job.attempt_count + 1;
        if (nextAttemptCount >= MAX_ATTEMPTS) {
            await this.dbPool.query(
                `UPDATE transcription_jobs
                 SET status = 'abandoned',
                     attempt_count = $2,
                     locked_at = NULL,
                     lease_expires_at = NULL,
                     lease_token = NULL,
                     updated_at = NOW()
                 WHERE id = $1 AND lease_token = $3`,
                [job.id, nextAttemptCount, job.lease_token]
            );
            return;
        }

        const nextAttempt = computeBackoff(job.attempt_count);
        await this.dbPool.query(
            `UPDATE transcription_jobs
             SET status = 'waiting_artifact',
                 attempt_count = $2,
                 next_attempt_at = $3,
                 locked_at = NULL,
                 lease_expires_at = NULL,
                 lease_token = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND lease_token = $4`,
            [job.id, nextAttemptCount, nextAttempt, job.lease_token]
        );
    }

    /** Marca job como failed (permanente) ou agenda retry com backoff. */
    private async failJob(job: TranscriptionJob, errorCode: string, permanent: boolean): Promise<void> {
        if (permanent) {
            await this.dbPool.query(
                `UPDATE transcription_jobs
                 SET status = 'failed',
                     last_error_code = $2,
                     locked_at = NULL,
                     lease_expires_at = NULL,
                     lease_token = NULL,
                     updated_at = NOW()
                 WHERE id = $1 AND lease_token = $3`,
                [job.id, errorCode, job.lease_token]
            );
        } else {
            // Buscar attempt_count atual para calcular backoff (usamos o da memória + 1)
            const attempts = job.attempt_count;

            if (attempts >= MAX_ATTEMPTS - 1) {
                await this.dbPool.query(
                    `UPDATE transcription_jobs
                     SET status = 'abandoned',
                         last_error_code = $2,
                         locked_at = NULL,
                         lease_expires_at = NULL,
                         lease_token = NULL,
                         updated_at = NOW()
                     WHERE id = $1 AND lease_token = $3`,
                    [job.id, errorCode, job.lease_token]
                );
            } else {
                const nextAttempt = computeBackoff(attempts);
                await this.dbPool.query(
                    `UPDATE transcription_jobs
                     SET status = 'pending',
                         attempt_count = attempt_count + 1,
                         last_error_code = $2,
                         next_attempt_at = $3,
                         locked_at = NULL,
                         lease_expires_at = NULL,
                         lease_token = NULL,
                         updated_at = NOW()
                     WHERE id = $1 AND lease_token = $4`,
                    [job.id, errorCode, nextAttempt, job.lease_token]
                );
            }
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Backoff exponencial com jitter (±20%). */
function computeBackoff(attempts: number): Date {
    const base = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts), MAX_BACKOFF_MS);
    const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20%
    return new Date(Date.now() + base + jitter);
}

/** Classifica o erro para decidir se é transitório ou permanente. */
function classifyError(err: unknown): string {
    if (!err || typeof err !== 'object') return 'UNKNOWN';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any;
    const status = e?.code ?? e?.status ?? e?.response?.status;
    const code = e?.code;

    if (code === 'FENCING_ERROR' || code === 'INVALID_TENANT_APPOINTMENT') return code;
    if (status === 401 || e?.message?.includes('invalid_grant')) return 'AUTH_REVOKED';
    if (status === 403) return 'FORBIDDEN'; // pode ser organizer mismatch
    if (status === 404) return 'NOT_FOUND';
    if (status === 429) return 'RATE_LIMITED';
    return 'INTERNAL_ERROR';
}
