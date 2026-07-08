import { Request, Response } from 'express';
import { isValidWebhookSignature } from '../../infrastructure/whatsappCloud/WebhookSignature';
import { loadWebhookAppSecret, loadWebhookVerifyToken, loadWhatsappCloudClientConfig } from '../../infrastructure/whatsappCloud/WhatsappCloudConfig';
import { IWhatsappCloudRepository } from '../../domain/repositories/IWhatsappCloudRepository';
import { logger } from '../../infrastructure/logger';

const RAW_BODY_MAX_BYTES = 512 * 1024; // 512KB — muito acima do que um payload legítimo de status/mensagem usa
const KNOWN_STATUS_VALUES = new Set(['sent', 'delivered', 'read', 'failed']);

interface MetaStatusItem {
    id?: string;
    status?: string;
    timestamp?: string;
    recipient_id?: string;
}

interface MetaContact {
    profile?: { name?: string };
    wa_id?: string;
}

interface MetaMessageItem {
    id?: string;
    from?: string;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
}

interface MetaChangeValue {
    metadata?: { phone_number_id?: string };
    statuses?: MetaStatusItem[];
    messages?: MetaMessageItem[];
    contacts?: MetaContact[];
}

/**
 * Webhook da WhatsApp Cloud API. Responsabilidade DELIBERADAMENTE mínima aqui:
 * validar assinatura, extrair itens de status conhecidos, persistir na inbox durável e
 * responder 2xx rápido. Todo processamento (avançar status de entrega) acontece no
 * WhatsappCloudInboxWorker, fora do ciclo da requisição — nunca aqui.
 */
export class WhatsappCloudWebhookController {
    constructor(private readonly repository: IWhatsappCloudRepository) {}

    verify = (req: Request, res: Response): void => {
        const verifyToken = loadWebhookVerifyToken();
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (!verifyToken) {
            logger.error('[WhatsappCloudWebhook] WHATSAPP_CLOUD_API_WEBHOOK_VERIFY_TOKEN não configurado.');
            res.sendStatus(500);
            return;
        }

        if (mode === 'subscribe' && token === verifyToken && typeof challenge === 'string') {
            res.status(200).type('text/plain').send(challenge);
            return;
        }

        res.sendStatus(403);
    };

    receive = async (req: Request, res: Response): Promise<void> => {
        // req.body é um Buffer bruto aqui (rota usa express.raw(), registrada ANTES do
        // express.json() global — ver whatsappCloudWebhookRoutes.ts e server.ts).
        const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

        if (rawBody.length === 0 || rawBody.length > RAW_BODY_MAX_BYTES) {
            res.sendStatus(400);
            return;
        }

        const appSecret = loadWebhookAppSecret();
        const signatureHeader = req.header('x-hub-signature-256');

        if (!appSecret || !isValidWebhookSignature(rawBody, signatureHeader, appSecret)) {
            logger.warn('[WhatsappCloudWebhook] Assinatura ausente ou inválida — payload rejeitado.');
            res.sendStatus(403);
            return;
        }

        let payload: any;
        try {
            payload = JSON.parse(rawBody.toString('utf8'));
        } catch {
            res.sendStatus(400);
            return;
        }

        if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload?.entry)) {
            // Estrutura mínima inesperada — responde 2xx (evita retry infinito da Meta por algo
            // que não vamos conseguir processar de qualquer forma) mas não persiste nada.
            res.sendStatus(200);
            return;
        }

        const configuredPhoneNumberId = loadWhatsappCloudClientConfig()?.phoneNumberId;

        try {
            for (const entry of payload.entry) {
                for (const change of entry?.changes ?? []) {
                    const value: MetaChangeValue = change?.value ?? {};

                    // Fail-closed: rejeita (não processa) qualquer evento sem phone_number_id ou
                    // com valor divergente do configurado, em vez de processar por omissão.
                    if (!configuredPhoneNumberId || value.metadata?.phone_number_id !== configuredPhoneNumberId) {
                        logger.warn('[WhatsappCloudWebhook] Evento sem phone_number_id correspondente — rejeitado (fail-closed).');
                        continue;
                    }

                    for (const status of value.statuses ?? []) {
                        await this.persistStatusEvent(status);
                    }

                    // Encaminhamento de mensagens inbound: SOMENTE notificação para o número
                    // pessoal (sem automação/resposta ao paciente) — ver WhatsappCloudInboxWorker.
                    const contactsByWaId = new Map((value.contacts ?? []).map(c => [c.wa_id, c.profile?.name ?? null]));
                    for (const message of value.messages ?? []) {
                        await this.persistMessageEvent(message, contactsByWaId);
                    }
                }
            }
        } catch (err) {
            // Nunca deixar uma falha de persistência esconder o recebimento do webhook da Meta
            // dela — mas também não podemos responder 2xx se NADA foi persistido, senão o evento
            // se perde para sempre (a Meta não reenvia depois de um 2xx). Resposta 500 aqui é
            // intencional: força a Meta a tentar de novo.
            logger.error({ err }, '[WhatsappCloudWebhook] Falha ao persistir eventos do webhook — sinalizando retry à Meta.');
            res.sendStatus(500);
            return;
        }

        res.sendStatus(200);
    };

    private async persistMessageEvent(message: MetaMessageItem, contactsByWaId: Map<string | undefined, string | null>): Promise<void> {
        if (!message?.id || !message.from || !message.timestamp) {
            return; // evento incompleto — ignorado com segurança
        }

        const providerTimestamp = new Date(Number(message.timestamp) * 1000);
        if (Number.isNaN(providerTimestamp.getTime())) return;

        // Preview curto e só de texto — mídia/áudio/outros tipos viram um marcador genérico em
        // vez de tentar baixar/reter o conteúdo (fora de escopo desta notificação simples).
        const textPreview = message.type === 'text' && message.text?.body
            ? message.text.body.slice(0, 300)
            : `[mensagem do tipo '${message.type ?? 'desconhecido'}']`;

        await this.repository.insertWebhookMessageEvent({
            providerMessageId: message.id,
            fromPhoneDigits: message.from.replace(/\D/g, ''),
            contactName: contactsByWaId.get(message.from) ?? null,
            textPreview,
            providerTimestamp,
        });
    }

    private async persistStatusEvent(status: MetaStatusItem): Promise<void> {
        if (!status?.id || !status.status || !KNOWN_STATUS_VALUES.has(status.status) || !status.timestamp) {
            return; // evento desconhecido/incompleto — ignorado com segurança, sem gerar erro
        }

        const providerTimestamp = new Date(Number(status.timestamp) * 1000);
        if (Number.isNaN(providerTimestamp.getTime())) return;

        await this.repository.insertWebhookStatusEvent({
            providerMessageId: status.id,
            statusValue: status.status as 'sent' | 'delivered' | 'read' | 'failed',
            providerTimestamp,
            rawPayload: status,
        });
    }
}
