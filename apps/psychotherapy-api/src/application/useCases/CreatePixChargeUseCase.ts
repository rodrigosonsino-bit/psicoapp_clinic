import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { IPixProvider } from '../../domain/services/IPixProvider';
import { PixCharge } from '../../domain/models/PixCharge';
import { AppError } from '../../domain/errors/AppError';
import { randomUUID } from 'crypto';

export interface CreatePixChargeInput {
    tenantId: string;
    patientId: string;
    monthlyRecordId?: string;
    amountCents: number;
    description: string;
    debtorName?: string;
    debtorCpf?: string;
    expirationMinutes?: number;
}

@injectable()
export class CreatePixChargeUseCase {
    constructor(
        @inject('IPixProvider') private readonly pixProvider: IPixProvider,
        private readonly dbPool: Pool
    ) {}

    async execute(input: CreatePixChargeInput): Promise<PixCharge> {
        if (input.amountCents <= 0) {
            throw new AppError('Valor da cobrança deve ser maior que zero', 400);
        }

        const txid = randomUUID().replace(/-/g, '').substring(0, 26);
        const expirationSeconds = (input.expirationMinutes ?? 60) * 60;

        const result = await this.pixProvider.createCharge({
            txid,
            amountCents: input.amountCents,
            description: input.description,
            expirationSeconds,
            debtorName: input.debtorName,
            debtorCpf: input.debtorCpf
        });

        const row = await this.dbPool.query(`
            INSERT INTO psychotherapy_pix_charges (
                tenant_id, patient_id, monthly_record_id, amount_cents, description,
                status, provider_charge_id, provider_txid, qr_code, qr_code_image_url, expires_at
            ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
            RETURNING *;
        `, [
            input.tenantId,
            input.patientId,
            input.monthlyRecordId ?? null,
            input.amountCents,
            input.description,
            result.providerChargeId,
            result.txid,
            result.qrCode,
            result.qrCodeImageUrl,
            result.expiresAt
        ]);

        return this.mapRow(row.rows[0]);
    }

    private mapRow(row: any): PixCharge {
        return new PixCharge(
            row.id, row.tenant_id, row.patient_id, row.monthly_record_id,
            row.amount_cents, row.description, row.status,
            row.provider_charge_id, row.provider_txid,
            row.qr_code, row.qr_code_image_url,
            row.expires_at ? new Date(row.expires_at) : null,
            row.paid_at ? new Date(row.paid_at) : null,
            new Date(row.created_at), new Date(row.updated_at)
        );
    }
}
