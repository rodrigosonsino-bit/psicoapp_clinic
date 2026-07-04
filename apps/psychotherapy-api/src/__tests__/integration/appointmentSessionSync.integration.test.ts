/**
 * appointmentSessionSync.integration.test.ts
 *
 * Testes de REGRESSÃO pra integridade appointment/session (item 6 do plano pós-Codex,
 * achado na revisão de 03/07/2026): o vínculo entre um agendamento
 * (psychotherapy_appointments) e a sessão correspondente no Diário de Sessões
 * (psychotherapy_sessions) era heurístico — casado em runtime por
 * (tenant_id, patient_id, date) — e só era sincronizado por updateAppointmentStatus(),
 * nunca por saveAppointment() (usado tanto pra criar/editar quanto pelo fluxo de
 * "atendimento retroativo" do frontend, que já cria o agendamento com status='attended').
 *
 * Corrigido (migration 082/083 + código): FK composta (appointment_id, tenant_id),
 * sincronizada em saveAppointment/updateAppointmentStatus/deleteAppointment.
 *
 * Esta primeira versão da implementação foi REPROVADA em revisão externa (Codex CLI,
 * 04/07/2026), que achou: risco de sobrescrever nota clínica ao copiar appointment.notes
 * pra session.notes; backfill da migration 082 podia gerar 2 sessões pro mesmo agendamento
 * (quebraria o índice único da 083, mesma classe do incidente de produção desta sessão);
 * troca de paciente num agendamento não sincronizava a sessão; Diário (saveSession/
 * deleteSession) continuava podendo desalinhar uma sessão vinculada. Todos corrigidos —
 * ver testes #7-#12 abaixo, além dos #1-#6 originais (com #6 corrigido pra realmente testar
 * o que o nome diz).
 *
 * NÃO coberto por teste automatizado aqui (limitação conhecida, verificado manualmente
 * lendo o SQL): a ambiguidade bidirecional do backfill da migration 082 exigiria seed de
 * dados ANTES da migration rodar, e o harness de teste (testDb.ts) já aplica todas as
 * migrations antes de qualquer teste começar.
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createPatient } from './helpers/fixtures';
import { PostgresPsychotherapyRepository } from '../../infrastructure/repositories/PostgresPsychotherapyRepository';

jest.setTimeout(120_000);

const TABLES = [
    'psychotherapy_clinical_notes', 'psychotherapy_sessions', 'psychotherapy_appointments',
    'calendar_events', 'psychotherapy_patients', 'tenants',
];

let pool: Pool;
let repo: PostgresPsychotherapyRepository;

beforeAll(async () => {
    pool = await getTestPool();
    repo = new PostgresPsychotherapyRepository(pool);
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

describe('[REGRESSÃO] saveAppointment sincroniza o Diário de Sessões', () => {
    it('#1 — agendamento criado já como "attended" (fluxo retroativo) gera sessão vinculada', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-10T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt, status: 'attended',
        });

        const rows = await pool.query(
            `SELECT status, appointment_id FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].status).toBe('attended');
    });

    it('#2 — editar o agendamento (mesmo id) pra "no_show" atualiza a MESMA sessão, não cria outra', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-11T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt, status: 'attended',
        });

        await repo.saveAppointment({
            id: appointment.id, tenantId: tenant.id, patientId: patient.id,
            scheduledAt, status: 'no_show',
        });

        const rows = await pool.query(
            `SELECT status FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        expect(rows.rows).toHaveLength(1); // não duplicou
        expect(rows.rows[0].status).toBe('unjustified_absence');
    });

    it('#3 — reagendar (mudar scheduled_at) mantém a MESMA sessão vinculada, atualiza a data', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const originalDate = new Date('2025-06-12T14:00:00Z');
        const newDate = new Date('2025-06-20T15:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt: originalDate, status: 'attended',
        });

        await repo.saveAppointment({
            id: appointment.id, tenantId: tenant.id, patientId: patient.id,
            scheduledAt: newDate, status: 'attended',
        });

        const rows = await pool.query(
            `SELECT date FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        // Comportamento ANTIGO (bug): ficaria uma sessão órfã na data original + talvez outra na
        // nova (heurística por data quebrava em reagendamento). Comportamento correto: 1 sessão
        // só, com a data atualizada.
        expect(rows.rows).toHaveLength(1);
        expect(new Date(rows.rows[0].date).toISOString()).toBe(newDate.toISOString());
    });

    it('#4 — reverter status pra "scheduled" remove a sessão (sem notas clínicas)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-13T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt, status: 'attended',
        });

        await repo.updateAppointmentStatus(tenant.id, appointment.id, 'scheduled');

        const rows = await pool.query(
            `SELECT id FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        expect(rows.rows).toHaveLength(0);
    });

    it('#5 — excluir o agendamento remove a sessão vinculada (sem notas clínicas)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-14T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt, status: 'attended',
        });

        await repo.deleteAppointment(tenant.id, appointment.id);

        const rows = await pool.query(
            `SELECT id FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        expect(rows.rows).toHaveLength(0);
    });

    it('#6 — reverter o status do agendamento é BLOQUEADO (409) se a sessão tem nota clínica', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-15T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt, status: 'attended',
        });

        await pool.query(
            `UPDATE psychotherapy_sessions SET notes = 'Nota clínica importante' WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );

        // Comportamento ANTIGO (bug, achado na 2ª revisão de 04/07/2026): revertia
        // silenciosamente, deixando agendamento "scheduled" com sessão ainda "attended" — um
        // estado contraditório. Comportamento correto: bloqueia com 409, nada muda.
        await expect(
            repo.updateAppointmentStatus(tenant.id, appointment.id, 'scheduled')
        ).rejects.toMatchObject({ statusCode: 409 });

        const rows = await pool.query(
            `SELECT status, notes FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].status).toBe('attended'); // não regrediu
        expect(rows.rows[0].notes).toBe('Nota clínica importante');

        const appt = await pool.query(`SELECT status FROM psychotherapy_appointments WHERE id = $1`, [appointment.id]);
        expect(appt.rows[0].status).toBe('attended'); // agendamento também não mudou (rollback)
    });

    it('#7 — excluir o agendamento (deleteAppointment de verdade) preserva sessão com nota clínica, mas desvincula', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-16T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt, status: 'attended',
        });

        const sessionBefore = await pool.query(
            `SELECT id FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        const sessionId = sessionBefore.rows[0].id;

        await pool.query(
            `INSERT INTO psychotherapy_clinical_notes (tenant_id, patient_id, session_id, note_date, content)
             VALUES ($1, $2, $3, CURRENT_DATE, 'Conteúdo clínico')`,
            [tenant.id, patient.id, sessionId]
        );

        await repo.deleteAppointment(tenant.id, appointment.id);

        const rows = await pool.query(
            `SELECT id, appointment_id FROM psychotherapy_sessions WHERE id = $1`,
            [sessionId]
        );
        expect(rows.rows).toHaveLength(1); // sessão preservada
        expect(rows.rows[0].appointment_id).toBeNull(); // mas desvinculada (agendamento não existe mais)
    });

    it('#8 — editar o agendamento com uma nota de agenda NÃO sobrescreve a nota clínica da sessão', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-17T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt, status: 'attended',
        });

        await pool.query(
            `UPDATE psychotherapy_sessions SET notes = 'Nota clínica original' WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );

        // Editar o agendamento com uma nota de AGENDA diferente (ex: "confirmar por telefone")
        await repo.saveAppointment({
            id: appointment.id, tenantId: tenant.id, patientId: patient.id,
            scheduledAt, status: 'attended', notes: 'confirmar por telefone',
        });

        const rows = await pool.query(
            `SELECT notes FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        // Comportamento ANTIGO (bug, achado na revisão de 04/07/2026): a nota clínica seria
        // sobrescrita pela nota de agenda. Comportamento correto: preservada, intocada.
        expect(rows.rows[0].notes).toBe('Nota clínica original');
    });

    it('#9 — trocar o paciente de um agendamento com sessão SEM nota clínica sincroniza a sessão', async () => {
        const tenant = await createTenant(pool);
        const patientA = await createPatient(pool, tenant.id);
        const patientB = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-18T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patientA.id, scheduledAt, status: 'attended',
        });

        await repo.saveAppointment({
            id: appointment.id, tenantId: tenant.id, patientId: patientB.id,
            scheduledAt, status: 'attended',
        });

        const rows = await pool.query(
            `SELECT patient_id FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        expect(rows.rows[0].patient_id).toBe(patientB.id);
    });

    it('#10 — trocar o paciente de um agendamento com sessão COM nota clínica é bloqueado (409)', async () => {
        const tenant = await createTenant(pool);
        const patientA = await createPatient(pool, tenant.id);
        const patientB = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-19T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patientA.id, scheduledAt, status: 'attended',
        });

        const session = await pool.query(
            `SELECT id FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        await pool.query(
            `INSERT INTO psychotherapy_clinical_notes (tenant_id, patient_id, session_id, note_date, content)
             VALUES ($1, $2, $3, CURRENT_DATE, 'Conteúdo clínico')`,
            [tenant.id, patientA.id, session.rows[0].id]
        );

        await expect(
            repo.saveAppointment({
                id: appointment.id, tenantId: tenant.id, patientId: patientB.id,
                scheduledAt, status: 'attended',
            })
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('#10b — trocar o paciente é bloqueado também com session.notes preenchido (sem linha em clinical_notes)', async () => {
        const tenant = await createTenant(pool);
        const patientA = await createPatient(pool, tenant.id);
        const patientB = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-20T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patientA.id, scheduledAt, status: 'attended',
        });

        // Nota clínica em texto livre na própria sessão, SEM linha em psychotherapy_clinical_notes
        // — era exatamente o gap achado na 2ª revisão de 04/07/2026 (a checagem original só
        // olhava a tabela estruturada).
        await pool.query(
            `UPDATE psychotherapy_sessions SET notes = 'Observação clínica em texto livre' WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );

        await expect(
            repo.saveAppointment({
                id: appointment.id, tenantId: tenant.id, patientId: patientB.id,
                scheduledAt, status: 'attended',
            })
        ).rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('[REGRESSÃO] Diário de Sessões (saveSession/deleteSession) não desalinha sessão vinculada', () => {
    it('#11 — editar data/status de uma sessão vinculada via saveSession é bloqueado (409); editar notes funciona', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-21T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt, status: 'attended',
        });
        const session = await pool.query(
            `SELECT id, date, status FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );
        const { id: sessionId, date, status } = session.rows[0];

        // Mudar a data é bloqueado
        await expect(
            repo.saveSession({
                id: sessionId, tenantId: tenant.id, patientId: patient.id,
                date: new Date('2025-06-22T14:00:00Z'), status,
            })
        ).rejects.toMatchObject({ statusCode: 409 });

        // Mudar SÓ o status (mesma data) também é bloqueado
        await expect(
            repo.saveSession({
                id: sessionId, tenantId: tenant.id, patientId: patient.id,
                date, status: 'justified_absence',
            })
        ).rejects.toMatchObject({ statusCode: 409 });

        // Editar só a nota funciona normalmente
        const updated = await repo.saveSession({
            id: sessionId, tenantId: tenant.id, patientId: patient.id,
            date, status, notes: 'Nota adicionada pelo Diário',
        });
        expect(updated.notes).toBe('Nota adicionada pelo Diário');
    });

    it('#11b — saveSession rejeita (409) se o patientId enviado está desatualizado', async () => {
        const tenant = await createTenant(pool);
        const patientA = await createPatient(pool, tenant.id);
        const patientB = await createPatient(pool, tenant.id);

        const manual = await repo.saveSession({
            tenantId: tenant.id, patientId: patientA.id,
            date: new Date('2025-06-26T14:00:00Z'), status: 'attended',
        });

        // Cliente enviando um patientId diferente do que a sessão realmente tem agora
        // (ex: tela desatualizada) — deve rejeitar, não gravar em cima do paciente errado.
        await expect(
            repo.saveSession({
                id: manual.id, tenantId: tenant.id, patientId: patientB.id,
                date: manual.date, status: manual.status, notes: 'Nota enviada com dado obsoleto',
            })
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('#12 — excluir uma sessão vinculada via deleteSession é bloqueado (409)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const scheduledAt = new Date('2025-06-23T14:00:00Z');

        const appointment = await repo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt, status: 'attended',
        });
        const session = await pool.query(
            `SELECT id FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2`,
            [tenant.id, appointment.id]
        );

        await expect(
            repo.deleteSession(tenant.id, session.rows[0].id)
        ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('#13 — sessão manual (sem agendamento) continua editável/excluível normalmente pelo Diário', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);

        const manual = await repo.saveSession({
            tenantId: tenant.id, patientId: patient.id,
            date: new Date('2025-06-24T14:00:00Z'), status: 'attended', notes: 'Entrada manual',
        });

        const updated = await repo.saveSession({
            id: manual.id, tenantId: tenant.id, patientId: patient.id,
            date: new Date('2025-06-25T09:00:00Z'), status: 'justified_absence',
        });
        expect(updated.status).toBe('justified_absence');

        await expect(repo.deleteSession(tenant.id, manual.id)).resolves.not.toThrow();
    });
});
