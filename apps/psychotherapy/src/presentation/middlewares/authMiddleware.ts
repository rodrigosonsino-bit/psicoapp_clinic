import { Request, Response, NextFunction } from 'express';
import { JwtService } from '../../infrastructure/auth/JwtService';

// Extender o objeto Request do Express para tipar nossas novas propriedades
export interface AuthenticatedRequest extends Request {
    tenantId?: string;
    tenantEmail?: string;
    tenantPlan?: string;
    userId?: string;
}

let jwtServiceInstance: JwtService | null = null;

function getJwtService(): JwtService {
    if (!jwtServiceInstance) {
        jwtServiceInstance = new JwtService();
    }
    return jwtServiceInstance;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    const authReq = req as AuthenticatedRequest;

    // Permitir fallback para DEFAULT_USER_ID apenas em desenvolvimento local.
    if (!authHeader?.startsWith('Bearer ')) {
        if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEFAULT_USER === 'true' && process.env.DEFAULT_USER_ID) {
            authReq.tenantId = process.env.DEFAULT_USER_ID;
            authReq.userId = process.env.DEFAULT_USER_ID;
            return next();
        }
        return res.status(401).json({ error: 'Token não fornecido ou cabeçalho Authorization inválido' });
    }

    try {
        const token = authHeader.slice(7);
        const payload = getJwtService().verifyToken(token);
        
        authReq.tenantId = payload.tenantId;
        authReq.tenantEmail = payload.email;
        authReq.tenantPlan = payload.plan;
        
        // Mantém compatibilidade com rotas que ainda usam req.userId
        authReq.userId = payload.tenantId;
        
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
}
