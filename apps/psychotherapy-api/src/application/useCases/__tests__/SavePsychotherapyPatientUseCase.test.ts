import 'reflect-metadata';
import { SavePsychotherapyPatientUseCase } from '../SavePsychotherapyPatientUseCase';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../../domain/errors/AppError';
import { PsychotherapyPatient } from '../../../domain/models/PsychotherapyPatient';

describe('SavePsychotherapyPatientUseCase', () => {
    let mockRepository: jest.Mocked<IPsychotherapyRepository>;
    let useCase: SavePsychotherapyPatientUseCase;

    beforeEach(() => {
        mockRepository = {
            savePatient: jest.fn(),
            listPatients: jest.fn(),
            findPatientById: jest.fn(),
            deletePatient: jest.fn(),
            saveMonthlyRecord: jest.fn(),
            bulkSaveMonthlyRecords: jest.fn(),
            listMonthlyRecords: jest.fn(),
            getMonthSummary: jest.fn()
        } as unknown as jest.Mocked<IPsychotherapyRepository>;

        useCase = new SavePsychotherapyPatientUseCase(mockRepository);
    });

    it('deve salvar um paciente com sucesso quando os dados forem válidos', async () => {
        const inputData = {
            tenantId: 'tenant-123',
            name: '  João Silva  ',
            status: 'weekly' as const
        };

        const expectedSavedPatient: PsychotherapyPatient = {
            id: 'patient-abc',
            tenantId: 'tenant-123',
            name: 'João Silva', // trim() aplicado
            status: 'weekly',
            paymentType: null,
            defaultSessionPriceCents: null,
            notes: null,
            document: null,
            phone: null,
            email: null,
            reminderChannel: 'whatsapp',
            fullName: null,
            whatsappBulkOptIn: false,
            createdAt: expect.any(Date),
            updatedAt: expect.any(Date)
        };

        mockRepository.savePatient.mockResolvedValue(expectedSavedPatient);

        const result = await useCase.execute(inputData);

        expect(result).toEqual(expectedSavedPatient);
        expect(mockRepository.savePatient).toHaveBeenCalledWith({
            ...inputData,
            name: 'João Silva' // Verifica se o trim foi repassado
        });
        expect(mockRepository.savePatient).toHaveBeenCalledTimes(1);
    });

    it('deve lançar AppError se o nome do paciente estiver em branco', async () => {
        const inputData = {
            tenantId: 'tenant-123',
            name: '   ',
            status: 'weekly' as const
        };

        await expect(useCase.execute(inputData)).rejects.toThrow(AppError);
        await expect(useCase.execute(inputData)).rejects.toThrow('Nome do paciente é obrigatório');
        expect(mockRepository.savePatient).not.toHaveBeenCalled();
    });
});
