import { UpcomingAppointment } from '../repositories/IPsychotherapyRepository';

export interface ReminderSendResult {
    success: boolean;
    /** Se false e success=false, o ciclo de retry automático NÃO deve reenviar (resultado ambíguo). */
    retryEligible: boolean;
    errorMessage?: string;
}

/** Porta de domínio para o envio do lembrete de sessão — cada provedor (Baileys, Cloud API) implementa a sua. */
export interface IReminderMessageSender {
    sendSessionReminder(appt: UpcomingAppointment): Promise<ReminderSendResult>;
}
