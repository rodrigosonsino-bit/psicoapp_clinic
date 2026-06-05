import { injectable, inject } from 'tsyringe';
import { generate, verify, generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import { IAuthRepository } from '../../domain/repositories/IAuthRepository';
import { AppError } from '../../domain/errors/AppError';

const APP_NAME = process.env.APP_NAME ?? 'PsicoGestão';
const BACKUP_CODE_COUNT = 8;

export interface TotpSetupResult {
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
    backupCodes: string[];
}

@injectable()
export class TotpUseCase {
    constructor(@inject('IAuthRepository') private readonly repository: IAuthRepository) {}

    async setup(tenantId: string, email: string): Promise<TotpSetupResult> {
        const tenant = await this.repository.findTenantById(tenantId);
        if (!tenant) throw new AppError('Usuário não encontrado', 404);
        if (tenant.totpEnabled) throw new AppError('2FA já está ativado', 400);

        const secret = generateSecret();
        const otpauthUrl = generateURI({ issuer: APP_NAME, label: email, secret });
        const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
        const backupCodes = this.generateBackupCodes();

        await this.repository.saveTotpSecret(tenantId, secret, backupCodes);

        return { secret, otpauthUrl, qrCodeDataUrl, backupCodes };
    }

    async verify(tenantId: string, token: string): Promise<void> {
        const tenant = await this.repository.findTenantById(tenantId);
        if (!tenant) throw new AppError('Usuário não encontrado', 404);
        if (!tenant.totpSecret) throw new AppError('2FA não foi configurado. Execute /auth/2fa/setup primeiro.', 400);

        const result = await verify({ token, secret: tenant.totpSecret });
        if (!result.valid) throw new AppError('Código 2FA inválido ou expirado', 401);

        if (!tenant.totpEnabled) {
            await this.repository.enableTotp(tenantId);
        }
    }

    async disable(tenantId: string, token: string): Promise<void> {
        const tenant = await this.repository.findTenantById(tenantId);
        if (!tenant) throw new AppError('Usuário não encontrado', 404);
        if (!tenant.totpEnabled) throw new AppError('2FA não está ativo', 400);

        const result = await verify({ token, secret: tenant.totpSecret! });
        if (!result.valid) throw new AppError('Código 2FA inválido', 401);

        await this.repository.disableTotp(tenantId);
    }

    async verifyLogin(tenantId: string, token: string): Promise<void> {
        const tenant = await this.repository.findTenantById(tenantId);
        if (!tenant?.totpEnabled || !tenant.totpSecret) return;

        const result = await verify({ token, secret: tenant.totpSecret });
        if (result.valid) return;

        const usedBackup = await this.repository.consumeBackupCode(tenantId, token);
        if (usedBackup) return;

        throw new AppError('Código 2FA inválido', 401);
    }

    private generateBackupCodes(): string[] {
        return Array.from({ length: BACKUP_CODE_COUNT }, () =>
            randomBytes(4).toString('hex').toUpperCase()
        );
    }
}
