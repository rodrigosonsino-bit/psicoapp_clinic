import { injectable, inject } from 'tsyringe';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { IAuthRepository } from '../../domain/repositories/IAuthRepository';
import { JwtService } from '../../infrastructure/auth/JwtService';
import { AppError } from '../../domain/errors/AppError';

type LoginResponse =
    | {
        requires2fa: true;
        tempToken: string;
      }
    | {
        requires2fa: false;
        accessToken: string;
        refreshToken: string;
        tenant: { id: string; name: string; email: string; plan: string };
      };

interface LoginDTO {
    email: string;
    password: string;
}

@injectable()
export class LoginTenantUseCase {
    private readonly jwtService = new JwtService();

    constructor(
        @inject('IAuthRepository') private readonly repository: IAuthRepository
    ) {}

    async execute(data: LoginDTO): Promise<LoginResponse> {
        const email = data.email.trim().toLowerCase();
        const password = data.password;

        const tenant = await this.repository.findTenantByEmail(email);
        if (!tenant) {
            throw new AppError('Credenciais inválidas', 401);
        }

        const passwordMatch = await bcrypt.compare(password, tenant.passwordHash);
        if (!passwordMatch) {
            throw new AppError('Credenciais inválidas', 401);
        }

        // Se 2FA está ativo, retorna um token temporário de curta duração para o segundo fator
        if (tenant.totpEnabled) {
            const tempToken = this.jwtService.generateToken(
                { tenantId: tenant.id, email: tenant.email, plan: tenant.plan, twoFactorPending: true },
                '5m'
            );
            return { requires2fa: true, tempToken };
        }

        // Revogar todos os refresh tokens anteriores do tenant
        await this.repository.revokeAllRefreshTokens(tenant.id);

        const accessToken = this.jwtService.generateToken({
            tenantId: tenant.id,
            email: tenant.email,
            plan: tenant.plan
        }, '15m');

        const refreshToken = crypto.randomUUID();
        const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        // 30 dias a partir de agora
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        await this.repository.saveRefreshToken(tenant.id, refreshTokenHash, expiresAt);

        return {
            requires2fa: false,
            accessToken,
            refreshToken,
            tenant: {
                id: tenant.id,
                name: tenant.name,
                email: tenant.email,
                plan: tenant.plan
            }
        };
    }
}
