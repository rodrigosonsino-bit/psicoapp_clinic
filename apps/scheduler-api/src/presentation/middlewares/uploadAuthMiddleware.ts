import { Request, Response, NextFunction } from 'express';
import { JwtService } from '../../infrastructure/auth/JwtService';

const jwtService = new JwtService();

export function uploadAuthMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    let token = '';

    if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    } else if (req.query.token && typeof req.query.token === 'string') {
        token = req.query.token;
    }

    if (!token) {
        if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEFAULT_USER === 'true' && process.env.DEFAULT_USER_ID) {
            (req as any).tenantId = process.env.DEFAULT_USER_ID;
            return next();
        }
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    try {
        const payload = jwtService.verifyToken(token);
        (req as any).tenantId = payload.tenantId;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
}
