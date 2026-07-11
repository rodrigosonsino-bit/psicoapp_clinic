import { Response, NextFunction } from 'express';
import { JwtService } from '../../infrastructure/auth/JwtService';
import { AuthenticatedRequest } from './authMiddleware';

let jwtServiceInstance: JwtService | null = null;

function getJwtService(): JwtService {
    if (!jwtServiceInstance) {
        jwtServiceInstance = new JwtService();
    }
    return jwtServiceInstance;
}

export function pending2faMiddleware(req: any, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    const authReq = req as AuthenticatedRequest;

    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de desafio 2FA ausente ou inválido' });
    }

    try {
        const token = authHeader.slice(7);
        const payload = getJwtService().verifyToken(token);

        if (!payload.twoFactorPending || payload.tokenUse !== '2fa-challenge') {
            return res.status(403).json({ error: 'Acesso negado. Apenas tokens de desafio 2FA são permitidos.' });
        }

        authReq.tenantId = payload.tenantId;
        authReq.tenantEmail = payload.email;
        authReq.tenantPlan = payload.plan;
        authReq.userId = payload.tenantId;

        next();
    } catch (error) {
        return res.status(401).json({ error: 'Token temporário de desafio 2FA expirado ou inválido' });
    }
}
