import { WhatsappCloudClient } from '../WhatsappCloudClient';
import { WhatsappCloudSender } from '../WhatsappCloudSender';
import { IWhatsappCloudRepository, WhatsappCloudTemplateBinding } from '../../../domain/repositories/IWhatsappCloudRepository';
import { UpcomingAppointment } from '../../../domain/repositories/IPsychotherapyRepository';

function makeRepository(): jest.Mocked<IWhatsappCloudRepository> {
    return {
        getActiveTemplate: jest.fn(),
        updateTemplateSyncStatus: jest.fn(),
        reserveAttempt: jest.fn(),
        finalizeAttempt: jest.fn(),
        createDeliveryRecord: jest.fn(),
        advanceDeliveryStatus: jest.fn(),
        insertWebhookStatusEvent: jest.fn(),
        insertWebhookMessageEvent: jest.fn(),
        insertOutboundMessage: jest.fn(),
        insertInboundMessageIfPatientMatch: jest.fn(),
        listMessagesForPatient: jest.fn(),
        claimUnseenConversations: jest.fn(),
        claimPendingWebhookEvents: jest.fn(),
        markWebhookEventProcessed: jest.fn(),
        markWebhookEventFailed: jest.fn(),
    };
}

function makeAppointment(overrides: Partial<UpcomingAppointment> = {}): UpcomingAppointment {
    return {
        appointmentId: 'appt-1',
        tenantId: 'tenant-1',
        tenantName: 'Tenant',
        patientId: 'patient-1',
        patientName: 'Fulano',
        patientPhone: '5511999999999',
        patientEmail: null,
        reminderChannel: 'whatsapp',
        scheduledAt: new Date('2026-08-18T16:30:00.000Z'),
        durationMinutes: 50,
        confirmToken: 'b854e34e-ae58-4417-8999-7326be98c890',
        ...overrides,
    };
}

function makeTemplate(overrides: Partial<WhatsappCloudTemplateBinding['parameterSchema']> = {}): WhatsappCloudTemplateBinding {
    return {
        id: 'tpl-1',
        purpose: 'session_reminder',
        metaTemplateName: 'session_reminder',
        languageCode: 'pt_BR',
        parameterSchema: { body: ['nome', 'data', 'duracao'], ...overrides },
        metaStatus: 'APPROVED',
        active: true,
    };
}

describe('WhatsappCloudSender — botão de URL do lembrete (inerte até parameterSchema.buttons existir)', () => {
    let repository: jest.Mocked<IWhatsappCloudRepository>;
    let client: { sendTemplateMessage: jest.Mock };
    let sender: WhatsappCloudSender;

    beforeEach(() => {
        repository = makeRepository();
        client = { sendTemplateMessage: jest.fn().mockResolvedValue({ kind: 'accepted', wamid: 'wamid.1', httpStatus: 200 }) };
        sender = new WhatsappCloudSender(client as unknown as WhatsappCloudClient, repository);
        repository.reserveAttempt.mockResolvedValue(1);
    });

    it('sem "buttons" no schema, o payload permanece idêntico ao atual (sem componente de botão)', async () => {
        repository.getActiveTemplate.mockResolvedValue(makeTemplate());

        await sender.sendSessionReminder(makeAppointment());

        const parameters = client.sendTemplateMessage.mock.calls[0][3];
        expect(parameters.some((p: any) => p.type === 'button')).toBe(false);
    });

    it('com buttons: ["confirmToken"], gera um parâmetro de botão subType "url" com o token', async () => {
        repository.getActiveTemplate.mockResolvedValue(makeTemplate({ buttons: ['confirmToken'] }));

        await sender.sendSessionReminder(makeAppointment({ confirmToken: 'my-token' }));

        const parameters = client.sendTemplateMessage.mock.calls[0][3];
        expect(parameters).toContainEqual({
            type: 'button',
            subType: 'url',
            buttonIndex: 0,
            values: ['my-token'],
        });
    });

    it('confirmToken nulo: lança (sem chamar a Meta nem reservar tentativa) — ReminderScheduler trata como falha não-retentável', async () => {
        repository.getActiveTemplate.mockResolvedValue(makeTemplate({ buttons: ['confirmToken'] }));

        await expect(sender.sendSessionReminder(makeAppointment({ confirmToken: null })))
            .rejects.toThrow('Agendamento sem confirmToken');

        expect(client.sendTemplateMessage).not.toHaveBeenCalled();
        expect(repository.reserveAttempt).not.toHaveBeenCalled();
    });

    it('mais de uma variável em "buttons" é configuração inconsistente e lança antes de chamar a Meta', async () => {
        repository.getActiveTemplate.mockResolvedValue(makeTemplate({ buttons: ['confirmToken', 'outraVar'] }));

        await expect(sender.sendSessionReminder(makeAppointment()))
            .rejects.toThrow('deve configurar exatamente uma variável');

        expect(client.sendTemplateMessage).not.toHaveBeenCalled();
    });
});

describe('WhatsappCloudClient — formato do componente de botão na Graph API', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    function mockFetchAccepted() {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ messages: [{ id: 'wamid.1' }] }),
        }) as unknown as typeof fetch;
    }

    it('subType "url" monta sub_type: "url" e parameters com type "text" (não "payload")', async () => {
        mockFetchAccepted();
        const client = new WhatsappCloudClient({ apiVersion: 'v21.0', phoneNumberId: '123', accessToken: 'tok' });

        await client.sendTemplateMessage('5511999999999', 'session_reminder', 'pt_BR', [
            { type: 'body', values: ['Fulano', '18/08 16:30', '50'] },
            { type: 'button', subType: 'url', buttonIndex: 0, values: ['my-token'] },
        ]);

        const sentBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        const buttonComponent = sentBody.template.components.find((c: any) => c.type === 'button');
        expect(buttonComponent).toEqual({
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: 'my-token' }],
        });
    });

    it('sem subType (default), continua montando quick_reply com type "payload" — comportamento pré-existente preservado', async () => {
        mockFetchAccepted();
        const client = new WhatsappCloudClient({ apiVersion: 'v21.0', phoneNumberId: '123', accessToken: 'tok' });

        await client.sendTemplateMessage('5511999999999', 'some_template', 'pt_BR', [
            { type: 'button', buttonIndex: 0, values: ['SIM'] },
        ]);

        const sentBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        const buttonComponent = sentBody.template.components.find((c: any) => c.type === 'button');
        expect(buttonComponent).toEqual({
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: 'SIM' }],
        });
    });
});
