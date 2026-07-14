import { createHmac } from 'crypto';
import { Request, Response } from 'express';
import { WhatsappCloudWebhookController } from '../WhatsappCloudWebhookController';
import { IWhatsappCloudRepository } from '../../../domain/repositories/IWhatsappCloudRepository';
import * as config from '../../../infrastructure/whatsappCloud/WhatsappCloudConfig';

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';
const PHONE_NUMBER_ID = '1234567890';

function sign(body: Buffer, secret: string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function makeRepository(): jest.Mocked<IWhatsappCloudRepository> {
    return {
        getActiveTemplate: jest.fn(),
        updateTemplateSyncStatus: jest.fn(),
        reserveAttempt: jest.fn(),
        finalizeAttempt: jest.fn(),
        createDeliveryRecord: jest.fn(),
        advanceDeliveryStatus: jest.fn(),
        insertWebhookStatusEvent: jest.fn().mockResolvedValue(true),
        insertWebhookMessageEvent: jest.fn().mockResolvedValue(true),
        insertOutboundMessage: jest.fn(),
        insertInboundMessageIfPatientMatch: jest.fn(),
        listMessagesForPatient: jest.fn(),
        claimUnseenConversations: jest.fn(),
        claimPendingWebhookEvents: jest.fn(),
        markWebhookEventProcessed: jest.fn(),
        markWebhookEventFailed: jest.fn(),
    };
}

function makeRes(): jest.Mocked<Response> {
    const res: Partial<Response> = {
        status: jest.fn().mockReturnThis(),
        sendStatus: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
    };
    return res as jest.Mocked<Response>;
}

describe('WhatsappCloudWebhookController', () => {
    let repository: jest.Mocked<IWhatsappCloudRepository>;
    let controller: WhatsappCloudWebhookController;

    beforeEach(() => {
        repository = makeRepository();
        controller = new WhatsappCloudWebhookController(repository);
        jest.spyOn(config, 'loadWebhookAppSecret').mockReturnValue(APP_SECRET);
        jest.spyOn(config, 'loadWebhookVerifyToken').mockReturnValue(VERIFY_TOKEN);
        jest.spyOn(config, 'loadWhatsappCloudClientConfig').mockReturnValue({
            apiVersion: 'v20.0',
            phoneNumberId: PHONE_NUMBER_ID,
            accessToken: 'token',
        });
    });

    describe('verify (GET handshake)', () => {
        it('echoes hub.challenge back when mode/token match', () => {
            const req = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'echo-me' } } as unknown as Request;
            const res = makeRes();

            controller.verify(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith('echo-me');
        });

        it('rejects with 403 when the verify token does not match', () => {
            const req = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'echo-me' } } as unknown as Request;
            const res = makeRes();

            controller.verify(req, res);

            expect(res.sendStatus).toHaveBeenCalledWith(403);
        });

        it('returns 500 when the verify token is not configured on the server', () => {
            jest.spyOn(config, 'loadWebhookVerifyToken').mockReturnValue(null);
            const req = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'echo-me' } } as unknown as Request;
            const res = makeRes();

            controller.verify(req, res);

            expect(res.sendStatus).toHaveBeenCalledWith(500);
        });
    });

    describe('receive (POST webhook)', () => {
        function makeReq(payload: object, opts?: { signatureSecret?: string; omitSignature?: boolean }): Request {
            const rawBody = Buffer.from(JSON.stringify(payload));
            const signature = opts?.omitSignature ? undefined : sign(rawBody, opts?.signatureSecret ?? APP_SECRET);
            return {
                body: rawBody,
                header: jest.fn((name: string) => (name.toLowerCase() === 'x-hub-signature-256' ? signature : undefined)),
            } as unknown as Request;
        }

        const statusPayload = {
            object: 'whatsapp_business_account',
            entry: [{
                changes: [{
                    value: {
                        metadata: { phone_number_id: PHONE_NUMBER_ID },
                        statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1700000000' }],
                    },
                }],
            }],
        };

        it('rejects with 403 when the signature is invalid', async () => {
            const req = makeReq(statusPayload, { signatureSecret: 'wrong-secret' });
            const res = makeRes();

            await controller.receive(req, res);

            expect(res.sendStatus).toHaveBeenCalledWith(403);
            expect(repository.insertWebhookStatusEvent).not.toHaveBeenCalled();
        });

        it('rejects with 403 when the signature header is missing', async () => {
            const req = makeReq(statusPayload, { omitSignature: true });
            const res = makeRes();

            await controller.receive(req, res);

            expect(res.sendStatus).toHaveBeenCalledWith(403);
        });

        it('rejects with 400 when the raw body is empty', async () => {
            const req = { body: Buffer.from([]), header: jest.fn() } as unknown as Request;
            const res = makeRes();

            await controller.receive(req, res);

            expect(res.sendStatus).toHaveBeenCalledWith(400);
        });

        it('rejects with 400 when the raw body is not valid JSON (but signature matches)', async () => {
            const rawBody = Buffer.from('not-json{{{');
            const req = {
                body: rawBody,
                header: jest.fn(() => sign(rawBody, APP_SECRET)),
            } as unknown as Request;
            const res = makeRes();

            await controller.receive(req, res);

            expect(res.sendStatus).toHaveBeenCalledWith(400);
        });

        it('responds 200 without persisting anything for an unexpected top-level shape', async () => {
            const req = makeReq({ object: 'something_else' });
            const res = makeRes();

            await controller.receive(req, res);

            expect(res.sendStatus).toHaveBeenCalledWith(200);
            expect(repository.insertWebhookStatusEvent).not.toHaveBeenCalled();
        });

        it('persists a valid status event and responds 200', async () => {
            const req = makeReq(statusPayload);
            const res = makeRes();

            await controller.receive(req, res);

            expect(repository.insertWebhookStatusEvent).toHaveBeenCalledWith(expect.objectContaining({
                providerMessageId: 'wamid.1',
                statusValue: 'delivered',
            }));
            expect(res.sendStatus).toHaveBeenCalledWith(200);
        });

        it('fail-closed: skips events whose phone_number_id does not match the configured one', async () => {
            const req = makeReq({
                object: 'whatsapp_business_account',
                entry: [{ changes: [{ value: { metadata: { phone_number_id: 'someone-elses-number' }, statuses: [{ id: 'wamid.2', status: 'read', timestamp: '1700000001' }] } }] }],
            });
            const res = makeRes();

            await controller.receive(req, res);

            expect(repository.insertWebhookStatusEvent).not.toHaveBeenCalled();
            expect(res.sendStatus).toHaveBeenCalledWith(200);
        });

        it('renders a reaction message as "<emoji> (reação)" in the preview instead of the generic unknown-type marker', async () => {
            const req = makeReq({
                object: 'whatsapp_business_account',
                entry: [{
                    changes: [{
                        value: {
                            metadata: { phone_number_id: PHONE_NUMBER_ID },
                            contacts: [{ wa_id: '5511999998888', profile: { name: 'Paciente Teste' } }],
                            messages: [{ id: 'wamid.3', from: '5511999998888', timestamp: '1700000002', type: 'reaction', reaction: { message_id: 'wamid.0', emoji: '❤️' } }],
                        },
                    }],
                }],
            });
            const res = makeRes();

            await controller.receive(req, res);

            expect(repository.insertWebhookMessageEvent).toHaveBeenCalledWith(expect.objectContaining({
                providerMessageId: 'wamid.3',
                textPreview: '❤️ (reação)',
                contactName: 'Paciente Teste',
            }));
        });

        it('responds 500 (forcing Meta to retry) when persistence throws, instead of silently swallowing the event', async () => {
            repository.insertWebhookStatusEvent.mockRejectedValueOnce(new Error('db down'));
            const req = makeReq(statusPayload);
            const res = makeRes();

            await controller.receive(req, res);

            expect(res.sendStatus).toHaveBeenCalledWith(500);
        });

        it('ignores an unknown status value without persisting or erroring', async () => {
            const req = makeReq({
                object: 'whatsapp_business_account',
                entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, statuses: [{ id: 'wamid.4', status: 'deleted', timestamp: '1700000003' }] } }] }],
            });
            const res = makeRes();

            await controller.receive(req, res);

            expect(repository.insertWebhookStatusEvent).not.toHaveBeenCalled();
            expect(res.sendStatus).toHaveBeenCalledWith(200);
        });
    });
});
