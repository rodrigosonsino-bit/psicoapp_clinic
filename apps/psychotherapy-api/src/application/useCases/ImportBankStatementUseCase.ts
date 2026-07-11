import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { parseNubankCsv, ParsedBankTransaction } from '../../infrastructure/parsers/nubankCsvParser';

const PIX_DUPLICATE_WINDOW_DAYS = 3;

export interface ImportBankStatementResult {
    importId: string;
    transactionCount: number;
    skippedLineCount: number;
    duplicateFitidCount: number;
}

interface CandidatePatient {
    id: string;
    name: string;
    fullName: string | null;
    paymentType: 'monthly' | 'per_session' | null;
    defaultSessionPriceCents: number | null;
    document: string | null;
}

interface MonthlyRecordSnapshot {
    id: string;
    sessionPriceCents: number | null;
    expectedAmountCents: number | null;
    expectedSessions: number;
    absences: number;
    paidSessions: number;
    paymentType: 'monthly' | 'per_session' | null;
}

interface MatchResult {
    suggestedPatientId: string | null;
    suggestedMonth: string | null;
    suggestedSessions: number | null;
    matchConfidence: 'high' | 'medium' | 'low' | 'none';
    possiblePixDuplicate: boolean;
}

@injectable()
export class ImportBankStatementUseCase {
    constructor(@inject(Pool) private readonly dbPool: Pool) {}

    async execute(params: {
        tenantId: string;
        importedBy: string;
        fileName: string;
        fileBuffer: Buffer;
    }): Promise<ImportBankStatementResult> {
        const { tenantId, importedBy, fileName, fileBuffer } = params;

        const { transactions, skippedLineCount, periodStart, periodEnd } = parseNubankCsv(fileBuffer);

        const candidates = await this.loadCandidatePatients(tenantId);

        const importRes = await this.dbPool.query<{ id: string }>(
            `INSERT INTO psychotherapy_bank_statement_imports
                (tenant_id, file_name, file_format, period_start, period_end,
                 transaction_count, skipped_line_count, imported_by)
             VALUES ($1, $2, 'csv', $3, $4, $5, $6, $7)
             RETURNING id`,
            [tenantId, fileName, periodStart, periodEnd, transactions.length, skippedLineCount, importedBy]
        );
        const importId = importRes.rows[0].id;

        let duplicateFitidCount = 0;

        for (const tx of transactions) {
            const match = await this.matchTransaction(tenantId, tx, candidates);

            const insertRes = await this.dbPool.query(
                `INSERT INTO psychotherapy_bank_statement_transactions
                    (tenant_id, import_id, fitid, posted_at, amount_cents, raw_description,
                     payer_name_guess, suggested_patient_id, suggested_month, suggested_sessions,
                     match_confidence, possible_pix_duplicate)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 ON CONFLICT (tenant_id, fitid) DO NOTHING
                 RETURNING id`,
                [
                    tenantId, importId, tx.fitid, tx.postedAt, tx.amountCents, tx.rawDescription,
                    tx.payerNameGuess, match.suggestedPatientId, match.suggestedMonth,
                    match.suggestedSessions, match.matchConfidence, match.possiblePixDuplicate
                ]
            );

            if (insertRes.rowCount === 0) duplicateFitidCount++;
        }

        if (duplicateFitidCount > 0) {
            await this.dbPool.query(
                `UPDATE psychotherapy_bank_statement_imports SET duplicate_fitid_count = $1 WHERE id = $2`,
                [duplicateFitidCount, importId]
            );
        }

        return {
            importId,
            transactionCount: transactions.length,
            skippedLineCount,
            duplicateFitidCount
        };
    }

    private async loadCandidatePatients(tenantId: string): Promise<CandidatePatient[]> {
        // listIndividualPatientsForBilling (repositório) filtra individual_therapy_enabled
        // mas NÃO filtra status='inactive' — precisa ser explícito aqui (achado da
        // auditoria do plano v7). Query direta em vez de reusar o método do
        // repositório pra já aplicar os dois filtros na mesma consulta.
        const result = await this.dbPool.query<{
            id: string; name: string; full_name: string | null;
            payment_type: 'monthly' | 'per_session' | null;
            default_session_price_cents: number | null;
            document: string | null;
        }>(
            `SELECT id, name, full_name, payment_type, default_session_price_cents, document
             FROM psychotherapy_patients
             WHERE tenant_id = $1
               AND individual_therapy_enabled = TRUE
               AND status != 'inactive'
               AND deleted_at IS NULL`,
            [tenantId]
        );

        return result.rows.map(r => ({
            id: r.id,
            name: r.name,
            fullName: r.full_name,
            paymentType: r.payment_type,
            defaultSessionPriceCents: r.default_session_price_cents,
            document: r.document
        }));
    }

