import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { ListPsychotherapyPatientsUseCase } from '../ListPsychotherapyPatientsUseCase';
import { PsychotherapyPatient } from '../../../domain/models/PsychotherapyPatient';

describe('ListPsychotherapyPatientsUseCase', () => {
    const repositoryMock = mock<IPsychotherapyRepository>();
    const useCase = new ListPsychotherapyPatientsUseCase(repositoryMock);

    it('Should list patients for a given tenant with pagination', async () => {
        const tenantId = 'tenant-123';
        const patients = [
            new PsychotherapyPatient('id1', tenantId, 'Alice', 'weekly', 'monthly', 10000, null, null, null, null, new Date(), new Date())
        ];
        
        const mockResult = { data: patients, total: 1 };
        (repositoryMock.listPatients as any).mockResolvedValue(mockResult);

        const result = await useCase.execute(tenantId, 1, 20);
        
        expect(result.data).toHaveLength(1);
        expect(result.data[0].name).toBe('Alice');
        expect(result.total).toBe(1);
        expect(repositoryMock.listPatients).toHaveBeenCalledWith(tenantId, { page: 1, limit: 20 });
    });
});
