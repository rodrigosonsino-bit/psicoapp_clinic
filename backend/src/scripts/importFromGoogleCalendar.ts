/**
 * Importa todos os eventos do calendário "Sessões_Terapia" para psychotherapy_appointments.
 *
 * Uso:
 *   cd apps/psychotherapy
 *   npx ts-node src/scripts/importFromGoogleCalendar.ts
 *
 * Requisitos:
 *   - DATABASE_URL e variáveis GOOGLE_* no .env
 *   - Tenant deve ter Google Calendar conectado (registro em google_oauth_tokens)
 *
 * Idempotente: eventos com google_event_id já existente no banco são ignorados.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { google } from 'googleapis';

type AppointmentStatus = 'scheduled' | 'confirmed' | 'attended' | 'canceled' | 'no_show';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    const tenantsRes = await pool.query<{
        tenant_id: string;
        access_token: string;
        refresh_token: string;
        expiry_date: number;
        calendar_id: string;
    }>(`
        SELECT tenant_id, access_token, refresh_token, expiry_date, calendar_id
        FROM google_oauth_tokens
        WHERE refresh_token IS NOT NULL AND calendar_id IS NOT NULL
    `);

    if (tenantsRes.rows.length === 0) {
        console.log('Nenhum tenant com Google Calendar configurado.');
        await pool.end();
        return;
    }

    for (const tenant of tenantsRes.rows) {
        await importForTenant(tenant);
    }

    await pool.end();
    console.log('\nImportação concluída.');
}

async function importForTenant(tenant: {
    tenant_id: string;
    access_token: string;
    refresh_token: string;
    expiry_date: number;
    calendar_id: string;
}) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Tenant: ${tenant.tenant_id}`);
    console.log(`${'═'.repeat(60)}`);

    // ── OAuth2 client ────────────────────────────────────────────
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
        access_token: tenant.access_token,
        refresh_token: tenant.refresh_token,
        expiry_date: tenant.expiry_date,
    });

    // Persiste novo access_token se o client o renovar automaticamente
    oauth2Client.on('tokens', async (newTokens: any) => {
        if (newTokens.access_token) {
            await pool.query(
                `UPDATE google_oauth_tokens
                 SET access_token = $1, expiry_date = $2, updated_at = NOW()
                 WHERE tenant_id = $3`,
                [newTokens.access_token, newTokens.expiry_date ?? Date.now() + 3_600_000, tenant.tenant_id]
            );
        }
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // ── Pacientes deste tenant (nome → dados completos) ──────────
    const patientsRes = await pool.query<{
        id: string; name: string; status: string;
        payment_type: string; default_session_price_cents: number;
    }>(
        `SELECT id, name, status, payment_type, default_session_price_cents
         FROM psychotherapy_patients WHERE tenant_id = $1`,
        [tenant.tenant_id]
    );
    const patientByName = new Map<string, string>();
    const patientDataById = new Map<string, typeof patientsRes.rows[0]>();
    for (const p of patientsRes.rows) {
        patientByName.set(normalize(p.name), p.id);
        patientDataById.set(p.id, p);
    }
    console.log(`Pacientes cadastrados: ${patientsRes.rows.length}`);

    // ── IDs de eventos já importados ─────────────────────────────
    const importedRes = await pool.query<{ google_event_id: string }>(
        `SELECT google_event_id FROM psychotherapy_appointments
         WHERE tenant_id = $1 AND google_event_id IS NOT NULL AND google_event_id <> ''`,
        [tenant.tenant_id]
    );
    const alreadyImported = new Set(importedRes.rows.map(r => r.google_event_id));

    // ── Buscar eventos (desde 3 anos atrás, sem limite futuro) ───
    const timeMin = new Date();
    timeMin.setFullYear(timeMin.getFullYear() - 3);

    let pageToken: string | undefined;
    let countImported = 0, countSkipped = 0, countUnmatched = 0, countAllDay = 0;
    const unmatched: string[] = [];

    do {
        const res = await calendar.events.list({
            calendarId: tenant.calendar_id,
            maxResults: 250,
            singleEvents: true,
            orderBy: 'startTime',
            timeMin: timeMin.toISOString(),
            showDeleted: false,
            pageToken,
        });

        for (const event of res.data.items ?? []) {
            if (!event.id) continue;

            // Ignora eventos de dia inteiro (sem horário definido)
            if (!event.start?.dateTime || !event.end?.dateTime) {
                countAllDay++;
                continue;
            }

            // Já importado
            if (alreadyImported.has(event.id)) {
                countSkipped++;
                continue;
            }

            // ── Extrai nome do paciente do título com busca flexível por substring ────────────────
            const summary = event.summary ?? '';
            const normalizedSummary = normalize(summary);
            let patientId: string | undefined;
            let patientName = summary;

            for (const [pName, pId] of patientByName.entries()) {
                if (normalizedSummary.includes(pName) || pName.includes(normalizedSummary)) {
                    patientId = pId;
                    patientName = pName.toUpperCase();
                    break;
                }
            }

            if (!patientId) {
                unmatched.push(`"${summary}"`);
                countUnmatched++;
                continue;
            }

            // ── Duração ──────────────────────────────────────────
            const start = new Date(event.start.dateTime);
            const end   = new Date(event.end.dateTime);
            const durationMinutes = Math.max(10, Math.round((end.getTime() - start.getTime()) / 60_000));

            // ── Status ───────────────────────────────────────────
            const status = resolveStatus(event.status ?? 'tentative', start);

            // ── Inserir agendamento ──────────────────────────────
            await pool.query(`
                INSERT INTO psychotherapy_appointments
                    (id, tenant_id, patient_id, scheduled_at, duration_minutes,
                     status, recurrence, google_event_id, google_event_url)
                VALUES
                    (gen_random_uuid(), $1, $2, $3, $4,
                     $5::appointment_status, 'none', $6, $7)
            `, [
                tenant.tenant_id,
                patientId,
                start,
                durationMinutes,
                status,
                event.id,
                event.htmlLink ?? null,
            ]);

            // ── Sync faturamento para attended ───────────────────
            if (status === 'attended') {
                const p = patientDataById.get(patientId!)!;
                const SESSIONS_BY_STATUS: Record<string, number> =
                    { weekly: 4, biweekly: 2, one_off: 1, inactive: 0 };
                const monthStr = toMonthStr(start);
                const initExpected = p.payment_type === 'monthly'
                    ? (SESSIONS_BY_STATUS[p.status] ?? 0)
                    : 1;
                const deltaExpected = p.payment_type === 'monthly' ? 0 : 1;

                // 1. Sincroniza faturamento mensal
                await pool.query(`
                    INSERT INTO psychotherapy_monthly_records (
                        id, tenant_id, patient_id, month,
                        patient_name_snapshot, status, payment_type,
                        session_price_cents, expected_sessions, absences,
                        paid_sessions, payment_status, previous_month_paid_cents
                    ) VALUES (
                        gen_random_uuid(), $1, $2, $3,
                        $4, $5, $6, $7, $8, 0, 0, 'pending', 0
                    )
                    ON CONFLICT (tenant_id, month, patient_id)
                    WHERE patient_id IS NOT NULL
                    DO UPDATE SET
                        expected_sessions = psychotherapy_monthly_records.expected_sessions + $9,
                        updated_at = NOW()
                `, [
                    tenant.tenant_id, patientId, monthStr,
                    p.name, p.status, p.payment_type,
                    p.default_session_price_cents, initExpected,
                    deltaExpected
                ]);

                // 2. Sincroniza diário de sessões
                const sessionCheck = await pool.query(`
                    SELECT id FROM psychotherapy_sessions
                    WHERE tenant_id = $1 AND patient_id = $2 AND date = $3
                    LIMIT 1;
                `, [tenant.tenant_id, patientId, start]);

                if (sessionCheck.rows.length === 0) {
                    await pool.query(`
                        INSERT INTO psychotherapy_sessions (id, tenant_id, patient_id, date, status, notes)
                        VALUES (gen_random_uuid(), $1, $2, $3, 'attended', $4);
                    `, [tenant.tenant_id, patientId, start, event.description ?? null]);
                }
            }

            const dateStr = start.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            console.log(`  ✅  ${patientName.padEnd(25)} ${dateStr}  [${status}]`);
            countImported++;
        }

        pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    // ── Resumo ───────────────────────────────────────────────────
    console.log(`\nResultado:`);
    console.log(`  Importados:          ${countImported}`);
    console.log(`  Já existiam:         ${countSkipped}`);
    console.log(`  Eventos de dia inteiro ignorados: ${countAllDay}`);
    console.log(`  Sem paciente correspondente: ${countUnmatched}`);
    if (unmatched.length > 0) {
        console.log(`\n  ⚠️  Títulos sem correspondência (verifique o nome cadastrado):`);
        for (const t of unmatched) console.log(`     ${t}`);
    }
}

/** Converte uma Date para YYYY-MM no fuso America/Sao_Paulo */
function toMonthStr(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit',
    }).formatToParts(date);
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    return `${y}-${m}`;
}

/** Status do agendamento baseado no status do evento e se já passou */
function resolveStatus(gcalStatus: string, start: Date): AppointmentStatus {
    if (gcalStatus === 'cancelled') return 'canceled';
    if (start < new Date()) return 'attended';     // evento passado → realizado
    if (gcalStatus === 'confirmed') return 'confirmed';
    return 'scheduled';
}

/** Normaliza string para comparação: minúsculas, sem acentos, sem espaços duplos */
function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

main().catch(err => {
    console.error('\n❌ Erro fatal:', err);
    pool.end().finally(() => process.exit(1));
});
