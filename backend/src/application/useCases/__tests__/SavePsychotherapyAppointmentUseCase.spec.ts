import 'reflect-metadata';
import { SavePsychotherapyAppointmentUseCase } from '../SavePsychotherapyAppointmentUseCase';
import { DeletePsychotherapyAppointmentUseCase } from '../DeletePsychotherapyAppointmentUseCase';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../../infrastructure/google/GoogleCalendarService';
import { PsychotherapyAppointment } from '../../../domain/models/PsychotherapyAppointment';
import { PsychotherapyPatient } from '../../../domain/models/PsychotherapyPatient';

describe('SavePsychotherapyAppointmentUseCase — divisão de série no Google Calendar', () => {
    const tenantId = 'tenant-123';
    const rootId = 'root-1';
    const anchorId = 'child-3';
    const patientId = 'patient-1';

    let repository: jest.Mocked<IPsychotherapyRepository>;
    let googleCalendar: jest.Mocked<GoogleCalendarService>;
    let deleteUseCase: jest.Mocked<DeletePsychotherapyAppointmentUseCase>;
    let useCase: SavePsychotherapyAppointmentUseCase;

    const patient = new PsychotherapyPatient(
        patientId, tenantId, 'Paciente Teste', 'weekly', 'per_session', 10000,
        null, null, null, null, new Date(), new Date()
    );

    // root: 1ª sessão da série, semanal, com evento mestre já no Google
    const root = new PsychotherapyAppointment(
        rootId, tenantId, patientId, new Date('2026-07-06T13:00:00.000Z'),
        50, 'attended', 'weekly', new Date('2026-12-15T23:59:59.000Z'),
        null, 'root-master-event-id', 'https://calendar.google/root', 'confirm-token-root', null
    );

    // âncora: uma sessão no MEIO da série (filho, parentId=root), ainda semanal antes da edição
    const beforeAnchor = new PsychotherapyAppointment(
        anchorId, tenantId, patientId, new Date('2026-08-10T13:00:00.000Z'),
        50, 'scheduled', 'weekly', null,
        null, 'root-master-event-id_20260810T130000Z', null, 'confirm-token-3', null, rootId
    );

    // âncora depois de salva com a nova recorrência quinzenal
    const anchorAfter = new PsychotherapyAppointment(
        anchorId, tenantId, patientId, new Date('2026-08-10T13:00:00.000Z'),
        50, 'scheduled', 'biweekly', new Date('2026-12-15T23:59:59.000Z'),
        null, 'root-master-event-id_20260810T130000Z', null, 'confirm-token-3', null, rootId
    );

    beforeEach(() => {
        repository = {
            findAppointmentById: jest.fn(),
            findPatientById: jest.fn().mockResolvedValue(patient),
            saveAppointment: jest.fn(),
            advanceAppointmentGoogleEventGeneration: jest.fn().mockResolvedValue(1),
            listSeriesAppointments: jest.fn().mockResolvedValue([])
        } as unknown as jest.Mocked<IPsychotherapyRepository>;

        googleCalendar = {
            syncAppointment: jest.fn().mockResolvedValue(undefined),
            truncateRecurringSeries: jest.fn().mockResolvedValue(true)
        } as unknown as jest.Mocked<GoogleCalendarService>;

        deleteUseCase = {
            execute: jest.fn().mockResolvedValue(undefined)
        } as unknown as jest.Mocked<DeletePsychotherapyAppointmentUseCase>;

        useCase = new SavePsychotherapyAppointmentUseCase(repository, googleCalendar, deleteUseCase);
    });

    it('trunca o master antigo e cria um novo evento mestre recorrente quando a âncora (filho) muda de padrão', async () => {
        repository.findAppointmentById.mockImplementation(async (_tenant, id) => {
            if (id === anchorId) return beforeAnchor; // "before" lido no início do execute()
            if (id === rootId) return root;
            return null;
        });
        repository.saveAppointment.mockResolvedValue(anchorAfter);

        await useCase.execute({
            id: anchorId,
            tenantId,
            patientId,
            scheduledAt: anchorAfter.scheduledAt,
            recurrence: 'biweekly',
            recurrenceEndDate: anchorAfter.recurrenceEndDate!
        });

        // findAppointmentById precisa ser reconsultado após saveAppointment pra
        // splitSeriesInGoogleCalendar enxergar o root e depois a âncora "fresh"
        // (repository mock simplificado sempre retorna o mesmo objeto por id).
        expect(googleCalendar.truncateRecurringSeries).toHaveBeenCalledWith(
            tenantId, 'root-master-event-id', anchorAfter.scheduledAt
        );
        expect(repository.advanceAppointmentGoogleEventGeneration).toHaveBeenCalledWith(
            anchorId, tenantId, anchorAfter.googleEventGeneration
        );
        expect(googleCalendar.syncAppointment).toHaveBeenCalledWith(
            tenantId, expect.objectContaining({ id: anchorId }), patient.name, patient.phone,
            expect.any(String), false, true, 0, true
        );
    });

    it('não cria novo evento mestre quando o novo padrão é "none" (só trunca o antigo)', async () => {
        const anchorNone = new PsychotherapyAppointment(
            anchorId, tenantId, patientId, beforeAnchor.scheduledAt,
            50, 'scheduled', 'none', null,
            null, beforeAnchor.googleEventId, null, 'confirm-token-3', null, rootId
        );
        repository.findAppointmentById.mockImplementation(async (_tenant, id) => {
            if (id === anchorId) return beforeAnchor;
            if (id === rootId) return root;
            return null;
        });
        repository.saveAppointment.mockResolvedValue(anchorNone);

        await useCase.execute({
            id: anchorId,
            tenantId,
            patientId,
            scheduledAt: anchorNone.scheduledAt,
            recurrence: 'none'
        });

        expect(googleCalendar.truncateRecurringSeries).toHaveBeenCalledWith(
            tenantId, 'root-master-event-id', anchorNone.scheduledAt
        );
        // Só a chamada normal de sync (fire-and-forget, treatAsSeriesRoot=false)
        // deveria ter ocorrido — nenhuma chamada com treatAsSeriesRoot=true.
        const treatAsRootCalls = googleCalendar.syncAppointment.mock.calls.filter(call => call[8] === true);
        expect(treatAsRootCalls).toHaveLength(0);
    });

    it('não mexe no Google quando a âncora editada É o root da série (sem parentId)', async () => {
        const rootBefore = root;
        const rootAfter = new PsychotherapyAppointment(
            rootId, tenantId, patientId, root.scheduledAt,
            50, 'attended', 'biweekly', new Date('2026-12-15T23:59:59.000Z'),
            null, root.googleEventId, root.googleEventUrl, 'confirm-token-root', null
        );
        repository.findAppointmentById.mockResolvedValue(rootBefore);
        repository.saveAppointment.mockResolvedValue(rootAfter);

        await useCase.execute({
            id: rootId,
            tenantId,
            patientId,
            scheduledAt: rootAfter.scheduledAt,
            recurrence: 'biweekly',
            recurrenceEndDate: rootAfter.recurrenceEndDate!
        });

        expect(googleCalendar.truncateRecurringSeries).not.toHaveBeenCalled();
        const treatAsRootCalls = googleCalendar.syncAppointment.mock.calls.filter(call => call[8] === true);
        expect(treatAsRootCalls).toHaveLength(0);
    });
});
