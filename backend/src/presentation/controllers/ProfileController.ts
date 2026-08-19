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
            address: data.address,
            bookingPage: data.bookingPage,
            automaticBillingReminders: data.automaticBillingReminders,
            // 'cardFeeRates'/'adminMirrorPhone' in data (não !== undefined) preserva a
            // distinção entre "campo ausente" e "campo enviado como null" até o repositório.
            ...('cardFeeRates' in data ? { cardFeeRates: data.cardFeeRates } : {}),
            ...('adminMirrorPhone' in data ? { adminMirrorPhone: data.adminMirrorPhone } : {})
        });

        res.status(200).json(updatedProfile.toJSON());
    };

    /** Status REAL da integração de transcrição (transcription_integrations), não confundir
     *  com tenants.transcription_preference — que é só a última intenção/tentativa e pode
     *  ficar dessincronizada dela (achado real: 2026-08-18, ver activateMeetTranscription). */
    getTranscriptionIntegrationStatus = async (req: Request, res: Response): Promise<void> => {
        const tenantId = (req as any).tenantId || (req as any).userId;
        if (!tenantId) throw new Error('Tenant não identificado');

        const provider = (req.query.provider as string) === 'deepgram_web' ? 'deepgram_web' : 'google_meet_native';
        const status = await this.repository.getTranscriptionIntegrationStatus(tenantId, provider);
        res.status(200).json({ status });
    };
}
