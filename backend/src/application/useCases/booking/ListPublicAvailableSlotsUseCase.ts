import { injectable, inject } from 'tsyringe';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../../domain/errors/AppError';
import { BookingPageSettings } from '../../../domain/models/TenantProfile';
import { AvailableSlot } from './ListAvailableSlotsUseCase';

const WEEKS_AHEAD = 6;
const MAX_SLOTS = 60;

export interface PublicBookingPageInfo {
    tenantName: string;
    availableSlots: AvailableSlot[];
    bookingPage: BookingPageSettings | null;
}

@injectable()
export class ListPublicAvailableSlotsUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    private toDateStr(d: Date): string {
        if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        }
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    private getWeeksDiff(dateStr1: string, dateStr2: string): number {
        const [y1, m1, d1] = dateStr1.split('-').map(Number);
        const [y2, m2, d2] = dateStr2.split('-').map(Number);
        return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / (7 * 24 * 60 * 60 * 1000));
    }

    private isSlotAvailableOnDate(slot: any, candidateDate: Date): boolean {
        if (!slot.isActive) return false;
        if (candidateDate.getDay() !== slot.dayOfWeek) return false;

        switch (slot.recurrenceType) {
            case 'once':
                if (!slot.startDate) return false;
                return this.toDateStr(candidateDate) === this.toDateStr(slot.startDate);
            case 'weekly':
                if (slot.startDate && this.toDateStr(candidateDate) < this.toDateStr(slot.startDate)) return false;
                return true;
            case 'biweekly': {
                if (!slot.startDate) return false;
                const diff = this.getWeeksDiff(this.toDateStr(candidateDate), this.toDateStr(slot.startDate));
                return diff >= 0 && diff % 2 === 0;
            }
            default:
                return true;
        }
    }

    private toMinuteKey(d: Date): string {
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
    }

    async execute(token: string): Promise<PublicBookingPageInfo> {
        const tenantId = await this.repository.findPublicBookingToken(token);
        if (!tenantId) throw new AppError('Link de agendamento inválido.', 404);

        const [slots, profile] = await Promise.all([
            this.repository.listAvailabilitySlots(tenantId),
            this.repository.getTenantProfile(tenantId)
        ]);

        const activeSlots = slots.filter(s => s.isActive);
        const tenantName = profile?.name ?? profile?.fullName ?? '';
        const bookingPage = profile?.bookingPage ?? null;

        if (activeSlots.length === 0) return { tenantName, availableSlots: [], bookingPage };

        const now = new Date();
        const from = new Date(now);
        from.setDate(from.getDate() + 1);
        from.setHours(0, 0, 0, 0);

        const to = new Date(from);
        to.setDate(to.getDate() + WEEKS_AHEAD * 7);

        const booked = await this.repository.listActiveAppointmentDatetimes(tenantId, from, to);
        const bookedSet = new Set(booked.map(d => this.toMinuteKey(d)));

        const available: AvailableSlot[] = [];
        const cursor = new Date(from);

        while (cursor < to && available.length < MAX_SLOTS) {
            for (const slot of activeSlots) {
                if (!this.isSlotAvailableOnDate(slot, cursor)) continue;

                // startTime ("HH:MM") é horário de parede em America/Sao_Paulo (BRT, -03:00).
                // Construir com offset explícito evita depender do fuso do servidor (UTC em produção).
                const y = cursor.getFullYear();
                const mo = String(cursor.getMonth() + 1).padStart(2, '0');
                const da = String(cursor.getDate()).padStart(2, '0');
                const dt = new Date(`${y}-${mo}-${da}T${slot.startTime}:00-03:00`);

                if (dt <= new Date(now.getTime() + 60 * 60 * 1000)) continue;
                if (!bookedSet.has(this.toMinuteKey(dt))) {
                    available.push({
                        datetime: dt.toISOString(),
                        durationMinutes: slot.durationMinutes,
                        dayOfWeek: slot.dayOfWeek,
                        startTime: slot.startTime,
                        modality: slot.modality
                    });
                }
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        available.sort((a, b) => a.datetime.localeCompare(b.datetime));
        return { tenantName, availableSlots: available.slice(0, MAX_SLOTS), bookingPage };
    }
}
