import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { UpdateTenantProfileUseCase } from '../../application/useCases/UpdateTenantProfileUseCase';
import { NotFoundError } from '../../domain/errors/NotFoundError';

@injectable()
export class ProfileController {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        private readonly updateProfileUseCase: UpdateTenantProfileUseCase
    ) {}

    getProfile = async (req: Request, res: Response): Promise<void> => {
        const tenantId = (req as any).tenantId || (req as any).userId;
        if (!tenantId) throw new Error('Tenant não identificado');

        const profile = await this.repository.getTenantProfile(tenantId);
        if (!profile) {
            throw new NotFoundError('Perfil do tenant não encontrado');
        }

        res.status(200).json(profile.toJSON());
    };

    updateProfile = async (req: Request, res: Response): Promise<void> => {
        const tenantId = (req as any).tenantId || (req as any).userId;
        if (!tenantId) throw new Error('Tenant não identificado');

        const data = req.body;

        const updatedProfile = await this.updateProfileUseCase.execute({
            tenantId,
            fullName: data.fullName,
            document: data.document,
            professionalId: data.professionalId,
            address: data.address
        });

        res.status(200).json(updatedProfile.toJSON());
    };
}
