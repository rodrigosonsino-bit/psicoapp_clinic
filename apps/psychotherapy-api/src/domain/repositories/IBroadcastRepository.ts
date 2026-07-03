import {
    PsychotherapyBroadcast,
    PsychotherapyBroadcastRecipient,
    BroadcastRecipientCandidate,
    BroadcastStatusCounts
} from '../models/PsychotherapyBroadcast';

export interface ExclusionCounts {
    inactive: number;
    deleted: number;
    withoutPhone: number;
    withoutOptIn: number;
}

export interface IBroadcastRepository {
    /**
     * Candidatos que já passam pelos filtros de banco (status ativo, não deletado,
     * opt-in, telefone presente). A validação final de formato do telefone
     * (PhoneNormalizer) é feita em memória, fora do repositório, para garantir que
     * preview e criação usem exatamente a mesma implementação de normalização.
     */
    listEligibleCandidates(tenantId: string): Promise<BroadcastRecipientCandidate[]>;

    countExclusions(tenantId: string): Promise<ExclusionCounts>;

    findBroadcastByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<PsychotherapyBroadcast | null>;

    hasActiveBroadcast(tenantId: string): Promise<boolean>;

    /**
     * Cria a campanha + snapshot de destinatários já normalizados em uma única
     * transação. `candidates` já deve estar filtrado/normalizado pelo use case.
     */
    createBroadcastWithRecipients(
        tenantId: string,
        idempotencyKey: string,
        content: string,
        candidates: BroadcastRecipientCandidate[]
    ): Promise<PsychotherapyBroadcast>;

    findBroadcastById(tenantId: string, broadcastId: string): Promise<PsychotherapyBroadcast | null>;

    listBroadcasts(tenantId: string, limit: number): Promise<PsychotherapyBroadcast[]>;

    getStatusCounts(broadcastId: string): Promise<BroadcastStatusCounts>;

    recomputeBroadcastStatus(broadcastId: string): Promise<void>;

    /** Marca a campanha e seus destinatários ainda não terminais como cancelados. */
    cancelBroadcast(tenantId: string, broadcastId: string): Promise<PsychotherapyBroadcastRecipient[]>;

    /** Destinatários queued/retry_wait com next_attempt_at vencido, para o dispatcher publicar jobs. */
    findDueRecipients(limit: number): Promise<PsychotherapyBroadcastRecipient[]>;

    findRecipientById(recipientId: string): Promise<PsychotherapyBroadcastRecipient | null>;

    /** Claim atômico: queued|retry_wait -> sending. Retorna null se já não estiver elegível. */
    claimRecipientForSending(recipientId: string): Promise<PsychotherapyBroadcastRecipient | null>;

    markRecipientSent(recipientId: string): Promise<void>;

    markRecipientRetryWait(recipientId: string, nextAttemptAt: Date, errorCode: string, errorMessage: string): Promise<void>;

    markRecipientFailed(recipientId: string, errorCode: string, errorMessage: string): Promise<void>;

    /** Leases `sending` expiradas (> leaseMs) viram delivery_unknown — nunca retornam à fila. */
    expireStaleLeases(leaseMs: number): Promise<number>;

    isBroadcastCanceled(broadcastId: string): Promise<boolean>;

    /** Consentimento explícito do paciente para receber mensagens em massa. */
    setPatientOptIn(tenantId: string, patientId: string, optIn: boolean): Promise<void>;
}
