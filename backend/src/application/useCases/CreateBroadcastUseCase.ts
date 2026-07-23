import { injectable, inject } from 'tsyringe';
import { IBroadcastRepository } from '../../domain/repositories/IBroadcastRepository';
import { PhoneNormalizer } from '../services/PhoneNormalizer';
import { PsychotherapyBroadcast, BroadcastRecipientCandidate } from '../../domain/models/PsychotherapyBroadcast';
import { AppError } from '../../domain/errors/AppError';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';
import { BroadcastOutboxDispatcher } from '../../infrastructure/queue/BroadcastOutboxDispatcher';

const MAX_RECIPIENTS = Number(process.env.BROADCAST_MAX_RECIPIENTS || 50);

export interface CreateBroadcastInput {
    tenantId: string;
    idempotencyKey: string;
    content: string;
}

@injectable()
export class CreateBroadcastUseCase {
    private readonly phoneNormalizer = new PhoneNormalizer();

    constructor(
        @inject('IBroadcastRepository') private readonly repository: IBroadcastRepository,
        @inject('WhatsappSessionManager') private readonly sessionManager: WhatsappSessionManager,
        @inject(BroadcastOutboxDispatcher) private readonly dispatcher: BroadcastOutboxDispatcher
    ) {}

    async execute(input: CreateBroadcastInput): Promise<PsychotherapyBroadcast> {


        const content = input.content?.trim();
        if (!content || content.length > 1000) {
            throw new AppError('Mensagem deve ter entre 1 e 1000 caracteres.', 400);
        }

        // Idempotência: retry com a mesma chave retorna a campanha já criada
        const existing = await this.repository.findBroadcastByIdempotencyKey(input.tenantId, input.idempotencyKey);
        if (existing) {
            return existing;
        }

        const hasActive = await this.repository.hasActiveBroadcast(input.tenantId);
        if (hasActive) {
            throw new AppError('Já existe uma campanha de mensagem em massa em andamento para este tenant.', 409);
        }

        const client = await this.sessionManager.getSession(input.tenantId);
        if (!client) {
            throw new AppError('WhatsApp não está conectado. Conecte o WhatsApp antes de enviar mensagens em massa.', 409);
        }

        const rawCandidates = await this.repository.listEligibleCandidates(input.tenantId);
        const candidates: BroadcastRecipientCandidate[] = [];
        for (const candidate of rawCandidates) {
            const normalized = this.phoneNormalizer.normalize(candidate.phone);
            if (normalized) {
                candidates.push({ ...candidate, phone: normalized });
            }
        }

        if (candidates.length === 0) {
            throw new AppError('Nenhum paciente elegível (ativo, com opt-in e telefone válido) foi encontrado.', 400);
        }
        if (candidates.length > MAX_RECIPIENTS) {
            throw new AppError(
                `Lote de ${candidates.length} destinatários excede o limite atual de ${MAX_RECIPIENTS}.`,
                422
            );
        }

        const broadcast = await this.repository.createBroadcastWithRecipients(
            input.tenantId,
            input.idempotencyKey,
            content,
            candidates
        );

        // Sinaliza o dispatcher para publicar os jobs; o sucesso do POST não depende disso.
        this.dispatcher.notify();

        return broadcast;
    }
}
