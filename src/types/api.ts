export interface TokenPayload {
  tenantId: string;
  email: string;
  plan: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type AuthResponse =
  | { requires2fa: false; accessToken: string; refreshToken: string; tenant: { id: string; name: string; email: string; plan: string } }
  | { requires2fa: true; tempToken: string };

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  tenant: { id: string; name: string; email: string; plan: string };
}

export type ReminderChannel = 'whatsapp' | 'email' | 'both' | 'none';

export interface Patient {
  id: string;
  tenantId: string;
  name: string;
  status: 'weekly' | 'biweekly' | 'monthly' | 'one_off' | 'inactive';
  paymentType: 'monthly' | 'per_session' | null;
  defaultSessionPriceCents: number | null;
  notes: string | null;
  document: string | null;
  phone: string | null;
  email: string | null;
  reminderChannel: ReminderChannel;
  fullName: string | null;
  whatsappBulkOptIn?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BroadcastPreview {
  eligible: number;
  excluded: {
    inactive: number;
    deleted: number;
    withoutPhone: number;
    invalidPhone: number;
    withoutOptIn: number;
  };
  maxRecipients: number;
}

export type BroadcastStatus = 'queued' | 'processing' | 'completed' | 'partial_failed' | 'canceled';

export interface BroadcastStatusCounts {
  queued: number;
  sending: number;
  retry_wait: number;
  sent: number;
  failed: number;
  delivery_unknown: number;
  canceled: number;
}

export interface Broadcast {
  id: string;
  tenantId: string;
  status: BroadcastStatus;
  totalRecipients: number;
  createdAt: string;
  counts?: BroadcastStatusCounts;
}

export interface WhatsappStatus {
  connected: boolean;
  status: 'connected' | 'connecting' | 'disconnected';
  hasQr: boolean;
}

export interface MonthlyRecord {
  id: string;
  tenantId: string;
  patientId: string | null;
  month: string;
  patientNameSnapshot: string;
  status: 'weekly' | 'biweekly' | 'monthly' | 'one_off' | 'inactive';
  paymentType: 'monthly' | 'per_session' | null;
  sessionPriceCents: number | null;
  expectedSessions: number;
  paidSessions: number;
  absences: number;
  paymentStatus: 'paid' | 'pending' | 'partial';
  notes: string | null;
  previousMonthPaidCents: number;
  expectedAmountCents: number;
  receivedAmountCents: number;
  pendingAmountCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  tenantId: string;
  patientId: string;
  date: string;
  status: 'attended' | 'justified_absence' | 'unjustified_absence' | 'canceled';
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Expense {
  id: string;
  tenantId: string;
  date: string;
  amountCents: number;
  description: string;
  category: 'rent' | 'taxes' | 'software' | 'marketing' | 'other';
  fixedExpenseId?: string | null;
  referenceMonth?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FixedExpense {
  id: string;
  tenantId: string;
  description: string;
  amountCents: number;
  dayOfMonth: number;
  category: string | null;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string | null; // 'YYYY-MM-DD'
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Receipt {
  id: string;
  tenantId: string;
  patientId: string;
  receiptNumber: number;
  amountCents: number;
  issueDate: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  patientNameSnapshot?: string | null;
  patientDocumentSnapshot?: string | null;
  tenantNameSnapshot?: string | null;
  tenantDocumentSnapshot?: string | null;
  tenantProfessionalIdSnapshot?: string | null;
  tenantAddressSnapshot?: string | null;
  status?: 'issued' | 'cancelled';
}

export interface BookingPageSettings {
  professionLabel?: string | null;
  displayName?: string | null;
  accentColor?: string | null;
  welcomeMessage?: string | null;
}

/** Taxa de cartão sugerida por nº de parcelas (chave "1"-"12"), em basis points (350 = 3,50%). */
export type CardFeeRates = Record<string, number>;

export interface TenantProfile {
  id: string;
  name: string;
  email: string;
  fullName: string | null;
  document: string | null;
  professionalId: string | null;
  address: string | null;
  twoFactorEnabled?: boolean;
  bookingPage?: BookingPageSettings | null;
  whatsappReminderTemplate?: string | null;
  cardFeeRates?: CardFeeRates | null;
}

export interface DashboardAnalytics {
  currentMonth: {
    revenueCents: number;
    sessionRevenueCents: number;
    expensesCents: number;
    netIncomeCents: number;
    pendingCents: number;
  };
  sixMonthsTrend: {
    month: string;
    revenueCents: number;
    expensesCents: number;
  }[];
}

export interface PendingSessionDetail {
  id: string;
  date: string;
  status: 'attended' | 'no_show' | 'scheduled' | 'confirmed';
  covered: boolean;
}

export interface PendingPatientDetail {
  recordId: string;
  patientId: string;
  patientName: string;
  status: 'weekly' | 'biweekly' | 'monthly' | 'one_off' | 'inactive';
  paymentType: 'monthly' | 'per_session';
  month: string;
  sessionPriceCents: number | null;
  expectedSessions: number;
  absences: number;
  paidSessions: number;
  previousMonthPaidCents: number;
  paymentStatus: 'paid' | 'pending' | 'partial';
  notes: string | null;
  receivedAmountCents: number;
  pendingAmountCents: number;
  sessions: PendingSessionDetail[];
}

export interface PendingGroupChargeDetail {
  groupPaymentId: string;
  groupName: string;
  memberName: string | null;
  amountCents: number;
  dueDate: string | null;
}

export interface PendingDetails {
  month: string;
  individualPatients: PendingPatientDetail[];
  groupCharges: PendingGroupChargeDetail[];
}

export interface WhatsappMessageHistoryEntry {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  messageType: string;
  occurredAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'attended' | 'canceled' | 'no_show';
export type RecurrenceType = 'none' | 'weekly' | 'biweekly' | 'monthly';

export interface Appointment {
  id: string;
  tenantId: string;
  patientId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  recurrence: RecurrenceType;
  recurrenceEndDate: string | null;
  notes: string | null;
  googleEventId: string | null;
  googleEventUrl: string | null;
  confirmToken: string | null;
  confirmedAt: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Presente quando o agendamento é de uma sessão de grupo (não de um paciente individual). */
  groupId: string | null;
}

export type AvailabilityRecurrenceType = 'weekly' | 'biweekly' | 'once';
export type AvailabilityModality = 'presencial' | 'online' | 'both';

export interface AvailabilitySlot {
  id: string;
  tenantId: string;
  dayOfWeek: number;
  startTime: string;
  durationMinutes: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  recurrenceType: AvailabilityRecurrenceType;
  startDate: string | null;
  modality: AvailabilityModality;
}

export interface BookingLinkResult {
  token: string;
  url: string;
  expiresAt: string | null;
}

export interface AvailableSlot {
  datetime: string;
  durationMinutes: number;
  dayOfWeek: number;
  startTime: string;
  modality: AvailabilityModality;
}

export interface BookingPageInfo {
  patientName: string;
  tenantName: string;
  availableSlots: AvailableSlot[];
  isExpired: boolean;
}

export interface GoogleCalendarStatus {
  connected: boolean;
  calendarName: string | null;
  calendarId: string | null;
}

export interface ClinicalNote {
  id: string;
  tenantId: string;
  patientId: string;
  sessionId: string | null;
  noteDate: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PixCharge {
  id: string;
  tenantId: string;
  patientId: string;
  monthlyRecordId: string | null;
  amountCents: number;
  description: string;
  status: 'pending' | 'paid' | 'expired' | 'canceled';
  providerTxid: string | null;
  qrCode: string | null;
  qrCodeImageUrl: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TotpSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
}

export interface MonthResponse {
  records: MonthlyRecord[];
  summary: {
    month: string;
    totalPatients: number;
    activePatients: number;
    paidRecords: number;
    pendingRecords: number;
    expectedAmountCents: number;
    receivedAmountCents: number;
    pendingAmountCents: number;
  };
}

// ── IR / Fiscal ───────────────────────────────────────────────────────────────

export interface IrMonthlyBreakdown {
  month: string;         // 'YYYY-MM'
  revenueCents: number;
  expensesCents: number;
}

export interface IrPatientSummary {
  patientId: string;
  patientName: string;
  patientFullName?: string | null;
  document: string | null;   // CPF
  totalPaidCents: number;
  sessionCount: number;
  months: string[];           // ['YYYY-MM', ...]
}

export interface IrReport {
  year: number;
  tenant: {
    name: string;
    fullName: string | null;
    document: string | null;   // CPF/CNPJ da psicóloga
    professionalId: string | null;  // CRP
    address: string | null;
    email: string;
  };
  summary: {
    totalRevenueCents: number;
    totalExpensesCents: number;
    netIncomeCents: number;
    monthlyBreakdown: IrMonthlyBreakdown[];
  };
  patientSummaries: IrPatientSummary[];
}

// ── Prontuário estruturado ────────────────────────────────────────────────────

export interface Anamnesis {
  id: string | null;
  chiefComplaint: string | null;
  onsetDescription: string | null;
  previousTreatment: string | null;
  medications: string | null;
  familyHistory: string | null;
  relevantHistory: string | null;
  cidCodes: string[];
  therapeuticApproach: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type TreatmentPlanStatus = 'active' | 'completed' | 'suspended';

export interface TreatmentPlan {
  id: string;
  title: string;
  goals: string[];
  approach: string | null;
  targetSessions: number | null;
  status: TreatmentPlanStatus;
  startedAt: string;
  endedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Conciliação de extrato bancário ───────────────────────────────────────────

export type BankStatementMatchConfidence = 'high' | 'medium' | 'low' | 'none';
export type BankStatementTransactionStatus = 'pending' | 'confirmed' | 'ignored';

export interface BankStatementImportResult {
  importId: string;
  transactionCount: number;
  skippedLineCount: number;
  duplicateFitidCount: number;
}

export interface BankStatementTransaction {
  id: string;
  fitid: string;
  posted_at: string;
  amount_cents: number;
  raw_description: string;
  payer_name_guess: string | null;
  suggested_patient_id: string | null;
  suggested_month: string | null;
  suggested_sessions: number | null;
  match_confidence: BankStatementMatchConfidence;
  possible_pix_duplicate: boolean;
  status: BankStatementTransactionStatus;
  confirmed_patient_id: string | null;
  confirmed_month: string | null;
  confirmed_sessions: number | null;
  confirmed_at: string | null;
  ignored_at: string | null;
  created_at: string;
}

export interface BankStatementConfirmResult {
  transactionId: string;
  confirmedSessions: number;
  paidSessions: number;
  paymentStatus: 'paid' | 'partial' | 'pending';
}

export interface BankStatementBatchResult {
  total: number;
  success: number;
  results: Array<{ id: string; success: boolean; reason?: string }>;
}
