import { Router } from 'express';
import { z } from 'zod';
import { PsychotherapyController } from '../controllers/PsychotherapyController';
import { ProfileController } from '../controllers/ProfileController';
import { ReceiptController } from '../controllers/ReceiptController';
import { SessionController } from '../controllers/SessionController';
import { ExpenseController } from '../controllers/ExpenseController';
import { AppointmentController } from '../controllers/AppointmentController';
import { ExportController } from '../controllers/ExportController';
import { ClinicalNoteController } from '../controllers/ClinicalNoteController';
import { ProntuarioController } from '../controllers/ProntuarioController';
import { PixController } from '../controllers/PixController';
import { AppointmentConfirmController } from '../controllers/AppointmentConfirmController';
import { BookingController } from '../controllers/BookingController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { validateBody, validateQuery, validateParams } from '../middlewares/validationMiddleware';
import { asyncHandler } from '../middlewares/asyncHandler';
import { container } from '../../container';

// Zod Enum schemas
const patientStatusSchema = z.enum(['weekly', 'biweekly', 'one_off', 'inactive']);
const paymentTypeSchema = z.enum(['monthly', 'per_session']);
const reminderChannelSchema = z.enum(['whatsapp', 'email', 'both', 'none']);
const paymentStatusSchema = z.enum(['paid', 'pending', 'partial']);

// Route Param and Query schemas
const uuidParamSchema = z.object({
    id: z.string().uuid('ID inválido (esperado UUID)')
});

const monthParamSchema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Mês inválido (esperado formato YYYY-MM)')
});

const listPatientsQuerySchema = z.object({
    page: z.string().transform(val => Math.max(1, parseInt(val, 10) || 1)).optional().default('1'),
    limit: z.string().transform(val => Math.min(100, Math.max(1, parseInt(val, 10) || 20))).optional().default('20'),
    search: z.string().max(100).optional()
});

const listReceiptsQuerySchema = z.object({
    patientId: z.string().uuid('ID do paciente deve ser um UUID válido').optional()
});

const listSessionsQuerySchema = z.object({
    patientId: z.string().uuid('ID do paciente deve ser um UUID válido').optional(),
    start: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)).optional(),
    end: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)).optional(),
    page: z.string().transform(val => Math.max(1, parseInt(val, 10) || 1)).optional().default('1'),
    limit: z.string().transform(val => Math.min(100, Math.max(1, parseInt(val, 10) || 20))).optional().default('20')
});

const listExpensesQuerySchema = z.object({
    start: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)).optional(),
    end: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)).optional(),
    page: z.string().transform(val => Math.max(1, parseInt(val, 10) || 1)).optional().default('1'),
    limit: z.string().transform(val => Math.min(100, Math.max(1, parseInt(val, 10) || 20))).optional().default('20')
});

const analyticsQuerySchema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Formato de mês inválido (esperado YYYY-MM)').optional()
});

// Body Validation schemas
const patientSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1, 'Nome do paciente é obrigatório'),
    status: patientStatusSchema,
    paymentType: paymentTypeSchema.nullable().optional(),
    defaultSessionPriceCents: z.number().int().nonnegative().nullable().optional(),
    notes: z.string().nullable().optional(),
    document: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    reminderChannel: reminderChannelSchema.optional().default('whatsapp'),
    fullName: z.string().min(1).nullable().optional()
});

const monthlyRecordSchema = z.object({
    id: z.string().uuid().optional(),
    patientId: z.string().uuid().nullable().optional(),
    patientNameSnapshot: z.string().min(1, 'Nome do paciente é obrigatório'),
    status: patientStatusSchema,
    paymentType: paymentTypeSchema.nullable().optional(),
    sessionPriceCents: z.number().int().nonnegative().nullable().optional(),
    expectedSessions: z.number().int().min(0).max(31).optional(),
    paidSessions: z.number().int().min(0).max(31).optional(),
    absences: z.number().int().min(0).max(31).optional(),
    paymentStatus: paymentStatusSchema.optional(),
    notes: z.string().nullable().optional(),
    previousMonthPaidCents: z.number().int().nonnegative().optional()
});

const updateProfileSchema = z.object({
    fullName: z.string().min(1).nullable().optional(),
    document: z.string().nullable().optional(),
    professionalId: z.string().nullable().optional(),
    address: z.string().nullable().optional()
});

