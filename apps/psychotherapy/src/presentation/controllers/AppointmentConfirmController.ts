import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class AppointmentConfirmController {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository
    ) {}

    /** GET /appointments/confirm/:token — retorna detalhes do agendamento para o paciente */
    async getByToken(req: Request, res: Response): Promise<Response> {
        const { token } = req.params;
        const appointment = await this.repository.findAppointmentByConfirmToken(token);

        if (!appointment) {
            return res.status(404).json({ error: 'Link de confirmação inválido ou expirado.' });
        }

        if (['canceled', 'no_show', 'attended'].includes(appointment.status)) {
            return res.status(200).json({
                data: {
                    status: appointment.status,
                    scheduledAt: appointment.scheduledAt,
                    durationMinutes: appointment.durationMinutes,
                    alreadyProcessed: true
                }
            });
        }

        return res.status(200).json({
            data: {
                id: appointment.id,
                scheduledAt: appointment.scheduledAt,
                durationMinutes: appointment.durationMinutes,
                status: appointment.status,
                confirmedAt: appointment.confirmedAt,
                alreadyProcessed: false
            }
        });
    }

    /** POST /appointments/confirm/:token — paciente confirma presença */
    async confirm(req: Request, res: Response): Promise<Response> {
        const { token } = req.params;
        const updated = await this.repository.confirmAppointmentByToken(token);

        if (!updated) {
            return res.status(409).json({ error: 'Agendamento não encontrado ou já processado.' });
        }

        return res.status(200).json({
            data: { status: updated.status, confirmedAt: updated.confirmedAt },
            message: 'Presença confirmada com sucesso!'
        });
    }
}
