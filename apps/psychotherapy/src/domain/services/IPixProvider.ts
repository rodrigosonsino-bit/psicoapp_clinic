export interface CreatePixChargeInput {
    txid: string;
    amountCents: number;
    description: string;
    expirationSeconds?: number;
    debtorName?: string;
    debtorCpf?: string;
}

export interface PixChargeResult {
    providerChargeId: string;
    txid: string;
    qrCode: string;
    qrCodeImageUrl: string;
    expiresAt: Date;
}

export interface IPixProvider {
    createCharge(input: CreatePixChargeInput): Promise<PixChargeResult>;
    cancelCharge(txid: string): Promise<void>;
}
