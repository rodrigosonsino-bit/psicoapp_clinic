import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { ManageAvailabilityUseCase } from '../../application/useCases/booking/ManageAvailabilityUseCase';
import { GenerateBookingLinkUseCase } from '../../application/useCases/booking/GenerateBookingLinkUseCase';
import { ListAvailableSlotsUseCase } from '../../application/useCases/booking/ListAvailableSlotsUseCase';
import { BookAppointmentUseCase } from '../../application/useCases/booking/BookAppointmentUseCase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';

@injectable()
export class BookingController {
    constructor(
        private readonly availabilityUseCase: ManageAvailabilityUseCase,
        private readonly generateLinkUseCase: GenerateBookingLinkUseCase,
        private readonly listSlotsUseCase: ListAvailableSlotsUseCase,
        private readonly bookUseCase: BookAppointmentUseCase
    ) {}

    // ── Availability (autenticado) ─────────────────────────────────────────────

    async listAvailability(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const slots = await this.availabilityUseCase.list(tenantId);
        return res.json({ data: slots });
    }

    async saveAvailability(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const slot = await this.availabilityUseCase.save({ tenantId, ...req.body });
        return res.status(req.body.id ? 200 : 201).json({ data: slot });
    }

    async deleteAvailability(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        await this.availabilityUseCase.delete(tenantId, req.params.id);
        return res.status(204).send();
    }

    // ── Booking links (autenticado) ────────────────────────────────────────────

    async generateLink(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { patientId } = req.params;
        const { expiresInDays } = req.body;
        const result = await this.generateLinkUseCase.execute(tenantId, patientId, expiresInDays);
        return res.status(201).json({ data: { token: result.link.token, url: result.url, expiresAt: result.link.expiresAt } });
    }

    async deactivateLink(req: Request, res: Response): Promise<Response> {
        const tenantId = this.getTenantId(req);
        const { patientId } = req.params;
        await this.generateLinkUseCase.deactivate(tenantId, patientId);
        return res.status(204).send();
    }

    // ── Booking page (público) ────────────────────────────────────────────────

    async getBookingPage(req: Request, res: Response): Promise<Response> {
        const { token } = req.params;
        const info = await this.listSlotsUseCase.execute(token);
        return res.json({ data: info });
    }

    async bookSlot(req: Request, res: Response): Promise<Response> {
        const { token } = req.params;
        const { scheduledAt } = req.body;
        const appointment = await this.bookUseCase.execute(token, scheduledAt);
        return res.status(201).json({ data: appointment });
    }

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }
}