const issueReceiptSchema = z.object({
    patientId: z.string().uuid('ID do paciente inválido'),
    amountCents: z.number().int().positive('Valor do recibo deve ser maior que zero'),
    issueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)).optional(),
    description: z.string().min(1, 'A descrição é obrigatória'),
    markMonthAsPaid: z.string().regex(/^\d{4}-\d{2}$/, 'Formato de mês inválido (esperado YYYY-MM)').optional()
});

const sessionSchema = z.object({
    id: z.string().uuid().optional(),
    patientId: z.string().uuid('ID do paciente inválido'),
    date: z.string().datetime().transform(val => new Date(val)),
    status: z.enum(['attended', 'justified_absence', 'unjustified_absence', 'canceled']),
    notes: z.string().nullable().optional()
});

const expenseSchema = z.object({
    id: z.string().uuid().optional(),
    date: z.string().datetime().transform(val => new Date(val)),
    amountCents: z.number().int().positive('Valor deve ser positivo'),
    description: z.string().min(1, 'A descrição é obrigatória'),
    category: z.enum(['rent', 'taxes', 'software', 'marketing', 'other'])
});

const fixedExpenseSchema = z.object({
    id: z.string().uuid().optional(),
    description: z.string().min(1, 'A descrição é obrigatória'),
    amountCents: z.number().int().positive('Valor deve ser positivo'),
    dayOfMonth: z.number().int().min(1).max(28, 'Dia do mês deve ser entre 1 e 28'),
    category: z.string().nullable().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de início inválida (esperado YYYY-MM-DD)'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de término inválida (esperado YYYY-MM-DD)').nullable().optional(),
    active: z.boolean().optional()
});

const toggleFixedExpenseSchema = z.object({
    active: z.boolean()
});