    private async matchTransaction(
        tenantId: string,
        tx: ParsedBankTransaction,
        candidates: CandidatePatient[]
    ): Promise<MatchResult> {
        const none: MatchResult = {
            suggestedPatientId: null,
            suggestedMonth: null,
            suggestedSessions: null,
            matchConfidence: 'none',
            possiblePixDuplicate: false
        };

        if (candidates.length === 0) return none;

        const suggestedMonth = tx.postedAt.slice(0, 7); // 'YYYY-MM'

        // 1. Match por nome (pg_trgm + unaccent) — só roda se houver um nome extraído.
        let namedPatient: CandidatePatient | null = null;
        if (tx.payerNameGuess) {
            namedPatient = await this.findUniqueNameMatch(tenantId, tx.payerNameGuess);
        }

        // 2. Fallback: match só por valor (sem nome reconhecido) — só considera
        // pacientes per_session cujo preço de sessão divide o valor exato num
        // número pequeno de sessões (1-4), e só se for o único candidato assim.
        let valueOnlyPatient: CandidatePatient | null = null;
        if (!namedPatient) {
            valueOnlyPatient = this.findUniqueValueOnlyMatch(tx.amountCents, candidates);
        }

        const candidatePatient = namedPatient ?? valueOnlyPatient;
        if (!candidatePatient) return none;

        // 3. Checagem de duplicata Pix pro candidato — força confiança 'none'
        // se houver cobrança Pix compatível (pending OU paid) pro mesmo
        // paciente/valor numa janela de dias.
        const possiblePixDuplicate = await this.hasPixDuplicateCandidate(
            tenantId, candidatePatient.id, tx.amountCents, tx.postedAt
        );
        if (possiblePixDuplicate) {
            return {
                suggestedPatientId: candidatePatient.id,
                suggestedMonth,
                suggestedSessions: null,
                matchConfidence: 'none',
                possiblePixDuplicate: true
            };
        }

        // 4. Match por valor contra o registro mensal do mês sugerido (não o
        // cadastro do paciente isolado).
        const record = await this.loadMonthlyRecord(tenantId, candidatePatient.id, suggestedMonth);
        const sessionsFromRecord = record ? this.computeExactSessions(tx.amountCents, record) : null;

        if (namedPatient && sessionsFromRecord !== null) {
            return {
                suggestedPatientId: candidatePatient.id,
                suggestedMonth,
                suggestedSessions: sessionsFromRecord,
                matchConfidence: 'high',
                possiblePixDuplicate: false
            };
        }

        if (namedPatient) {
            // Nome bateu, mas valor não fecha exato (ou não há registro do mês
            // ainda) — sugere o paciente, não sugere sessões.
            return {
                suggestedPatientId: candidatePatient.id,
                suggestedMonth,
                suggestedSessions: null,
                matchConfidence: 'medium',
                possiblePixDuplicate: false
            };
        }

        // valueOnlyPatient: confiança baixa, sem nome como evidência.
        return {
            suggestedPatientId: candidatePatient.id,
            suggestedMonth,
            suggestedSessions: sessionsFromRecord,
            matchConfidence: 'low',
            possiblePixDuplicate: false
        };
    }

