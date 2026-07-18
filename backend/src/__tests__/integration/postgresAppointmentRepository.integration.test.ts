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
import { createTenant, createPatient } from './helpers/fixtures';
import { PostgresAppointmentRepository } from '../../infrastructure/repositories/PostgresAppointmentRepository';
import { NotFoundError } from '../../domain/errors/NotFoundError';
import { AppError } from '../../domain/errors/AppError';

jest.setTimeout(120_000);

const TABLES = [
    'psychotherapy_clinical_notes', 'psychotherapy_sessions', 'psychotherapy_appointments',
    'calendar_events', 'psychotherapy_monthly_records', 'psychotherapy_patients', 'tenants',
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
