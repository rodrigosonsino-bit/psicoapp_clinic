import 'reflect-metadata';
import { DeletePsychotherapyAppointmentUseCase } from '../DeletePsychotherapyAppointmentUseCase';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../../infrastructure/google/GoogleCalendarService';
import { PsychotherapyAppointment } from '../../../domain/models/PsychotherapyAppointment';

describe('DeletePsychotherapyAppointmentUseCase — proteção contra apagar série inteira via root', () => {
    const tenantId = '22222222-2222-4222-8222-222222222222';
    const rootId = '11111111-1111-4111-8111-111111111111';
    const masterEventId = 'ifru3lpgtbjfugv6hl93i7sd5g';

    let repository: jest.Mocked<IPsychotherapyRepository>;
    let googleCalendar: jest.Mocked<GoogleCalendarService>;
    let useCase: DeletePsychotherapyAppointmentUseCase;

    const root = (overrides: Partial<PsychotherapyAppointment> = {}) => ({
        id: rootId, tenantId, patientId: 'patient-1', parentId: null,
        scheduledAt: new Date('2026-07-21T16:40:00.000Z'), durationMinutes: 50,
        status: 'attended', recurrence: 'biweekly', googleEventId: masterEventId,
        ...overrides,
    } as PsychotherapyAppointment);

    const activeChild = {
        id: 'child-1', tenantId, patientId: 'patient-1', parentId: rootId,
        scheduledAt: new Date('2026-08-18T16:40:00.000Z'), durationMinutes: 50,
        status: 'scheduled', recurrence: 'none', googleEventId: null,
    } as PsychotherapyAppointment;

    beforeEach(() => {
        repository = {
            findAppointmentById: jest.fn(),
            deleteAppointment: jest.fn().mockResolvedValue(undefined),
            listSeriesAppointments: jest.fn(),
        } as unknown as jest.Mocked<IPsychotherapyRepository>;

        googleCalendar = {
            deleteEvent: jest.fn().mockResolvedValue(undefined),
            cancelRecurringInstance: jest.fn().mockResolvedValue(true),
        } as unknown as jest.Mocked<GoogleCalendarService>;

        useCase = new DeletePsychotherapyAppointmentUseCase(repository, googleCalendar);
    });

    it('excluir (mode=single) o root de uma série com filhos ativos NÃO apaga o evento mestre — cancela só a instância', async () => {
        const theRoot = root();
        repository.findAppointmentById.mockResolvedValue(theRoot);
        repository.listSeriesAppointments.mockResolvedValue([theRoot, activeChild]);

        await useCase.execute(tenantId, rootId, 'single');

        expect(repository.deleteAppointment).toHaveBeenCalledWith(tenantId, rootId);
        expect(googleCalendar.deleteEvent).not.toHaveBeenCalled();
        expect(googleCalendar.cancelRecurringInstance).toHaveBeenCalledWith(
            tenantId, masterEventId, theRoot.scheduledAt
        );
    });

    it('excluir o root de uma série SEM filhos ativos apaga o evento mestre normalmente', async () => {
        const theRoot = root();
        repository.findAppointmentById.mockResolvedValue(theRoot);
        repository.listSeriesAppointments.mockResolvedValue([theRoot]); // sem filhos

        await useCase.execute(tenantId, rootId, 'single');

        expect(googleCalendar.deleteEvent).toHaveBeenCalledWith(tenantId, masterEventId);
        expect(googleCalendar.cancelRecurringInstance).not.toHaveBeenCalled();
    });

    it('excluir um agendamento avulso (sem parentId, recurrence=none) apaga o evento normalmente', async () => {
        const standalone = root({ recurrence: 'none' });
        repository.findAppointmentById.mockResolvedValue(standalone);

        await useCase.execute(tenantId, rootId, 'single');

        expect(googleCalendar.deleteEvent).toHaveBeenCalledWith(tenantId, masterEventId);
        expect(repository.listSeriesAppointments).not.toHaveBeenCalled();
    });

    it('excluir um FILHO (parentId presente) apaga o evento normalmente, sem checar irmãos', async () => {
        const childWithEvent = { ...activeChild, googleEventId: 'occurrence-event-id' } as PsychotherapyAppointment;
        repository.findAppointmentById.mockResolvedValue(childWithEvent);

        await useCase.execute(tenantId, childWithEvent.id, 'single');

        expect(googleCalendar.deleteEvent).toHaveBeenCalledWith(tenantId, 'occurrence-event-id');
        expect(repository.listSeriesAppointments).not.toHaveBeenCalled();
    });

    it('mode=all deletando root + todos os filhos apaga o evento mestre normalmente (série inteira é o alvo)', async () => {
        const theRoot = root();
        repository.findAppointmentById.mockResolvedValue(theRoot);
        // Mesma lista é usada tanto pra montar os alvos quanto pela checagem
        // de segurança — como os filhos já foram removidos do banco antes do
        // root ser processado (ordenação filhos-primeiro), a segunda consulta
        // deve refletir que não sobrou filho ativo.
        repository.listSeriesAppointments
            .mockResolvedValueOnce([theRoot, activeChild]) // monta os alvos (mode=all)
            .mockResolvedValueOnce([theRoot]); // reavaliação ao processar o root, filho já apagado

        await useCase.execute(tenantId, rootId, 'all');

        expect(repository.deleteAppointment).toHaveBeenCalledWith(tenantId, activeChild.id);
        expect(repository.deleteAppointment).toHaveBeenCalledWith(tenantId, rootId);
        expect(googleCalendar.deleteEvent).toHaveBeenCalledWith(tenantId, masterEventId);
        expect(googleCalendar.cancelRecurringInstance).not.toHaveBeenCalled();
    });
});
