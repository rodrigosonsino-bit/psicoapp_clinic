/**
 * groupSessions.integration.test.ts
 *
 * Testes de integração para RegisterGroupSessionUseCase.
 * Valida criação atômica do calendar_event compartilhado, gravação de
 * calendar_event_id nos appointments (NOT NULL) e idempotência.
 *
 * Cenários do plano: #12, #13, #14, #15
 */

import 'reflect-metadata';
import { Pool } from 'pg';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createGroup, createPatient, addGroupMember } from './helpers/fixtures';
import { RegisterGroupSessionUseCase } from '../../application/useCases/RegisterGroupSessionUseCase';

jest.setTimeout(120_000);

const TABLES = [
    'group_payments', 'group_session_records',
    'psychotherapy_appointments', 'calendar_events',
    'therapy_group_members', 'therapy_groups',
    'psychotherapy_patients', 'tenants',
];

let pool: Pool;
let registerSessionUseCase: RegisterGroupSessionUseCase;

beforeAll(async () => {
    pool = await getTestPool();
    registerSessionUseCase = new RegisterGroupSessionUseCase(pool);
});

afterAll(async () => {
    await teardownTestDb();
});

afterEach(async () => {
    await truncateTables(pool, TABLES);
});

describe('RegisterGroupSessionUseCase', () => {
    it('#12 e #14 — registra sessão e cria um único calendar_event compartilhado', async () => {
        const tenant   = await createTenant(pool);
        const patient1 = await createPatient(pool, tenant.id);
        const patient2 = await createPatient(pool, tenant.id);
        const group    = await createGroup(pool, tenant.id);

        const member1 = await addGroupMember(pool, group.id, patient1.id, tenant.id);
        const member2 = await addGroupMember(pool, group.id, patient2.id, tenant.id);

        const result = await registerSessionUseCase.execute({
            tenantId: tenant.id,
            groupId: group.id,
            sessionDate: '2025-05-10',
            attendances: [
                { groupMemberId: member1, status: 'present' },
                { groupMemberId: member2, status: 'absent' },
            ],
            sessionNotes: 'Sessão normal',
        });

        expect(result.records).toHaveLength(2);
        expect(result.appointmentsProcessed).toBe(2);

        // Verifica que apenas 1 calendar_event foi criado
        const events = await pool.query(
            `SELECT id FROM calendar_events WHERE tenant_id = $1 AND group_id = $2`,
            [tenant.id, group.id]
        );
        expect(events.rows).toHaveLength(1);
        const eventId = events.rows[0].id;

        // Verifica que os appointments foram criados com o calendar_event_id
        const appointments = await pool.query(
            `SELECT id, calendar_event_id, status FROM psychotherapy_appointments WHERE group_id = $1`,
            [group.id]
        );
        expect(appointments.rows).toHaveLength(2);
        expect(appointments.rows[0].calendar_event_id).toBe(eventId);
        expect(appointments.rows[1].calendar_event_id).toBe(eventId);
    });

    it('#13 — registrar a mesma sessão novamente atualiza os dados em vez de duplicar', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        const group   = await createGroup(pool, tenant.id);

        const member1 = await addGroupMember(pool, group.id, patient.id, tenant.id);

        // Primeira chamada
        await registerSessionUseCase.execute({
            tenantId: tenant.id, groupId: group.id,
            sessionDate: '2025-05-15',
            attendances: [{ groupMemberId: member1, status: 'present' }],
        });

        // Segunda chamada (idempotente) com status alterado
        const result = await registerSessionUseCase.execute({
            tenantId: tenant.id, groupId: group.id,
            sessionDate: '2025-05-15',
            attendances: [{ groupMemberId: member1, status: 'absent' }], // mudou para absent
        });

        expect(result.appointmentsProcessed).toBe(1);

        // calendar_events não deve ter duplicado
        const events = await pool.query(`SELECT COUNT(*) FROM calendar_events WHERE group_id = $1`, [group.id]);
        expect(Number(events.rows[0].count)).toBe(1);

        // appointment não duplicou e foi atualizado
        const appointments = await pool.query(`SELECT status FROM psychotherapy_appointments WHERE group_id = $1`, [group.id]);
        expect(appointments.rows).toHaveLength(1);
        expect(appointments.rows[0].status).toBe('no_show'); // 'absent' mapeia para 'no_show'
    });

    it('#15 — registrar sessão em grupo sem mensalidade cria group_payment pendente', async () => {
        const tenant  = await createTenant(pool);
        const patient = await createPatient(pool, tenant.id);
        // group sem monthly_fee, mas com session_price
        const group   = await createGroup(pool, tenant.id, { monthlyFeeCents: 0, sessionPriceCents: 15000 });

        const member1 = await addGroupMember(pool, group.id, patient.id, tenant.id);

        await registerSessionUseCase.execute({
            tenantId: tenant.id, groupId: group.id,
            sessionDate: '2025-06-01',
            attendances: [{ groupMemberId: member1, status: 'present' }],
        });

        const payment = await pool.query(
            `SELECT amount_cents, original_amount_cents, status FROM group_payments WHERE group_id = $1`,
            [group.id]
        );

        expect(payment.rows).toHaveLength(1);
        expect(payment.rows[0].amount_cents).toBe(15000);
        expect(payment.rows[0].original_amount_cents).toBe(15000);
        expect(payment.rows[0].status).toBe('pending');
    });
});
