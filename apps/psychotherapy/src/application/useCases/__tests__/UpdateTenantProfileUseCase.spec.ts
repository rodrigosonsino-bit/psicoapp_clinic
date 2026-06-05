import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { UpdateTenantProfileUseCase } from '../UpdateTenantProfileUseCase';
import { AppError } from '../../../domain/errors/AppError';

describe('UpdateTenantProfileUseCase', () => {
    const repositoryMock = mock<IPsychotherapyRepository>();
    const useCase = new UpdateTenantProfileUseCase(repositoryMock);

    it('Should update tenant profile', async () => {
        repositoryMock.updateTenantProfile.mockResolvedValue({} as any);

        await useCase.execute({
            tenantId: 'tenant-1',
            fullName: 'Dr. Smith',
            document: '12345678901'
        });

        expect(repositoryMock.updateTenantProfile).toHaveBeenCalledWith({
            tenantId: 'tenant-1',
            fullName: 'Dr. Smith',
            document: '12345678901'
        });
    });

    it('Should throw error for invalid document length', async () => {
        await expect(useCase.execute({
            tenantId: 'tenant-1',
            document: '123'
        })).rejects.toThrow(AppError);
    });
});
