import cron from 'node-cron';
import { SyncGoogleCalendarUseCase } from '../../application/useCases/SyncGoogleCalendarUseCase';
import { logger } from '../logger/logger';

export class GoogleCalendarSyncJob {
    constructor(
        private readonly syncUseCase: SyncGoogleCalendarUseCase
    ) {}

    public start() {
        // Roda a cada 5 minutos
        cron.schedule('*/5 * * * *', async () => {
            logger.info('⚙️ Iniciando ciclo cron de sincronização do Google Calendar...');
            try {
                await this.syncUseCase.execute();
                logger.info('✨ Ciclo cron de sincronização do Google Calendar finalizado.');
            } catch (error) {
                logger.error({ err: error }, 'Falha grave no cron do Google Calendar.');
            }
        }, {
            timezone: 'America/Sao_Paulo'
        });
        
        logger.info('🛰️ Cron Job de Sincronização do Google Calendar ATIVADO (Intervalo: 5 minutos).');
    }
}
