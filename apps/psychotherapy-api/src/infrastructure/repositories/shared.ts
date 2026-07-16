import { PatientRow } from './dbRowTypes';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Helpers compartilhados entre PostgresPsychotherapyRepository e seus sub-repositórios
 * (extração mecânica, ver .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md item 1) —
 * centralizados aqui para não duplicar em cada sub-repositório.
 */
export function validateTenantId(tenantId: string): string {
    if (!UUID_REGEX.test(tenantId)) {
        throw new Error(`TenantId inválido: "${tenantId}". Esperado UUID v1-v5.`);
    }
    return tenantId;
}

/**
 * mapPatient é usado tanto por savePatient (COMPLEXO, permanece no arquivo principal) quanto
 * pelos métodos FOLHA de leitura/exclusão de pacientes (migrados para
 * PostgresPatientRepository) — por isso vive aqui, não em nenhum dos dois arquivos.
 */
export function mapPatient(row: PatientRow): PsychotherapyPatient {
    return new PsychotherapyPatient(
        row.id,
        row.tenant_id,
        row.name,
        row.status,
        row.payment_type,
        row.default_session_price_cents,
        row.notes,
        row.document,
        row.phone,
        row.email,
        new Date(row.created_at),
        new Date(row.updated_at),
        row.reminder_channel ?? 'whatsapp',
        row.full_name ?? null,
        row.whatsapp_bulk_opt_in ?? false,
        row.individual_therapy_enabled
    );
}
