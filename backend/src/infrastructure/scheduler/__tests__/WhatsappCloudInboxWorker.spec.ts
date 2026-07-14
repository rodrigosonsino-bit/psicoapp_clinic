import { WhatsappCloudInboxWorker } from '../WhatsappCloudInboxWorker';
import { IWhatsappCloudRepository, PendingWebhookEvent } from '../../../domain/repositories/IWhatsappCloudRepository';

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

function statusEvent(overrides: Partial<PendingWebhookEvent> = {}): PendingWebhookEvent {
    return {
        id: 'evt-1',
        eventType: 'status',
        providerMessageId: 'wamid.abc',
        statusValue: 'delivered',
        providerTimestamp: new Date('2026-07-14T12:00:00Z'),
        rawPayload: {},
        processingAttempts: 0,
        ...overrides,
    };
}

/**
 * Cobre exatamente a classe de bug que causou o incidente corrigido no PR #1 (delivery record):
 * status events da Meta chegando para mensagens sem createDeliveryRecord() ainda commitado
 * caiam em dead-letter silenciosamente em vez de serem reagendados corretamente. Um teste aqui
 * teria pego isso antes de ir pra produção.
 */
describe('WhatsappCloudInboxWorker', () => {
    let repository: jest.Mocked<IWhatsappCloudRepository>;
    let worker: WhatsappCloudInboxWorker;

    beforeEach(() => {
        repository = makeRepository();
        worker = new WhatsappCloudInboxWorker(repository);
    });

    it('does nothing when there are no pending events', async () => {
        repository.claimPendingWebhookEvents.mockResolvedValue([]);

        await worker.processBatch();

        expect(repository.markWebhookEventProcessed).not.toHaveBeenCalled();
        expect(repository.markWebhookEventFailed).not.toHaveBeenCalled();
    });

    it('logs and returns early if claiming pending events itself fails (no throw escapes to the cron scheduler)', async () => {
        repository.claimPendingWebhookEvents.mockRejectedValue(new Error('db unreachable'));

        await expect(worker.processBatch()).resolves.toBeUndefined();
    });

    it('marks a status event as processed when the delivery status transition succeeds', async () => {
        const event = statusEvent();
        repository.claimPendingWebhookEvents.mockResolvedValue([event]);
        repository.advanceDeliveryStatus.mockResolvedValue('updated');

        await worker.processBatch();

        expect(repository.advanceDeliveryStatus).toHaveBeenCalledWith('wamid.abc', 'delivered', event.providerTimestamp);
        expect(repository.markWebhookEventProcessed).toHaveBeenCalledWith('evt-1');
        expect(repository.markWebhookEventFailed).not.toHaveBeenCalled();
    });

    it('treats a bare "sent" status as already-initial and marks it processed WITHOUT calling advanceDeliveryStatus', async () => {
        const event = statusEvent({ statusValue: 'sent' });
        repository.claimPendingWebhookEvents.mockResolvedValue([event]);

        await worker.processBatch();

        expect(repository.advanceDeliveryStatus).not.toHaveBeenCalled();
        expect(repository.markWebhookEventProcessed).toHaveBeenCalledWith('evt-1');
    });

    it('discards (marks processed) an incomplete event missing providerMessageId/statusValue, without calling the repository', async () => {
        const event = statusEvent({ providerMessageId: null });
        repository.claimPendingWebhookEvents.mockResolvedValue([event]);

        await worker.processBatch();

        expect(repository.advanceDeliveryStatus).not.toHaveBeenCalled();
        expect(repository.markWebhookEventProcessed).toHaveBeenCalledWith('evt-1');
    });

    it('THE CORE BUG CLASS: reschedules quickly (not_found) instead of dead-lettering when createDeliveryRecord has not landed yet', async () => {
        const event = statusEvent({ processingAttempts: 1 });
        repository.claimPendingWebhookEvents.mockResolvedValue([event]);
        repository.advanceDeliveryStatus.mockResolvedValue('not_found');

        await worker.processBatch();

        expect(repository.markWebhookEventProcessed).not.toHaveBeenCalled();
        expect(repository.markWebhookEventFailed).toHaveBeenCalledTimes(1);
        const [, , deadLetter] = repository.markWebhookEventFailed.mock.calls[0];
        expect(deadLetter).toBe(false);
    });

    it('dead-letters a "not_found" event once MAX_PROCESSING_ATTEMPTS (8) is reached, instead of retrying forever', async () => {
        const event = statusEvent({ processingAttempts: 8 });
        repository.claimPendingWebhookEvents.mockResolvedValue([event]);
        repository.advanceDeliveryStatus.mockResolvedValue('not_found');

        await worker.processBatch();

        expect(repository.markWebhookEventProcessed).not.toHaveBeenCalled();
        const [, , deadLetter] = repository.markWebhookEventFailed.mock.calls[0];
        expect(deadLetter).toBe(true);
    });

    it('marks processed (not failed) an out-of-order/duplicate transition (ignored_invalid_transition) — safe to discard', async () => {
        const event = statusEvent();
        repository.claimPendingWebhookEvents.mockResolvedValue([event]);
        repository.advanceDeliveryStatus.mockResolvedValue('ignored_invalid_transition');

        await worker.processBatch();

        expect(repository.markWebhookEventProcessed).toHaveBeenCalledWith('evt-1');
        expect(repository.markWebhookEventFailed).not.toHaveBeenCalled();
    });

    it('reschedules with exponential backoff (not dead-letter) when repository.advanceDeliveryStatus itself throws, below the attempt cap', async () => {
        const event = statusEvent({ processingAttempts: 2 });
        repository.claimPendingWebhookEvents.mockResolvedValue([event]);
        repository.advanceDeliveryStatus.mockRejectedValue(new Error('unexpected db error'));

        await worker.processBatch();

        expect(repository.markWebhookEventProcessed).not.toHaveBeenCalled();
        const [, , deadLetter] = repository.markWebhookEventFailed.mock.calls[0];
        expect(deadLetter).toBe(false);
    });

    it('dead-letters a hard failure once MAX_PROCESSING_ATTEMPTS is reached', async () => {
        const event = statusEvent({ processingAttempts: 8 });
        repository.claimPendingWebhookEvents.mockResolvedValue([event]);
        repository.advanceDeliveryStatus.mockRejectedValue(new Error('unexpected db error'));

        await worker.processBatch();

        const [, , deadLetter] = repository.markWebhookEventFailed.mock.calls[0];
        expect(deadLetter).toBe(true);
    });

    it('processes multiple events in the same batch independently — one failure does not block the others', async () => {
        const ok = statusEvent({ id: 'evt-ok', providerMessageId: 'wamid.ok' });
        const bad = statusEvent({ id: 'evt-bad', providerMessageId: 'wamid.bad' });
        repository.claimPendingWebhookEvents.mockResolvedValue([ok, bad]);
        repository.advanceDeliveryStatus.mockImplementation(async (id) => (id === 'wamid.ok' ? 'updated' : 'not_found'));

        await worker.processBatch();

        expect(repository.markWebhookEventProcessed).toHaveBeenCalledWith('evt-ok');
        expect(repository.markWebhookEventProcessed).not.toHaveBeenCalledWith('evt-bad');
        expect(repository.markWebhookEventFailed).toHaveBeenCalledWith('evt-bad', expect.any(Date), false);
    });

    describe('message events (encaminhamento pro número pessoal)', () => {
        it('marks a message event processed even when notifyConfig is not set (feature opcional, nunca deve travar a inbox)', async () => {
            const event: PendingWebhookEvent = {
                id: 'evt-msg',
                eventType: 'message',
                providerMessageId: 'wamid.msg',
                statusValue: null,
                providerTimestamp: new Date(),
                rawPayload: { fromPhoneDigits: '5511999998888', textPreview: 'Oi' },
                processingAttempts: 0,
            };
            repository.claimPendingWebhookEvents.mockResolvedValue([event]);

            await worker.processBatch();

            expect(repository.markWebhookEventProcessed).toHaveBeenCalledWith('evt-msg');
        });

        it('skips forwarding (but still processes) when the notification template is not yet approved', async () => {
            const notifyConfig = {
                client: { sendTemplateMessage: jest.fn() } as any,
                notifyPhoneDigits: '5511900000000',
                tenantId: 'tenant-1',
            };
            const workerWithNotify = new WhatsappCloudInboxWorker(repository, notifyConfig);
            const event: PendingWebhookEvent = {
                id: 'evt-msg-2',
                eventType: 'message',
                providerMessageId: 'wamid.msg2',
                statusValue: null,
                providerTimestamp: new Date(),
                rawPayload: { fromPhoneDigits: '5511999998888', textPreview: 'Oi de novo' },
                processingAttempts: 0,
            };
            repository.claimPendingWebhookEvents.mockResolvedValue([event]);
            repository.getActiveTemplate.mockResolvedValue({
                id: 't1', purpose: 'patient_reply_notify', metaTemplateName: 'x', languageCode: 'pt_BR',
                parameterSchema: {}, metaStatus: 'PENDING', active: true,
            });

            await workerWithNotify.processBatch();

            expect(notifyConfig.client.sendTemplateMessage).not.toHaveBeenCalled();
            expect(repository.markWebhookEventProcessed).toHaveBeenCalledWith('evt-msg-2');
        });
    });
});
