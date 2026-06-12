import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { IssuePsychotherapyReceiptUseCase } from '../IssuePsychotherapyReceiptUseCase';
import { AppError } from '../../../domain/errors/AppError';

describe('IssuePsychotherapyReceiptUseCase', () => {
    const repositoryMock = mock<IPsychotherapyRepository>();
    const useCase = new IssuePsychotherapyReceiptUseCase(repositoryMock);

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('Should issue receipt for an existing patient', async () => {
        repositoryMock.findPatientById.mockResolvedValue({} as any);
        repositoryMock.saveReceipt.mockResolvedValue({} as any);

        const request = {
            tenantId: 'tenant-1',
            patientId: 'patient-1',
            amountCents: 15000,
            description: 'Sessões'
        };

        await useCase.execute(request);

        expect(repositoryMock.findPatientById).toHaveBeenCalledWith('tenant-1', 'patient-1');
        expect(repositoryMock.saveReceipt).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 'tenant-1',
            patientId: 'patient-1',
            amountCents: 15000,
            description: 'Sessões'
        }));
    });

    it('Should throw error if amount is zero or negative', async () => {
        await expect(useCase.execute({
            tenantId: 'tenant-1',
            patientId: 'patient-1',
            amountCents: 0,
            description: 'Sessões'
        })).rejects.toThrow(AppError);
    });

    it('Should throw error if patient does not exist', async () => {
        repositoryMock.findPatientById.mockResolvedValue(null);

        await expect(useCase.execute({
            tenantId: 'tenant-1',
            patientId: 'patient-1',
            amountCents: 15000,
            description: 'Sessões'
        })).rejects.toThrow(AppError);
    });
});
