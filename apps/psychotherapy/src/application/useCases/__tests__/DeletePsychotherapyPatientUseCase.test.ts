import 'reflect-metadata';
import { DeletePsychotherapyPatientUseCase } from '../DeletePsychotherapyPatientUseCase';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../../domain/errors/AppError';

describe('DeletePsychotherapyPatientUseCase', () => {
    let mockRepository: jest.Mocked<IPsychotherapyRepository>;
    let useCase: DeletePsychotherapyPatientUseCase;

    beforeEach(() => {
        // Mock do repositório
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

        useCase = new DeletePsychotherapyPatientUseCase(mockRepository);
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
});
