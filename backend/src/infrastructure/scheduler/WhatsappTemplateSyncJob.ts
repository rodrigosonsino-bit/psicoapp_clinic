import * as cron from 'node-cron';
import { IWhatsappCloudRepository, WhatsappCloudTemplateBinding } from '../../domain/repositories/IWhatsappCloudRepository';
import { WhatsappCloudClient } from '../whatsappCloud/WhatsappCloudClient';
import { logger } from '../logger';

/** Únicos valores aceitos pela CHECK constraint de whatsapp_cloud_templates.meta_status — a Meta
 * usa outros status (PENDING_DELETION, IN_APPEAL, LIMIT_EXCEEDED, REINSTATED, ...) que não temos
 * uma coluna para representar; esses são ignorados (logados, não gravados) em vez de quebrar o
 * sync inteiro por um UPDATE com valor fora do CHECK. */
const KNOWN_STATUSES = new Set<WhatsappCloudTemplateBinding['metaStatus']>(['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED']);

function isKnownStatus(status: string): status is WhatsappCloudTemplateBinding['metaStatus'] {
    return KNOWN_STATUSES.has(status as WhatsappCloudTemplateBinding['metaStatus']);
}

/**
 * Sincroniza periodicamente whatsapp_cloud_templates.meta_status com o status real na Meta —
 * sem isso, um template aprovado na Meta continua marcado como 'PENDING' no nosso banco para
 * sempre, e getActiveTemplate() nunca o considera pronto (WhatsappCloudSender/WhatsappCloudInboxWorker
 * checam `metaStatus === 'APPROVED'` antes de enviar). Só ATUALIZA templates já cadastrados
 * localmente — nunca cria nem desativa nenhum.
 */
export class WhatsappTemplateSyncJob {
    private task: ReturnType<typeof cron.schedule> | null = null;

    constructor(
        private readonly client: WhatsappCloudClient,
        private readonly repository: IWhatsappCloudRepository,
        private readonly businessAccountId: string
    ) {}

    /** Roda a cada 30 min (status de template muda raramente) + uma vez imediatamente ao iniciar,
     * para não esperar até 30 min por um template recém-aprovado. */
    start(): void {
        void this.syncOnce();
        this.task = cron.schedule('*/30 * * * *', async () => {
            await this.syncOnce();
        });
        logger.info('🔄 WhatsappTemplateSyncJob iniciado (sincroniza status de templates com a Meta a cada 30min)');
    }

    stop(): void {
        this.task?.stop();
    }

    async syncOnce(): Promise<void> {
        let remoteTemplates;
        try {
            remoteTemplates = await this.client.listTemplates(this.businessAccountId);
        } catch (err) {
            logger.error({ err }, '❌ WhatsappTemplateSyncJob: falha ao consultar templates na Meta — tentará de novo no próximo ciclo.');
            return;
        }

        let updated = 0;
        let skippedUnknownStatus = 0;

        for (const remote of remoteTemplates) {
            if (!isKnownStatus(remote.status)) {
                skippedUnknownStatus++;
                logger.warn({ name: remote.name, language: remote.language, status: remote.status },
                    'WhatsappTemplateSyncJob: status retornado pela Meta não mapeado — ignorado (não grava).');
                continue;
            }

            try {
                await this.repository.updateTemplateSyncStatus(remote.name, remote.language, remote.status);
                updated++;
            } catch (err) {
                logger.error({ err, name: remote.name, language: remote.language },
                    '❌ WhatsappTemplateSyncJob: falha ao gravar status de template — seguindo para os demais.');
            }
        }

        logger.info({ totalFromMeta: remoteTemplates.length, updated, skippedUnknownStatus },
            '✅ WhatsappTemplateSyncJob: sincronização concluída.');
    }
}
