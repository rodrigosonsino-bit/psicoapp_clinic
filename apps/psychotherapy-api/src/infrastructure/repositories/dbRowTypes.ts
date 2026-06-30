// Linha da tabela: psychotherapy_patients
export interface PatientRow {
    id: string;
    tenant_id: string;
    name: string;
    status: 'weekly' | 'biweekly' | 'one_off' | 'inactive';
    payment_type: 'monthly' | 'per_session' | null;
    default_session_price_cents: number | null;
    notes: string | null;
    document: string | null;
    phone: string | null;
    email: string | null;
    reminder_channel: 'whatsapp' | 'email' | 'both' | 'none' | null;
    created_at: Date;
    updated_at: Date;
    full_name: string | null;
    whatsapp_bulk_opt_in?: boolean;
}

// Linha da tabela: psychotherapy_monthly_records
export interface MonthlyRecordRow {
    id: string;
    tenant_id: string;
    patient_id: string | null;
    month: string;
    patient_name_snapshot: string;
    status: 'weekly' | 'biweekly' | 'one_off' | 'inactive';
    payment_type: 'monthly' | 'per_session' | null;
    session_price_cents: number | null;
    expected_sessions: number;
    paid_sessions: number;
    absences: number;
    payment_status: 'paid' | 'pending' | 'partial';
    notes: string | null;
    previous_month_paid_cents: number;
    created_at: Date;
    updated_at: Date;
}

// Linha da tabela: tenants (apenas colunas selecionadas no getTenantProfile)
export interface TenantProfileRow {
    id: string;
    name: string;
    email: string;
    full_name: string | null;
    document: string | null;
    professional_id: string | null;
    address: string | null;
    totp_enabled?: boolean;
    booking_page?: import('../../domain/models/TenantProfile').BookingPageSettings | null;
    whatsapp_reminder_template?: string | null;
}

// Linha da tabela: psychotherapy_receipts
export interface ReceiptRow {
    id: string;
    tenant_id: string;
    patient_id: string;
    receipt_number: number;
    amount_cents: number;
    issue_date: Date;
    description: string;
    created_at: Date;
    updated_at: Date;
    patient_name_snapshot?: string | null;
    patient_document_snapshot?: string | null;
    tenant_name_snapshot?: string | null;
    tenant_document_snapshot?: string | null;
    tenant_professional_id_snapshot?: string | null;
    tenant_address_snapshot?: string | null;
    status?: 'issued' | 'cancelled';
}

// Linha da tabela: psychotherapy_sessions
export interface SessionRow {
    id: string;
    tenant_id: string;
    patient_id: string;
    date: Date;
    status: 'attended' | 'justified_absence' | 'unjustified_absence' | 'canceled';
    notes: string | null;
    created_at: Date;
    updated_at: Date;
}

// Linha da tabela: psychotherapy_expenses
export interface ExpenseRow {
    id: string;
    tenant_id: string;
    date: Date;
    amount_cents: number;
    description: string;
    category: 'rent' | 'taxes' | 'software' | 'marketing' | 'utilities' | 'office_supplies' | 'services' | 'cleaning' | 'other';
    fixed_expense_id: string | null;
    reference_month: string | null;
    created_at: Date;
    updated_at: Date;
}

// Linha da tabela: psychotherapy_fixed_expenses
export interface FixedExpenseRow {
    id: string;
    tenant_id: string;
    description: string;
    amount_cents: number;
    day_of_month: number;
    category: string | null;
    start_date: string; // 'YYYY-MM-DD'
    end_date: string | null; // 'YYYY-MM-DD'
    active: boolean;
    created_at: Date;
    updated_at: Date;
}

// Linha da tabela: psychotherapy_availability_slots
export interface AvailabilitySlotRow {
    id: string;
    tenant_id: string;
    day_of_week: number;
    start_time: string;
    duration_minutes: number;
    is_active: boolean;
    notes: string | null;
    created_at: Date;
    updated_at: Date;
    recurrence_type: string;
    start_date: Date | null;
    modality: string;
}

// Linha da tabela: psychotherapy_booking_links
export interface BookingLinkRow {
    id: string;
    token: string;
    tenant_id: string;
    patient_id: string;
    expires_at: Date | null;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}

// Linha da tabela: psychotherapy_public_booking_tokens
export interface PublicBookingTokenRow {
    id: string;
    token: string;
    tenant_id: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}

// Linha da tabela: psychotherapy_clinical_notes
export interface ClinicalNoteRow {
    id: string;
    tenant_id: string;
    patient_id: string;
    session_id: string | null;
    note_date: Date;
    content: string;
    tags: string[];
    created_at: Date;
    updated_at: Date;
}

// Linha da tabela: psychotherapy_appointments
export interface AppointmentRow {
    id: string;
    tenant_id: string;
    patient_id: string;
    scheduled_at: Date;
    duration_minutes: number;
    status: 'scheduled' | 'confirmed' | 'attended' | 'canceled' | 'no_show';
    recurrence: 'none' | 'weekly' | 'biweekly';
    recurrence_end_date: Date | null;
    notes: string | null;
    google_event_id: string | null;
    google_event_url: string | null;
    confirm_token: string | null;
    confirmed_at: Date | null;
    parent_id: string | null;
    created_at: Date;
    updated_at: Date;
}
