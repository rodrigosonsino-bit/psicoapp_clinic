import { Pool } from 'pg';
import {
    IPsychotherapyRepository,
    PsychotherapyMonthSummary,
    SaveMonthlyRecordDTO,
    SavePatientDTO,
    UpdateTenantProfileDTO,
    SaveReceiptDTO,
    PaginationOptions,
    PaginatedResult,
    SaveAppointmentDTO,
    ListAppointmentsOptions,
    UpcomingAppointment,
    GoogleOAuthTokens,
    SaveAvailabilitySlotDTO,
    FinancialPayment,
    RegisterPaymentDTO,
    MarkReminderSentOptions
} from '../../domain/repositories/IPsychotherapyRepository';
import { PsychotherapyPatient } from '../../domain/models/PsychotherapyPatient';
import { PsychotherapyMonthlyRecord } from '../../domain/models/PsychotherapyMonthlyRecord';
import { TenantProfile } from '../../domain/models/TenantProfile';
import { PsychotherapyReceipt } from '../../domain/models/PsychotherapyReceipt';
import { PsychotherapySession } from '../../domain/models/PsychotherapySession';
import { PsychotherapyExpense } from '../../domain/models/PsychotherapyExpense';
import { PsychotherapyFixedExpense } from '../../domain/models/PsychotherapyFixedExpense';
import { DashboardAnalytics, PendingDetails, SaveExpenseDTO, SaveSessionDTO, SaveClinicalNoteDTO, SaveFixedExpenseDTO, AddAdvanceCreditDTO } from '../../domain/repositories/IPsychotherapyRepository';
import { AppointmentStatus, PsychotherapyAppointment } from '../../domain/models/PsychotherapyAppointment';
import { ClinicalNote } from '../../domain/models/ClinicalNote';
import { AvailabilitySlot } from '../../domain/models/AvailabilitySlot';
import { BookingLink } from '../../domain/models/BookingLink';
import { validateTenantId, mapAppointment } from './shared';
import { PostgresPatientRepository } from './PostgresPatientRepository';
import { PostgresSessionRepository } from './PostgresSessionRepository';
import { PostgresAppointmentRepository } from './PostgresAppointmentRepository';
import { PostgresExpenseRepository } from './PostgresExpenseRepository';
import { PostgresTenantProfileRepository } from './PostgresTenantProfileRepository';
import { PostgresGoogleOAuthRepository } from './PostgresGoogleOAuthRepository';
import { PostgresAvailabilitySlotRepository } from './PostgresAvailabilitySlotRepository';
import { PostgresBookingLinkRepository } from './PostgresBookingLinkRepository';
import { PostgresBillingRepository } from './PostgresBillingRepository';

const SESSIONS_BY_PATIENT_STATUS: Record<string, number> = {
    weekly: 4, biweekly: 2, one_off: 0, inactive: 0,
};

import { injectable } from 'tsyringe';
import { BusinessError } from '../../domain/errors/BusinessError';

@injectable()
export class PostgresPsychotherapyRepository implements IPsychotherapyRepository {
    private readonly tenantProfileRepository: PostgresTenantProfileRepository;
    private readonly googleOAuthRepository: PostgresGoogleOAuthRepository;
    private readonly availabilitySlotRepository: PostgresAvailabilitySlotRepository;
    private readonly bookingLinkRepository: PostgresBookingLinkRepository;
    private readonly patientRepository: PostgresPatientRepository;
    private readonly sessionRepository: PostgresSessionRepository;
    private readonly appointmentRepository: PostgresAppointmentRepository;
    private readonly expenseRepository: PostgresExpenseRepository;
    private readonly billingRepository: PostgresBillingRepository;

    constructor(private readonly dbPool: Pool) {
        this.tenantProfileRepository = new PostgresTenantProfileRepository(dbPool);
        this.googleOAuthRepository = new PostgresGoogleOAuthRepository(dbPool);
        this.availabilitySlotRepository = new PostgresAvailabilitySlotRepository(dbPool);
        this.bookingLinkRepository = new PostgresBookingLinkRepository(dbPool);
        this.patientRepository = new PostgresPatientRepository(dbPool);
        this.sessionRepository = new PostgresSessionRepository(dbPool);
        this.appointmentRepository = new PostgresAppointmentRepository(dbPool);
        this.expenseRepository = new PostgresExpenseRepository(dbPool);
        this.billingRepository = new PostgresBillingRepository(dbPool, this.expenseRepository);
    }

    async savePatient(data: SavePatientDTO): Promise<PsychotherapyPatient> {
        return this.patientRepository.savePatient(data);
    }

