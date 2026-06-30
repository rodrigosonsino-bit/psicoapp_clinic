import jwt from 'jsonwebtoken';

export interface TokenPayload {
    tenantId: string;
    email: string;
    plan: string;
    twoFactorPending?: boolean;
    tokenUse?: 'session' | '2fa-challenge';
    jti?: string;
}

export class JwtService {
    private readonly secret: string;
    private readonly expiresIn = '7d';

    constructor() {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error('FATAL: A variável de ambiente JWT_SECRET é obrigatória.');
        }
        this.secret = secret;
    }

    generateToken(payload: TokenPayload, expiresIn?: string): string {
        return jwt.sign(payload, this.secret, { expiresIn: (expiresIn ?? this.expiresIn) as any });
    }

    verifyToken(token: string): TokenPayload {
        return jwt.verify(token, this.secret) as TokenPayload;
    }
}
