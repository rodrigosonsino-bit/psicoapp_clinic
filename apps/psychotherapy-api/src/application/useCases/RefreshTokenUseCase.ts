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
        
        const newRefreshToken = crypto.randomUUID();
        const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        const newId = crypto.randomUUID();

        let rotationResult: { tenantId: string; familyId: string } | null;
        try {
            rotationResult = await this.repository.rotateRefreshToken(
                tokenHash,
                newRefreshToken,
                newRefreshTokenHash,
                expiresAt,
                newId
            );
        } catch (error: any) {
            if (error.message === 'Refresh token expirado') {
                throw new AppError('Refresh token expirado', 401);
            }
            if (error.message === 'Token já utilizado') {
                throw new AppError('Token já utilizado. Toda a família de tokens foi revogada por segurança.', 401);
            }
            throw error;
        }

        if (!rotationResult) {
            throw new AppError('Refresh token inválido', 401);
        }

        const tenant = await this.repository.findTenantById(rotationResult.tenantId);
        if (!tenant) {
            throw new AppError('Tenant não encontrado', 404);
        }

        const accessToken = this.jwtService.generateToken({
            tenantId: tenant.id,
            email: tenant.email,
            plan: tenant.plan,
            tokenUse: 'session'
        }, '15m');

        return {
            accessToken,
            refreshToken: newRefreshToken
        };
    }
}