    async listPatients(tenantId: string, pagination?: PaginationOptions): Promise<any> {
        return this.patientRepository.listPatients(tenantId, pagination);
    }

    async listIndividualPatientsForBilling(tenantId: string): Promise<PsychotherapyPatient[]> {
        return this.patientRepository.listIndividualPatientsForBilling(tenantId);
    }

    async findPatientById(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        return this.patientRepository.findPatientById(tenantId, id);
    }

    async findActivePatientById(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        return this.patientRepository.findActivePatientById(tenantId, id);
    }

    async findPatientByIdIncludingDeleted(tenantId: string, id: string): Promise<PsychotherapyPatient | null> {
        return this.patientRepository.findPatientByIdIncludingDeleted(tenantId, id);
    }

    async deletePatient(tenantId: string, id: string): Promise<void> {
        return this.patientRepository.deletePatient(tenantId, id);
    }

    async saveMonthlyRecord(data: SaveMonthlyRecordDTO): Promise<PsychotherapyMonthlyRecord> {
        return this.billingRepository.saveMonthlyRecord(data);
    }

    async bulkSaveMonthlyRecords(data: SaveMonthlyRecordDTO[]): Promise<PsychotherapyMonthlyRecord[]> {
        return this.billingRepository.bulkSaveMonthlyRecords(data);
    }

    async addAdvanceCredit(data: AddAdvanceCreditDTO): Promise<PsychotherapyMonthlyRecord> {
        return this.billingRepository.addAdvanceCredit(data);
    }

    async countScheduledSessionsByPatient(tenantId: string, month: string): Promise<Map<string, number>> {
        return this.billingRepository.countScheduledSessionsByPatient(tenantId, month);
    }

    async listMonthlyRecords(tenantId: string, month: string): Promise<PsychotherapyMonthlyRecord[]> {
        return this.billingRepository.listMonthlyRecords(tenantId, month);
    }

    async getMonthSummary(tenantId: string, month: string): Promise<PsychotherapyMonthSummary> {
        return this.billingRepository.getMonthSummary(tenantId, month);
    }

    async getTenantProfile(tenantId: string): Promise<TenantProfile | null> {
        return this.tenantProfileRepository.getTenantProfile(tenantId);
    }

    async updateTenantProfile(data: UpdateTenantProfileDTO): Promise<TenantProfile> {
        return this.tenantProfileRepository.updateTenantProfile(data);
    }

    async saveReceipt(data: SaveReceiptDTO): Promise<PsychotherapyReceipt> {
        return this.billingRepository.saveReceipt(data);
    }

    async listReceipts(tenantId: string, patientId?: string): Promise<PsychotherapyReceipt[]> {
        return this.billingRepository.listReceipts(tenantId, patientId);
    }

    async deleteReceipt(tenantId: string, id: string, voidedBy: string, reason: string): Promise<void> {
        return this.billingRepository.deleteReceipt(tenantId, id, voidedBy, reason);
    }

    async saveSession(data: SaveSessionDTO): Promise<PsychotherapySession> {
        return this.sessionRepository.saveSession(data);
    }

    async listSessions(
        tenantId: string,
        patientId?: string,
        start?: Date,
        end?: Date,
        pagination?: PaginationOptions
    ): Promise<PaginatedResult<PsychotherapySession>> {
        return this.sessionRepository.listSessions(tenantId, patientId, start, end, pagination);
    }

    async deleteSession(tenantId: string, id: string): Promise<void> {
        return this.sessionRepository.deleteSession(tenantId, id);
    }

    async saveExpense(data: SaveExpenseDTO): Promise<PsychotherapyExpense> {
        return this.expenseRepository.saveExpense(data);
    }

    async listExpenses(
        tenantId: string,
        start?: Date,
        end?: Date,
        pagination?: PaginationOptions
    ): Promise<PaginatedResult<PsychotherapyExpense>> {
        return this.expenseRepository.listExpenses(tenantId, start, end, pagination);
    }

    async deleteExpense(tenantId: string, id: string): Promise<void> {
        return this.expenseRepository.deleteExpense(tenantId, id);
    }

    async listFixedExpenses(tenantId: string): Promise<PsychotherapyFixedExpense[]> {
        return this.expenseRepository.listFixedExpenses(tenantId);
    }

    async saveFixedExpense(data: SaveFixedExpenseDTO): Promise<PsychotherapyFixedExpense> {
        return this.expenseRepository.saveFixedExpense(data);
    }

    async deleteFixedExpense(tenantId: string, id: string): Promise<void> {
        return this.expenseRepository.deleteFixedExpense(tenantId, id);
    }

