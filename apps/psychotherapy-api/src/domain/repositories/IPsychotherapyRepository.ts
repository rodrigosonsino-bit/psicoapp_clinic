import { PaymentStatus, PsychotherapyMonthlyRecord } from '../models/PsychotherapyMonthlyRecord';
import { PatientStatus, PaymentType, PsychotherapyPatient, ReminderChannel } from '../models/PsychotherapyPatient';
import { PsychotherapyReceipt } from '../models/PsychotherapyReceipt';
import { PsychotherapySession, SessionStatus } from '../models/PsychotherapySession';
import { ExpenseCategory, PsychotherapyExpense } from '../models/PsychotherapyExpense';
import { PsychotherapyFixedExpense } from '../models/PsychotherapyFixedExpense';
import { TenantProfile } from '../models/TenantProfile';
import { AppointmentStatus, PsychotherapyAppointment, RecurrenceType } from '../models/PsychotherapyAppointment';
import { ClinicalNote } from '../models/ClinicalNote';
import { AvailabilitySlot, AvailabilityRecurrenceType, AvailabilityModality } from '../models/AvailabilitySlot';
import { BookingLink } from '../models/BookingLink';

export interface SavePatientDTO {
    id?: string;
    tenantId: string;
    name: string;
    status: PatientStatus;
    paymentType?: PaymentType | null;
    defaultSessionPriceCents?: number | null;
    notes?: string | null;
    document?: string | null;
    phone?: string | null;
    email?: string | null;
    reminderChannel?: ReminderChannel;
    fullName?: string | null;
    individualTherapyEnabled?: boolean;
}

export interface SaveMonthlyRecordDTO {
    id?: string;
    tenantId: string;
    patientId?: string | null;
    month: string;
    patientNameSnapshot: string;
    status: PatientStatus;
    paymentType?: PaymentType | null;
    sessionPriceCents?: number | null;
    expectedSessions?: number;
    paidSessions?: number;
    absences?: number;
    paymentStatus?: PaymentStatus;
    notes?: string | null;
    previousMonthPaidCents?: number;
}

export interface PsychotherapyMonthSummary {
    month: string;
    totalPatients: number;
    activePatients: number;
    inactivePatients: number;
    paidRecords: number;
    pendingRecords: number;
    partialRecords: number;
    expectedAmountCents: number;
    receivedAmountCents: number;
    pendingAmountCents: number;
    totalAbsences: number;
}

export interface UpdateTenantProfileDTO {
    tenantId: string;
    fullName?: string | null;
    document?: string | null;
    professionalId?: string | null;
    address?: string | null;
    bookingPage?: import('../models/TenantProfile').BookingPageSettings | null;
    whatsappReminderTemplate?: string | null;
}

export interface SaveReceiptDTO {
    id?: string;
    tenantId: string;
    patientId: string;
    amountCents: number;
    issueDate: Date;
    description: string;
}

export interface SaveSessionDTO {
    id?: string;
    tenantId: string;
    patientId: string;
    date: Date;
    status: SessionStatus;
    notes?: string;
}

export interface SaveExpenseDTO {
    id?: string;
    tenantId: string;
    date: Date;
    amountCents: number;
    description: string;
    category: ExpenseCategory;
    fixedExpenseId?: string | null;
    referenceMonth?: string | null;
}

export interface SaveFixedExpenseDTO {
    id?: string;
    tenantId: string;
    description: string;
    amountCents: number;
    dayOfMonth: number;
    category?: string | null;
    startDate: string; // 'YYYY-MM-DD'
    endDate?: string | null; // 'YYYY-MM-DD' or null
    active?: boolean;
}

export interface SaveAppointmentDTO {
    id?: string;
    tenantId: string;
    patientId: string;
    scheduledAt: Date;
    durationMinutes?: number;
    status?: AppointmentStatus;
    recurrence?: RecurrenceType;
    recurrenceEndDate?: Date | null;
    notes?: string | null;
    parentId?: string | null;
    calendarEventId?: string | null;
    groupId?: string | null;
}

export interface ListAppointmentsOptions {
    start?: Date;
    end?: Date;
    patientId?: string;
    page?: number;
    limit?: number;
}

export interface UpcomingAppointment {
    appointmentId: string;
    tenantId: string;
    tenantName: string;
    patientId: string;
    patientName: string;
    patientPhone: string | null;
    patientEmail: string | null;
    reminderChannel: ReminderChannel;
    scheduledAt: Date;
    durationMinutes: number;
    whatsappReminderTemplate: string | null;
}

export type ReminderLogStatus = 'success' | 'failed';
export type ReminderLogChannel = 'whatsapp' | 'email';

/**
 * Metadados adicionais opcionais do envio — usados pelo provedor Cloud API (Meta) para
 * distinguir de qual implementação técnica o log veio e se um resultado 'failed' é elegível
 * para o retry automático do próximo ciclo do cron. Omitidos (undefined), o comportamento é
 * idêntico ao anterior: provider fica NULL e retry_eligible assume o default TRUE do banco —
 * ou seja, nenhuma chamada existente (Baileys/email) precisa mudar.
 */
