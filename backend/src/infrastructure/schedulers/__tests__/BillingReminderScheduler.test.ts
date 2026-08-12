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
    month: string;
}> = {}): PsychotherapyMonthlyRecord {
    return new PsychotherapyMonthlyRecord(
        'record-1', TENANT_ID, 'patient-1', overrides.month ?? MONTH, 'Joel', 'weekly',
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
        repository.listPatientMonthlyRecordsBefore.mockResolvedValue([]);
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

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

describe('BillingReminderScheduler — alerta de inadimplência acumulada', () => {
    const setup = () => {
        const repository = mock<IPsychotherapyRepository>();
        const whatsappCloudClient = mock<WhatsappCloudClient>();
        repository.listTenantsWithAutomaticBilling.mockResolvedValue([makeTenant()]);
        repository.hasSentBillingReminder.mockResolvedValue(false);
        repository.listMonthlyRecords.mockResolvedValue([makeRecord({ paymentStatus: 'pending' })]);
        repository.findActivePatientById.mockResolvedValue(makePatient({ paymentType: 'per_session' }));
        whatsappCloudClient.sendTemplateMessage.mockResolvedValue({ kind: 'accepted' } as any);

        process.env.WHATSAPP_PROVIDER = 'meta_cloud';
        const scheduler = new BillingReminderScheduler(repository, undefined, whatsappCloudClient);
        return { repository, whatsappCloudClient, scheduler };
    };

    it('sem meses anteriores em aberto: não altera o valor enviado no template', async () => {
        const { repository, whatsappCloudClient, scheduler } = setup();
        repository.listPatientMonthlyRecordsBefore.mockResolvedValue([]);

        await scheduler.runOnce({ dryRun: false });

        const [, , , components] = whatsappCloudClient.sendTemplateMessage.mock.calls[0];
        expect(components[0].values[2]).toBe(brl(10000));
    });

    it('um mês anterior em aberto: soma corretamente e avisa que o valor não está incluído na fatura atual', async () => {
        const { repository, whatsappCloudClient, scheduler } = setup();
        repository.listPatientMonthlyRecordsBefore.mockResolvedValue([
            makeRecord({ month: '2026-06', paymentStatus: 'pending', paidSessions: 0, expectedSessions: 1 })
        ]);

        const results = await scheduler.runOnce({ dryRun: false });

        expect(results[0].overdueMonthsCount).toBe(1);
        expect(results[0].overdueTotalCents).toBe(10000);
        // amountCents da cobrança do mês corrente continua isolado (não soma o atraso)
        expect(results[0].amountCents).toBe(10000);

        const [, , , components] = whatsappCloudClient.sendTemplateMessage.mock.calls[0];
        expect(components[0].values[2]).toContain('não incluído nesta fatura');
        expect(components[0].values[2]).toContain(`${brl(10000)} pendente`);
    });

    it('vários meses anteriores em aberto: soma o total e conta corretamente', async () => {
        const { repository, scheduler } = setup();
        repository.listPatientMonthlyRecordsBefore.mockResolvedValue([
            makeRecord({ month: '2026-05', paymentStatus: 'pending', paidSessions: 0, expectedSessions: 1 }),
            makeRecord({ month: '2026-06', paymentStatus: 'partial', paidSessions: 0, expectedSessions: 1 })
        ]);

        const results = await scheduler.runOnce({ dryRun: false });

        expect(results[0].overdueMonthsCount).toBe(2);
        expect(results[0].overdueTotalCents).toBe(20000);
    });

    it('mês anterior já pago (pendingAmountCents = 0) não entra no alerta', async () => {
        const { repository, whatsappCloudClient, scheduler } = setup();
        repository.listPatientMonthlyRecordsBefore.mockResolvedValue([
            makeRecord({ month: '2026-06', paymentStatus: 'paid', paidSessions: 1, expectedSessions: 1 })
        ]);

        const results = await scheduler.runOnce({ dryRun: false });

        expect(results[0].overdueMonthsCount).toBe(0);
        expect(results[0].overdueTotalCents).toBe(0);
        const [, , , components] = whatsappCloudClient.sendTemplateMessage.mock.calls[0];
        expect(components[0].values[2]).toBe(brl(10000));
    });

    it('status inconsistente (paymentStatus=paid mas pendingAmountCents>0) ainda entra no alerta', async () => {
        const { repository, scheduler } = setup();
        repository.listPatientMonthlyRecordsBefore.mockResolvedValue([
            makeRecord({ month: '2026-06', paymentStatus: 'paid', paidSessions: 0, expectedSessions: 1 })
        ]);

        const results = await scheduler.runOnce({ dryRun: false });

        expect(results[0].overdueMonthsCount).toBe(1);
        expect(results[0].overdueTotalCents).toBe(10000);
    });

    it('falha ao consultar meses anteriores não impede o envio da cobrança do mês corrente', async () => {
        const { repository, whatsappCloudClient, scheduler } = setup();
        repository.listPatientMonthlyRecordsBefore.mockRejectedValue(new Error('timeout no banco'));

        const results = await scheduler.runOnce({ dryRun: false });

        expect(results).toHaveLength(1);
        expect(results[0].sent).toBe(true);
        expect(results[0].overdueMonthsCount).toBe(0);
        expect(results[0].overdueTotalCents).toBe(0);
        const [, , , components] = whatsappCloudClient.sendTemplateMessage.mock.calls[0];
        expect(components[0].values[2]).toBe(brl(10000));
    });
});
