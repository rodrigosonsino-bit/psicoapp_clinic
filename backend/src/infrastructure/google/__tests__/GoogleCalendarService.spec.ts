import 'reflect-metadata';
import { google } from 'googleapis';
import { GoogleCalendarService } from '../GoogleCalendarService';
import { GoogleCalendarEventIdFactory } from '../GoogleCalendarEventIdFactory';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyAppointment } from '../../../domain/models/PsychotherapyAppointment';

describe('GoogleCalendarService idempotency', () => {
    const tenantId = 'tenant-123';
    const appointmentId = 'appointment-456';
    const calendarId = 'calendar@group.calendar.google.com';
    const expectedId = new GoogleCalendarEventIdFactory().create(tenantId, appointmentId, 0);

    let repository: jest.Mocked<IPsychotherapyRepository>;
    let service: GoogleCalendarService;
    let insert: jest.Mock;
    let update: jest.Mock;
    let get: jest.Mock;

    const appointment = (googleEventId: string | null = null) => new PsychotherapyAppointment(
        appointmentId,
        tenantId,
        'patient-1',
        new Date('2026-08-03T14:00:00.000Z'),
        50,
        'scheduled',
        'none',
        null,
        null,
        googleEventId,
        googleEventId ? 'https://calendar.google/event' : null,
        'confirm-token',
        null
    );

    beforeEach(() => {
        insert = jest.fn();
        update = jest.fn();
        get = jest.fn();
        jest.spyOn(google, 'calendar').mockReturnValue({
            events: { insert, update, get, delete: jest.fn() }
        } as any);

        repository = {
            getGoogleOAuthTokens: jest.fn().mockResolvedValue({
                tenantId,
                accessToken: 'access',
                refreshToken: 'refresh',
                expiryDate: Date.now() + 60_000,
                calendarId
            }),
            markAppointmentGoogleSyncProcessing: jest.fn().mockResolvedValue(undefined),
            markAppointmentGoogleSyncError: jest.fn().mockResolvedValue(undefined),
            updateAppointmentGoogleEvent: jest.fn().mockResolvedValue(undefined),
            advanceAppointmentGoogleEventGeneration: jest.fn().mockResolvedValue(1),
            findAppointmentById: jest.fn()
        } as unknown as jest.Mocked<IPsychotherapyRepository>;

        service = new GoogleCalendarService(repository, {} as any);
        jest.spyOn(service, 'getAuthenticatedClient').mockResolvedValue({} as any);
    });

    afterEach(() => jest.restoreAllMocks());

    it('cria evento novo com ID determinístico e metadados privados', async () => {
        insert.mockResolvedValue({ data: { id: expectedId, htmlLink: 'https://calendar/new' } });

        await service.syncAppointment(tenantId, appointment(), 'Paciente', null, 'https://confirm');

        expect(insert).toHaveBeenCalledTimes(1);
        expect(insert.mock.calls[0][0].requestBody).toMatchObject({
            id: expectedId,
            extendedProperties: {
                private: { psicoappAppointmentId: appointmentId }
            }
        });
        expect(repository.updateAppointmentGoogleEvent)
            .toHaveBeenCalledWith(appointmentId, tenantId, expectedId, 'https://calendar/new');
    });

    it('reconcilia 409 usando o evento existente em vez de criar outro ID', async () => {
        insert.mockRejectedValue({ code: 409 });
        get.mockResolvedValue({
            data: {
                id: expectedId,
                status: 'confirmed',
                htmlLink: 'https://calendar/existing',
                extendedProperties: {
                    private: {
                        psicoappAppointmentId: appointmentId,
                        psicoappTenantFingerprint: new GoogleCalendarEventIdFactory().tenantFingerprint(tenantId)
                    }
                }
            }
        });
        update.mockResolvedValue({ data: { id: expectedId, htmlLink: 'https://calendar/existing' } });

        await service.syncAppointment(tenantId, appointment(), 'Paciente', null, 'https://confirm');

        expect(insert).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith({ calendarId, eventId: expectedId });
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ eventId: expectedId }));
        expect(repository.updateAppointmentGoogleEvent)
            .toHaveBeenCalledWith(appointmentId, tenantId, expectedId, 'https://calendar/existing');
    });

    it('preserva ID legado e apenas atualiza o evento existente', async () => {
        update.mockResolvedValue({ data: { id: 'legacy-event', htmlLink: 'https://calendar/legacy' } });

        await service.syncAppointment(tenantId, appointment('legacy-event'), 'Paciente', null, 'https://confirm');

        expect(insert).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'legacy-event' }));
        expect(repository.updateAppointmentGoogleEvent)
            .toHaveBeenCalledWith(appointmentId, tenantId, 'legacy-event', 'https://calendar/legacy');
    });

    it('repara root recorrente vinculado a uma ocorrência antes de enviar RRULE', async () => {
        const occurrenceId = 'legacy-master_20260721T164000Z';
        const recurring = new PsychotherapyAppointment(
            appointmentId, tenantId, 'patient-1', new Date('2026-07-21T16:40:00.000Z'),
            50, 'confirmed', 'biweekly', new Date('2026-12-15T23:59:59.000Z'),
            null, occurrenceId, 'https://calendar.google/event', 'confirm-token', null
        );
        const repaired = new PsychotherapyAppointment(
            appointmentId, tenantId, 'patient-1', recurring.scheduledAt,
            50, 'confirmed', 'biweekly', recurring.recurrenceEndDate,
            null, 'legacy-master', recurring.googleEventUrl, 'confirm-token', null
        );
        repository.findAppointmentById.mockResolvedValue(repaired);
        update.mockResolvedValue({ data: { id: 'legacy-master', htmlLink: recurring.googleEventUrl } });

        await service.syncAppointment(tenantId, recurring, 'FRAN', null, 'https://confirm');

        expect(repository.updateAppointmentGoogleEvent).toHaveBeenNthCalledWith(
            1, appointmentId, tenantId, 'legacy-master', recurring.googleEventUrl
        );
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'legacy-master' }));
        expect(update.mock.calls[0][0].requestBody.recurrence).toEqual([
            'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261215T235959Z'
        ]);
    });

    it('repete o mesmo ID quando o Google criou mas a persistência local falhou', async () => {
        insert
            .mockResolvedValueOnce({ data: { id: expectedId, htmlLink: 'https://calendar/new' } })
            .mockRejectedValueOnce({ code: 409 });
        repository.updateAppointmentGoogleEvent
            .mockRejectedValueOnce(new Error('database unavailable'))
            .mockResolvedValueOnce(undefined);
        get.mockResolvedValue({
            data: {
                id: expectedId,
                status: 'confirmed',
                htmlLink: 'https://calendar/new',
                extendedProperties: {
                    private: {
                        psicoappAppointmentId: appointmentId,
                        psicoappTenantFingerprint: new GoogleCalendarEventIdFactory().tenantFingerprint(tenantId)
                    }
                }
            }
        });
        update.mockResolvedValue({ data: { id: expectedId, htmlLink: 'https://calendar/new' } });

        await service.syncAppointment(tenantId, appointment(), 'Paciente', null, 'https://confirm');
        await service.syncAppointment(tenantId, appointment(), 'Paciente', null, 'https://confirm');

        expect(insert).toHaveBeenCalledTimes(2);
        expect(insert.mock.calls[0][0].requestBody.id).toBe(expectedId);
        expect(insert.mock.calls[1][0].requestBody.id).toBe(expectedId);
        expect(repository.markAppointmentGoogleSyncError).toHaveBeenCalledTimes(1);
    });
});
