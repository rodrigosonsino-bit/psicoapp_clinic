import { injectable, inject } from 'tsyringe';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { IAuthRepository } from '../../domain/repositories/IAuthRepository';
import { JwtService } from '../../infrastructure/auth/JwtService';
import { AppError } from '../../domain/errors/AppError';

interface RegisterResponse {
    accessToken: string;
    refreshToken: string;
    tenant: {
        id: string;
        name: string;
        email: string;
        plan: string;
    };
}

interface RegisterDTO {
    name: string;
    email: string;
    password: string;
}

@injectable()
export class RegisterTenantUseCase {
    private readonly jwtService = new JwtService();

    constructor(
        @inject('IAuthRepository') private readonly repository: IAuthRepository
    ) {}

    async execute(data: RegisterDTO): Promise<RegisterResponse> {
        const name = data.name.trim();
        const email = data.email.trim().toLowerCase();
        const password = data.password;

        if (!name || name.length < 2) {
            throw new AppError('Nome inválido (mínimo 2 caracteres)', 400);
        }
        if (!email) {
            throw new AppError('Email é obrigatório', 400);
        }
        if (!password || password.length < 6) {
            throw new AppError('Senha inválida (mínimo 6 caracteres)', 400);
        }

        const existingTenant = await this.repository.findTenantByEmail(email);
        if (existingTenant) {
            throw new AppError('Email já cadastrado', 409);
        }

        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const tenant = await this.repository.createTenant({
            name,
            email,
            passwordHash
        });

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
