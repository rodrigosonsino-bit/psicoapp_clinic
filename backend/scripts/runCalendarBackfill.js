const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

async function runCalendarBackfill() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('❌ DATABASE_URL não definida.');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
        console.log('🏁 Iniciando data migration: calendar_events_v1...');

        // 1. Garantir registro na tabela data_migrations
        await client.query(`
            INSERT INTO data_migrations (name, status, rows_processed, started_at)
            VALUES ('calendar_events_v1', 'running', 0, NOW())
            ON CONFLICT (name) DO UPDATE SET status = 'running', started_at = NOW();
        `);

        // 2. Preflight Check: Buscar sobreposições/colisões físicas de horários de sessões ativas do mesmo profissional
        console.log('🔍 Executando Preflight Check de sobreposição de agendamentos...');
        const overlapRes = await client.query(`
            SELECT a1.id as a1_id, a2.id as a2_id, a1.tenant_id, a1.scheduled_at, a1.duration_minutes
            FROM psychotherapy_appointments a1
            JOIN psychotherapy_appointments a2 
              ON a1.tenant_id = a2.tenant_id 
             AND a1.id < a2.id
             -- Sobreposição física de horários
             AND a1.scheduled_at < a2.scheduled_at + (a2.duration_minutes * interval '1 minute')
             AND a2.scheduled_at < a1.scheduled_at + (a1.duration_minutes * interval '1 minute')
            WHERE a1.status NOT IN ('canceled')
              AND a2.status NOT IN ('canceled')
              -- Permite participantes do mesmo grupo no mesmo horário, mas bloqueia qualquer outro overlap
              AND NOT (a1.group_id = a2.group_id AND a1.scheduled_at = a2.scheduled_at AND a1.group_id IS NOT NULL)
            LIMIT 10;
        `);

        if (overlapRes.rows.length > 0) {
            console.error('❌ PREFLIGHT ERROR: Conflito/Sobreposição física de agendamentos ativos detectado!');
            console.table(overlapRes.rows);
            await client.query(`
                UPDATE data_migrations 
                SET status = 'failed', last_error = 'Preflight failed: Overlapping appointments found.', completed_at = NOW()
                WHERE name = 'calendar_events_v1';
            `);
            process.exit(1);
        }
        console.log('✅ Preflight Check concluído com sucesso. Nenhuma sobreposição detectada.');

        // 3. Processamento em lotes (batch size = 100)
        let hasMore = true;
        let totalProcessed = 0;

        const mapStatus = (apptStatus) => {
            if (apptStatus === 'attended' || apptStatus === 'no_show') return 'completed';
            return apptStatus; // 'scheduled', 'confirmed', 'canceled'
        };

        while (hasMore) {
            // Busca o próximo lote de agendamentos sem calendar_event_id
            const { rows: batch } = await client.query(`
                SELECT id, tenant_id, patient_id, scheduled_at, duration_minutes, status, group_id
                FROM psychotherapy_appointments
                WHERE calendar_event_id IS NULL
                ORDER BY id ASC
                LIMIT 100;
            `);

            if (batch.length === 0) {
                hasMore = false;
                break;
            }

            await client.query('BEGIN');
            try {
                for (const appt of batch) {
                    const duration = appt.duration_minutes ?? 50;
                    const endedAt = new Date(new Date(appt.scheduled_at).getTime() + duration * 60 * 1000);
                    const mappedEventStatus = mapStatus(appt.status);

                    if (appt.group_id) {
                        // Agendamento de grupo: verificar se já existe um evento físico compartilhado
                        const existRes = await client.query(`
                            SELECT id FROM calendar_events
                            WHERE tenant_id = $1 AND group_id = $2 AND scheduled_at = $3;
                        `, [appt.tenant_id, appt.group_id, appt.scheduled_at]);

                        let eventId;
                        if (existRes.rows.length > 0) {
                            eventId = existRes.rows[0].id;
                        } else {
                            eventId = crypto.randomUUID();
                            await client.query(`
                                INSERT INTO calendar_events (id, tenant_id, scheduled_at, ended_at, duration_minutes, event_type, status, group_id)
                                VALUES ($1, $2, $3, $4, $5, 'group', $6, $7);
                            `, [eventId, appt.tenant_id, appt.scheduled_at, endedAt, duration, mappedEventStatus, appt.group_id]);
                        }

                        await client.query(`
                            UPDATE psychotherapy_appointments
                            SET calendar_event_id = $1
                            WHERE id = $2;
                        `, [eventId, appt.id]);

                    } else {
                        // Agendamento individual: correspondência 1-para-1
                        const eventId = appt.id;
                        await client.query(`
                            INSERT INTO calendar_events (id, tenant_id, scheduled_at, ended_at, duration_minutes, event_type, status, group_id)
                            VALUES ($1, $2, $3, $4, $5, 'individual', $6, NULL)
                            ON CONFLICT (id) DO NOTHING;
                        `, [eventId, appt.tenant_id, appt.scheduled_at, endedAt, duration, mappedEventStatus]);

                        await client.query(`
                            UPDATE psychotherapy_appointments
                            SET calendar_event_id = $1
                            WHERE id = $2;
                        `, [eventId, appt.id]);
                    }
                }

                totalProcessed += batch.length;

                // Salva checkpoint na data_migrations
                const lastId = batch[batch.length - 1].id;
                await client.query(`
                    UPDATE data_migrations
                    SET rows_processed = $1, last_checkpoint = $2
                    WHERE name = 'calendar_events_v1';
                `, [totalProcessed, lastId]);

                await client.query('COMMIT');
                console.log(`   - Processados ${totalProcessed} agendamentos...`);
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            }
        }

        // 4. Validação e Conclusão
        const { rows: verifyRows } = await client.query(`
            SELECT COUNT(*) as count FROM psychotherapy_appointments WHERE calendar_event_id IS NULL;
        `);
        const remaining = parseInt(verifyRows[0].count, 10);

        if (remaining > 0) {
            throw new Error(`Falha de integridade: restam ${remaining} agendamentos sem calendar_event_id.`);
        }

        await client.query(`
            UPDATE data_migrations
            SET status = 'completed', completed_at = NOW(), last_error = NULL
            WHERE name = 'calendar_events_v1';
        `);

        console.log(`✅ Backfill concluído com sucesso! ${totalProcessed} registros migrados.`);

    } catch (error) {
        console.error('❌ Erro crítico no backfill:', error.message);
        try {
            await client.query(`
                UPDATE data_migrations 
                SET status = 'failed', last_error = $1, completed_at = NOW()
                WHERE name = 'calendar_events_v1';
            `, [error.message]);
        } catch (_) {}
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runCalendarBackfill();
