import cron from 'node-cron';
import { SyncGoogleCalendarEventsUseCase } from '../../application/useCases/SyncGoogleCalendarEventsUseCase';
import { logger } from '../logger';

export class GoogleCalendarSyncJob {
    private task: ReturnType<typeof cron.schedule> | null = null;

    constructor(
        private readonly syncUseCase: SyncGoogleCalendarEventsUseCase
    ) {}

    public start(): void {
        this.task = cron.schedule('*/5 * * * *', async () => {
            logger.info('⚙️ Iniciando cron de importação/sincronização do Google Calendar...');
            try {
                await this.syncUseCase.execute();
                logger.info('✨ Cron de importação/sincronização do Google Calendar finalizado.');
            } catch (error) {
                logger.error({ err: error }, 'Erro no cron de sincronização do Google Calendar.');
            }
        }, {
            timezone: 'America/Sao_Paulo'
        });

        logger.info('🛰️ Cron Job de Sincronização do Google Calendar ATIVADO (Intervalo: 5 minutos).');
    }

    public stop(): void {
        this.task?.stop();
        logger.info('🛰️ Cron Job de Sincronização do Google Calendar PARADO.');
    }
}
