import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { DeletePsychotherapyReceiptUseCase } from '../DeletePsychotherapyReceiptUseCase';
import { AppError } from '../../../domain/errors/AppError';

describe('DeletePsychotherapyReceiptUseCase', () => {
    const repositoryMock = mock<IPsychotherapyRepository>();
    const useCase = new DeletePsychotherapyReceiptUseCase(repositoryMock);

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('Should delete receipt successfully', async () => {
        repositoryMock.deleteReceipt.mockResolvedValue(undefined);

        await useCase.execute('tenant-1', 'receipt-1');

        expect(repositoryMock.deleteReceipt).toHaveBeenCalledWith('tenant-1', 'receipt-1');
    });

    it('Should throw error if tenantId is missing', async () => {
        await expect(useCase.execute('', 'receipt-1')).rejects.toThrow(AppError);
    });

    it('Should throw error if receipt ID is missing', async () => {
        await expect(useCase.execute('tenant-1', '')).rejects.toThrow(AppError);
    });
});