export interface MarkReminderSentOptions {
    provider?: 'baileys' | 'meta_cloud';
    /** false para resultados ambíguos (timeout/5xx pós-envio) — evita reenvio automático cego. */
    retryEligible?: boolean;
}

export interface SaveClinicalNoteDTO {
    id?: string;
    tenantId: string;
    patientId: string;
    sessionId?: string | null;
    noteDate: Date;
    content: string;
    tags?: string[];
}

export interface DashboardAnalytics {
    currentMonth: {
        revenueCents: number; // Received (paid receipts)
        sessionRevenueCents: number; // Individual sessions only (excludes group payments)
        expensesCents: number; // Total expenses
        netIncomeCents: number; // Revenue - Expenses
        pendingCents: number; // Unpaid monthly records
    };
    sixMonthsTrend: {
        month: string; // YYYY-MM
        revenueCents: number;
        expensesCents: number;
    }[];
}

export interface PaginationOptions {
    page: number;
    limit: number;
    search?: string;
    scope?: 'individual' | 'all';
}

export interface PaginatedResult<T> {
    data: T[];
    total: number;
}

export interface IPsychotherapyRepository {
    savePatient(data: SavePatientDTO): Promise<PsychotherapyPatient>;
    listPatients(tenantId: string, pagination?: PaginationOptions): Promise<PsychotherapyPatient[] | PaginatedResult<PsychotherapyPatient>>;
    listIndividualPatientsForBilling(tenantId: string): Promise<PsychotherapyPatient[]>;
    findPatientById(tenantId: string, id: string): Promise<PsychotherapyPatient | null>;
    findActivePatientById(tenantId: string, id: string): Promise<PsychotherapyPatient | null>;
    findPatientByIdIncludingDeleted(tenantId: string, id: string): Promise<PsychotherapyPatient | null>;
    deletePatient(tenantId: string, id: string): Promise<void>;
    saveMonthlyRecord(data: SaveMonthlyRecordDTO): Promise<PsychotherapyMonthlyRecord>;
    bulkSaveMonthlyRecords(records: SaveMonthlyRecordDTO[]): Promise<PsychotherapyMonthlyRecord[]>;
    listMonthlyRecords(tenantId: string, month: string): Promise<PsychotherapyMonthlyRecord[]>;
    getMonthSummary(tenantId: string, month: string): Promise<PsychotherapyMonthSummary>;
    getTenantProfile(tenantId: string): Promise<TenantProfile | null>;
    updateTenantProfile(data: UpdateTenantProfileDTO): Promise<TenantProfile>;
    saveReceipt(data: SaveReceiptDTO): Promise<PsychotherapyReceipt>;
    listReceipts(tenantId: string, patientId?: string): Promise<PsychotherapyReceipt[]>;
    deleteReceipt(tenantId: string, id: string): Promise<void>;
    saveSession(data: SaveSessionDTO): Promise<PsychotherapySession>;
    listSessions(tenantId: string, patientId?: string, start?: Date, end?: Date, pagination?: PaginationOptions): Promise<PaginatedResult<PsychotherapySession>>;
    deleteSession(tenantId: string, id: string): Promise<void>;
    saveExpense(data: SaveExpenseDTO): Promise<PsychotherapyExpense>;
    listExpenses(tenantId: string, start?: Date, end?: Date, pagination?: PaginationOptions): Promise<PaginatedResult<PsychotherapyExpense>>;
    deleteExpense(tenantId: string, id: string): Promise<void>;
    listFixedExpenses(tenantId: string): Promise<PsychotherapyFixedExpense[]>;
    saveFixedExpense(data: SaveFixedExpenseDTO): Promise<PsychotherapyFixedExpense>;
    deleteFixedExpense(tenantId: string, id: string): Promise<void>;
    toggleFixedExpense(tenantId: string, id: string, active: boolean): Promise<PsychotherapyFixedExpense>;
    expenseExistsForMonth(tenantId: string, fixedExpenseId: string, month: string): Promise<boolean>;
    getDashboardAnalytics(tenantId: string, currentMonthStr: string): Promise<DashboardAnalytics>;
    saveAppointment(data: SaveAppointmentDTO): Promise<PsychotherapyAppointment>;
    listAppointments(tenantId: string, options?: ListAppointmentsOptions): Promise<PaginatedResult<PsychotherapyAppointment>>;
    findAppointmentById(tenantId: string, id: string): Promise<PsychotherapyAppointment | null>;
    deleteAppointment(tenantId: string, id: string): Promise<void>;
    updateAppointmentStatus(tenantId: string, id: string, status: AppointmentStatus): Promise<PsychotherapyAppointment>;
    findUpcomingAppointments(windowStart: Date, windowEnd: Date): Promise<UpcomingAppointment[]>;
    /** Agendamentos futuros cuja janela normal já passou mas que têm tentativa de WhatsApp falhada e nenhum sucesso ainda (retry). */
    findFailedWhatsappReminders(now: Date, windowStart: Date, maxAttempts: number): Promise<UpcomingAppointment[]>;
    markReminderSent(appointmentId: string, tenantId: string, channelUsed: ReminderLogChannel, status: ReminderLogStatus, errorMessage?: string, options?: MarkReminderSentOptions): Promise<void>;
    hasReminderBeenSent(appointmentId: string, channelUsed: ReminderLogChannel): Promise<boolean>;
    countScheduledSessionsByPatient(tenantId: string, month: string): Promise<Map<string, number>>;
    saveClinicalNote(data: SaveClinicalNoteDTO): Promise<ClinicalNote>;
    listClinicalNotes(tenantId: string, patientId: string, page?: number, limit?: number): Promise<PaginatedResult<ClinicalNote>>;
    findClinicalNoteById(tenantId: string, id: string): Promise<ClinicalNote | null>;
    deleteClinicalNote(tenantId: string, id: string): Promise<void>;
    updateAppointmentGoogleEvent(id: string, tenantId: string, googleEventId: string, googleEventUrl: string): Promise<void>;
    findAppointmentByConfirmToken(token: string): Promise<PsychotherapyAppointment | null>;
    confirmAppointmentByToken(token: string): Promise<PsychotherapyAppointment | null>;
    saveGoogleOAuthTokens(tenantId: string, accessToken: string, refreshToken: string, expiryDate: number, calendarId?: string): Promise<void>;
    getGoogleOAuthTokens(tenantId: string): Promise<GoogleOAuthTokens | null>;
    updateGoogleAccessToken(tenantId: string, accessToken: string, expiryDate: number): Promise<void>;
    listAllGoogleOAuthTokens(): Promise<GoogleOAuthTokens[]>;
    findAppointmentByGoogleEventId(tenantId: string, googleEventId: string): Promise<PsychotherapyAppointment | null>;

