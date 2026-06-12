import { injectable, inject } from 'tsyringe';
import { ClinicalNote } from '../../domain/models/ClinicalNote';
import { IPsychotherapyRepository, SaveClinicalNoteDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AppError } from '../../domain/errors/AppError';

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 50;

@injectable()
export class SaveClinicalNoteUseCase {
    constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository) {}

    async execute(data: SaveClinicalNoteDTO): Promise<ClinicalNote> {
        const content = data.content.trim();
        if (!content) throw new AppError('O conteúdo da nota é obrigatório', 400);

        const tags = (data.tags ?? [])
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0);

        if (tags.length > MAX_TAGS) {
            throw new AppError(`Máximo de ${MAX_TAGS} tags por nota`, 400);
        }
        if (tags.some(t => t.length > MAX_TAG_LENGTH)) {
            throw new AppError(`Cada tag pode ter no máximo ${MAX_TAG_LENGTH} caracteres`, 400);
        }

        return this.repository.saveClinicalNote({ ...data, content, tags });
    }
}
