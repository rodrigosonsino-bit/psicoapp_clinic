/**
 * Adapter fino da WhatsApp Cloud API (Meta Graph API). Não depende de banco de dados nem de
 * qualquer repositório — só sabe falar HTTP com a Meta e validar assinaturas de webhook.
 * Toda persistência/orquestração fica em WhatsappCloudSender e nos repositórios dedicados.
 */

export interface WhatsappCloudClientConfig {
    /** Versão da Graph API fixada explicitamente (ex: "v21.0") — nunca usar "latest" implícito. */
    apiVersion: string;
    phoneNumberId: string;
    accessToken: string;
    /** Timeout por requisição, em ms. */
    timeoutMs?: number;
}

export interface TemplateComponentParameter {
    type: 'body' | 'header' | 'button';
    /** Índice do botão (só relevante para type='button'). */
    buttonIndex?: number;
    values: string[];
}

export interface SendTemplateResult {
    /** wamid retornado pela Meta — identificador único da mensagem para correlação de status. */
    wamid: string;
    httpStatus: number;
}

export type SubmissionOutcomeKind = 'accepted' | 'rejected' | 'unknown';

/**
 * Classificação do resultado de uma tentativa de envio:
 * - 'accepted': a Meta confirmou recebimento (2xx com wamid).
 * - 'rejected': erro claro e definitivo (4xx exceto 429) — seguro reenviar depois de corrigir.
 * - 'unknown': timeout/erro de rede após o request sair, ou 5xx/429 esgotando retries — o envio
 *   PODE ter sido aceito pela Meta sem confirmação chegar até nós. NÃO deve gerar reenvio automático
 *   cego (risco de duplicar a mensagem para o paciente).
 */
export interface SubmissionOutcome {
    kind: SubmissionOutcomeKind;
    httpStatus?: number;
    errorCode?: string;
    /** Mensagem sanitizada/curta — nunca incluir telefone ou corpo da mensagem. */
    errorMessage?: string;
    wamid?: string;
}
