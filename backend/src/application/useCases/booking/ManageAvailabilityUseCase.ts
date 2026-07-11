import { injectable, inject } from 'tsyringe';
import { AvailabilitySlot } from '../../../domain/models/AvailabilitySlot';
import { IPsychotherapyRepository, SaveAvailabilitySlotDTO } from '../../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class ManageAvailabilityUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async save(data: any): Promise<AvailabilitySlot> {
        let dayOfWeek = data.dayOfWeek;
        let parsedStartDate: Date | null = null;

        if (data.startDate) {
            const dateStr = typeof data.startDate === 'string' ? data.startDate : (data.startDate as Date).toISOString().slice(0, 10);
            const [y, m, d] = dateStr.split('-').map(Number);
            parsedStartDate = new Date(Date.UTC(y, m - 1, d));
            if (data.recurrenceType === 'once') {
                dayOfWeek = new Date(y, m - 1, d).getDay();
            }
        }

        return this.repository.saveAvailabilitySlot({
            ...data,
            dayOfWeek,
            startDate: parsedStartDate
        });
    }

    async list(tenantId: string): Promise<AvailabilitySlot[]> {
        return this.repository.listAvailabilitySlots(tenantId);
    }

    async delete(tenantId: string, id: string): Promise<void> {
        return this.repository.deleteAvailabilitySlot(tenantId, id);
    }
}
