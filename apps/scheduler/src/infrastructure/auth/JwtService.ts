import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export interface TokenPayload {
    tenantId: string;
    email: string;
    plan: string;
}

export class JwtService {
    private readonly secret: string;
    private readonly expiresIn = '7d';

    constructor() {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error('FATAL: A variável de ambiente JWT_SECRET é obrigatória em produção!');
            }
            this.secret = 'fallback-secret-for-development-only-please-change';
        } else {
            this.secret = secret;
        }
    }

    generateToken(payload: TokenPayload): string {
        return jwt.sign(payload, this.secret, { expiresIn: this.expiresIn });
    }

    verifyToken(token: string): TokenPayload {
        return jwt.verify(token, this.secret) as TokenPayload;
    }

    static async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, 12);
    }

    static async comparePassword(plain: string, hash: string): Promise<boolean> {
        return bcrypt.compare(plain, hash);
    }
}
