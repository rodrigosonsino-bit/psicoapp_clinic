import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { GeneratePsychotherapyMonthUseCase } from '../GeneratePsychotherapyMonthUseCase';
import { PsychotherapyPatient } from '../../../domain/models/PsychotherapyPatient';

describe('GeneratePsychotherapyMonthUseCase', () => {
    const repositoryMock = mock<IPsychotherapyRepository>();
    const useCase = new GeneratePsychotherapyMonthUseCase(repositoryMock);

    it('Should generate month records for active patients', async () => {
        const tenantId = 'tenant-123';
        const month = '2023-11';
        
        const activePatient = new PsychotherapyPatient('id1', tenantId, 'Bob', 'weekly', 'monthly', 12000, null, null, null, null, new Date(), new Date());
        const inactivePatient = new PsychotherapyPatient('id2', tenantId, 'Alice', 'inactive', 'monthly', 12000, null, null, null, null, new Date(), new Date());
        
        (repositoryMock.listPatients as any).mockResolvedValue([activePatient]);
        repositoryMock.bulkSaveMonthlyRecords.mockResolvedValue([]); // return value not fully mocked

        await useCase.execute(tenantId, month);
        
        expect(repositoryMock.listPatients).toHaveBeenCalledWith(tenantId);
        expect(repositoryMock.bulkSaveMonthlyRecords).toHaveBeenCalled();
        
        // Ensure it saved a record for the active patient
        const callArgs = repositoryMock.bulkSaveMonthlyRecords.mock.calls[0][0];
        expect(callArgs).toHaveLength(1);
        expect(callArgs[0].patientNameSnapshot).toBe('Bob');
    });
});
