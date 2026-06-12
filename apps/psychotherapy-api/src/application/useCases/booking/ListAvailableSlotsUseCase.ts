import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../../domain/errors/AppError';

const WEEKS_AHEAD = 6;
const MAX_SLOTS = 60;
const TIMEZONE = process.env.TZ_CALENDAR ?? 'America/Sao_Paulo';

export interface AvailableSlot {
    datetime: string;       // ISO 8601 em UTC
    durationMinutes: number;
    dayOfWeek: number;
    startTime: string;      // "HH:MM"
}

export interface BookingPageInfo {
    patientName: string;
    tenantName: string;
    availableSlots: AvailableSlot[];
    isExpired: boolean;
}

@injectable()
export class ListAvailableSlotsUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(token: string): Promise<BookingPageInfo> {
        const link = await this.repository.findBookingLinkByToken(token);
        if (!link || !link.isActive) throw new AppError('Link de agendamento inválido ou desativado.', 404);

        if (link.isExpired) {
            const patient = await this.repository.findPatientById(link.tenantId, link.patientId);
            return {
                patientName: patient?.name ?? '',
                tenantName: '',
                availableSlots: [],
                isExpired: true
            };
        }

        const [patient, slots, profile] = await Promise.all([
            this.repository.findPatientById(link.tenantId, link.patientId),
            this.repository.listAvailabilitySlots(link.tenantId),
            this.repository.getTenantProfile(link.tenantId)
        ]);

        if (!patient) throw new AppError('Paciente não encontrado.', 404);

        const activeSlots = slots.filter(s => s.isActive);
        if (activeSlots.length === 0) {
            return { patientName: patient.name, tenantName: profile?.name ?? '', availableSlots: [], isExpired: false };
        }

        // Janela de busca: amanhã até WEEKS_AHEAD semanas
        const now = new Date();
        const from = new Date(now);
        from.setDate(from.getDate() + 1);
        from.setHours(0, 0, 0, 0);

        const to = new Date(from);
        to.setDate(to.getDate() + WEEKS_AHEAD * 7);

        // Busca datetimes já ocupados (para excluir)
        const booked = await this.repository.listActiveAppointmentDatetimes(link.tenantId, from, to);
        const bookedSet = new Set(booked.map(d => this.toMinuteKey(d)));

        // Gera todos os datetimes disponíveis
        const available: AvailableSlot[] = [];
        const cursor = new Date(from);

        while (cursor < to && available.length < MAX_SLOTS) {
            const dow = cursor.getDay(); // 0=Dom…6=Sáb (JS local)

            for (const slot of activeSlots) {
                if (slot.dayOfWeek !== dow) continue;

                const [hh, mm] = slot.startTime.split(':').map(Number);
                const dt = new Date(cursor);
                dt.setHours(hh, mm, 0, 0);

                // Só horários no futuro (a partir de agora + 1h de antecedência)
                if (dt <= new Date(now.getTime() + 60 * 60 * 1000)) continue;

                const key = this.toMinuteKey(dt);
                if (!bookedSet.has(key)) {
                    available.push({
                        datetime: dt.toISOString(),
                        durationMinutes: slot.durationMinutes,
                        dayOfWeek: slot.dayOfWeek,
                        startTime: slot.startTime
                    });
                }
            }

            cursor.setDate(cursor.getDate() + 1);
        }

        available.sort((a, b) => a.datetime.localeCompare(b.datetime));

        return {
            patientName: patient.name,
            tenantName: profile?.name ?? profile?.fullName ?? '',
            availableSlots: available.slice(0, MAX_SLOTS),
            isExpired: false
        };
    }

    private toMinuteKey(d: Date): string {
        // Chave em minuto para comparar datetimes independente de segundos
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
    }
}
