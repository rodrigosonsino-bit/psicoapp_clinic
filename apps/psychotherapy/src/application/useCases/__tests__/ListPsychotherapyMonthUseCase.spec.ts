import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { ListPsychotherapyMonthUseCase } from '../ListPsychotherapyMonthUseCase';
import { PsychotherapyMonthlyRecord } from '../../../domain/models/PsychotherapyMonthlyRecord';

describe('ListPsychotherapyMonthUseCase', () => {
    const repositoryMock = mock<IPsychotherapyRepository>();
    const useCase = new ListPsychotherapyMonthUseCase(repositoryMock);

    it('Should list month records and summary', async () => {
        const tenantId = 'tenant-123';
        const month = '2023-10';
        
        repositoryMock.listMonthlyRecords.mockResolvedValue([]);

        const result = await useCase.execute(tenantId, month);
        
        expect(result.records).toEqual([]);
        expect(result.summary.month).toBe(month);
        expect(repositoryMock.listMonthlyRecords).toHaveBeenCalledWith(tenantId, month);
    });
});
