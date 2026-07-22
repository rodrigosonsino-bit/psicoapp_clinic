/**
 * postgresAppointmentRepository.integration.test.ts
 *
 * Testes de integração contra PostgreSQL real para PostgresAppointmentRepository.saveAppointment,
 * .deleteAppointment e .updateAppointmentStatus — os 3 métodos COMPLEXO (transação própria com
 * FOR UPDATE, chamam syncMonthlyRecord) extraídos de PostgresPsychotherapyRepository, até aqui só
 * verificados por diff mecânico + build.
 *
 * Cobre especificamente as proteções de conteúdo clínico documentadas no código-fonte (achados de
 * revisão de 03/07 e 04/07/2026): sincronização retroativa attended→sessão, bloqueio de reversão
 * de status/troca de paciente quando há nota clínica vinculada, preservação de sessão com nota ao
 * deletar o agendamento, e o efeito colateral de calendar_events (1-para-1 pra individual).
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createPatient, createGroup } from './helpers/fixtures';
import { PostgresAppointmentRepository } from '../../infrastructure/repositories/PostgresAppointmentRepository';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { AppError } from '../../domain/errors/AppError';

jest.setTimeout(120_000);

const TABLES = [
    'psychotherapy_clinical_notes', 'psychotherapy_sessions', 'psychotherapy_appointments',
    'calendar_events', 'psychotherapy_monthly_records', 'psychotherapy_patients', 'therapy_groups', 'tenants',
];

let pool: Pool;
let appointmentRepo: PostgresAppointmentRepository;

beforeAll(async () => {
    pool = await getTestPool();
    appointmentRepo = new PostgresAppointmentRepository(pool);
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

async function addClinicalNoteToAppointmentSession(pool: Pool, tenantId: string, patientId: string, appointmentId: string) {
    const sessionRes = await pool.query(
        'SELECT id FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2',
        [tenantId, appointmentId]
    );
    const sessionId = sessionRes.rows[0].id;
    await pool.query(
        `INSERT INTO psychotherapy_clinical_notes (id, tenant_id, patient_id, session_id, note_date, content)
         VALUES (gen_random_uuid(), $1, $2, $3, CURRENT_DATE, 'Nota clínica de teste')`,
        [tenantId, patientId, sessionId]
    );
    return sessionId;
}

describe('PostgresAppointmentRepository.saveAppointment', () => {
    it('cria um agendamento individual novo com calendar_event 1-para-1', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);

        const appointment = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt: new Date('2025-02-10T14:00:00Z'),
        });

        expect(appointment.patientId).toBe(patient.id);
        expect(appointment.status).toBe('scheduled');

        const event = await pool.query('SELECT id FROM calendar_events WHERE id = $1 AND tenant_id = $2', [appointment.id, tenant.id]);
        expect(event.rows).toHaveLength(1);
    });

    it('criar um agendamento já com status attended gera a sessão correspondente (fluxo retroativo)', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);

        const appointment = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt: new Date('2025-02-10T14:00:00Z'), status: 'attended',
        });

        const session = await pool.query(
            'SELECT status FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2',
            [tenant.id, appointment.id]
        );
        expect(session.rows).toHaveLength(1);
        expect(session.rows[0].status).toBe('attended');
    });

    it('bloqueia troca de paciente quando a sessão vinculada tem nota clínica registrada', async () => {
        const tenant = await createTenant(pool);
        const patientA = await createPatient(pool, tenant.id);
        const patientB = await createPatient(pool, tenant.id);

        const appointment = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patientA.id, scheduledAt: new Date('2025-02-10T14:00:00Z'), status: 'attended',
        });
        await addClinicalNoteToAppointmentSession(pool, tenant.id, patientA.id, appointment.id);

        await expect(appointmentRepo.saveAppointment({
            id: appointment.id, tenantId: tenant.id, patientId: patientB.id, scheduledAt: new Date('2025-02-10T14:00:00Z'), status: 'attended',
        })).rejects.toThrow(AppError);

        const stillPatientA = await pool.query('SELECT patient_id FROM psychotherapy_appointments WHERE id = $1', [appointment.id]);
        expect(stillPatientA.rows[0].patient_id).toBe(patientA.id);
    });

    it('bloqueia reverter status pra scheduled quando a sessão vinculada tem nota clínica', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);

        const appointment = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt: new Date('2025-02-10T14:00:00Z'), status: 'attended',
        });
        await addClinicalNoteToAppointmentSession(pool, tenant.id, patient.id, appointment.id);

        await expect(appointmentRepo.saveAppointment({
            id: appointment.id, tenantId: tenant.id, patientId: patient.id, scheduledAt: new Date('2025-02-10T14:00:00Z'), status: 'scheduled',
        })).rejects.toThrow(AppError);
    });
});

describe('PostgresAppointmentRepository.updateAppointmentStatus', () => {
    it('attended cria a sessão vinculada se ainda não existir', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const appointment = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt: new Date('2025-02-10T14:00:00Z'),
        });

        await appointmentRepo.updateAppointmentStatus(tenant.id, appointment.id, 'attended');

        const session = await pool.query(
            'SELECT status FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2',
            [tenant.id, appointment.id]
        );
        expect(session.rows).toHaveLength(1);
        expect(session.rows[0].status).toBe('attended');
    });

    it('no_show mapeia pra unjustified_absence na sessão', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const appointment = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt: new Date('2025-02-10T14:00:00Z'),
        });

        await appointmentRepo.updateAppointmentStatus(tenant.id, appointment.id, 'no_show');

        const session = await pool.query(
            'SELECT status FROM psychotherapy_sessions WHERE tenant_id = $1 AND appointment_id = $2',
            [tenant.id, appointment.id]
        );
        expect(session.rows[0].status).toBe('unjustified_absence');
    });

    it('bloqueia reverter pra confirmed quando a sessão vinculada tem nota clínica', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const appointment = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt: new Date('2025-02-10T14:00:00Z'), status: 'attended',
        });
        await addClinicalNoteToAppointmentSession(pool, tenant.id, patient.id, appointment.id);

        await expect(
            appointmentRepo.updateAppointmentStatus(tenant.id, appointment.id, 'confirmed')
        ).rejects.toThrow(AppError);
    });

    it('lança NotFoundError para agendamento inexistente ou de outro tenant', async () => {
        const tenant = await createTenant(pool);
        await expect(
            appointmentRepo.updateAppointmentStatus(tenant.id, '00000000-0000-0000-0000-000000000000', 'attended')
        ).rejects.toThrow(NotFoundError);
    });
});

describe('PostgresAppointmentRepository.deleteAppointment', () => {
    it('apaga o agendamento e o calendar_event individual correspondente', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const appointment = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt: new Date('2025-02-10T14:00:00Z'),
        });

        await appointmentRepo.deleteAppointment(tenant.id, appointment.id);

        const appt = await pool.query('SELECT id FROM psychotherapy_appointments WHERE id = $1', [appointment.id]);
        expect(appt.rows).toHaveLength(0);
        const event = await pool.query('SELECT id FROM calendar_events WHERE id = $1', [appointment.id]);
        expect(event.rows).toHaveLength(0);
    });

    it('preserva a sessão com nota clínica (desvincula em vez de apagar) ao deletar o agendamento', async () => {
        const tenant = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const appointment = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patient.id, scheduledAt: new Date('2025-02-10T14:00:00Z'), status: 'attended',
        });
        const sessionId = await addClinicalNoteToAppointmentSession(pool, tenant.id, patient.id, appointment.id);

        await appointmentRepo.deleteAppointment(tenant.id, appointment.id);

        const appt = await pool.query('SELECT id FROM psychotherapy_appointments WHERE id = $1', [appointment.id]);
        expect(appt.rows).toHaveLength(0);

        const session = await pool.query('SELECT appointment_id FROM psychotherapy_sessions WHERE id = $1', [sessionId]);
        expect(session.rows).toHaveLength(1);
        expect(session.rows[0].appointment_id).toBeNull();
    });

    it('lança NotFoundError para agendamento inexistente ou de outro tenant', async () => {
        const tenant = await createTenant(pool);
        await expect(
            appointmentRepo.deleteAppointment(tenant.id, '00000000-0000-0000-0000-000000000000')
        ).rejects.toThrow(NotFoundError);
    });
});

describe('PostgresAppointmentRepository - Proteção Física de Agenda / Concorrência', () => {
    it('bloqueia agendamentos individuais sobrepostos no mesmo tenant (concorrência)', async () => {
        const tenant = await createTenant(pool);
        const patientA = await createPatient(pool, tenant.id);
        const patientB = await createPatient(pool, tenant.id);
        const date = new Date('2025-02-10T14:00:00Z');

        // Cria o primeiro agendamento
        await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patientA.id, scheduledAt: date,
        });

        // Tenta criar outro agendamento no mesmo horário para o mesmo tenant
        await expect(appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patientB.id, scheduledAt: date,
        })).rejects.toThrow(AppError);
    });

    it('garante que apenas uma de duas tentativas simultâneas no mesmo horário é bem-sucedida', async () => {
        const tenant = await createTenant(pool);
        const patientA = await createPatient(pool, tenant.id);
        const patientB = await createPatient(pool, tenant.id);
        const date = new Date('2025-02-12T09:00:00Z');

        const promises = [
            appointmentRepo.saveAppointment({ tenantId: tenant.id, patientId: patientA.id, scheduledAt: date }),
            appointmentRepo.saveAppointment({ tenantId: tenant.id, patientId: patientB.id, scheduledAt: date })
        ];

        const results = await Promise.allSettled(promises);
        const fulfilled = results.filter(r => r.status === 'fulfilled');
        const rejected = results.filter(r => r.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
        expect(((rejected[0] as PromiseRejectedResult).reason as AppError).statusCode).toBe(409);
    });

    it('permite agendamentos no mesmo horário em tenants diferentes', async () => {
        const tenant1 = await createTenant(pool);
        const tenant2 = await createTenant(pool);
        const patient1 = await createPatient(pool, tenant1.id);
        const patient2 = await createPatient(pool, tenant2.id);
        const date = new Date('2025-02-10T14:00:00Z');

        await expect(appointmentRepo.saveAppointment({
            tenantId: tenant1.id, patientId: patient1.id, scheduledAt: date,
        })).resolves.toBeDefined();

        await expect(appointmentRepo.saveAppointment({
            tenantId: tenant2.id, patientId: patient2.id, scheduledAt: date,
        })).resolves.toBeDefined();
    });

    it('permite múltiplos agendamentos no mesmo horário para o mesmo grupo (mesmo calendar_event_id)', async () => {
        const tenant = await createTenant(pool);
        const patientA = await createPatient(pool, tenant.id);
        const patientB = await createPatient(pool, tenant.id);
        const group = await createGroup(pool, tenant.id);
        const date = new Date('2025-02-10T14:00:00Z');

        // Cria o primeiro agendamento do grupo
        const app1 = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patientA.id, scheduledAt: date, groupId: group.id,
        });

        // Cria o segundo agendamento do grupo (deve compartilhar o mesmo calendarEventId)
        const app2 = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patientB.id, scheduledAt: date, groupId: group.id,
        });

        const dbApp1 = await pool.query('SELECT calendar_event_id FROM psychotherapy_appointments WHERE id = $1', [app1.id]);
        const dbApp2 = await pool.query('SELECT calendar_event_id FROM psychotherapy_appointments WHERE id = $1', [app2.id]);
        expect(dbApp1.rows[0].calendar_event_id).toBe(dbApp2.rows[0].calendar_event_id);
    });

    it('agendamento cancelado não bloqueia novo agendamento no mesmo slot', async () => {
        const tenant = await createTenant(pool);
        const patientA = await createPatient(pool, tenant.id);
        const patientB = await createPatient(pool, tenant.id);
        const date = new Date('2025-02-10T14:00:00Z');

        // Cria o primeiro agendamento
        const app1 = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patientA.id, scheduledAt: date,
        });

        // Cancela o primeiro agendamento
        await appointmentRepo.updateAppointmentStatus(tenant.id, app1.id, 'canceled');

        // Agora deve ser possível criar um novo agendamento no mesmo horário
        const app2 = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patientB.id, scheduledAt: date,
        });

        expect(app2.id).toBeDefined();
    });

    it('restauração concorrente de cancelado contra novo agendamento ativo falha', async () => {
        const tenant = await createTenant(pool);
        const patientA = await createPatient(pool, tenant.id);
        const patientB = await createPatient(pool, tenant.id);
        const date = new Date('2025-02-10T14:00:00Z');

        // 1. Cria e cancela agendamento do Paciente A
        const appA = await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patientA.id, scheduledAt: date,
        });
        await appointmentRepo.updateAppointmentStatus(tenant.id, appA.id, 'canceled');

        // 2. Cria agendamento ativo para Paciente B no mesmo horário
        await appointmentRepo.saveAppointment({
            tenantId: tenant.id, patientId: patientB.id, scheduledAt: date,
        });

        // 3. Tenta restaurar o agendamento do Paciente A (deve falhar por conflito)
        await expect(
            appointmentRepo.updateAppointmentStatus(tenant.id, appA.id, 'confirmed')
        ).rejects.toThrow(AppError);
    });
});