    async toggleFixedExpense(tenantId: string, id: string, active: boolean): Promise<PsychotherapyFixedExpense> {
        return this.expenseRepository.toggleFixedExpense(tenantId, id, active);
    }

    async expenseExistsForMonth(tenantId: string, fixedExpenseId: string, month: string): Promise<boolean> {
        return this.expenseRepository.expenseExistsForMonth(tenantId, fixedExpenseId, month);
    }

    async getDashboardAnalytics(tenantId: string, currentMonthStr: string): Promise<DashboardAnalytics> {
        return this.billingRepository.getDashboardAnalytics(tenantId, currentMonthStr);
    }

    /**
     * Detalhamento por paciente/cobrança do valor de "Inadimplência" do Dashboard —
     * mesmos números que getDashboardAnalytics, mas explodidos por linha em vez de somados.
     * Reusa exatamente a mesma fórmula de pendência (ver comentário em getDashboardAnalytics)
     * pra nunca divergir do total exibido no card.
     */
    async getPendingDetails(tenantId: string, currentMonthStr: string): Promise<PendingDetails> {
        return this.billingRepository.getPendingDetails(tenantId, currentMonthStr);
    }

    async listCoveredAppointmentIds(tenantId: string, month: string): Promise<string[]> {
        return this.billingRepository.listCoveredAppointmentIds(tenantId, month);
    }

    // ── Appointments ──────────────────────────────────────────────────────────

    async saveAppointment(data: SaveAppointmentDTO): Promise<PsychotherapyAppointment> {
        return this.appointmentRepository.saveAppointment(data);
    }

    async listAppointments(tenantId: string, options: ListAppointmentsOptions = {}): Promise<PaginatedResult<PsychotherapyAppointment>> {
        return this.appointmentRepository.listAppointments(tenantId, options);
    }

    async findAppointmentById(tenantId: string, id: string): Promise<PsychotherapyAppointment | null> {
        return this.appointmentRepository.findAppointmentById(tenantId, id);
    }

    async deleteAppointment(tenantId: string, id: string): Promise<void> {
        return this.appointmentRepository.deleteAppointment(tenantId, id);
    }

    async updateAppointmentStatus(tenantId: string, id: string, status: AppointmentStatus): Promise<PsychotherapyAppointment> {
        return this.appointmentRepository.updateAppointmentStatus(tenantId, id, status);
    }

    async findUpcomingAppointments(windowStart: Date, windowEnd: Date): Promise<UpcomingAppointment[]> {
        return this.appointmentRepository.findUpcomingAppointments(windowStart, windowEnd);
    }

    async findFailedWhatsappReminders(now: Date, windowStart: Date, maxAttempts: number): Promise<UpcomingAppointment[]> {
        return this.appointmentRepository.findFailedWhatsappReminders(now, windowStart, maxAttempts);
    }

    async markReminderSent(
        appointmentId: string,
        tenantId: string,
        channelUsed: 'whatsapp' | 'email',
        status: 'success' | 'failed',
        errorMessage?: string,
        options?: MarkReminderSentOptions
    ): Promise<void> {
        return this.appointmentRepository.markReminderSent(appointmentId, tenantId, channelUsed, status, errorMessage, options);
    }

    async hasReminderBeenSent(appointmentId: string, channelUsed: 'whatsapp' | 'email'): Promise<boolean> {
        return this.appointmentRepository.hasReminderBeenSent(appointmentId, channelUsed);
    }

    // ── Google OAuth Tokens ───────────────────────────────────────────────────

    async saveGoogleOAuthTokens(tenantId: string, accessToken: string, refreshToken: string, expiryDate: number, calendarId?: string): Promise<void> {
        return this.googleOAuthRepository.saveGoogleOAuthTokens(tenantId, accessToken, refreshToken, expiryDate, calendarId);
    }

    async getGoogleOAuthTokens(tenantId: string): Promise<GoogleOAuthTokens | null> {
        return this.googleOAuthRepository.getGoogleOAuthTokens(tenantId);
    }

    async updateGoogleAccessToken(tenantId: string, accessToken: string, expiryDate: number): Promise<void> {
        return this.googleOAuthRepository.updateGoogleAccessToken(tenantId, accessToken, expiryDate);
    }

    async listAllGoogleOAuthTokens(): Promise<GoogleOAuthTokens[]> {
        return this.googleOAuthRepository.listAllGoogleOAuthTokens();
    }

    async findAppointmentByGoogleEventId(tenantId: string, googleEventId: string): Promise<PsychotherapyAppointment | null> {
        return this.appointmentRepository.findAppointmentByGoogleEventId(tenantId, googleEventId);
    }

