import 'reflect-metadata';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/test_db';
import request from 'supertest';
import app from '../../server';
import { container } from '../../container';
import { Pool } from 'pg';

describe('E2E - Health Check', () => {
    let dbPool: Pool;

    beforeAll(() => {
        dbPool = container.resolve(Pool);
        jest.spyOn(dbPool, 'query').mockImplementation(async () => ({ rowCount: 1, rows: [{}] } as any));
    });

    afterAll(async () => {
        jest.spyOn(dbPool, 'end').mockImplementation(async () => undefined as any);
        await dbPool.end();
        jest.restoreAllMocks();
    });

    it('Should return 200 OK from /health endpoint', async () => {
        const response = await request(app).get('/health');
        
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
        expect(response.body.service).toBe('psychotherapy-backend');
        expect(response.body.database).toBe('connected');
        expect(response.body).toHaveProperty('timestamp');
    });
});
