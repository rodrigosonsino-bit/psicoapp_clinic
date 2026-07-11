import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { RegisterTenantUseCase } from '../../application/useCases/RegisterTenantUseCase';
import { LoginTenantUseCase } from '../../application/useCases/LoginTenantUseCase';
import { RefreshTokenUseCase } from '../../application/useCases/RefreshTokenUseCase';
import { Login2faUseCase } from '../../application/useCases/Login2faUseCase';

@injectable()
export class AuthController {
    constructor(
        private readonly registerTenantUseCase: RegisterTenantUseCase,
        private readonly loginTenantUseCase: LoginTenantUseCase,
        private readonly refreshTokenUseCase: RefreshTokenUseCase,
        private readonly login2faUseCase: Login2faUseCase
    ) {}

    async register(req: Request, res: Response): Promise<void> {
        const result = await this.registerTenantUseCase.execute(req.body);
        res.status(201).json(result);
    }

    async login(req: Request, res: Response): Promise<void> {
        const result = await this.loginTenantUseCase.execute(req.body);
        res.status(200).json(result);
    }

    async login2fa(req: Request, res: Response): Promise<void> {
        const tempToken = (req.headers.authorization || '').slice(7);
        const { token } = req.body;
        const ipAddress = req.ip || '';
        const result = await this.login2faUseCase.execute({ tempToken, token, ipAddress });
        res.status(200).json(result);
    }

    async refresh(req: Request, res: Response): Promise<void> {
        const { refreshToken } = req.body;
        const result = await this.refreshTokenUseCase.execute(refreshToken);
        res.status(200).json(result);
    }
}
