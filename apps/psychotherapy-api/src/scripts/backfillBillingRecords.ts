import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SESSIONS_BY_STATUS: Record<string, number> = {
    weekly: 4,
    biweekly: 2,
    monthly: 1,
    one_off: 1,
    inactive: 0
};

function toMonthStr(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit',
    }).formatToParts(date);
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    return `${y}-${m}`;
}

async function main() {
    console.log('Iniciando backfill de faturamento...');

    // 1. Obter todos os pacientes
    const patientsRes = await pool.query<{
        id: string;
        tenant_id: string;
        name: string;
        status: string;
        payment_type: string | null;
        default_session_price_cents: number | null;
    }>('SELECT id, tenant_id, name, status, payment_type, default_session_price_cents FROM psychotherapy_patients');
    
    const patientsMap = new Map(patientsRes.rows.map(p => [p.id, p]));
    console.log(`Carregados ${patientsMap.size} pacientes.`);

    // 2. Obter todos os agendamentos realizados/faltas
    const appointmentsRes = await pool.query<{
        tenant_id: string;
        patient_id: string;
        scheduled_at: Date;
        status: string;
    }>("SELECT tenant_id, patient_id, scheduled_at, status FROM psychotherapy_appointments WHERE status IN ('attended', 'no_show')");

    console.log(`Carregados ${appointmentsRes.rows.length} agendamentos com status atendido/falta.`);

    // Agrupar agendamentos por: tenant_id : patient_id : month
    const groups = new Map<string, { attended: number; noShow: number; scheduledAt: Date }[]>();

    for (const app of appointmentsRes.rows) {
        const patient = patientsMap.get(app.patient_id);
        if (!patient) continue;

        const monthStr = toMonthStr(app.scheduled_at);
        const key = `${app.tenant_id}:${app.patient_id}:${monthStr}`;

        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push({
            attended: app.status === 'attended' ? 1 : 0,
            noShow: app.status === 'no_show' ? 1 : 0,
            scheduledAt: app.scheduled_at
        });
    }

    console.log(`Agrupados em ${groups.size} registros de faturamento mensais.`);

    let countUpserted = 0;

    for (const [key, items] of groups.entries()) {
        const [tenantId, patientId, month] = key.split(':');
        const patient = patientsMap.get(patientId)!;

        const totalAttended = items.reduce((acc, x) => acc + x.attended, 0);
        const totalNoShow = items.reduce((acc, x) => acc + x.noShow, 0);

        let expectedSessions = 0;
        let absences = totalNoShow;

        if (patient.payment_type === 'monthly') {
            expectedSessions = SESSIONS_BY_STATUS[patient.status] ?? 0;
        } else {
            // per_session
            expectedSessions = totalAttended + totalNoShow;
        }

        // Executar UPSERT
        await pool.query(`
            INSERT INTO psychotherapy_monthly_records (
                id, tenant_id, patient_id, month,
                patient_name_snapshot, status, payment_type,
                session_price_cents, expected_sessions, absences,
                paid_sessions, payment_status, previous_month_paid_cents
            ) VALUES (
                gen_random_uuid(), $1, $2, $3,
                $4, $5, $6, $7, $8, $9,
                0, 'pending', 0
            )
            ON CONFLICT (tenant_id, month, patient_id) WHERE patient_id IS NOT NULL
            DO UPDATE SET
                expected_sessions = EXCLUDED.expected_sessions,
                absences = EXCLUDED.absences,
                updated_at = NOW();
        `, [
            tenantId,
            patientId,
            month,
            patient.name,
            patient.status,
            patient.payment_type,
            patient.default_session_price_cents,
            expectedSessions,
            absences
        ]);

        countUpserted++;
    }

    console.log(`Backfill finalizado. ${countUpserted} registros inseridos/atualizados com sucesso.`);
    await pool.end();
}

main().catch(err => {
    console.error('Erro no script de backfill:', err);
    pool.end().finally(() => process.exit(1));
});
