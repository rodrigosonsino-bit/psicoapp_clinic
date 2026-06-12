import { injectable, inject } from 'tsyringe';
import crypto from 'crypto';
import { IAuthRepository } from '../../domain/repositories/IAuthRepository';
import { JwtService } from '../../infrastructure/auth/JwtService';
import { AppError } from '../../domain/errors/AppError';

interface RefreshTokenResponse {
    accessToken: string;
    refreshToken: string;
}

@injectable()
export class RefreshTokenUseCase {
    private readonly jwtService = new JwtService();

    constructor(
        @inject('IAuthRepository') private readonly repository: IAuthRepository
    ) {}

    async execute(refreshToken: string): Promise<RefreshTokenResponse> {
        if (!refreshToken) {
            throw new AppError('Refresh token é obrigatório', 400);
        }

        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        
        const record = await this.repository.findRefreshToken(tokenHash);
        if (!record) {
            throw new AppError('Refresh token inválido ou expirado', 401);
        }

        const tenant = await this.repository.findTenantById(record.tenantId);
        if (!tenant) {
            throw new AppError('Tenant não encontrado', 404);
        }

        // Revogar o refresh token atual (rotação de token)
        await this.repository.revokeRefreshToken(tokenHash);

        const accessToken = this.jwtService.generateToken({
            tenantId: tenant.id,
            email: tenant.email,
            plan: tenant.plan
        }, '15m');

        const newRefreshToken = crypto.randomUUID();
        const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

        // 30 dias a partir de agora
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        await this.repository.saveRefreshToken(tenant.id, newRefreshTokenHash, expiresAt);

        return {
            accessToken,
            refreshToken: newRefreshToken
        };
    }
}
