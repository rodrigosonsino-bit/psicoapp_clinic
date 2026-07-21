import 'reflect-metadata';
import { SyncGoogleCalendarEventsUseCase } from '../SyncGoogleCalendarEventsUseCase';
import { PsychotherapyAppointment, AppointmentStatus } from '../../../domain/models/PsychotherapyAppointment';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../../infrastructure/google/GoogleCalendarService';
import { Pool } from 'pg';

describe('SyncGoogleCalendarEventsUseCase — restauração de evento removido', () => {
    const appointment = (status: AppointmentStatus) => new PsychotherapyAppointment(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        new Date('2026-07-20T14:00:00.000Z'),
        50,
        status,
        'weekly',
        new Date('2026-12-14T03:00:00.000Z'),
        null,
        'legacy-series-id',
        null,
        '44444444-4444-4444-8444-444444444444',
        null
    );

    it.each<AppointmentStatus>(['attended', 'no_show', 'canceled'])(
        'não restaura série em estado terminal %s',
        async status => {
            const repository = {
                findAppointmentByGoogleEventId: jest.fn().mockResolvedValue(appointment(status)),
                findPatientById: jest.fn(),
                advanceAppointmentGoogleEventGeneration: jest.fn(),
            } as unknown as IPsychotherapyRepository;
            const googleCalendar = { syncAppointment: jest.fn() } as unknown as GoogleCalendarService;
            const useCase = new SyncGoogleCalendarEventsUseCase(repository, googleCalendar, {} as Pool);

            await (useCase as any).restoreIfStillActiveInApp(
                '22222222-2222-4222-8222-222222222222',
                'legacy-series-id'
            );

            expect(repository.findPatientById).not.toHaveBeenCalled();
            expect(repository.advanceAppointmentGoogleEventGeneration).not.toHaveBeenCalled();
            expect(googleCalendar.syncAppointment).not.toHaveBeenCalled();
        }
    );

    it('usa o paciente autoritativo do root para vincular filho mesmo sem correspondência heurística', async () => {
        const tenantId = '22222222-2222-4222-8222-222222222222';
        const rootId = '11111111-1111-4111-8111-111111111111';
        const childId = '55555555-5555-4555-8555-555555555555';
        const patientId = '33333333-3333-4333-8333-333333333333';
        const masterId = 'google-master';
        const occurrenceId = `${masterId}_20260803T140000Z`;
        const root = {
            id: rootId, tenantId, patientId, parentId: null,
            scheduledAt: new Date('2026-07-27T14:00:00.000Z'), durationMinutes: 50,
            status: 'scheduled', recurrence: 'weekly', googleEventId: masterId,
        } as PsychotherapyAppointment;
        const child = {
            id: childId, tenantId, patientId, parentId: rootId,
            scheduledAt: new Date('2026-08-03T14:00:00.000Z'), durationMinutes: 50,
            status: 'scheduled', recurrence: 'none', googleEventId: null,
        } as PsychotherapyAppointment;
        const patient = { id: patientId, tenantId, name: 'ALICE', phone: '+5518997067933' } as any;
        const linkedChild = { ...child, googleEventId: occurrenceId } as PsychotherapyAppointment;
        const repository = {
            findAppointmentByGoogleEventId: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(root),
            listSeriesAppointments: jest.fn().mockResolvedValue([root, child]),
            findPatientById: jest.fn().mockResolvedValue(patient),
            updateAppointmentGoogleEvent: jest.fn().mockResolvedValue(undefined),
            findAppointmentById: jest.fn().mockResolvedValue(linkedChild),
        } as unknown as IPsychotherapyRepository;
        const googleCalendar = { syncAppointment: jest.fn() } as unknown as GoogleCalendarService;
        const useCase = new SyncGoogleCalendarEventsUseCase(repository, googleCalendar, {} as Pool);

        await (useCase as any).syncSeriesGroup(
            { tenantId, calendarId: 'calendar-id' },
            masterId,
            [{
                id: occurrenceId,
                recurringEventId: masterId,
                summary: 'título editado sem nome do paciente',
                start: { dateTime: '2026-08-03T14:00:00.000Z' },
                end: { dateTime: '2026-08-03T14:50:00.000Z' },
                htmlLink: 'https://calendar.google.test/event',
            }],
            []
        );

        expect(repository.updateAppointmentGoogleEvent).toHaveBeenCalledWith(
            childId, tenantId, occurrenceId, 'https://calendar.google.test/event'
        );
    });
});
