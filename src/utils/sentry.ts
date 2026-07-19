import * as Sentry from '@sentry/react';

// Mesma lista usada no backend (backend/src/infrastructure/sentry.ts) — cobre
// credenciais e dado clínico/pessoal de paciente (LGPD art. 11, dado de saúde).
// Duplicada de propósito: frontend e backend não compartilham módulo, e o risco
// de vazar prontuário/nota clínica pro Sentry justifica manter a lista redundante
// em vez de arriscar um import cruzado quebrar o build de um dos dois lados.
const SENSITIVE_KEY_PATTERN =
  /token|senha|password|secret|authorization|cookie|jwt|cpf|rg|email|telefone|phone|endereco|address|nota|note|prontuario|diagnos|sintoma|symptom|clinical|health|paciente_nome|patient_name/i;

// Mesmo racional do backend (backend/src/infrastructure/sentry.ts): Sentry carrega
// a URL completa (com query string) em event.request.url e em breadcrumb.data.url,
// que scrubObject (filtro por nome de chave) não cobre — achado da revisão
// automática do Codex no PR #25.
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
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Só error tracking nesta fase, sem tracing/APM nem Session Replay — ver
    // auditoria Codex 2026-07-19 (mesma decisão do backend).
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeBreadcrumb(breadcrumb) {
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
