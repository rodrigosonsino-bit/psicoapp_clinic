import { PatientRow, SessionRow, ClinicalNoteRow, AppointmentRow } from './dbRowTypes';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { PsychotherapySession } from '../../domain/models/PsychotherapySession';
import { ClinicalNote } from '../../domain/models/ClinicalNote';
import { PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';

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

/**
 * mapSession é usado tanto por saveSession (COMPLEXO, permanece no arquivo principal) quanto
 * por listSessions (FOLHA, migrado para PostgresSessionRepository).
 */
export function mapSession(row: SessionRow): PsychotherapySession {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        patientId: row.patient_id,
        date: new Date(row.date),
        status: row.status,
        notes: row.notes ?? undefined,
        appointmentId: row.appointment_id ?? undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
    };
}

/**
 * mapClinicalNote é usado tanto por saveClinicalNote (COMPLEXO, permanece no arquivo principal)
 * quanto por listClinicalNotes/findClinicalNoteById (FOLHA, migrados para
 * PostgresSessionRepository).
 */
export function mapClinicalNote(row: ClinicalNoteRow): ClinicalNote {
    return new ClinicalNote(
        row.id,
        row.tenant_id,
        row.patient_id,
        row.session_id,
        new Date(row.note_date),
        row.content,
        row.tags ?? [],
        new Date(row.created_at),
        new Date(row.updated_at)
    );
}

/**
 * mapAppointment é usado tanto por saveAppointment/updateAppointmentStatus (COMPLEXOS,
 * permanecem no arquivo principal) quanto pelos métodos FOLHA de leitura de appointments
 * (migrados para PostgresAppointmentRepository).
 */
export function mapAppointment(row: AppointmentRow): PsychotherapyAppointment {
    return new PsychotherapyAppointment(
        row.id,
        row.tenant_id,
        row.patient_id,
        new Date(row.scheduled_at),
        row.duration_minutes,
        row.status,
        row.recurrence,
        row.recurrence_end_date ? new Date(row.recurrence_end_date) : null,
        row.notes,
        row.google_event_id ?? null,
        row.google_event_url ?? null,
        row.confirm_token ?? null,
        row.confirmed_at ? new Date(row.confirmed_at) : null,
        row.parent_id ?? null,
        new Date(row.created_at),
        new Date(row.updated_at),
        row.group_id ?? null
    );
}