export function createPsychotherapyRoutes(): Router {
    const router = Router();

    // ── Rotas públicas (sem autenticação) ─────────────────────────────────────
    const confirmController = container.resolve(AppointmentConfirmController);
    const confirmTokenParamSchema = z.object({ token: z.string().uuid('Token inválido') });
    router.get('/appointments/confirm/:token', validateParams(confirmTokenParamSchema), asyncHandler((req, res) => confirmController.getByToken(req, res)));
    router.post('/appointments/confirm/:token', validateParams(confirmTokenParamSchema), asyncHandler((req, res) => confirmController.confirm(req, res)));

    // Auto-agendamento pelo paciente (público)
    const bookingController = container.resolve(BookingController);
    const bookingTokenSchema = z.object({ token: z.string().uuid('Token inválido') });
    const bookSlotSchema = z.object({
        scheduledAt: z.string().datetime('Data/hora inválida')
    });
    router.get('/book/:token', validateParams(bookingTokenSchema), asyncHandler((req, res) => bookingController.getBookingPage(req, res)));
    router.post('/book/:token', validateParams(bookingTokenSchema), validateBody(bookSlotSchema), asyncHandler((req, res) => bookingController.bookSlot(req, res)));

    // Self-booking público — novo paciente preenche nome + celular
    const selfBookSlotSchema = z.object({
        name: z.string().min(2, 'Nome obrigatório (mínimo 2 caracteres)'),
        phone: z.string().min(8, 'Celular obrigatório'),
        scheduledAt: z.string().datetime('Data/hora inválida')
    });
    router.get('/book-public/:token', validateParams(bookingTokenSchema), asyncHandler((req, res) => bookingController.getPublicBookingPage(req, res)));
    router.post('/book-public/:token', validateParams(bookingTokenSchema), validateBody(selfBookSlotSchema), asyncHandler((req, res) => bookingController.selfBookSlot(req, res)));

    // MercadoPago Webhook
    const { MercadoPagoWebhookController } = require('../controllers/MercadoPagoWebhookController');
    const mpWebhookController: InstanceType<typeof MercadoPagoWebhookController> = container.resolve(MercadoPagoWebhookController);
    router.post('/psychotherapy/webhooks/mercadopago', asyncHandler((req, res) => mpWebhookController.handleWebhook(req, res)));

    // ── Rotas protegidas ──────────────────────────────────────────────────────
    router.use(authMiddleware);

    const controller = container.resolve(PsychotherapyController);
    const profileController = container.resolve(ProfileController);
    const receiptController = container.resolve(ReceiptController);

    // Patients & Months
    router.get('/psychotherapy/patients', validateQuery(listPatientsQuerySchema), asyncHandler((req, res) => controller.listPatients(req, res)));
    router.post('/psychotherapy/patients', validateBody(patientSchema), asyncHandler((req, res) => controller.savePatient(req, res)));
    router.delete('/psychotherapy/patients/:id', validateParams(uuidParamSchema), asyncHandler((req, res) => controller.deletePatient(req, res)));
    router.get('/psychotherapy/months/:month', validateParams(monthParamSchema), asyncHandler((req, res) => controller.getMonth(req, res)));
    router.post('/psychotherapy/months/:month/generate', validateParams(monthParamSchema), asyncHandler((req, res) => controller.generateMonth(req, res)));
    router.post('/psychotherapy/months/:month/records', validateParams(monthParamSchema), validateBody(monthlyRecordSchema), asyncHandler((req, res) => controller.saveMonthlyRecord(req, res)));

    // Profile
    router.get('/profile', asyncHandler((req, res) => profileController.getProfile(req, res)));
    router.put('/profile', validateBody(updateProfileSchema), asyncHandler((req, res) => profileController.updateProfile(req, res)));

    // Receipts
    router.post('/psychotherapy/receipts', validateBody(issueReceiptSchema), asyncHandler((req, res) => receiptController.issueReceipt(req, res)));
    router.get('/psychotherapy/receipts', validateQuery(listReceiptsQuerySchema), asyncHandler((req, res) => receiptController.listReceipts(req, res)));

    // Sessions
    const sessionController = container.resolve(SessionController);
    router.post('/psychotherapy/sessions', validateBody(sessionSchema), asyncHandler((req, res) => sessionController.saveSession(req, res)));
    router.get('/psychotherapy/sessions', validateQuery(listSessionsQuerySchema), asyncHandler((req, res) => sessionController.listSessions(req, res)));
    router.delete('/psychotherapy/sessions/:id', validateParams(uuidParamSchema), asyncHandler((req, res) => sessionController.deleteSession(req, res)));

    // Expenses & Analytics
    const expenseController = container.resolve(ExpenseController);
    router.post('/psychotherapy/expenses', validateBody(expenseSchema), asyncHandler((req, res) => expenseController.saveExpense(req, res)));
    router.get('/psychotherapy/expenses', validateQuery(listExpensesQuerySchema), asyncHandler((req, res) => expenseController.listExpenses(req, res)));
    router.delete('/psychotherapy/expenses/:id', validateParams(uuidParamSchema), asyncHandler((req, res) => expenseController.deleteExpense(req, res)));
    router.get('/psychotherapy/analytics/dashboard', validateQuery(analyticsQuerySchema), asyncHandler((req, res) => expenseController.getAnalytics(req, res)));

    router.get('/psychotherapy/fixed-expenses', asyncHandler((req, res) => expenseController.listFixedExpenses(req, res)));
    router.post('/psychotherapy/fixed-expenses', validateBody(fixedExpenseSchema), asyncHandler((req, res) => expenseController.saveFixedExpense(req, res)));
    router.delete('/psychotherapy/fixed-expenses/:id', validateParams(uuidParamSchema), asyncHandler((req, res) => expenseController.deleteFixedExpense(req, res)));
    router.patch('/psychotherapy/fixed-expenses/:id/toggle', validateParams(uuidParamSchema), validateBody(toggleFixedExpenseSchema), asyncHandler((req, res) => expenseController.toggleFixedExpense(req, res)));

    // Appointments
    const appointmentController = container.resolve(AppointmentController);

    const appointmentSchema = z.object({
        id: z.string().uuid().optional(),
        patientId: z.string().uuid('ID do paciente inválido'),
        scheduledAt: z.string().datetime().transform(val => new Date(val)),
        durationMinutes: z.number().int().min(10).max(240).optional().default(50),
        status: z.enum(['scheduled', 'confirmed', 'attended', 'canceled', 'no_show']).optional(),
        recurrence: z.enum(['none', 'weekly', 'biweekly']).optional().default('none'),
        recurrenceEndDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)).nullable().optional(),
        notes: z.string().nullable().optional(),
        mode: z.enum(['single', 'future', 'all']).optional()
    });

    const updateAppointmentStatusSchema = z.object({
        status: z.enum(['scheduled', 'confirmed', 'attended', 'canceled', 'no_show'])
    });

    const listAppointmentsQuerySchema = z.object({
        patientId: z.string().uuid().optional(),
        start: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)).optional(),
        end: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)).optional(),
        page: z.string().transform(val => Math.max(1, parseInt(val, 10) || 1)).optional().default('1'),
        limit: z.string().transform(val => Math.min(100, Math.max(1, parseInt(val, 10) || 50))).optional().default('50')
    });

    router.post('/psychotherapy/appointments', validateBody(appointmentSchema), asyncHandler((req, res) => appointmentController.saveAppointment(req, res)));
    router.get('/psychotherapy/appointments', validateQuery(listAppointmentsQuerySchema), asyncHandler((req, res) => appointmentController.listAppointments(req, res)));
    router.delete('/psychotherapy/appointments/:id', validateParams(uuidParamSchema), asyncHandler((req, res) => appointmentController.deleteAppointment(req, res)));
    router.patch('/psychotherapy/appointments/:id/status', validateParams(uuidParamSchema), validateBody(updateAppointmentStatusSchema), asyncHandler((req, res) => appointmentController.updateStatus(req, res)));

    // CSV Exports
    const exportController = container.resolve(ExportController);

    const exportDateRangeQuerySchema = z.object({
        start: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)).optional(),
        end: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)).optional()
    });

    router.get('/psychotherapy/export/months/:month', validateParams(monthParamSchema), asyncHandler((req, res) => exportController.exportMonthlyRecords(req, res)));
    router.get('/psychotherapy/export/sessions', validateQuery(exportDateRangeQuerySchema), asyncHandler((req, res) => exportController.exportSessions(req, res)));
    router.get('/psychotherapy/export/expenses', validateQuery(exportDateRangeQuerySchema), asyncHandler((req, res) => exportController.exportExpenses(req, res)));
    router.get('/psychotherapy/export/receipts', asyncHandler((req, res) => exportController.exportReceipts(req, res)));

    const irReportQuerySchema = z.object({
        year: z.string().regex(/^\d{4}$/, 'Ano deve ter 4 dígitos').refine(
            y => { const n = parseInt(y, 10); return n >= 2020 && n <= 2099; },
            'Ano fora do intervalo permitido (2020–2099)',
        ),
    });
    router.get('/psychotherapy/export/ir-report', validateQuery(irReportQuerySchema), asyncHandler((req, res) => exportController.exportIrReport(req, res)));

    // Availability slots (horários disponíveis do terapeuta)
    const availabilitySlotSchema = z.object({
        id: z.string().uuid().optional(),
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM inválido'),
        durationMinutes: z.number().int().min(10).max(240).optional().default(50),
        isActive: z.boolean().optional().default(true),
        notes: z.string().nullable().optional(),
        recurrenceType: z.enum(['weekly', 'biweekly', 'once']).optional().default('weekly'),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD inválido').nullable().optional(),
        modality: z.enum(['presencial', 'online', 'both']).optional().default('presencial')
    }).superRefine((data, ctx) => {
        if (data.recurrenceType === 'once' && !data.startDate) {
            ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Data obrigatória para slot avulso' });
        }
        if (data.recurrenceType === 'biweekly' && !data.startDate) {
            ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Data de início obrigatória para slot quinzenal' });
        }
    });
    // Token público do terapeuta (autenticado)
    router.get('/psychotherapy/public-booking-token', authMiddleware, asyncHandler((req, res) => bookingController.getPublicBookingToken(req, res)));

    router.get('/psychotherapy/availability', asyncHandler((req, res) => bookingController.listAvailability(req, res)));
    router.post('/psychotherapy/availability', validateBody(availabilitySlotSchema), asyncHandler((req, res) => bookingController.saveAvailability(req, res)));
    router.delete('/psychotherapy/availability/:id', validateParams(uuidParamSchema), asyncHandler((req, res) => bookingController.deleteAvailability(req, res)));

    // Booking links por paciente
    const generateLinkSchema = z.object({
        expiresInDays: z.number().int().min(1).max(365).optional()
    });
    const patientIdParamSchema = z.object({ patientId: z.string().uuid('ID do paciente inválido') });
    router.post('/psychotherapy/patients/:patientId/booking-link', validateParams(patientIdParamSchema), validateBody(generateLinkSchema), asyncHandler((req, res) => bookingController.generateLink(req, res)));
    router.delete('/psychotherapy/patients/:patientId/booking-link', validateParams(patientIdParamSchema), asyncHandler((req, res) => bookingController.deactivateLink(req, res)));

    // Clinical Notes (prontuário)
    const clinicalNoteController = container.resolve(ClinicalNoteController);

    const clinicalNoteSchema = z.object({
        id: z.string().uuid().optional(),
        sessionId: z.string().uuid().nullable().optional(),
        noteDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform(val => new Date(val)),
        content: z.string().min(1, 'O conteúdo da nota é obrigatório'),
        tags: z.array(z.string().max(50)).max(10).optional().default([])
    });

    const listNotesQuerySchema = z.object({
        page: z.string().transform(val => Math.max(1, parseInt(val, 10) || 1)).optional().default('1'),
        limit: z.string().transform(val => Math.min(100, Math.max(1, parseInt(val, 10) || 20))).optional().default('20')
    });

    const patientUuidParamSchema = z.object({
        patientId: z.string().uuid('ID do paciente inválido')
    });

    router.post('/psychotherapy/patients/:patientId/notes', validateParams(patientUuidParamSchema), validateBody(clinicalNoteSchema), asyncHandler((req, res) => clinicalNoteController.saveNote(req, res)));
    router.get('/psychotherapy/patients/:patientId/notes', validateParams(patientUuidParamSchema), validateQuery(listNotesQuerySchema), asyncHandler((req, res) => clinicalNoteController.listNotes(req, res)));
    router.delete('/psychotherapy/notes/:id', validateParams(uuidParamSchema), asyncHandler((req, res) => clinicalNoteController.deleteNote(req, res)));

    // Prontuário estruturado (anamnese + planos terapêuticos)
    const prontuarioController = container.resolve(ProntuarioController);
    const planIdParamSchema = z.object({ patientId: z.string().uuid(), planId: z.string().uuid() });
    const anamnesisBodySchema = z.object({
        chiefComplaint:      z.string().nullable().optional(),
        onsetDescription:    z.string().nullable().optional(),
        previousTreatment:   z.string().nullable().optional(),
        medications:         z.string().nullable().optional(),
        familyHistory:       z.string().nullable().optional(),
        relevantHistory:     z.string().nullable().optional(),
        cidCodes:            z.array(z.string()).optional(),
        therapeuticApproach: z.string().nullable().optional(),
    });
    const treatmentPlanBodySchema = z.object({
        title:          z.string().min(1, 'Título é obrigatório'),
        goals:          z.array(z.string()).optional(),
        approach:       z.string().nullable().optional(),
        targetSessions: z.number().int().positive().nullable().optional(),
        notes:          z.string().nullable().optional(),
    });
    const planStatusBodySchema = z.object({
        status: z.enum(['active', 'completed', 'suspended']),
    });

    router.get('/psychotherapy/patients/:patientId/anamnesis',
        validateParams(patientUuidParamSchema),
        asyncHandler((req, res) => prontuarioController.getAnamnesis(req, res)));
    router.put('/psychotherapy/patients/:patientId/anamnesis',
        validateParams(patientUuidParamSchema),
        validateBody(anamnesisBodySchema),
        asyncHandler((req, res) => prontuarioController.upsertAnamnesis(req, res)));
    router.get('/psychotherapy/patients/:patientId/treatment-plans',
        validateParams(patientUuidParamSchema),
        asyncHandler((req, res) => prontuarioController.listTreatmentPlans(req, res)));
    router.post('/psychotherapy/patients/:patientId/treatment-plans',
        validateParams(patientUuidParamSchema),
        validateBody(treatmentPlanBodySchema),
        asyncHandler((req, res) => prontuarioController.createTreatmentPlan(req, res)));
    router.patch('/psychotherapy/patients/:patientId/treatment-plans/:planId/status',
        validateParams(planIdParamSchema),
        validateBody(planStatusBodySchema),
        asyncHandler((req, res) => prontuarioController.updateTreatmentPlanStatus(req, res)));

    // Pix
    const pixController = container.resolve(PixController);

    const createPixChargeSchema = z.object({
        patientId: z.string().uuid('ID do paciente inválido'),
        monthlyRecordId: z.string().uuid().optional(),
        amountCents: z.number().int().positive('Valor deve ser positivo'),
        description: z.string().min(1, 'Descrição é obrigatória'),
        debtorName: z.string().optional(),
        debtorCpf: z.string().optional(),
        expirationMinutes: z.number().int().min(5).max(1440).optional().default(60)
    });

    router.post('/psychotherapy/pix/charges', validateBody(createPixChargeSchema), asyncHandler((req, res) => pixController.createCharge(req, res)));
    router.get('/psychotherapy/pix/charges', asyncHandler((req, res) => pixController.listCharges(req, res)));

    // ── Grupos de Terapia ─────────────────────────────────────────────────────
    const { GroupController } = require('../controllers/GroupController');
    const groupController: InstanceType<typeof GroupController> = container.resolve(GroupController);

    const groupIdParamSchema = z.object({
        groupId: z.string().uuid('groupId inválido (esperado UUID)')
    });

    const groupSessionSchema = z.object({
        sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'sessionDate deve estar no formato YYYY-MM-DD'),
        sessionNotes: z.string().nullable().optional(),
        attendances: z.array(z.object({
            patientId: z.string().uuid('patientId inválido'),
            status: z.enum(['present', 'absent', 'excused']),
            notes: z.string().nullable().optional(),
            sessionPriceCentsOverride: z.number().int().nonnegative().nullable().optional(),
        })).min(1, 'Informe a presença de ao menos um membro'),
    });

    const listGroupSessionsQuerySchema = z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/, 'Formato de mês inválido (esperado YYYY-MM)').optional(),
    });

    const listGroupMembersQuerySchema = z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/, 'Formato de mês inválido (esperado YYYY-MM)').optional(),
    });

    const addGroupMemberSchema = z.object({
        patientId: z.string().uuid('patientId inválido (esperado UUID)'),
    });

    const groupMemberParamSchema = z.object({
        groupId: z.string().uuid('groupId inválido (esperado UUID)'),
        patientId: z.string().uuid('patientId inválido (esperado UUID)'),
    });

    const listGroupsQuerySchema = z.object({
        includeInactive: z.enum(['true', 'false']).optional(),
    });

    const createGroupSchema = z.object({
        name:               z.string().min(1, 'Nome é obrigatório'),
        description:        z.string().nullable().optional(),
        monthly_fee_cents:  z.number().int().nonnegative('Mensalidade inválida'),
        day_of_week:        z.number().int().min(0).max(6).nullable().optional(),
        start_time:         z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
        duration_minutes:   z.number().int().positive().optional().default(90),
        start_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        duration_months:    z.number().int().positive().nullable().optional(),
    });

    const updateGroupSchema = createGroupSchema.partial().extend({
        is_active:          z.boolean().optional(),
    });

    const registerGroupPaymentSchema = z.object({
        patient_id:         z.string().uuid('patient_id inválido'),
        reference_month:    z.string().regex(/^\d{4}-\d{2}$/, 'Formato YYYY-MM'),
        amount_cents:       z.number().int().positive('Valor inválido'),
        payment_method:     z.enum(['pix', 'cash', 'debit_card', 'credit_card']),
        total_installments: z.number().int().min(1).optional().default(1),
        installment_number: z.number().int().min(1).optional().default(1),
        notes:              z.string().nullable().optional(),
    });

    const deletePaymentParamSchema = z.object({
        groupId:   z.string().uuid(),
        paymentId: z.string().uuid(),
    });

    const updateGroupPaymentSchema = z.object({
        amount_cents:   z.number().int().positive('Valor inválido'),
        payment_method: z.enum(['pix', 'cash', 'debit_card', 'credit_card']),
        notes:          z.string().nullable().optional(),
    });

    const deletePaymentQuerySchema = z.object({
        mode: z.enum(['single', 'all']).optional().default('single'),
    });

    const listGroupPaymentsQuerySchema = z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/, 'Formato de mês inválido (esperado YYYY-MM)').optional(),
    });

    // Listar grupos do paciente
    router.get('/psychotherapy/patients/:patientId/groups',
        validateParams(patientIdParamSchema),
        asyncHandler((req, res) => groupController.listPatientGroups(req, res)));

    // Listar grupos
    router.get('/psychotherapy/groups',
        validateQuery(listGroupsQuerySchema),
        asyncHandler((req, res) => groupController.listGroups(req, res)));

    // Membros de um grupo com status de pagamento do mês (🟢🟡🔴)
    router.get('/psychotherapy/groups/:groupId/members',
        validateParams(groupIdParamSchema),
        validateQuery(listGroupMembersQuerySchema),
        asyncHandler((req, res) => groupController.listGroupMembers(req, res)));

    // Adicionar membro ao grupo
    router.post('/psychotherapy/groups/:groupId/members',
        validateParams(groupIdParamSchema),
        validateBody(addGroupMemberSchema),
        asyncHandler((req, res) => groupController.addGroupMember(req, res)));

    // Remover membro do grupo
    router.delete('/psychotherapy/groups/:groupId/members/:patientId',
        validateParams(groupMemberParamSchema),
        asyncHandler((req, res) => groupController.removeGroupMember(req, res)));

    // Registrar sessão de grupo (presença + faturamento)
    router.post('/psychotherapy/groups/:groupId/sessions',
        validateParams(groupIdParamSchema),
        validateBody(groupSessionSchema),
        asyncHandler((req, res) => groupController.registerGroupSession(req, res)));

    // Histórico de sessões de um grupo
    router.get('/psychotherapy/groups/:groupId/sessions',
        validateParams(groupIdParamSchema),
        validateQuery(listGroupSessionsQuerySchema),
        asyncHandler((req, res) => groupController.listGroupSessions(req, res)));

    // Criar grupo
    router.post('/psychotherapy/groups',
        validateBody(createGroupSchema),
        asyncHandler((req, res) => groupController.createGroup(req, res)));

    // Editar grupo
    router.put('/psychotherapy/groups/:groupId',
        validateParams(groupIdParamSchema),
        validateBody(updateGroupSchema),
        asyncHandler((req, res) => groupController.updateGroup(req, res)));

    // Excluir grupo
    router.delete('/psychotherapy/groups/:groupId',
        validateParams(groupIdParamSchema),
        asyncHandler((req, res) => groupController.deleteGroup(req, res)));

    // Listar pagamentos de grupo
    router.get('/psychotherapy/groups/:groupId/payments',
        validateParams(groupIdParamSchema),
        validateQuery(listGroupPaymentsQuerySchema),
        asyncHandler((req, res) => groupController.listGroupPayments(req, res)));

    // Registrar pagamento de grupo
    router.post('/psychotherapy/groups/:groupId/payments',
        validateParams(groupIdParamSchema),
        validateBody(registerGroupPaymentSchema),
        asyncHandler((req, res) => groupController.registerPayment(req, res)));

    // Editar pagamento de grupo (valor, método, notas)
    router.put('/psychotherapy/groups/:groupId/payments/:paymentId',
        validateParams(deletePaymentParamSchema),
        validateBody(updateGroupPaymentSchema),
        asyncHandler((req, res) => groupController.updatePayment(req, res)));

    // Estornar pagamento de grupo
    router.delete('/psychotherapy/groups/:groupId/payments/:paymentId',
        validateParams(deletePaymentParamSchema),
        validateQuery(deletePaymentQuerySchema),
        asyncHandler((req, res) => groupController.deletePayment(req, res)));

    // ── Lembretes automáticos ─────────────────────────────────────────────────
    // Trigger manual para teste / diagnóstico
    router.post('/psychotherapy/reminders/trigger', authMiddleware, asyncHandler(async (req, res) => {
        const { ReminderScheduler } = require('../../infrastructure/scheduler/ReminderScheduler');
        const { WhatsappSessionManager } = require('@antigravity/whatsapp-core');
        const repository = container.resolve<any>('IPsychotherapyRepository');
        const sessionManager = container.resolve<InstanceType<typeof WhatsappSessionManager>>('WhatsappSessionManager');
        const scheduler = new ReminderScheduler(repository, sessionManager);
        const result = await scheduler.processReminders();
        res.json({ ok: true, result });
    }));

    // Log dos últimos 50 lembretes disparados
    router.get('/psychotherapy/reminders/log', authMiddleware, asyncHandler(async (req, res) => {
        const { Pool } = require('pg');
        const dbPool = container.resolve<InstanceType<typeof Pool>>(Pool);
        const tenantId = (req as any).tenantId;
        const rows = await dbPool.query(
            `SELECT rl.id, rl.appointment_id, rl.channel_used, rl.status, rl.error_message, rl.sent_at,
                    a.scheduled_at, p.name AS patient_name
             FROM psychotherapy_reminders_log rl
             JOIN psychotherapy_appointments a ON a.id = rl.appointment_id
             JOIN psychotherapy_patients p ON p.id = a.patient_id
             WHERE rl.tenant_id = $1
             ORDER BY rl.sent_at DESC
             LIMIT 50`,
            [tenantId]
        );
        res.json({ data: rows.rows });
    }));

    return router;
}

