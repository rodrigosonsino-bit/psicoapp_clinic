export type BroadcastStatus = 'queued' | 'processing' | 'completed' | 'partial_failed' | 'canceled';

export type BroadcastRecipientStatus =
    | 'queued'
    | 'sending'
    | 'retry_wait'
    | 'sent'
    | 'failed'
    | 'delivery_unknown'
    | 'canceled';

export class PsychotherapyBroadcast {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly idempotencyKey: string,
        public readonly content: string,
        public readonly status: BroadcastStatus,
        public readonly totalRecipients: number,
        public readonly createdAt: Date,
        public readonly startedAt: Date | null,
        public readonly completedAt: Date | null,
        public readonly canceledAt: Date | null
    ) {}
}

export class PsychotherapyBroadcastRecipient {
    constructor(
        public readonly id: string,
        public readonly broadcastId: string,
        public readonly tenantId: string,
        public readonly patientId: string,
        public readonly patientNameSnapshot: string,
        public readonly phoneSnapshot: string,
        public readonly status: BroadcastRecipientStatus,
        public readonly attemptCount: number,
        public readonly nextAttemptAt: Date,
        public readonly lockedAt: Date | null,
        public readonly sentAt: Date | null,
        public readonly lastErrorCode: string | null,
        public readonly lastErrorMessage: string | null,
        public readonly createdAt: Date
    ) {}
}

export interface BroadcastRecipientCandidate {
    patientId: string;
    name: string;
    phone: string;
}

export interface BroadcastPreview {
    eligible: number;
    excluded: {
        inactive: number;
        deleted: number;
        withoutPhone: number;
        invalidPhone: number;
        withoutOptIn: number;
    };
    maxRecipients: number;
}

export interface BroadcastStatusCounts {
    queued: number;
    sending: number;
    retry_wait: number;
    sent: number;
    failed: number;
    delivery_unknown: number;
    canceled: number;
}

export interface BroadcastWithCounts {
    broadcast: PsychotherapyBroadcast;
    counts: BroadcastStatusCounts;
}
