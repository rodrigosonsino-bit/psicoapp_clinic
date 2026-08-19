import 'reflect-metadata';
import { SavePsychotherapyAppointmentUseCase } from '../SavePsychotherapyAppointmentUseCase';
import { DeletePsychotherapyAppointmentUseCase } from '../DeletePsychotherapyAppointmentUseCase';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { GoogleCalendarService } from '../../../infrastructure/google/GoogleCalendarService';
import { PsychotherapyAppointment } from '../../../domain/models/PsychotherapyAppointment';
import { AppError } from '../../../domain/errors/AppError';

describe('SavePsychotherapyAppointmentUseCase — cap de 3 meses e renovação de série', () => {
    const tenantId = 'tenant-123';
    const patientId = 'patient-1';
    const rootId = 'root-1';

    let repository: jest.Mocked<IPsychotherapyRepository>;
    let googleCalendar: jest.Mocked<GoogleCalendarService>;
    let deleteUseCase: jest.Mocked<DeletePsychotherapyAppointmentUseCase>;
    let useCase: SavePsychotherapyAppointmentUseCase;

    beforeEach(() => {
        repository = {
            findAppointmentById: jest.fn(),
            saveAppointment: jest.fn(),
            listSeriesAppointments: jest.fn().mockResolvedValue([])
        } as unknown as jest.Mocked<IPsychotherapyRepository>;

        googleCalendar = {
            syncAppointment: jest.fn().mockResolvedValue(undefined)
        } as unknown as jest.Mocked<GoogleCalendarService>;

        deleteUseCase = {} as unknown as jest.Mocked<DeletePsychotherapyAppointmentUseCase>;

        useCase = new SavePsychotherapyAppointmentUseCase(repository, googleCalendar, deleteUseCase);
    });

    describe('cap de 3 meses em série nova', () => {
        it('rejeita recurrenceEndDate acima de 3 meses ao criar uma série nova', async () => {
            await expect(useCase.execute({
                tenantId,
                patientId,
                scheduledAt: new Date('2026-09-01T13:00:00.000Z'),
                recurrence: 'weekly',
                recurrenceEndDate: new Date('2027-01-05T13:00:00.000Z') // > 3 meses
            })).rejects.toThrow(AppError);

            expect(repository.saveAppointment).not.toHaveBeenCalled();
        });

        it('aceita recurrenceEndDate dentro de 3 meses ao criar uma série nova', async () => {
            repository.saveAppointment.mockResolvedValue(
                new PsychotherapyAppointment(
                    rootId, tenantId, patientId, new Date('2026-09-01T13:00:00.000Z'),
                    50, 'scheduled', 'weekly', new Date('2026-11-24T13:00:00.000Z'),
                    null, null, null, 'token', null, null
                )
            );

            await expect(useCase.execute({
                tenantId,
                patientId,
                scheduledAt: new Date('2026-09-01T13:00:00.000Z'),
                recurrence: 'weekly',
                recurrenceEndDate: new Date('2026-11-24T13:00:00.000Z') // dentro de 3 meses
            })).resolves.toBeDefined();

            expect(repository.saveAppointment).toHaveBeenCalled();
        });

        it('não aplica o cap ao EDITAR uma série já existente (mode single, mesmo tipo de recorrência)', async () => {
            const existingRoot = new PsychotherapyAppointment(
                rootId, tenantId, patientId, new Date('2026-01-01T13:00:00.000Z'),
                50, 'scheduled', 'weekly', new Date('2026-06-01T13:00:00.000Z'),
                null, null, null, 'token', null, null
            );
            repository.findAppointmentById.mockResolvedValue(existingRoot);
            repository.saveAppointment.mockResolvedValue(existingRoot);

            await expect(useCase.execute({
                id: rootId,
                tenantId,
                patientId,
                scheduledAt: new Date('2026-01-01T13:00:00.000Z'),
                recurrence: 'weekly',
                recurrenceEndDate: new Date('2027-06-01T13:00:00.000Z'), // bem além de 3 meses, mas é edição
                mode: 'single'
            })).resolves.toBeDefined();
        });
    });

    describe('renewSeries', () => {
        it('estende recurrenceEndDate a partir do fim atual e gera as ocorrências novas', async () => {
            const root = new PsychotherapyAppointment(
                rootId, tenantId, patientId, new Date('2026-06-01T13:00:00.000Z'),
                50, 'scheduled', 'weekly', new Date('2026-08-31T13:00:00.000Z'),
                null, null, null, 'token', null, null
            );
            repository.findAppointmentById.mockResolvedValue(root);
            repository.saveAppointment.mockImplementation(async (data: any) =>
                new PsychotherapyAppointment(
                    data.id ?? 'new-id', tenantId, patientId, data.scheduledAt,
                    data.durationMinutes ?? 50, data.status ?? 'scheduled', data.recurrence ?? 'none',
                    data.recurrenceEndDate ?? null, data.notes ?? null, null, null, 'token', null, data.parentId ?? null
                )
            );

            const renewed = await useCase.renewSeries(tenantId, rootId, 1);

            // addMonths usa setMonth: 31/ago + 1 mês estoura pro dia 1/out (setembro só tem 30 dias) —
            // comportamento conhecido do JS Date, aceitável para esse cap não-financeiro.
            expect(renewed.recurrenceEndDate?.toISOString()).toBe('2026-10-01T13:00:00.000Z');
            // Root atualizado + pelo menos uma ocorrência nova gerada dentro do novo trecho.
            expect(repository.saveAppointment).toHaveBeenCalledWith(expect.objectContaining({ id: rootId }));
            expect(repository.saveAppointment.mock.calls.length).toBeGreaterThan(1);
        });

        it('rejeita renovar um agendamento que não é o root da série', async () => {
            const child = new PsychotherapyAppointment(
                'child-1', tenantId, patientId, new Date('2026-06-08T13:00:00.000Z'),
                50, 'scheduled', 'none', null,
                null, null, null, 'token', null, rootId
            );
            repository.findAppointmentById.mockResolvedValue(child);

            await expect(useCase.renewSeries(tenantId, 'child-1', 1)).rejects.toThrow(AppError);
        });

        it('rejeita renovar um agendamento avulso (sem recorrência)', async () => {
            const oneOff = new PsychotherapyAppointment(
                'one-off', tenantId, patientId, new Date('2026-06-08T13:00:00.000Z'),
                50, 'scheduled', 'none', null,
                null, null, null, 'token', null, null
            );
            repository.findAppointmentById.mockResolvedValue(oneOff);

            await expect(useCase.renewSeries(tenantId, 'one-off', 1)).rejects.toThrow(AppError);
        });
    });
});
