import 'reflect-metadata';
import { RecurrenceRenewalReminderScheduler } from '../RecurrenceRenewalReminderScheduler';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { WhatsappCloudClient } from '../../whatsappCloud/WhatsappCloudClient';
import { PsychotherapyAppointment } from '../../../domain/models/PsychotherapyAppointment';
import { TenantProfile } from '../../../domain/models/TenantProfile';

const TENANT_ID = 'tenant-1';

function makeTenant(adminMirrorPhone: string | null = '+5511988887777'): TenantProfile {
    return new TenantProfile(
        TENANT_ID, 'Clinica', 'clinica@example.com', 'Clinica LTDA', null, null, null,
        false, null, null, 'deepgram_web', false, adminMirrorPhone
    );
}

function makeRootAppointment(recurrenceEndDate: Date): PsychotherapyAppointment {
    return new PsychotherapyAppointment(
        'root-1', TENANT_ID, 'patient-1', new Date('2026-06-01T13:00:00.000Z'),
        50, 'scheduled', 'weekly', recurrenceEndDate,
        null, null, null, 'token', null, null
    );
}

describe('RecurrenceRenewalReminderScheduler', () => {
    let repository: jest.Mocked<IPsychotherapyRepository>;
    let whatsappCloudClient: jest.Mocked<WhatsappCloudClient>;
    let scheduler: RecurrenceRenewalReminderScheduler;

    beforeEach(() => {
        process.env.WHATSAPP_PROVIDER = 'meta_cloud';

        repository = {
            listAllTenants: jest.fn().mockResolvedValue([makeTenant()]),
            listExpiringRecurrenceRoots: jest.fn(),
            createRecurrenceRenewalNotice: jest.fn(),
        } as unknown as jest.Mocked<IPsychotherapyRepository>;

        whatsappCloudClient = {
            sendFreeformText: jest.fn().mockResolvedValue({ kind: 'accepted' })
        } as unknown as jest.Mocked<WhatsappCloudClient>;

        scheduler = new RecurrenceRenewalReminderScheduler(repository, undefined, whatsappCloudClient);
    });

    afterEach(() => {
        delete process.env.WHATSAPP_PROVIDER;
        jest.clearAllMocks();
    });

    it('cria o aviso e envia WhatsApp pro admin_mirror_phone quando é a 1ª vez nesse ciclo', async () => {
        const endDate = new Date('2026-08-30T00:00:00.000Z');
        repository.listExpiringRecurrenceRoots.mockResolvedValue([
            { appointment: makeRootAppointment(endDate), patientName: 'Joel', patientPhone: '+5511999999999' }
        ]);
        repository.createRecurrenceRenewalNotice.mockResolvedValue('notice-1');

        await scheduler.runOnce();

        expect(repository.createRecurrenceRenewalNotice).toHaveBeenCalledWith(
            TENANT_ID, 'root-1', 'patient-1', endDate
        );
        expect(whatsappCloudClient.sendFreeformText).toHaveBeenCalledTimes(1);
        expect(whatsappCloudClient.sendFreeformText).toHaveBeenCalledWith(
            '+5511988887777',
            expect.stringContaining('Joel')
        );
    });

    it('não reenvia WhatsApp quando o aviso já existe pra esse ciclo (idempotência)', async () => {
        const endDate = new Date('2026-08-30T00:00:00.000Z');
        repository.listExpiringRecurrenceRoots.mockResolvedValue([
            { appointment: makeRootAppointment(endDate), patientName: 'Joel', patientPhone: '+5511999999999' }
        ]);
        // null = já existia (unique constraint bateu) — não deve notificar de novo.
        repository.createRecurrenceRenewalNotice.mockResolvedValue(null);

        await scheduler.runOnce();

        expect(whatsappCloudClient.sendFreeformText).not.toHaveBeenCalled();
    });

    it('não envia WhatsApp quando o tenant não tem admin_mirror_phone configurado', async () => {
        repository.listAllTenants.mockResolvedValue([makeTenant(null)]);
        const endDate = new Date('2026-08-30T00:00:00.000Z');
        repository.listExpiringRecurrenceRoots.mockResolvedValue([
            { appointment: makeRootAppointment(endDate), patientName: 'Joel', patientPhone: '+5511999999999' }
        ]);
        repository.createRecurrenceRenewalNotice.mockResolvedValue('notice-1');

        await scheduler.runOnce();

        expect(repository.createRecurrenceRenewalNotice).toHaveBeenCalled();
        expect(whatsappCloudClient.sendFreeformText).not.toHaveBeenCalled();
    });

    it('não derruba o processamento dos demais tenants se um tenant falhar', async () => {
        repository.listAllTenants.mockResolvedValue([makeTenant(), makeTenant('+5511977776666')]);
        repository.listExpiringRecurrenceRoots
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce([]);

        await expect(scheduler.runOnce()).resolves.not.toThrow();
        expect(repository.listExpiringRecurrenceRoots).toHaveBeenCalledTimes(2);
    });
});
