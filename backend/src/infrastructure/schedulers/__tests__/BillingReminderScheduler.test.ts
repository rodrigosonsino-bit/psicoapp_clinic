import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { BillingReminderScheduler } from '../BillingReminderScheduler';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { WhatsappCloudClient } from '../../whatsappCloud/WhatsappCloudClient';
import { PsychotherapyPatient } from '../../../domain/models/PsychotherapyPatient';
import { PsychotherapyMonthlyRecord } from '../../../domain/models/PsychotherapyMonthlyRecord';
import { TenantProfile } from '../../../domain/models/TenantProfile';

const TENANT_ID = 'tenant-1';
const MONTH = '2026-07';

function makeTenant(): TenantProfile {
    return new TenantProfile(
        TENANT_ID, 'Clinica', 'clinica@example.com', null, null, null, null,
        false, null, null, 'deepgram_web', true, null
    );
}

function makePatient(overrides: Partial<{
    paymentType: 'monthly' | 'per_session' | null;
    phone: string | null;
    automaticBillingOptOut: boolean;
}> = {}): PsychotherapyPatient {
    return new PsychotherapyPatient(
        'patient-1', TENANT_ID, 'Joel', 'weekly',
        overrides.paymentType ?? 'per_session',
        10000, null, null,
        overrides.phone === undefined ? '+5511999999999' : overrides.phone,
        null, new Date(), new Date(),
        'whatsapp', 'Joel', false, true,
        overrides.automaticBillingOptOut ?? false
    );
}

function makeRecord(overrides: Partial<{
    paymentStatus: 'paid' | 'pending' | 'partial';
    sessionPriceCents: number | null;
    expectedSessions: number;
    paidSessions: number;
    absences: number;
    previousMonthPaidCents: number;
}> = {}): PsychotherapyMonthlyRecord {
    return new PsychotherapyMonthlyRecord(
        'record-1', TENANT_ID, 'patient-1', MONTH, 'Joel', 'weekly',
        'per_session',
        overrides.sessionPriceCents ?? 10000,
        overrides.expectedSessions ?? 2,
        overrides.paidSessions ?? 1,
        overrides.absences ?? 0,
        overrides.paymentStatus ?? 'partial',
        null,
        overrides.previousMonthPaidCents ?? 0,
        new Date(), new Date()
    );
}

describe('BillingReminderScheduler — elegibilidade de per_session', () => {
    const setup = () => {
        const repository = mock<IPsychotherapyRepository>();
        const whatsappCloudClient = mock<WhatsappCloudClient>();
        repository.listTenantsWithAutomaticBilling.mockResolvedValue([makeTenant()]);
        repository.hasSentBillingReminder.mockResolvedValue(false);
        whatsappCloudClient.sendTemplateMessage.mockResolvedValue({ kind: 'accepted' } as any);

        process.env.WHATSAPP_PROVIDER = 'meta_cloud';
        const scheduler = new BillingReminderScheduler(repository, undefined, whatsappCloudClient);
        return { repository, whatsappCloudClient, scheduler };
    };

    it('paciente per_session com saldo pendente (partial) é candidato e recebe a cobrança', async () => {
        const { repository, whatsappCloudClient, scheduler } = setup();
        repository.listMonthlyRecords.mockResolvedValue([makeRecord({ paymentStatus: 'partial' })]);
        repository.findActivePatientById.mockResolvedValue(makePatient({ paymentType: 'per_session' }));

        const results = await scheduler.runOnce({ dryRun: true });

        expect(results).toHaveLength(1);
        expect(results[0].sent).toBe(false); // dryRun não envia
        expect(results[0].patientId).toBe('patient-1');
        expect(whatsappCloudClient.sendTemplateMessage).not.toHaveBeenCalled();
    });

    it('paciente per_session totalmente pago não é candidato', async () => {
        const { repository, scheduler } = setup();
        repository.listMonthlyRecords.mockResolvedValue([
            makeRecord({ paymentStatus: 'paid', paidSessions: 2, expectedSessions: 2 })
        ]);
        repository.findActivePatientById.mockResolvedValue(makePatient({ paymentType: 'per_session' }));

        const results = await scheduler.runOnce({ dryRun: true });

        expect(results).toHaveLength(0);
    });

    it('paciente com opt-out não é candidato mesmo com saldo pendente', async () => {
        const { repository, scheduler } = setup();
        repository.listMonthlyRecords.mockResolvedValue([makeRecord({ paymentStatus: 'pending' })]);
        repository.findActivePatientById.mockResolvedValue(
            makePatient({ paymentType: 'per_session', automaticBillingOptOut: true })
        );

        const results = await scheduler.runOnce({ dryRun: true });

        expect(results).toHaveLength(0);
    });

    it('paciente sem telefone não é candidato', async () => {
        const { repository, scheduler } = setup();
        repository.listMonthlyRecords.mockResolvedValue([makeRecord({ paymentStatus: 'pending' })]);
        repository.findActivePatientById.mockResolvedValue(makePatient({ paymentType: 'per_session', phone: null }));

        const results = await scheduler.runOnce({ dryRun: true });

        expect(results).toHaveLength(0);
    });

    it('lembrete já enviado no mês não é reenviado', async () => {
        const { repository, scheduler } = setup();
        repository.listMonthlyRecords.mockResolvedValue([makeRecord({ paymentStatus: 'pending' })]);
        repository.findActivePatientById.mockResolvedValue(makePatient({ paymentType: 'per_session' }));
        repository.hasSentBillingReminder.mockResolvedValue(true);

        const results = await scheduler.runOnce({ dryRun: true });

        expect(results).toHaveLength(0);
    });

    it('paciente monthly com saldo pendente continua sendo candidato (comportamento preexistente)', async () => {
        const { repository, scheduler } = setup();
        repository.listMonthlyRecords.mockResolvedValue([makeRecord({ paymentStatus: 'pending' })]);
        repository.findActivePatientById.mockResolvedValue(makePatient({ paymentType: 'monthly' }));

        const results = await scheduler.runOnce({ dryRun: true });

        expect(results).toHaveLength(1);
    });
});
