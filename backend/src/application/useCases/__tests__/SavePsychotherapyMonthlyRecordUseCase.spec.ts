import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { SavePsychotherapyMonthlyRecordUseCase } from '../SavePsychotherapyMonthlyRecordUseCase';

describe('SavePsychotherapyMonthlyRecordUseCase', () => {
    const repositoryMock = mock<IPsychotherapyRepository>();
    const useCase = new SavePsychotherapyMonthlyRecordUseCase(repositoryMock);

    it('Should save a monthly record', async () => {
        const dto = {
            tenantId: 'tenant-1',
            month: '2023-10',
            patientNameSnapshot: 'Charlie',
            status: 'weekly' as const
        };
        
        repositoryMock.saveMonthlyRecord.mockResolvedValue({} as any);

        await useCase.execute(dto);
        
        expect(repositoryMock.saveMonthlyRecord).toHaveBeenCalledWith(dto);
    });
});
