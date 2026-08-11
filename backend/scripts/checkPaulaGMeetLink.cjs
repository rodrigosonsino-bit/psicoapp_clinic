const { Pool } = require('pg');

const TENANT_ID = 'e4c39d63-78ca-4c5e-b1de-efd41f7c5a35';
const NAME_PATTERN = 'PAULA G%';

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });

    const patients = await pool.query(
        `SELECT id, full_name, name, phone, email, reminder_channel
         FROM psychotherapy_patients
         WHERE tenant_id = $1 AND (UPPER(full_name) LIKE $2 OR UPPER(name) LIKE $2);`,
        [TENANT_ID, NAME_PATTERN]
    );

    if (patients.rows.length === 0) {
        console.log('Nenhuma paciente "PAULA G*" encontrada.');
        await pool.end();
        return;
    }

    for (const p of patients.rows) {
        console.log(`\n=== Paciente: ${p.full_name || p.name} (id=${p.id}) ===`);
        console.log(`phone=${p.phone ? 'presente' : 'AUSENTE'} email=${p.email ? 'presente' : 'AUSENTE'} reminder_channel=${p.reminder_channel}`);

        const appts = await pool.query(
            `SELECT id, scheduled_at, modality, status, google_meet_link, google_event_id, recurrence, parent_id
             FROM psychotherapy_appointments
             WHERE tenant_id = $1 AND patient_id = $2
               AND scheduled_at BETWEEN NOW() - INTERVAL '2 days' AND NOW() + INTERVAL '7 days'
             ORDER BY scheduled_at ASC;`,
            [TENANT_ID, p.id]
        );

        if (appts.rows.length === 0) {
            console.log('  Nenhum agendamento na janela de -2 a +7 dias.');
            continue;
        }

        for (const a of appts.rows) {
            console.log(`  --- Agendamento ${a.id} ---`);
            console.log(`  scheduled_at=${a.scheduled_at} status=${a.status} modality=${a.modality}`);
            console.log(`  google_meet_link=${a.google_meet_link ? 'PRESENTE' : 'AUSENTE'} google_event_id=${a.google_event_id ? 'presente' : 'ausente'}`);
            console.log(`  recurrence=${a.recurrence} parent_id=${a.parent_id ?? 'null'}`);

            let logs;
            try {
                logs = await pool.query(
                    `SELECT channel_used, status, error_message, sent_at, provider, retry_eligible
                     FROM psychotherapy_reminders_log
                     WHERE appointment_id = $1
                     ORDER BY sent_at DESC;`,
                    [a.id]
                );
            } catch (err) {
                console.log(`  (erro ao consultar reminders_log: ${err.message})`);
                logs = { rows: [] };
            }

            if (logs.rows.length === 0) {
                console.log('  Nenhum registro em psychotherapy_reminders_log para este agendamento.');
            } else {
                for (const l of logs.rows) {
                    console.log(`  log: channel=${l.channel_used} status=${l.status} provider=${l.provider ?? '-'} sent_at=${l.sent_at} error=${l.error_message ?? '-'}`);
                }
            }
        }
    }

    await pool.end();
}

main().catch(err => {
    console.error('Falha:', err.message);
    process.exit(1);
});
