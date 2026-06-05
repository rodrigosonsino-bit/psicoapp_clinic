import cron from 'node-cron';
import { Pool } from 'pg';
import { WeeklyReportUseCase } from '../../application/useCases/WeeklyReportUseCase';
import { WhatsappSessionManager } from '../whatsapp/WhatsappSessionManager';
import { logger } from '../logger/logger';

export class WeeklyReportCronJob {
    constructor(
        private readonly weeklyReportUseCase: WeeklyReportUseCase,
        private readonly sessionManager: WhatsappSessionManager,
        private readonly dbPool: Pool
    ) {}

    public start() {
        // Expressão cron: roda a cada minuto para checar dinamicamente
        cron.schedule('* * * * *', async () => {
            await this.runWeeklyReport();
        }, {
            timezone: 'America/Sao_Paulo'
        });

        logger.info('🛰️ Cron Job de Relatório Semanal do WhatsApp ATIVADO (Roda a cada minuto checando os horários dinâmicos).');
    }

    public async runWeeklyReport(): Promise<boolean> {
        // Não logamos no modo dinâmico pra não poluir a cada minuto, a menos que tenhamos relatórios para processar
        try {
            // 1. Verificar no banco de dados quem quer receber o relatório
            const settingsResult = await this.dbPool.query(
                'SELECT user_id, receive_weekly_report, weekly_report_day, weekly_report_time FROM system_settings WHERE receive_weekly_report = true;'
            );

            if (settingsResult.rows.length === 0) {
                return false;
            }

            const now = new Date();
            // Converter para timezone local de SP
            const options: Intl.DateTimeFormatOptions = { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false };
            const timeParts = new Intl.DateTimeFormat('pt-BR', options).format(now).split(':');
            const currentHour = timeParts[0].padStart(2, '0');
            const currentMinute = timeParts[1].padStart(2, '0');
            const currentLocalTime = `${currentHour}:${currentMinute}`;
            
            const dayParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(now);
            const daysMap: Record<string, string> = {
                'Sun': '0', 'Mon': '1', 'Tue': '2', 'Wed': '3', 'Thu': '4', 'Fri': '5', 'Sat': '6'
            };
            const currentLocalDay = daysMap[dayParts];

            let reportsSent = 0;

            for (const row of settingsResult.rows) {
                const userId = row.user_id; // Este é o tenant_id
                const dayString = row.weekly_report_day || '1';
                const timeString = row.weekly_report_time || '08:00';

                if (currentLocalDay !== dayString || currentLocalTime !== timeString) {
                    continue;
                }

                logger.info({ userId, currentLocalDay, currentLocalTime }, '⏰ Horário de envio de relatório alcançado para o tenant. Gerando relatório semanal...');

                // 2. Verificar se o WhatsApp está conectado e obter a sessão ativa
                const whatsappClient = await this.sessionManager.getSession(userId);
                if (!whatsappClient || !whatsappClient.isConnected()) {
                    logger.warn({ userId }, '📊 WhatsApp desconectado para este tenant. Impossível enviar o relatório semanal automático.');
                    continue;
                }

                const myJid = whatsappClient.getMyJid();
                if (!myJid) {
                    logger.warn({ userId }, '📊 Impossível determinar o próprio JID do WhatsApp para envio do relatório.');
                    continue;
                }

                // 3. Gerar estatísticas usando o caso de uso
                const stats = await this.weeklyReportUseCase.execute(userId);

                // 4. Formatar a mensagem do WhatsApp de forma ultra premium
                const platformText = stats.platformStats.length > 0
                    ? stats.platformStats.map(p => `  • ${p.platform}: ${p.count} ${p.count === 1 ? 'envio' : 'envios'}`).join('\n')
                    : '  • Nenhuma mensagem enviada';

                const messageText = `📊 *Relatório Semanal do Co-Piloto Sarah* 📊\n\n` +
                    `Olá! Aqui está o resumo das suas mensagens agendadas dos últimos 7 dias:\n\n` +
                    `📈 *Desempenho Geral:*\n` +
                    `  • 📅 Total Processado: ${stats.total} mensagens\n` +
                    `  • ✅ Enviadas com Sucesso: ${stats.sent}\n` +
                    `  • ❌ Falhas no Envio: ${stats.failed}\n` +
                    `  • ⏳ Pendentes/Agendadas: ${stats.pending}\n` +
                    `  • 🚀 Taxa de Entrega: ${stats.successRate}%\n\n` +
                    `📱 *Por Canal de Envio:*\n${platformText}\n\n` +
                    `Excelente trabalho! Desejo a você uma semana extraordinária e altamente produtiva! 🦾✨`;

                // 5. Enviar a mensagem para si mesmo
                await whatsappClient.sendMessage(myJid, messageText);
                reportsSent++;
                logger.info({ userId, myJid }, '📊 Relatório semanal enviado com absoluto sucesso para o próprio tenant via WhatsApp.');
            }

            return reportsSent > 0;
        } catch (error) {
            logger.error({ err: error }, '❌ Erro crítico ao processar o Cron Job do Relatório Semanal.');
            return false;
        }
    }
}