    // Availability slots
    saveAvailabilitySlot(data: SaveAvailabilitySlotDTO): Promise<AvailabilitySlot>;
    listAvailabilitySlots(tenantId: string): Promise<AvailabilitySlot[]>;
    deleteAvailabilitySlot(tenantId: string, id: string): Promise<void>;
    listActiveAppointmentDatetimes(tenantId: string, from: Date, to: Date): Promise<Date[]>;

    // Booking links
    upsertBookingLink(tenantId: string, patientId: string, expiresAt?: Date | null): Promise<BookingLink>;
    findBookingLinkByToken(token: string): Promise<BookingLink | null>;
    deactivateBookingLink(tenantId: string, patientId: string): Promise<void>;

    // Public booking token (sem paciente prévio)
    getOrCreatePublicBookingToken(tenantId: string): Promise<string>;
    findPublicBookingToken(token: string): Promise<string | null>;
    findPatientByPhone(tenantId: string, phone: string): Promise<PsychotherapyPatient | null>;

    listSeriesAppointments(tenantId: string, rootId: string): Promise<PsychotherapyAppointment[]>;

    // Ledger / Payments
    registerPayment(data: RegisterPaymentDTO): Promise<FinancialPayment>;
    voidPayment(tenantId: string, paymentId: string, voidedBy: string, reason: string): Promise<FinancialPayment>;
    findPaymentByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<FinancialPayment | null>;
    findPaymentById(tenantId: string, id: string): Promise<FinancialPayment | null>;
}

export interface FinancialPayment {
    id: string;
    tenantId: string;
    patientId: string;
    monthlyRecordId: string | null;
    amountCents: number;
    currency: string;
    paidAt: Date;
    method: 'pix' | 'credit_card' | 'cash' | 'bank_transfer' | 'other';
    source: 'manual' | 'pix';
    status: 'confirmed' | 'voided';
    providerTxid: string | null;
    idempotencyKey: string;
    voidedAt: Date | null;
    voidedBy: string | null;
    voidReason: string | null;
    createdBy: string;
    createdAt: Date;
}

export interface RegisterPaymentDTO {
    id?: string;
    tenantId: string;
    patientId: string;
    monthlyRecordId?: string | null;
    amountCents: number;
    paidAt: Date;
    method: 'pix' | 'credit_card' | 'cash' | 'bank_transfer' | 'other';
    source: 'manual' | 'pix';
    providerTxid?: string | null;
    idempotencyKey: string;
    createdBy: string;
}

export interface SaveAvailabilitySlotDTO {
    id?: string;
    tenantId: string;
    dayOfWeek: number;
    startTime: string;
    durationMinutes?: number;
    isActive?: boolean;
    notes?: string | null;
    recurrenceType?: AvailabilityRecurrenceType;
    startDate?: Date | null;
    modality?: AvailabilityModality;
}

export interface GoogleOAuthTokens {
    tenantId: string;
    accessToken: string;
    refreshToken: string;
    expiryDate: number | null;
    calendarId: string | null;
}

