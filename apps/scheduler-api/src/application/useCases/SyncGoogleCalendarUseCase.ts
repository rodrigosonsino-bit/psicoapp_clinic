import { Pool } from 'pg';
import { GoogleCalendarClient } from '../../infrastructure/google/GoogleCalendarClient';
import { IMessageRepository } from '../../domain/repositories/IMessageRepository';
import { ScheduledMessage } from '../../domain/models/ScheduledMessage';
import { IMessageSchedulerService } from '../services/IMessageSchedulerService';
import { logger } from '../../infrastructure/logger/logger';

export class SyncGoogleCalendarUseCase {
    constructor(
        private readonly googleClient: GoogleCalendarClient,
        private readonly messageRepository: IMessageRepository,
        private readonly dbPool: Pool,
        private readonly scheduler: IMessageSchedulerService
    ) {}

    public async execute(tenantId?: string): Promise<void> {
        logger.info({ tenantId }, 'Iniciando sincronização de Google Calendars...');

        try {
            const configs = tenantId
                ? [await this.googleClient.getConfig(tenantId)]
                : await this.googleClient.getActiveConfigs();

            for (const config of configs) {
                if (config?.isEnabled) {
                    await this.syncUserCalendar(config);
                }
            }
        } catch (err) {
            logger.error({ err }, 'Erro durante a sincronização dos calendários.');
        }
    }

    private async syncUserCalendar(config: any): Promise<void> {
        const events = await this.googleClient.getUpcomingEvents(config);
        logger.info(`📅 Encontrados ${events.length} eventos para o usuário ${config.userId} (${config.email})`);

        for (const event of events) {
            try {
                const phone = this.extractPhoneNumber(event.summary + ' ' + (event.description || ''));
                if (!phone) {
                    continue;
                }

                const eventId = event.id;

                // Verificar se o usuário desativou o envio automático para este evento
                const autoSendEnabled = await this.googleClient.isEventAutoSendEnabled(config.userId, eventId);
                if (!autoSendEnabled) {
                    logger.info(`⏭️ Evento ${eventId} tem envio automático DESATIVADO pelo usuário. Pulando.`);
                    continue;
                }

                const startDateTime = new Date(event.start.dateTime || event.start.date);
                const clientName = this.extractClientName(event.summary);

                // 1. Agendamento para o Cliente (24h antes do compromisso)
                const clientSendAt = new Date(startDateTime.getTime() - 24 * 60 * 60 * 1000);
                await this.scheduleReminder(
                    config.userId,
                    eventId,
                    'client',
                    phone,
                    `Olá ${clientName}, lembrete do seu compromisso amanhã (${this.formatDate(startDateTime)}) às ${this.formatTime(startDateTime)}!`,
                    clientSendAt
                );

                // 2. Agendamento para Você/Profissional (30 minutos antes do compromisso)
                const profPhone = process.env.PROFESSIONAL_PHONE; 
                if (profPhone) {
                    const profSendAt = new Date(startDateTime.getTime() - 30 * 60 * 1000);
                    await this.scheduleReminder(
                        config.userId,
                        eventId,
                        'professional',
                        profPhone,
                        `Lembrete: Você tem um compromisso com ${clientName} em 30 minutos (${this.formatTime(startDateTime)})!`,
                        profSendAt
                    );
                }
            } catch (eventErr) {
                logger.error({ err: eventErr, eventId: event.id, userId: config.userId }, 'Erro ao processar sincronização de evento individual do Google Calendar. Continuando.');
            }
        }
    }

    private async scheduleReminder(
        userId: string,
        eventId: string,
        reminderType: 'client' | 'professional',
        recipientId: string,
        content: string,
        sendAt: Date
    ): Promise<void> {
        // Ignorar se o horário de envio já passou!
        if (sendAt.getTime() < Date.now()) {
            return;
        }

        // Verificar se já existe lembrete agendado para este evento e tipo
        const isAlreadyScheduled = await this.checkIfAlreadyScheduled(userId, eventId, reminderType);
        if (isAlreadyScheduled) {
            return;
        }

        // Criar agendamento
        const scheduledMessage = new ScheduledMessage(
            null,
            userId,
            content,
            recipientId,
            sendAt,
            'pending',
            'whatsapp',
            new Date(),
            { googleEventId: eventId, reminderType }
        );

        const savedMessage = await this.messageRepository.save(scheduledMessage);
        
        // 2. Calcula qual será o delay em milissegundos
        const targetTimeMs = sendAt.getTime();
        const currentTimeMs = Date.now();
        const delayMs = Math.max(0, targetTimeMs - currentTimeMs);

        // 3. Adiciona na Fila (BullMQ/Redis) com esse atraso
        await this.scheduler.schedule(savedMessage, delayMs);

        logger.info(`✨ Lembrete do Google Calendar (${reminderType}) agendado com sucesso para ${recipientId} em ${sendAt.toISOString()}`);
    }

    private async checkIfAlreadyScheduled(userId: string, eventId: string, reminderType: string): Promise<boolean> {
        const query = `
            SELECT COUNT(*) 
            FROM scheduled_messages 
            WHERE user_id = $1 
              AND metadata->>'googleEventId' = $2 
              AND metadata->>'reminderType' = $3
              AND status IN ('pending', 'sent');
        `;
        const result = await this.dbPool.query(query, [userId, eventId, reminderType]);
        return parseInt(result.rows[0].count, 10) > 0;
    }

    private extractPhoneNumber(text: string): string | null {
        const regex = /(?:\+?55\s?)?\(?([1-9]\d)\)?\s?(?:9?\d{4}[-.\s]?\d{4})/g;
        const match = regex.exec(text);
        if (!match) return null;

        const clean = match[0].replace(/\D/g, '');

        if (clean.length === 10 || clean.length === 11) {
            return '55' + clean;
        }
        if (clean.length === 12 || clean.length === 13) {
            return clean;
        }
        return null;
    }

    private extractClientName(summary: string): string {
        const parts = summary.split('-');
        return parts[0].trim() || summary;
    }

    private formatDate(date: Date): string {
        return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    }

    private formatTime(date: Date): string {
        return date.toLocaleTimeString('pt-BR', { 
            timeZone: 'America/Sao_Paulo', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
}
