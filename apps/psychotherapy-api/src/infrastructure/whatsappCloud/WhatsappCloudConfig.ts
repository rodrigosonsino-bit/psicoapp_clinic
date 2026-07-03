import { WhatsappCloudClientConfig } from './types';

export type WhatsappProvider = 'disabled' | 'baileys' | 'meta_cloud';

const VALID_PROVIDERS: WhatsappProvider[] = ['disabled', 'baileys', 'meta_cloud'];

/**
 * Seleção de provedor FAIL-CLOSED: lê WHATSAPP_PROVIDER explicitamente. Nunca cai
 * silenciosamente para outro provedor — se o valor não for reconhecido, desliga o envio de
 * WhatsApp (melhor não enviar do que enviar pelo canal errado ou duplicar).
 * Ausente = 'baileys' (comportamento atual, zero mudança para quem não configurar nada).
 */
export function resolveWhatsAppProvider(): WhatsappProvider {
    const raw = process.env.WHATSAPP_PROVIDER?.trim();
    if (!raw) return 'baileys';
    if (VALID_PROVIDERS.includes(raw as WhatsappProvider)) return raw as WhatsappProvider;
    return 'disabled';
}

/**
 * Lê a config da Cloud API do ambiente. Retorna null se qualquer variável obrigatória estiver
 * ausente — o chamador deve tratar isso como erro visível (fail-closed), nunca como "usa Baileys
 * então". Token/App Secret nunca são logados.
 */
export function loadWhatsappCloudClientConfig(): WhatsappCloudClientConfig | null {
    const apiVersion = process.env.WHATSAPP_CLOUD_API_VERSION?.trim();
    const phoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID?.trim();
    const accessToken = process.env.WHATSAPP_CLOUD_API_TOKEN?.trim();

    if (!apiVersion || !phoneNumberId || !accessToken) {
        return null;
    }

    return { apiVersion, phoneNumberId, accessToken };
}

export function loadWebhookAppSecret(): string | null {
    return process.env.WHATSAPP_CLOUD_API_APP_SECRET?.trim() || null;
}

export function loadWebhookVerifyToken(): string | null {
    return process.env.WHATSAPP_CLOUD_API_WEBHOOK_VERIFY_TOKEN?.trim() || null;
}
