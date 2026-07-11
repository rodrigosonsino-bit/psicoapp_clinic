import 'reflect-metadata';

// Set environment variables before imports
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/test_db';

// Mock bcrypt hash/compare globally for these E2E tests to speed them up and avoid timeout
const bcrypt = require('bcrypt');
jest.spyOn(bcrypt, 'hash').mockImplementation(async () => 'hashedpassword');
jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

import { container } from '../../container';
import { mock, MockProxy } from 'jest-mock-extended';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { IAuthRepository } from '../../domain/repositories/IAuthRepository';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';

// Create Mocks
const mockRepo: MockProxy<IPsychotherapyRepository> = mock<IPsychotherapyRepository>();
const mockAuthRepo: MockProxy<IAuthRepository> = mock<IAuthRepository>();

// Register Mocks in DI container BEFORE loading server
container.registerInstance('IPsychotherapyRepository', mockRepo);
container.registerInstance('IAuthRepository', mockAuthRepo);

import request from 'supertest';
import app from '../../server';
import { JwtService } from '../../infrastructure/auth/JwtService';

describe('E2E - API Integration Tests', () => {
    let authToken: string;
    const testTenantId = 'e3b0c442-98fc-11ee-b9d1-0242ac120002';

    beforeAll(() => {
        const jwtService = new JwtService();
        authToken = jwtService.generateToken({
            tenantId: testTenantId,
            email: 'test@example.com',
            plan: 'starter',
            tokenUse: 'session'
        });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Auth Routes', () => {
        it('POST /auth/register - Should register a new tenant', async () => {
            const tenantData = {
                id: testTenantId,
                name: 'Test Tenant',
                email: 'test@example.com',
                passwordHash: 'hashedpassword',
                plan: 'starter',
                status: 'active'
            };
            mockAuthRepo.createTenant.mockResolvedValue(tenantData);

            const res = await request(app)
                .post('/auth/register')
                .send({
                    name: 'Test Tenant',
                    email: 'test@example.com',
                    password: 'password123'
                });

            expect(res.status).toBe(201);
            expect(res.body.tenant.id).toBe(testTenantId);
            expect(res.body.tenant.email).toBe('test@example.com');
        });

        it('POST /auth/login - Should log in and return tokens', async () => {
            const tenantData = {
                id: testTenantId,
                name: 'Test Tenant',
                email: 'test@example.com',
                passwordHash: '$2b$10$abcdefghijklmnopqrstuv', // Fake bcrypt hash
                plan: 'starter',
                status: 'active'
            };
            mockAuthRepo.findTenantByEmail.mockResolvedValue(tenantData);
            
            // Mock bcrypt compare inside LoginTenantUseCase
            // We just bypass bcrypt comparison by throwing or mocking it if login use case is tested,
            // but login use case is tested separately. Let's make sure it passes.
            // Wait, LoginTenantUseCase imports bcrypt. We can spy on it or mock it.
            const bcrypt = require('bcrypt');
            jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

            const res = await request(app)
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'password123'
                });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('accessToken');
            expect(res.body).toHaveProperty('refreshToken');
        });

        it('POST /auth/refresh - Should refresh token', async () => {
            const tenantData = {
                id: testTenantId,
                name: 'Test Tenant',
                email: 'test@example.com',
                passwordHash: 'hash',
                plan: 'starter',
                status: 'active'
            };
            mockAuthRepo.rotateRefreshToken.mockResolvedValue({
                tenantId: testTenantId,
                familyId: 'family-1'
            });
            mockAuthRepo.findTenantById.mockResolvedValue(tenantData);

            const res = await request(app)
                .post('/auth/refresh')
                .send({
                    refreshToken: 'e3b0c442-98fc-11ee-b9d1-0242ac120002'
                });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('accessToken');
        });
    });

    describe('Patient Routes', () => {
        it('GET /api/psychotherapy/patients - Should list patients', async () => {
            const patientsList = {
                data: [
                    { id: '1', name: 'Patient A', status: 'weekly' },
                    { id: '2', name: 'Patient B', status: 'biweekly' }
                ],
                total: 2
            };
            mockRepo.listPatients.mockResolvedValue(patientsList as any);

            const res = await request(app)
                .get('/api/psychotherapy/patients')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.meta.total).toBe(2);
        });

        it('POST /api/psychotherapy/patients - Should create new patient', async () => {
            const patientData = {
                id: 'patient-uuid',
                tenantId: testTenantId,
                name: 'New Patient',
                status: 'weekly',
                paymentType: 'monthly',
                defaultSessionPriceCents: 15000,
                notes: 'Test note',
                document: '123456789',
                phone: '123456',
                email: 'patient@example.com',
                createdAt: new Date(),
                updatedAt: new Date()
            };
            mockRepo.savePatient.mockResolvedValue(patientData as any);

            const res = await request(app)
                .post('/api/psychotherapy/patients')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: 'New Patient',
                    status: 'weekly',
                    paymentType: 'monthly',
                    defaultSessionPriceCents: 15000
                });

            expect(res.status).toBe(201);
            expect(res.body.data.name).toBe('New Patient');
        });

        it('DELETE /api/psychotherapy/patients/:id - Should delete patient', async () => {
            const patientId = 'e3b0c442-98fc-11ee-b9d1-0242ac120002';
            mockRepo.listAppointments.mockResolvedValue({ data: [], total: 0 });
            mockRepo.deletePatient.mockResolvedValue();

            const res = await request(app)
                .delete(`/api/psychotherapy/patients/${patientId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(204);
        });
    });

    describe('Monthly Record Routes', () => {
        it('GET /api/psychotherapy/months/:month - Should get monthly records and summary', async () => {
            const mockSummary = {
                month: '2026-06',
                totalPatients: 1,
                activePatients: 1,
                inactivePatients: 0,
                paidRecords: 0,
                pendingRecords: 1,
                partialRecords: 0,
                expectedAmountCents: 10000,
                receivedAmountCents: 0,
                pendingAmountCents: 10000,
                totalAbsences: 0
            };
            const mockRecords = [
                new PsychotherapyMonthlyRecord(
                    'rec-1',
                    testTenantId,
                    'pat-1',
                    '2026-06',
                    'Patient A',
                    'weekly',
                    'per_session',
                    2500, // sessionPriceCents
                    4,    // expectedSessions
                    0,    // paidSessions
                    0,    // absences
                    'pending',
                    null,
                    0,
                    new Date(),
                    new Date()
                )
            ];

            mockRepo.listMonthlyRecords.mockResolvedValue(mockRecords);

            const res = await request(app)
                .get('/api/psychotherapy/months/2026-06')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.summary.expectedAmountCents).toBe(10000);
            expect(res.body.records).toHaveLength(1);
        });

        it('POST /api/psychotherapy/months/:month/generate - Should generate monthly records', async () => {
            mockRepo.listPatients.mockResolvedValue([
                { id: 'pat-1', name: 'Patient A', status: 'weekly', paymentType: 'monthly', defaultSessionPriceCents: 10000 }
            ] as any);
            mockRepo.countScheduledSessionsByPatient.mockResolvedValue(new Map());
            mockRepo.listMonthlyRecords.mockResolvedValue([]);
            mockRepo.bulkSaveMonthlyRecords.mockResolvedValue([
                { id: 'rec-1', month: '2026-06', patientNameSnapshot: 'Patient A', status: 'weekly', paymentStatus: 'pending' }
            ] as any);

            const res = await request(app)
                .post('/api/psychotherapy/months/2026-06/generate')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(201);
            expect(res.body.data).toHaveLength(1);
        });
    });

    describe('Receipt Routes', () => {
        it('POST /api/psychotherapy/receipts - Should issue a receipt', async () => {
            const mockReceipt = {
                id: 'receipt-uuid',
                tenantId: testTenantId,
                patientId: 'pat-uuid',
                receiptNumber: 10,
                amountCents: 15000,
                issueDate: new Date(),
                description: 'Consultation Fee',
                createdAt: new Date(),
                updatedAt: new Date(),
                toJSON: () => ({ id: 'receipt-uuid', receiptNumber: 10, amountCents: 15000 })
            };
            mockRepo.findPatientById.mockResolvedValue({ id: 'pat-uuid', name: 'Patient X', document: '12345678901' } as any);
            mockRepo.saveReceipt.mockResolvedValue(mockReceipt as any);

            const res = await request(app)
                .post('/api/psychotherapy/receipts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    patientId: 'e3b0c442-98fc-11ee-b9d1-0242ac120002',
                    amountCents: 15000,
                    description: 'Consultation Fee'
                });

            expect(res.status).toBe(201);
            expect(res.body.receiptNumber).toBe(10);
        });
    });

    describe('Session Routes', () => {
        it('POST /api/psychotherapy/sessions - Should save a session', async () => {
            const mockSession = {
                id: 'sess-uuid',
                tenantId: testTenantId,
                patientId: 'pat-uuid',
                date: new Date(),
                status: 'attended',
                notes: 'Good progress'
            };
            mockRepo.findPatientById.mockResolvedValue({ id: 'pat-uuid', name: 'Patient X' } as any);
            mockRepo.saveSession.mockResolvedValue(mockSession as any);

            const res = await request(app)
                .post('/api/psychotherapy/sessions')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    patientId: 'e3b0c442-98fc-11ee-b9d1-0242ac120002',
                    date: new Date().toISOString(),
                    status: 'attended',
                    notes: 'Good progress'
                });

            expect(res.status).toBe(201);
            expect(res.body.notes).toBe('Good progress');
        });

        it('GET /api/psychotherapy/sessions - Should list sessions', async () => {
            const mockSessions = {
                data: [
                    { id: 'sess-1', patientId: 'pat-1', status: 'attended', date: new Date() }
                ],
                total: 1
            };
            mockRepo.listSessions.mockResolvedValue(mockSessions as any);

            const res = await request(app)
                .get('/api/psychotherapy/sessions')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.meta.total).toBe(1);
        });
    });

    describe('Expense and Analytics Routes', () => {
        it('POST /api/psychotherapy/expenses - Should save an expense', async () => {
            const mockExpense = {
                id: 'exp-uuid',
                tenantId: testTenantId,
                date: new Date(),
                amountCents: 50000,
                description: 'Office Rent',
                category: 'rent'
            };
            mockRepo.saveExpense.mockResolvedValue(mockExpense as any);

            const res = await request(app)
                .post('/api/psychotherapy/expenses')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    date: new Date().toISOString(),
                    amountCents: 50000,
                    description: 'Office Rent',
                    category: 'rent'
                });

            expect(res.status).toBe(201);
            expect(res.body.category).toBe('rent');
        });

        it('GET /api/psychotherapy/analytics/dashboard - Should get analytics', async () => {
            const mockAnalytics = {
                currentMonth: {
                    revenueCents: 100000,
                    sessionRevenueCents: 80000,
                    expensesCents: 50000,
                    netIncomeCents: 50000,
                    pendingCents: 20000
                },
                sixMonthsTrend: []
            };
            mockRepo.getDashboardAnalytics.mockResolvedValue(mockAnalytics);

            const res = await request(app)
                .get('/api/psychotherapy/analytics/dashboard')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.currentMonth.netIncomeCents).toBe(50000);
        });
    });
});