    async updateAppointmentGoogleEvent(id: string, tenantId: string, googleEventId: string, googleEventUrl: string): Promise<void> {
        return this.appointmentRepository.updateAppointmentGoogleEvent(id, tenantId, googleEventId, googleEventUrl);
    }

    async findAppointmentByConfirmToken(token: string): Promise<PsychotherapyAppointment | null> {
        return this.appointmentRepository.findAppointmentByConfirmToken(token);
    }

    async confirmAppointmentByToken(token: string): Promise<PsychotherapyAppointment | null> {
        return this.appointmentRepository.confirmAppointmentByToken(token);
    }

    // ── Clinical Notes ────────────────────────────────────────────────────────

    async saveClinicalNote(data: SaveClinicalNoteDTO): Promise<ClinicalNote> {
        return this.sessionRepository.saveClinicalNote(data);
    }

    async listClinicalNotes(tenantId: string, patientId: string, page = 1, limit = 20): Promise<PaginatedResult<ClinicalNote>> {
        return this.sessionRepository.listClinicalNotes(tenantId, patientId, page, limit);
    }

    async findClinicalNoteById(tenantId: string, id: string): Promise<ClinicalNote | null> {
        return this.sessionRepository.findClinicalNoteById(tenantId, id);
    }

    async deleteClinicalNote(tenantId: string, id: string): Promise<void> {
        return this.sessionRepository.deleteClinicalNote(tenantId, id);
    }

    // ── Availability Slots ────────────────────────────────────────────────────

    async saveAvailabilitySlot(data: SaveAvailabilitySlotDTO): Promise<AvailabilitySlot> {
        return this.availabilitySlotRepository.saveAvailabilitySlot(data);
    }

    async listAvailabilitySlots(tenantId: string): Promise<AvailabilitySlot[]> {
        return this.availabilitySlotRepository.listAvailabilitySlots(tenantId);
    }

    async deleteAvailabilitySlot(tenantId: string, id: string): Promise<void> {
        return this.availabilitySlotRepository.deleteAvailabilitySlot(tenantId, id);
    }

    async listActiveAppointmentDatetimes(tenantId: string, from: Date, to: Date): Promise<Date[]> {
        return this.appointmentRepository.listActiveAppointmentDatetimes(tenantId, from, to);
    }

    // ── Booking Links ──────────────────────────────────────────────────────────

    async upsertBookingLink(tenantId: string, patientId: string, expiresAt?: Date | null): Promise<BookingLink> {
        return this.bookingLinkRepository.upsertBookingLink(tenantId, patientId, expiresAt);
    }

    async findBookingLinkByToken(token: string): Promise<BookingLink | null> {
        return this.bookingLinkRepository.findBookingLinkByToken(token);
    }

    async deactivateBookingLink(tenantId: string, patientId: string): Promise<void> {
        return this.bookingLinkRepository.deactivateBookingLink(tenantId, patientId);
    }

    // ── Public booking tokens ─────────────────────────────────────────────────

    async getOrCreatePublicBookingToken(tenantId: string): Promise<string> {
        return this.bookingLinkRepository.getOrCreatePublicBookingToken(tenantId);
    }

    async findPublicBookingToken(token: string): Promise<string | null> {
        return this.bookingLinkRepository.findPublicBookingToken(token);
    }

    async findPatientByPhone(tenantId: string, phone: string): Promise<PsychotherapyPatient | null> {
        return this.patientRepository.findPatientByPhone(tenantId, phone);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    async listSeriesAppointments(tenantId: string, rootId: string): Promise<PsychotherapyAppointment[]> {
        return this.appointmentRepository.listSeriesAppointments(tenantId, rootId);
    }

    async registerPayment(data: RegisterPaymentDTO): Promise<FinancialPayment> {
        return this.billingRepository.registerPayment(data);
    }

    async voidPayment(tenantId: string, paymentId: string, voidedBy: string, reason: string): Promise<FinancialPayment> {
        return this.billingRepository.voidPayment(tenantId, paymentId, voidedBy, reason);
    }

    async findPaymentByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<FinancialPayment | null> {
        return this.billingRepository.findPaymentByIdempotencyKey(tenantId, idempotencyKey);
    }

    async findPaymentById(tenantId: string, id: string): Promise<FinancialPayment | null> {
        return this.billingRepository.findPaymentById(tenantId, id);
    }

    async listSessionLinksForMonth(tenantId: string, month: string): Promise<Record<string, string>> {
        return this.appointmentRepository.listSessionLinksForMonth(tenantId, month);
    }
}
