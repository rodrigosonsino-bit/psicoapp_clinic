import { IMessageRepository } from '../../domain/repositories/IMessageRepository';
import { ScheduledMessage } from '../../domain/models/ScheduledMessage';

export interface WeeklyReportStats {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    successRate: number;
    dailyStats: { day: string; date: string; count: number }[];
    platformStats: { platform: string; count: number }[];
    sentMessagesList: {
        id: string;
        content: string;
        recipientId: string;
        sendAt: string;
        status: string;
        platform: string;
    }[];
}

export class WeeklyReportUseCase {
    /**
     * Defensive query limit for retrieving weekly report messages.
     * Prevents memory exhaustion during heavy queries while safeguarding API design.
     */
    private static readonly MAX_WEEKLY_REPORT_MESSAGES = 100000;

    constructor(private readonly messageRepository: IMessageRepository) {}

    async execute(userId: string, recipientId?: string): Promise<WeeklyReportStats> {
        // Definir os últimos 7 dias (incluindo hoje)
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);

        // Buscar todas as mensagens no período (usamos um limite alto para abranger tudo)
        const messages = await this.messageRepository.findAll(userId, WeeklyReportUseCase.MAX_WEEKLY_REPORT_MESSAGES, 0, {
            startDate,
            endDate,
            recipientId
        });

        // 1. Inicializar métricas
        let total = messages.length;
        let sent = 0;
        let failed = 0;
        let pending = 0;
        const platformCounts: { [key: string]: number } = { whatsapp: 0, telegram: 0 };

        // 2. Inicializar as estatísticas diárias para os últimos 7 dias
        const dailyStats: { day: string; date: string; count: number }[] = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateString = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            let dayName = d.toLocaleDateString('pt-BR', { weekday: 'short' }); // ex: "seg.", "ter."
            dayName = dayName.charAt(0).toUpperCase() + dayName.slice(1).replace('.', '');
            
            dailyStats.push({
                day: dayName,
                date: dateString,
                count: 0
            });
        }

        // 3. Processar cada mensagem
        const sentMessagesList: any[] = [];

        for (const msg of messages) {
            // Contagem de status
            if (msg.status === 'sent') {
                sent++;
            } else if (msg.status === 'failed') {
                failed++;
            } else {
                pending++;
            }

            // Contagem de plataforma
            const plat = msg.platform || 'whatsapp';
            platformCounts[plat] = (platformCounts[plat] || 0) + 1;

            // Agrupamento diário por data de agendamento (sendAt)
            const sendAtDate = new Date(msg.sendAt);
            const msgDateString = sendAtDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            
            const dayStat = dailyStats.find(ds => ds.date === msgDateString);
            if (dayStat) {
                dayStat.count++;
            }

            // Adicionar à lista formatada
            sentMessagesList.push({
                id: msg.id,
                content: msg.content,
                recipientId: msg.recipientId,
                sendAt: msg.sendAt.toISOString(),
                status: msg.status,
                platform: plat
            });
        }

        // Ordenar lista de mensagens por data de envio decrescente (mais recentes primeiro)
        sentMessagesList.sort((a, b) => new Date(b.sendAt).getTime() - new Date(a.sendAt).getTime());

        // 4. Calcular taxa de sucesso
        const totalProcessed = sent + failed;
        const successRate = totalProcessed > 0 ? parseFloat(((sent / totalProcessed) * 100).toFixed(1)) : 100.0;

        // 5. Formatar estatísticas de plataforma
        const platformStats = Object.keys(platformCounts).map(plat => ({
            platform: plat.charAt(0).toUpperCase() + plat.slice(1),
            count: platformCounts[plat]
        }));

        return {
            total,
            sent,
            failed,
            pending,
            successRate,
            dailyStats,
            platformStats,
            sentMessagesList
        };
    }
}
