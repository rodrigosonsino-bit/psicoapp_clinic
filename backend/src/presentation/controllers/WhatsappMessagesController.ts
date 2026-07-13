import { Response } from 'express';
import { IWhatsappCloudRepository } from '../../domain/repositories/IWhatsappCloudRepository';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { WhatsappCloudClient } from '../../infrastructure/whatsappCloud/WhatsappCloudClient';
import { normalizePhoneDigits } from '../../infrastructure/whatsappCloud/phoneNormalization';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';
import { NotFoundError } from '../../domain/errors/NotFoundError';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_REPLY_LENGTH = 4096;

/**
 * Histórico de conversa WhatsApp por paciente — visualização + resposta manual (o profissional
 * digita e envia, sem automação nenhuma). Instanciado diretamente em server.ts (mesmo padrão de
 * WhatsappCloudWebhookController), fora do container tsyringe.
 */
export class WhatsappMessagesController {
    constructor(
        private readonly repository: IWhatsappCloudRepository,
        private readonly psychotherapyRepository: IPsychotherapyRepository,
        private readonly cloudClient: WhatsappCloudClient | null
    ) {}

    listForPatient = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
        const tenantId = req.tenantId || req.userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const { patientId } = req.params;
        const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
        const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT));

        const result = await this.repository.listMessagesForPatient(tenantId, patientId, page, limit);

        return res.status(200).json({
            data: result.data,
            meta: {
                total: result.total,
                page,
                limit,
                totalPages: Math.ceil(result.total / limit),
            },
        });
    };

    /**
     * Reivindica (marca como vistas) todas as conversas com mensagem inbound não vista — usado
     * pelo popup global que faz polling nesta rota. Sem automação: só sinaliza pro frontend abrir
     * o popup; a resposta continua sendo uma ação explícita do profissional.
     */
    listUnseen = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
        const tenantId = req.tenantId || req.userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const conversations = await this.repository.claimUnseenConversations(tenantId);
        return res.status(200).json({ data: conversations });
    };

    /**
     * Envia uma resposta manual ao paciente (texto livre — só é aceito pela Meta dentro da janela
     * de 24h desde a última mensagem do paciente). Nenhuma automação: é sempre uma ação explícita
     * do profissional clicando "Enviar" na ficha do paciente.
     */
    sendReply = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
        const tenantId = req.tenantId || req.userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);

        const { patientId } = req.params;
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!text) throw new AppError('Texto da mensagem é obrigatório.', 400);
        if (text.length > MAX_REPLY_LENGTH) throw new AppError(`Mensagem muito longa (máximo ${MAX_REPLY_LENGTH} caracteres).`, 400);

        if (!this.cloudClient) throw new AppError('WhatsApp Cloud API não configurada — não é possível enviar resposta.', 503);

        const patient = await this.psychotherapyRepository.findPatientById(tenantId, patientId);
        if (!patient) throw new NotFoundError('Paciente não encontrado ou não autorizado');
        if (!patient.phone) throw new AppError('Paciente não tem telefone cadastrado.', 400);

        let phoneDigits: string;
        try {
            phoneDigits = normalizePhoneDigits(patient.phone);
        } catch (err) {
            throw new AppError((err as Error).message, 400);
        }

        const outcome = await this.cloudClient.sendFreeformText(phoneDigits, text);

        if (outcome.kind === 'rejected') {
            // Causa mais comum: janela de 24h de atendimento fechada (paciente não escreveu
            // recentemente) — nesse caso é preciso usar um template aprovado, não texto livre.
            throw new AppError(outcome.errorMessage || 'A Meta rejeitou o envio (provavelmente a janela de 24h está fechada).', 400);
        }

        if (outcome.kind === 'unknown' || !outcome.wamid) {
            throw new AppError('Resultado incerto do envio (timeout/instabilidade) — confirme manualmente pelo WhatsApp Manager antes de reenviar.', 502);
        }

        await this.repository.insertOutboundMessage({
            tenantId,
            patientId,
            providerMessageId: outcome.wamid,
            body: text,
            occurredAt: new Date(),
        });

        // Sem isso, o webhook de status (sent/delivered/read) da Meta nunca acha a linha
        // correspondente em psychotherapy_whatsapp_cloud_status e o evento cai em dead-letter
        // sem nunca ser processado — mesmo padrão usado em WhatsappCloudSender.ts para lembretes,
        // aqui sem appointmentId pois a resposta manual não está associada a um agendamento.
        await this.repository.createDeliveryRecord(outcome.wamid, tenantId);

        return res.status(201).json({
            id: outcome.wamid,
            direction: 'outbound' as const,
            body: text,
            messageType: 'text',
            occurredAt: new Date().toISOString(),
        });
    };
}
