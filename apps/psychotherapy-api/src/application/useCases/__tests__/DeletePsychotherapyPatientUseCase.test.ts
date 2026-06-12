import 'reflect-metadata';
import { DeletePsychotherapyPatientUseCase } from '../DeletePsychotherapyPatientUseCase';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../../infrastructure/google/GoogleCalendarService';
import { AppError } from '../../../domain/errors/AppError';

describe('DeletePsychotherapyPatientUseCase', () => {
    let mockRepository: jest.Mocked<IPsychotherapyRepository>;
    let mockGoogleCalendar: jest.Mocked<GoogleCalendarService>;
    let useCase: DeletePsychotherapyPatientUseCase;

    beforeEach(() => {
        mockRepository = {
            savePatient: jest.fn(),
            listPatients: jest.fn(),
            findPatientById: jest.fn(),
            deletePatient: jest.fn(),
            listAppointments: jest.fn().mockResolvedValue({ data: [], total: 0 }),
            saveMonthlyRecord: jest.fn(),
            bulkSaveMonthlyRecords: jest.fn(),
            listMonthlyRecords: jest.fn(),
            getMonthSummary: jest.fn()
        } as unknown as jest.Mocked<IPsychotherapyRepository>;

        mockGoogleCalendar = {
            deleteEvent: jest.fn().mockResolvedValue(undefined)
        } as unknown as jest.Mocked<GoogleCalendarService>;

        useCase = new DeletePsychotherapyPatientUseCase(mockRepository, mockGoogleCalendar);
    });

    it('deve excluir um paciente com sucesso quando os parâmetros forem válidos', async () => {
        const tenantId = 'tenant-123';
        const patientId = 'patient-abc';

        mockRepository.deletePatient.mockResolvedValue();

        await expect(useCase.execute(tenantId, patientId)).resolves.not.toThrow();
        expect(mockRepository.deletePatient).toHaveBeenCalledWith(tenantId, patientId);
        expect(mockRepository.deletePatient).toHaveBeenCalledTimes(1);
    });

    it('deve lançar AppError se o ID do paciente não for fornecido', async () => {
        const tenantId = 'tenant-123';

        await expect(useCase.execute(tenantId, '')).rejects.toThrow(AppError);
        await expect(useCase.execute(tenantId, '')).rejects.toThrow('ID do paciente é obrigatório');
        expect(mockRepository.deletePatient).not.toHaveBeenCalled();
    });

    it('deve deletar eventos do Google Calendar de agendamentos futuros antes de excluir o paciente', async () => {
        const tenantId = 'tenant-123';
        const patientId = 'patient-abc';

        mockRepository.listAppointments.mockResolvedValue({
            data: [
                { id: 'appt-1', googleEventId: 'gcal-event-1' } as any,
                { id: 'appt-2', googleEventId: null } as any,
                { id: 'appt-3', googleEventId: 'gcal-event-3' } as any,
            ],
            total: 3
        });
        mockRepository.deletePatient.mockResolvedValue();

        await useCase.execute(tenantId, patientId);

        expect(mockGoogleCalendar.deleteEvent).toHaveBeenCalledTimes(2);
        expect(mockGoogleCalendar.deleteEvent).toHaveBeenCalledWith(tenantId, 'gcal-event-1');
        expect(mockGoogleCalendar.deleteEvent).toHaveBeenCalledWith(tenantId, 'gcal-event-3');
        expect(mockRepository.deletePatient).toHaveBeenCalledWith(tenantId, patientId);
    });

    it('deve continuar a exclusão mesmo se a remoção de um evento do Google Calendar falhar', async () => {
        const tenantId = 'tenant-123';
        const patientId = 'patient-abc';

        mockRepository.listAppointments.mockResolvedValue({
            data: [{ id: 'appt-1', googleEventId: 'gcal-event-1' } as any],
            total: 1
        });
        mockGoogleCalendar.deleteEvent.mockRejectedValue(new Error('Google API error'));
        mockRepository.deletePatient.mockResolvedValue();

        await expect(useCase.execute(tenantId, patientId)).resolves.not.toThrow();
        expect(mockRepository.deletePatient).toHaveBeenCalledWith(tenantId, patientId);
    });
});