    private async findUniqueNameMatch(tenantId: string, payerNameGuess: string): Promise<CandidatePatient | null> {
        const SIMILARITY_THRESHOLD = 0.4;
        const AMBIGUITY_MARGIN = 0.15;

        const result = await this.dbPool.query<{
            id: string; name: string; full_name: string | null;
            payment_type: 'monthly' | 'per_session' | null;
            default_session_price_cents: number | null;
            document: string | null;
            sim: number;
        }>(
            `SELECT id, name, full_name, payment_type, default_session_price_cents, document,
                    GREATEST(
                        similarity(lower(unaccent(name)), lower(unaccent($2))),
                        similarity(lower(unaccent(COALESCE(full_name, ''))), lower(unaccent($2)))
                    ) AS sim
             FROM psychotherapy_patients
             WHERE tenant_id = $1
               AND individual_therapy_enabled = TRUE
               AND status != 'inactive'
               AND deleted_at IS NULL
             ORDER BY sim DESC
             LIMIT 3`,
            [tenantId, payerNameGuess]
        );

        const rows = result.rows.filter(r => r.sim >= SIMILARITY_THRESHOLD);
        if (rows.length === 0) return null;
        if (rows.length > 1 && rows[0].sim - rows[1].sim < AMBIGUITY_MARGIN) return null; // ambíguo

        const winner = rows[0];
        return {
            id: winner.id,
            name: winner.name,
            fullName: winner.full_name,
            paymentType: winner.payment_type,
            defaultSessionPriceCents: winner.default_session_price_cents,
            document: winner.document
        };
    }

    private findUniqueValueOnlyMatch(amountCents: number, candidates: CandidatePatient[]): CandidatePatient | null {
        const matches = candidates.filter(c => {
            if (c.paymentType !== 'per_session') return false;
            const price = c.defaultSessionPriceCents;
            if (!price || price <= 0) return false;
            if (amountCents % price !== 0) return false;
            const sessions = amountCents / price;
            return sessions >= 1 && sessions <= 4;
        });

        return matches.length === 1 ? matches[0] : null;
    }

    private async loadMonthlyRecord(tenantId: string, patientId: string, month: string): Promise<MonthlyRecordSnapshot | null> {
        const result = await this.dbPool.query<{
            id: string; session_price_cents: number | null; expected_amount_cents: number | null;
            expected_sessions: number; absences: number; paid_sessions: number;
            payment_type: 'monthly' | 'per_session' | null;
        }>(
            `SELECT id, session_price_cents, expected_amount_cents, expected_sessions, absences,
                    paid_sessions, payment_type
             FROM psychotherapy_monthly_records
             WHERE tenant_id = $1 AND patient_id = $2 AND month = $3
             LIMIT 1`,
            [tenantId, patientId, month]
        );

        const row = result.rows[0];
        if (!row) return null;

        return {
            id: row.id,
            sessionPriceCents: row.session_price_cents,
            expectedAmountCents: row.expected_amount_cents,
            expectedSessions: row.expected_sessions,
            absences: row.absences,
            paidSessions: row.paid_sessions,
            paymentType: row.payment_type
        };
    }

    /** Retorna a quantidade de sessões se o valor bater EXATO com o registro
     * mensal (por_session: divisão exata; monthly: bate com expected_amount_cents),
     * respeitando o saldo pendente do mês. null se não bater exato. */
    private computeExactSessions(amountCents: number, record: MonthlyRecordSnapshot): number | null {
        const saldo = Math.max(record.expectedSessions - record.absences - record.paidSessions, 0);
        if (saldo <= 0) return null;

        if (record.paymentType === 'per_session') {
            const price = record.sessionPriceCents;
            if (!price || price <= 0) return null;
            if (amountCents % price !== 0) return null;
            const sessions = amountCents / price;
            return sessions >= 1 && sessions <= saldo ? sessions : null;
        }

        if (record.paymentType === 'monthly') {
            if (record.expectedAmountCents && amountCents === record.expectedAmountCents) {
                return saldo;
            }
            return null;
        }

        return null;
    }

    private async hasPixDuplicateCandidate(
        tenantId: string, patientId: string, amountCents: number, postedAt: string
    ): Promise<boolean> {
        const result = await this.dbPool.query(
            `SELECT 1 FROM psychotherapy_pix_charges
             WHERE tenant_id = $1 AND patient_id = $2 AND amount_cents = $3
               AND status IN ('pending', 'paid')
               AND (
                 status = 'pending'
                 OR paid_at BETWEEN $4::date - INTERVAL '${PIX_DUPLICATE_WINDOW_DAYS} days'
                                 AND $4::date + INTERVAL '${PIX_DUPLICATE_WINDOW_DAYS} days'
               )
             LIMIT 1`,
            [tenantId, patientId, amountCents, postedAt]
        );

        return (result.rowCount ?? 0) > 0;
    }
}
