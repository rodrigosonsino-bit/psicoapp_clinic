import 'reflect-metadata';
import { google } from 'googleapis';
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
            childId, tenantId, occurrenceId, 'https://calendar.google.test/event', null, null
        );
    });

    it('captura hangoutLink/conferenceData ao vincular um filho de série ainda sem googleEventId', async () => {
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
            status: 'scheduled', recurrence: 'none', googleEventId: null, modality: 'online',
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
                hangoutLink: 'https://meet.google.com/abc-defg-hij',
                conferenceData: {
                    conferenceId: 'abc-defg-hij',
                    conferenceSolution: { key: { type: 'hangoutsMeet' } },
                },
            }],
            []
        );

        expect(repository.updateAppointmentGoogleEvent).toHaveBeenCalledWith(
            childId, tenantId, occurrenceId, 'https://calendar.google.test/event',
            'https://meet.google.com/abc-defg-hij', 'spaces/abc-defg-hij'
        );
    });

    it('preenche retroativamente google_meet_link de um agendamento já vinculado quando o link nunca foi capturado (bug histórico)', async () => {
        const tenantId = '22222222-2222-4222-8222-222222222222';
        const appointmentId = '66666666-6666-4666-8666-666666666666';
        const patientId = '33333333-3333-4333-8333-333333333333';
        const eventId = 'existing-event-id';
        const existingAppt = {
            id: appointmentId, tenantId, patientId, parentId: null,
            scheduledAt: new Date('2026-08-03T14:00:00.000Z'), durationMinutes: 50,
            status: 'scheduled', recurrence: 'none', googleEventId: eventId,
            googleEventUrl: 'https://calendar.google.test/existing',
            modality: 'online', googleMeetLink: null,
        } as PsychotherapyAppointment;
        const patient = { id: patientId, tenantId, name: 'ALICE', phone: '+5518997067933' } as any;
        const repository = {
            findAppointmentByGoogleEventId: jest.fn().mockResolvedValue(existingAppt),
            findPatientById: jest.fn().mockResolvedValue(patient),
            updateAppointmentGoogleEvent: jest.fn().mockResolvedValue(undefined),
        } as unknown as IPsychotherapyRepository;
        const googleCalendar = { syncAppointment: jest.fn() } as unknown as GoogleCalendarService;
        const useCase = new SyncGoogleCalendarEventsUseCase(repository, googleCalendar, {} as Pool);

        await (useCase as any).syncSingleEvent(
            { tenantId, calendarId: 'calendar-id' },
            {
                id: eventId,
                summary: 'ALICE',
                start: { dateTime: '2026-08-03T14:00:00.000Z' },
                end: { dateTime: '2026-08-03T14:50:00.000Z' },
                htmlLink: 'https://calendar.google.test/existing',
                hangoutLink: 'https://meet.google.com/xyz-uvwx-rst',
                conferenceData: {
                    conferenceId: 'xyz-uvwx-rst',
                    conferenceSolution: { key: { type: 'hangoutsMeet' } },
                },
            },
            [patient]
        );

        expect(repository.updateAppointmentGoogleEvent).toHaveBeenCalledWith(
            appointmentId, tenantId, eventId, 'https://calendar.google.test/existing',
            'https://meet.google.com/xyz-uvwx-rst', 'spaces/xyz-uvwx-rst'
        );
        // syncAppointment (push) não deve ser chamado — backfill é uma correção
        // local de metadados, sem tempo/duração divergentes.
        expect(googleCalendar.syncAppointment).not.toHaveBeenCalled();
    });

    it('dispara push mesmo sem drift de horário quando o evento online não tem NENHUMA conferência do Meet', async () => {
        const tenantId = '22222222-2222-4222-8222-222222222222';
        const appointmentId = '66666666-6666-4666-8666-666666666666';
        const patientId = '33333333-3333-4333-8333-333333333333';
        const eventId = 'existing-event-id';
        const existingAppt = {
            id: appointmentId, tenantId, patientId, parentId: null,
            scheduledAt: new Date('2026-08-03T14:00:00.000Z'), durationMinutes: 50,
            status: 'scheduled', recurrence: 'none', googleEventId: eventId,
            googleEventUrl: 'https://calendar.google.test/existing',
            modality: 'online', googleMeetLink: null,
        } as PsychotherapyAppointment;
        const patient = { id: patientId, tenantId, name: 'ALICE', phone: '+5518997067933' } as any;
        const repository = {
            findAppointmentByGoogleEventId: jest.fn().mockResolvedValue(existingAppt),
            findPatientById: jest.fn().mockResolvedValue(patient),
            updateAppointmentGoogleEvent: jest.fn().mockResolvedValue(undefined),
        } as unknown as IPsychotherapyRepository;
        const googleCalendar = { syncAppointment: jest.fn().mockResolvedValue(undefined) } as unknown as GoogleCalendarService;
        const useCase = new SyncGoogleCalendarEventsUseCase(repository, googleCalendar, {} as Pool);

        await (useCase as any).syncSingleEvent(
            { tenantId, calendarId: 'calendar-id' },
            {
                id: eventId,
                summary: 'ALICE',
                start: { dateTime: '2026-08-03T14:00:00.000Z' },
                end: { dateTime: '2026-08-03T14:50:00.000Z' },
                htmlLink: 'https://calendar.google.test/existing',
                // sem hangoutLink nem conferenceData — evento nunca teve Meet.
            },
            [patient]
        );

        expect(googleCalendar.syncAppointment).toHaveBeenCalledWith(
            tenantId, existingAppt, patient.name, patient.phone, expect.any(String), false
        );
    });

    it('NÃO dispara push por falta de Meet quando o agendamento está cancelado/no_show', async () => {
        const tenantId = '22222222-2222-4222-8222-222222222222';
        const appointmentId = '66666666-6666-4666-8666-666666666666';
        const patientId = '33333333-3333-4333-8333-333333333333';
        const eventId = 'existing-event-id';
        const existingAppt = {
            id: appointmentId, tenantId, patientId, parentId: null,
            scheduledAt: new Date('2026-08-03T14:00:00.000Z'), durationMinutes: 50,
            status: 'no_show', recurrence: 'none', googleEventId: eventId,
            googleEventUrl: 'https://calendar.google.test/existing',
            modality: 'online', googleMeetLink: null,
        } as PsychotherapyAppointment;
        const patient = { id: patientId, tenantId, name: 'ALICE', phone: '+5518997067933' } as any;
        const repository = {
            findAppointmentByGoogleEventId: jest.fn().mockResolvedValue(existingAppt),
            findPatientById: jest.fn().mockResolvedValue(patient),
            updateAppointmentGoogleEvent: jest.fn().mockResolvedValue(undefined),
        } as unknown as IPsychotherapyRepository;
        const googleCalendar = { syncAppointment: jest.fn() } as unknown as GoogleCalendarService;
        const useCase = new SyncGoogleCalendarEventsUseCase(repository, googleCalendar, {} as Pool);

        await (useCase as any).syncSingleEvent(
            { tenantId, calendarId: 'calendar-id' },
            {
                id: eventId,
                summary: 'ALICE',
                start: { dateTime: '2026-08-03T14:00:00.000Z' },
                end: { dateTime: '2026-08-03T14:50:00.000Z' },
                htmlLink: 'https://calendar.google.test/existing',
            },
            [patient]
        );

        expect(googleCalendar.syncAppointment).not.toHaveBeenCalled();
    });

    it('percorre todas as páginas de calendar.events.list — evento só presente na 2ª página ainda é processado', async () => {
        const tenantId = '22222222-2222-4222-8222-222222222222';
        const patientId = '33333333-3333-4333-8333-333333333333';
        const eventIdPage2 = 'event-on-page-2';

        const patient = { id: patientId, tenantId, name: 'FELIPE', phone: null } as any;
        const unlinkedAppt = {
            id: 'appt-page2', tenantId, patientId, parentId: null,
            scheduledAt: new Date('2026-08-13T10:30:00.000Z'), durationMinutes: 50,
            status: 'scheduled', recurrence: 'none', googleEventId: null,
        } as PsychotherapyAppointment;

        const list = jest.fn()
            .mockResolvedValueOnce({
                data: {
                    items: [{
                        id: 'event-on-page-1', status: 'confirmed',
                        start: { dateTime: '2026-08-10T14:00:00.000Z' }, end: { dateTime: '2026-08-10T14:50:00.000Z' },
                        summary: 'Outro Paciente',
                    }],
                    nextPageToken: 'page-2-token',
                },
            })
            .mockResolvedValueOnce({
                data: {
                    items: [{
                        id: eventIdPage2, status: 'confirmed',
                        start: { dateTime: '2026-08-13T10:30:00.000Z' }, end: { dateTime: '2026-08-13T10:30:00.000Z' },
                        summary: 'FELIPE', htmlLink: 'https://calendar.google.test/page2',
                    }],
                    // sem nextPageToken — última página
                },
            });
        jest.spyOn(google, 'calendar').mockReturnValue({ events: { list } } as any);

        const repository = {
            listAllGoogleOAuthTokens: jest.fn().mockResolvedValue([
                { tenantId, calendarId: 'calendar-id' }
            ]),
            listAppointments: jest.fn().mockResolvedValue({ data: [unlinkedAppt], total: 1 }),
            listPatients: jest.fn().mockResolvedValue([patient]),
            findAppointmentByGoogleEventId: jest.fn().mockResolvedValue(null),
            updateAppointmentGoogleEvent: jest.fn().mockResolvedValue(undefined),
            findAppointmentById: jest.fn().mockResolvedValue(unlinkedAppt),
        } as unknown as IPsychotherapyRepository;

        const googleCalendar = {
            getAuthenticatedClient: jest.fn().mockResolvedValue({}),
            syncAppointment: jest.fn().mockResolvedValue(undefined),
        } as unknown as GoogleCalendarService;

        const pool = { connect: jest.fn().mockResolvedValue({
            query: jest.fn().mockResolvedValue({ rows: [{ acquired: true }] }),
            release: jest.fn(),
        }) } as unknown as Pool;

        const useCase = new SyncGoogleCalendarEventsUseCase(repository, googleCalendar, pool);
        await useCase.execute();

        expect(list).toHaveBeenCalledTimes(2);
        expect(list.mock.calls[1][0]).toMatchObject({ pageToken: 'page-2-token' });
        // Evento só existente na 2ª página foi vinculado ao agendamento do app.
        expect(repository.updateAppointmentGoogleEvent).toHaveBeenCalledWith(
            'appt-page2', tenantId, eventIdPage2, 'https://calendar.google.test/page2', null, null
        );
    });
});
