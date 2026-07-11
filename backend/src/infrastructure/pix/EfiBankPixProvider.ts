import { IPixProvider, CreatePixChargeInput, PixChargeResult } from '../../domain/services/IPixProvider';
import { injectable } from 'tsyringe';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../logger';
import QRCode from 'qrcode';

/**
 * Provider de produção para o Efí Bank (ex-Gerencianet).
 * Requer as variáveis de ambiente:
 *   EFI_CLIENT_ID
 *   EFI_CLIENT_SECRET
 *   EFI_PIX_KEY       → chave Pix do terapeuta (EVP, CPF, email, telefone)
 *   EFI_SANDBOX=true  → usa ambiente de homologação
 */
@injectable()
export class EfiBankPixProvider implements IPixProvider {
    private readonly baseUrl: string;
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly pixKey: string;
    private accessToken: string | null = null;
    private tokenExpiresAt: number = 0;

    constructor() {
        const sandbox = process.env.EFI_SANDBOX !== 'false';
        this.baseUrl = sandbox
            ? 'https://pix-h.api.efipay.com.br'
            : 'https://pix.api.efipay.com.br';
        this.clientId = process.env.EFI_CLIENT_ID ?? '';
        this.clientSecret = process.env.EFI_CLIENT_SECRET ?? '';
        this.pixKey = process.env.EFI_PIX_KEY ?? '';

        if (!this.clientId || !this.clientSecret || !this.pixKey) {
            logger.warn('⚠️  Efí Bank: credenciais não configuradas — cobranças Pix reais não funcionarão');
        }
    }

    async createCharge(input: CreatePixChargeInput): Promise<PixChargeResult> {
        const token = await this.getAccessToken();
        const expirationSeconds = input.expirationSeconds ?? 3600;

        const body = {
            calendario: { expiracao: expirationSeconds },
            devedor: input.debtorCpf
                ? { cpf: input.debtorCpf.replace(/\D/g, ''), nome: input.debtorName ?? '' }
                : undefined,
            valor: { original: (input.amountCents / 100).toFixed(2) },
            chave: this.pixKey,
            infoAdicionais: [{ nome: 'Descrição', valor: input.description }]
        };

        const response = await fetch(`${this.baseUrl}/v2/cob/${input.txid}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            const error = await response.text();
            logger.error({ status: response.status, error }, 'Efí Bank: falha ao criar cobrança Pix');
            throw new AppError('Falha ao criar cobrança Pix. Tente novamente.', 502);
        }

        const data: any = await response.json();

        // Busca o QR Code EMV da cobrança criada
        const qrResponse = await fetch(`${this.baseUrl}/v2/loc/${data.loc.id}/qrcode`, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(10000)
        });

        const qrData: any = await qrResponse.json();
        const qrCodeImageUrl = await QRCode.toDataURL(qrData.qrcode);

        return {
            providerChargeId: data.loc.id.toString(),
            txid: data.txid,
            qrCode: qrData.qrcode,
            qrCodeImageUrl,
            expiresAt: new Date(Date.now() + expirationSeconds * 1000)
        };
    }

    async cancelCharge(txid: string): Promise<void> {
        const token = await this.getAccessToken();
        await fetch(`${this.baseUrl}/v2/cob/${txid}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }),
            signal: AbortSignal.timeout(10000)
        });
    }

    async getChargeStatus(txid: string): Promise<'pending' | 'paid' | 'canceled'> {
        const token = await this.getAccessToken();
        const response = await fetch(`${this.baseUrl}/v2/cob/${txid}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new AppError('Falha ao consultar cobrança no Efí Bank', 502);
        }

        const data: any = await response.json();
        if (data.status === 'CONCLUIDA') return 'paid';
        if (data.status === 'ATIVA') return 'pending';
        return 'canceled';
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiresAt) {
            return this.accessToken;
        }

        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const response = await fetch(`${this.baseUrl}/oauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${credentials}`
            },
            body: JSON.stringify({ grant_type: 'client_credentials' }),
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new AppError('Falha ao autenticar com Efí Bank', 502);
        }

        const data: any = await response.json();
        this.accessToken = data.access_token;
        this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
        return this.accessToken!;
    }
}
