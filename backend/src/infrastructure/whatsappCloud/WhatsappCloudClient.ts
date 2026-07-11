import { logger } from '../logger';
import { WhatsappCloudClientConfig, TemplateComponentParameter, SubmissionOutcome } from './types';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Backoff com jitter — evita que retries de várias tentativas colidam no mesmo instante. */
function backoffDelayMs(attempt: number): number {
    const base = 500 * Math.pow(2, attempt);
    const jitter = Math.random() * 250;
    return base + jitter;
}

/** Nunca logar token/telefone/payload completo — só o necessário para diagnóstico. */
function redact(value: string | undefined): string {
    if (!value) return '';
    return value.length <= 4 ? '****' : `${value.slice(0, 2)}***${value.slice(-2)}`;
}

/** Header Retry-After pode vir como segundos inteiros ou como data HTTP — trata os dois formatos. */
function parseRetryAfterMs(header: string | null): number | undefined {
    if (!header) return undefined;
    const asSeconds = Number(header);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds * 1000;
    const asDate = Date.parse(header);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
    return undefined;
}

interface InternalOutcome extends SubmissionOutcome {
    retryAfterMs?: number;
}

/**
 * Cliente HTTP fino para a WhatsApp Cloud API (Graph API da Meta). Sem dependência de banco —
 * cada chamada retorna um resultado classificado (accepted/rejected/unknown) para que o chamador
 * decida a política de retry (nunca reenviar automaticamente um resultado 'unknown').
 */
export class WhatsappCloudClient {
    constructor(private readonly config: WhatsappCloudClientConfig) {}

    private get baseUrl(): string {
        return `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
    }

    async sendTemplateMessage(
        toE164: string,
        templateName: string,
        languageCode: string,
        parameters: TemplateComponentParameter[]
    ): Promise<SubmissionOutcome> {
        const components = parameters.map(p => {
            if (p.type === 'body') {
                return { type: 'body', parameters: p.values.map(text => ({ type: 'text', text })) };
            }
            if (p.type === 'header') {
                return { type: 'header', parameters: p.values.map(text => ({ type: 'text', text })) };
            }
            return {
                type: 'button',
                sub_type: 'quick_reply',
                index: String(p.buttonIndex ?? 0),
                parameters: p.values.map(text => ({ type: 'payload', payload: text })),
            };
        });

        const body = {
            messaging_product: 'whatsapp',
            to: toE164,
            type: 'template',
            template: {
                name: templateName,
                language: { code: languageCode },
                components,
            },
        };

        return this.postWithRetry(body, toE164);
    }

    /**
     * Mensagem de texto livre — só é aceita pela Meta dentro da janela de 24h desde a última
     * mensagem do destinatário para o número (janela de atendimento ao cliente). Fora da janela,
     * a Meta rejeita com erro específico; é preciso usar template nesse caso.
     */
    async sendFreeformText(toE164: string, text: string): Promise<SubmissionOutcome> {
        const body = {
            messaging_product: 'whatsapp',
            to: toE164,
            type: 'text',
            text: { body: text },
        };

        return this.postWithRetry(body, toE164);
    }

    private async postWithRetry(body: unknown, toE164: string): Promise<SubmissionOutcome> {
        let lastOutcome: SubmissionOutcome = { kind: 'unknown', errorMessage: 'Nenhuma tentativa executada' };

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const outcome = await this.postOnce(body);

            if (outcome.kind === 'accepted' || outcome.kind === 'rejected') {
                return outcome; // resultado definitivo — não precisa (nem deve) retry aqui
            }

            lastOutcome = outcome;

            // 'unknown' com sinal explícito de rate limit (429) pode reter conforme Retry-After;
            // qualquer outro 'unknown' (timeout/5xx pós-envio) NÃO é retentado automaticamente
            // dentro desta chamada — decisão de reenviar fica com o chamador (attempts/log).
            if (outcome.httpStatus === 429 && attempt < MAX_RETRIES) {
                // Respeita o Retry-After real da Meta quando presente; só usa o backoff próprio
                // como fallback se o header não vier.
                const delay = (outcome as InternalOutcome).retryAfterMs ?? backoffDelayMs(attempt);
                logger.warn({ to: redact(toE164), attempt, delay }, '[WhatsappCloud] 429 — aguardando antes de tentar novamente');
                await sleep(delay);
                continue;
            }

            break;
        }

        return lastOutcome;
    }

    private async postOnce(body: unknown): Promise<InternalOutcome> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.config.accessToken}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timeout);

            let parsed: any = null;
            try {
                parsed = await response.json();
            } catch {
                // corpo não-JSON — trata como unknown abaixo
            }

            if (response.ok && parsed?.messages?.[0]?.id) {
                return { kind: 'accepted', httpStatus: response.status, wamid: parsed.messages[0].id };
            }

            const errorCode = parsed?.error?.code ? String(parsed.error.code) : undefined;
            const errorMessage = parsed?.error?.message ? String(parsed.error.message).slice(0, 300) : undefined;

            // 4xx (exceto 429, tratado como retry-able acima): rejeição definitiva da Meta.
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                return { kind: 'rejected', httpStatus: response.status, errorCode, errorMessage };
            }

            // 429 e 5xx: resultado incerto — pode ter sido aceito sem confirmação chegar.
            const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers.get('retry-after')) : undefined;
            return { kind: 'unknown', httpStatus: response.status, errorCode, errorMessage, retryAfterMs };
        } catch (err) {
            clearTimeout(timeout);
            const isAbort = err instanceof Error && err.name === 'AbortError';
            logger.warn({ err: isAbort ? 'timeout' : (err as Error)?.message }, '[WhatsappCloud] Falha de rede/timeout ao enviar template');
            // Timeout/erro de rede APÓS o request ter sido despachado é ambíguo por definição —
            // não sabemos se a Meta processou antes da conexão cair.
            return { kind: 'unknown', errorMessage: isAbort ? 'timeout' : 'network_error' };
        }
    }
}
