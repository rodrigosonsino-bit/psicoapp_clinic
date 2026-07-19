import * as Sentry from '@sentry/node';
import type { Request } from 'express';
import { AppError } from '../domain/errors/AppError';

// Nomes de campos tratados como sensíveis em qualquer nível do payload do evento
// (body, query, headers, cookies, extras) — cobre credenciais e dado clínico/pessoal
// de paciente (LGPD art. 11, dado de saúde). Lista propositalmente ampla: preferimos
// remover demais a vazar prontuário/nota clínica para um terceiro (Sentry).
const SENSITIVE_KEY_PATTERN =
    /token|senha|password|secret|authorization|cookie|jwt|cpf|rg|email|telefone|phone|endereco|address|nota|note|prontuario|diagnos|sintoma|symptom|clinical|health|paciente_nome|patient_name/i;

// Sentry carrega a URL completa (com query string) em event.request.url e em
// breadcrumb.data.url das requisições HTTP — scrubObject só filtra por nome de
// chave, então não pega valores de query como ?search=<nome do paciente> ou
// ?code=<token OAuth>. Removemos a query string inteira em vez de tentar filtrar
// parâmetro a parâmetro (achado da revisão automática do Codex no PR #25).
function stripQueryString(url: string): string {
    const separatorIndex = url.search(/[?#]/);
    return separatorIndex === -1 ? url : url.slice(0, separatorIndex);
}

function scrubObject(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined || depth > 5) return value;
    if (Array.isArray(value)) return value.map(item => scrubObject(item, depth + 1));
    if (typeof value !== 'object') return value;

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[Filtered]' : scrubObject(val, depth + 1);
    }
    return result;
}

export function initSentry(): void {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        // Só error tracking nesta fase — tracing/APM aumenta volume e superfície de
        // dados coletados sem necessidade comprovada ainda (ver auditoria Codex 2026-07-19).
        tracesSampleRate: 0,
        sendDefaultPii: false,
        beforeBreadcrumb(breadcrumb) {
            // Breadcrumbs HTTP/console podem carregar URL com query de paciente ou
            // texto de log estruturado (Pino) contendo prontuário — removemos o corpo
            // e mantemos só metadados de navegação (categoria, tipo, timestamp).
            if (breadcrumb.data) {
                breadcrumb.data = scrubObject(breadcrumb.data) as Record<string, unknown>;
                if (typeof breadcrumb.data.url === 'string') {
                    breadcrumb.data.url = stripQueryString(breadcrumb.data.url);
                }
            }
            return breadcrumb;
        },
        beforeSend(event) {
            if (event.request) {
                delete event.request.data;
                delete event.request.cookies;
                delete event.request.query_string;
                if (event.request.url) {
                    event.request.url = stripQueryString(event.request.url);
                }
                if (event.request.headers) {
                    event.request.headers = scrubObject(event.request.headers) as Record<string, string>;
                }
            }
            if (event.user) {
                delete event.user.email;
                delete event.user.username;
                delete event.user.ip_address;
            }
            if (event.extra) {
                event.extra = scrubObject(event.extra) as Record<string, unknown>;
            }
            return event;
        },
    });
}

/**
 * Reporta apenas erros não-operacionais (bugs reais) ao Sentry — nunca AppError com
 * statusCode < 500 (regra de negócio esperada) nem ZodError (erro de validação de
 * entrada do usuário), para não afogar o error tracking com ruído previsto.
 */
export function captureServerException(err: unknown, req?: Request): void {
    if (err instanceof AppError && err.statusCode < 500) return;
    const isZodError =
        err instanceof Error &&
        (err.name === 'ZodError' || Array.isArray((err as { issues?: unknown }).issues));
    if (isZodError) return;

    Sentry.withScope(scope => {
        // Apenas identificadores não-sensíveis — nunca e-mail/nome/CPF/telefone do
        // usuário autenticado (ver auditoria de PII/PHI).
        const tenantId = (req as (Request & { tenantId?: string }) | undefined)?.tenantId;
        const userId = (req as (Request & { user?: { id?: string } }) | undefined)?.user?.id;
        if (tenantId) scope.setTag('tenant_id', tenantId);
        if (userId) scope.setTag('user_id', userId);
        if (req) {
            scope.setTag('method', req.method);
            scope.setTag('route', req.route?.path || req.path);
        }
        Sentry.captureException(err);
    });
}

/**
 * Reporta falhas fora do ciclo de requisição HTTP (ex.: boot do servidor, conexão
 * inicial com o banco) — sem req/scope de tenant, mas ainda precisam ir pro Sentry
 * (achado da revisão automática do Codex no PR #25: uma falha de boot em produção
 * antes não gerava evento nenhum).
 */
export function captureFatalException(err: unknown): void {
    Sentry.captureException(err);
}

export async function closeSentry(timeoutMs = 2000): Promise<void> {
    await Sentry.flush(timeoutMs);
}
