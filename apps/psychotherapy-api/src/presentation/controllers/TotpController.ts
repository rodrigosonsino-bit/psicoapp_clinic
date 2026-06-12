import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { TotpUseCase } from '../../application/useCases/TotpUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class TotpController {
    constructor(private readonly totpUseCase: TotpUseCase) {}

    async setup(req: Request, res: Response): Promise<Response> {
        const { tenantId, email } = this.getAuth(req);
        const result = await this.totpUseCase.setup(tenantId, email);
        return res.status(200).json({ data: result });
    }

    async verify(req: Request, res: Response): Promise<Response> {
        const { tenantId } = this.getAuth(req);
        const { token } = req.body;
        await this.totpUseCase.verify(tenantId, token);
        return res.status(200).json({ message: '2FA ativado com sucesso' });
    }

    async disable(req: Request, res: Response): Promise<Response> {
        const { tenantId } = this.getAuth(req);
        const { token } = req.body;
        await this.totpUseCase.disable(tenantId, token);
        return res.status(200).json({ message: '2FA desativado com sucesso' });
    }

    private getAuth(req: Request): { tenantId: string; email: string } {
        const authReq = req as AuthenticatedRequest;
        const tenantId = authReq.tenantId || authReq.userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return { tenantId, email: authReq.tenantEmail ?? '' };
    }
}
