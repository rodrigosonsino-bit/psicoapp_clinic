import { injectable, inject } from 'tsyringe';
import { AvailabilitySlot } from '../../../domain/models/AvailabilitySlot';
import { IPsychotherapyRepository, SaveAvailabilitySlotDTO } from '../../../domain/repositories/IPsychotherapyRepository';

@injectable()
export class ManageAvailabilityUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async save(data: SaveAvailabilitySlotDTO): Promise<AvailabilitySlot> {
        return this.repository.saveAvailabilitySlot(data);
    }

    async list(tenantId: string): Promise<AvailabilitySlot[]> {
        return this.repository.listAvailabilitySlots(tenantId);
    }

    async delete(tenantId: string, id: string): Promise<void> {
        return this.repository.deleteAvailabilitySlot(tenantId, id);
    }
}
