import { UpcomingAppointment } from '../../domain/repositories/IPsychotherapyRepository';
import { IWhatsappCloudRepository } from '../../domain/repositories/IWhatsappCloudRepository';
import { IReminderMessageSender, ReminderSendResult } from '../../domain/services/IReminderMessageSender';
import { WhatsappCloudClient } from './WhatsappCloudClient';
import { TemplateComponentParameter } from './types';
import { formatDateTimeBR } from '../scheduler/ReminderScheduler';
import { normalizePhoneDigits } from './phoneNormalization';
import { logger } from '../logger';

const REMINDER_TEMPLATE_PURPOSE = 'session_reminder';
const DEFAULT_LANGUAGE_CODE = 'pt_BR';

function resolveTemplateVariable(varName: string, appt: UpcomingAppointment): string {
    switch (varName) {
        case 'nome':
            return appt.patientName;
        case 'data':
            return formatDateTimeBR(appt.scheduledAt);
        case 'duracao':
            return String(appt.durationMinutes);
        default:
            throw new Error(`Variável de template não mapeada: ${varName}`);
    }
}

/**
 * Envia o lembrete de sessão via WhatsApp Cloud API usando um template pré-aprovado pela Meta.
 *
 * Fluxo com reserva atômica: o número da tentativa é RESERVADO no banco (via
 * repository.reserveAttempt) ANTES de chamar a Meta. Se duas execuções concorrentes tentarem
 * enviar o mesmo lembrete, a segunda perde a corrida na reserva (UNIQUE constraint) e nunca chega
 * a chamar a Meta — evita duplicar a mensagem para o paciente.
 */
export class WhatsappCloudSender implements IReminderMessageSender {
    constructor(
        private readonly client: WhatsappCloudClient,
        private readonly repository: IWhatsappCloudRepository
    ) {}

    async sendSessionReminder(appt: UpcomingAppointment): Promise<ReminderSendResult> {
        const template = await this.repository.getActiveTemplate(REMINDER_TEMPLATE_PURPOSE, DEFAULT_LANGUAGE_CODE);
        if (!template || !template.active || template.metaStatus !== 'APPROVED') {
            // Falha de configuração — fail-closed: nunca cai para outro provedor silenciosamente.
            return {
                success: false,
                retryEligible: false,
                errorMessage: 'Nenhum template Meta ativo e aprovado configurado para lembrete de sessão.',
            };
        }

        let phone: string;
        try {
            phone = normalizePhoneDigits(appt.patientPhone ?? '');
        } catch (err) {
            return { success: false, retryEligible: false, errorMessage: (err as Error).message };
        }

        const parameters: TemplateComponentParameter[] = [];
        if (template.parameterSchema.body?.length) {
            parameters.push({
                type: 'body',
                values: template.parameterSchema.body.map(varName => resolveTemplateVariable(varName, appt)),
            });
        }
        if (template.parameterSchema.header?.length) {
            parameters.push({
                type: 'header',
                values: template.parameterSchema.header.map(varName => resolveTemplateVariable(varName, appt)),
            });
        }

        const attemptNumber = await this.repository.reserveAttempt(appt.tenantId, appt.appointmentId);
        if (attemptNumber === null) {
            // Perdeu a corrida da reserva — outra execução já está processando este lembrete.
            logger.warn({ appointmentId: appt.appointmentId }, '⏭️ WhatsappCloudSender: reserva de tentativa em corrida — pulando para evitar duplicidade.');
            return { success: false, retryEligible: false, errorMessage: 'Tentativa concorrente já em andamento para este agendamento.' };
        }

        const outcome = await this.client.sendTemplateMessage(phone, template.metaTemplateName, template.languageCode, parameters);

        if (outcome.kind === 'accepted' || outcome.kind === 'rejected') {
            await this.repository.finalizeAttempt(appt.appointmentId, {
                attemptNumber,
                httpStatus: outcome.httpStatus,
                submissionResult: outcome.kind,
                providerMessageId: outcome.wamid,
                providerErrorCode: outcome.errorCode,
                providerErrorMessage: outcome.errorMessage,
            });
        } else {
            await this.repository.finalizeAttempt(appt.appointmentId, {
                attemptNumber,
                httpStatus: outcome.httpStatus,
                submissionResult: 'unknown',
                providerErrorCode: outcome.errorCode,
                providerErrorMessage: outcome.errorMessage,
            });
        }

        if (outcome.kind === 'accepted' && outcome.wamid) {
            await this.repository.createDeliveryRecord(outcome.wamid, appt.tenantId, appt.appointmentId);

            // Histórico de conversa exibido na ficha do paciente — só visualização, sem efeito
            // nenhum sobre o envio em si (se falhar, não deve derrubar o fluxo do lembrete).
            try {
                const bodyText = parameters
                    .filter(p => p.type === 'body' || p.type === 'header')
                    .flatMap(p => p.values)
                    .join(' — ') || `[template: ${template.metaTemplateName}]`;
                await this.repository.insertOutboundMessage({
                    tenantId: appt.tenantId,
                    patientId: appt.patientId,
                    providerMessageId: outcome.wamid,
                    body: bodyText,
                    occurredAt: new Date(),
                });
            } catch (err) {
                logger.warn({ err, appointmentId: appt.appointmentId }, 'WhatsappCloudSender: falha ao registrar histórico de conversa (não afeta o envio).');
            }

            logger.info({ appointmentId: appt.appointmentId, attemptNumber }, '✅ Lembrete enviado via WhatsApp Cloud API');
            return { success: true, retryEligible: true };
        }

        if (outcome.kind === 'rejected') {
            // 401/403: falha de autenticação/permissão — problema de CONFIGURAÇÃO (token
            // revogado/inválido), não específico deste agendamento. Reenviar automaticamente só
            // repetiria o mesmo erro para todos os lembretes pendentes sem nenhuma chance de
            // sucesso — precisa de intervenção humana antes de tentar de novo.
            const isAuthFailure = outcome.httpStatus === 401 || outcome.httpStatus === 403;
            return {
                success: false,
                retryEligible: !isAuthFailure,
                errorMessage: outcome.errorMessage ?? 'Rejeitado pela Meta',
            };
        }

        // 'unknown': timeout/5xx após o envio — a mensagem PODE ter sido aceita sem confirmação
        // chegar até nós. NÃO marcar como elegível para reenvio automático (risco de duplicar).
        return {
            success: false,
            retryEligible: false,
            errorMessage: outcome.errorMessage ?? 'Resultado incerto (timeout/5xx) — requer verificação manual',
        };
    }
}
