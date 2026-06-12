import { IPixProvider, CreatePixChargeInput, PixChargeResult } from '../../domain/services/IPixProvider';
import { injectable } from 'tsyringe';
import QRCode from 'qrcode';

/**
 * Provider mock para desenvolvimento e testes.
 * Gera um QR Code Pix estático fake — útil para testar o fluxo sem credenciais reais.
 */
@injectable()
export class MockPixProvider implements IPixProvider {
    async createCharge(input: CreatePixChargeInput): Promise<PixChargeResult> {
        const expirationSeconds = input.expirationSeconds ?? 3600;
        const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

        // Payload Pix estático fake (formato EMV)
        const fakePixPayload = [
            '000201',
            '010212',
            `26580014br.gov.bcb.pix0136${input.txid}`,
            `52040000`,
            '5303986',
            `54${String(input.amountCents / 100).padStart(6, '0')}`,
            '5802BR',
            '5913Psicologo Dev',
            '6009São Paulo',
            `62070503${input.txid.substring(0, 3)}`,
            '6304'
        ].join('');

        const qrCodeImageUrl = await QRCode.toDataURL(fakePixPayload);

        return {
            providerChargeId: `mock_${input.txid}`,
            txid: input.txid,
            qrCode: fakePixPayload,
            qrCodeImageUrl,
            expiresAt
        };
    }

    async cancelCharge(_txid: string): Promise<void> {
        // no-op em modo mock
    }
}
