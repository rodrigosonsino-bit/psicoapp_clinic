import 'reflect-metadata';
import { Pool } from 'pg';
import { container } from '../../container';
import { getTestPool, teardownTestDb, truncateTables } from './helpers/testDb';
import { createTenant, createPatient } from './helpers/fixtures';
import { TranscriptionController } from '../../presentation/controllers/TranscriptionController';
import { Response } from 'express';
import { AuthenticatedRequest } from '../../presentation/middlewares/authMiddleware';

jest.setTimeout(60000);

const TABLES = [
    'session_transcripts',
    'psychotherapy_sessions',
    'psychotherapy_appointments',
    'psychotherapy_patients',
    'tenants'
];

describe('Transcription Integration Tests', () => {
    let pool: Pool;
    let controller: TranscriptionController;
    let tenantId: string;
    let patientId: string;
    let sessionId: string;

    beforeAll(async () => {
        pool = await getTestPool();
        // Registra o pool de testes no container
        container.registerInstance(Pool, pool);
        controller = container.resolve(TranscriptionController);
    });

    afterAll(async () => {
        await teardownTestDb();
    });

    beforeEach(async () => {
        await truncateTables(pool, TABLES);

        // Criar fixtures básicas
        const tenant = await createTenant(pool);
        tenantId = tenant.id;
        const patient = await createPatient(pool, tenantId);
        patientId = patient.id;

        // Criar um agendamento e uma sessão vinculada para poder referenciar
        const apptRes = await pool.query(`
            INSERT INTO psychotherapy_appointments (tenant_id, patient_id, scheduled_at, duration_minutes, status, recurrence)
            VALUES ($1, $2, NOW(), 50, 'scheduled', 'none')
            RETURNING id;
        `, [tenantId, patientId]);
        const appointmentId = apptRes.rows[0].id;

        const sessionRes = await pool.query(`
            INSERT INTO psychotherapy_sessions (tenant_id, patient_id, date, status, appointment_id)
            VALUES ($1, $2, NOW(), 'attended', $3)
            RETURNING id;
        `, [tenantId, patientId, appointmentId]);
        sessionId = sessionRes.rows[0].id;
    });

    it('deve transcrever uma sessão e gerar o rascunho de IA (modo mock/desenvolvimento)', async () => {
        const req = {
            tenantId,
            params: { id: sessionId },
            file: {
                buffer: Buffer.from('mock-audio-data'),
                mimetype: 'audio/wav',
                originalname: 'session.wav'
            }
        } as unknown as AuthenticatedRequest;

        const jsonMock = jest.fn();
        const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
        const res = {
            status: statusMock
        } as unknown as Response;

        await controller.transcribeSession(req, res);

        expect(statusMock).toHaveBeenCalledWith(200);
        expect(jsonMock).toHaveBeenCalledWith(
            expect.objectContaining({
                transcript: expect.any(String),
                summary: expect.any(String)
            })
        );

        // Verificar se foi persistido no banco
        const dbRes = await pool.query('SELECT * FROM session_transcripts WHERE session_id = $1', [sessionId]);
        expect(dbRes.rows).toHaveLength(1);
        expect(dbRes.rows[0].raw_transcript).toContain('Hoje na sessão de terapia conversamos');
    });

    it('deve retornar 404 se a transcrição não existir', async () => {
        const req = {
            tenantId,
            params: { id: sessionId }
        } as unknown as AuthenticatedRequest;

        const jsonMock = jest.fn();
        const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
        const res = {
            status: statusMock
        } as unknown as Response;

        await controller.getTranscription(req, res);

        expect(statusMock).toHaveBeenCalledWith(404);
        expect(jsonMock).toHaveBeenCalledWith({
            message: 'Nenhuma transcrição encontrada para esta sessão.'
        });
    });
});
