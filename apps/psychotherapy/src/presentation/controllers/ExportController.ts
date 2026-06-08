import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { Pool } from 'pg';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { AppError } from '../../domain/errors/AppError';

function escapeCsv(value: unknown): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function toCsvRow(fields: unknown[]): string {
    return fields.map(escapeCsv).join(',');
}

function formatCents(cents: number): string {
    return (cents / 100).toFixed(2).replace('.', ',');
}

function formatDate(date: Date): string {
    return date.toLocaleDateString('pt-BR');
}

@injectable()
export class ExportController {
    constructor(
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository,
        @inject(Pool) private readonly dbPool: Pool,
    ) {}

    async exportMonthlyRecords(req: Request, res: Response): Promise<void> {
        const tenantId = this.getTenantId(req);
        const { month } = req.params;

        const records = await this.repository.listMonthlyRecords(tenantId, month);

        const header = toCsvRow([
            'Paciente', 'Status', 'Tipo Pagamento', 'Sessões Esperadas',
            'Sessões Pagas', 'Faltas', 'Status Pagamento',
            'Valor Esperado (R$)', 'Valor Recebido (R$)', 'Valor Pendente (R$)', 'Observações'
        ]);

        const rows = records.map(r => toCsvRow([
            r.patientNameSnapshot,
            r.status,
            r.paymentType ?? '',
            r.expectedSessions,
            r.paidSessions,
            r.absences,
            r.paymentStatus,
            formatCents(r.expectedAmountCents),
            formatCents(r.receivedAmountCents),
            formatCents(r.pendingAmountCents),
            r.notes ?? ''
        ]));

        const csv = [header, ...rows].join('\r\n');
        const filename = `registros-${month}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.write('﻿'); // BOM para Excel reconhecer UTF-8
        res.end(csv);
    }

    async exportSessions(req: Request, res: Response): Promise<void> {
        const tenantId = this.getTenantId(req);
        const { start, end, patientId } = req.query as any;

        const result = await this.repository.listSessions(tenantId, patientId, start, end, { page: 1, limit: 10000 });

        const header = toCsvRow(['Data', 'Paciente ID', 'Status', 'Observações']);

        const rows = result.data.map(s => toCsvRow([
            formatDate(s.date),
            s.patientId,
            s.status,
            s.notes ?? ''
        ]));

        const csv = [header, ...rows].join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="sessoes.csv"');
        res.write('﻿');
        res.end(csv);
    }

    async exportExpenses(req: Request, res: Response): Promise<void> {
        const tenantId = this.getTenantId(req);
        const { start, end } = req.query as any;

        const result = await this.repository.listExpenses(tenantId, start, end, { page: 1, limit: 10000 });

        const header = toCsvRow(['Data', 'Descrição', 'Categoria', 'Valor (R$)']);

        const rows = result.data.map(e => toCsvRow([
            formatDate(e.date),
            e.description,
            e.category,
            formatCents(e.amountCents)
        ]));

        const csv = [header, ...rows].join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="despesas.csv"');
        res.write('﻿');
        res.end(csv);
    }

    async exportReceipts(req: Request, res: Response): Promise<void> {
        const tenantId = this.getTenantId(req);
        const { patientId } = req.query as any;

        const receipts = await this.repository.listReceipts(tenantId, patientId);

        const header = toCsvRow(['Nº Recibo', 'Paciente ID', 'Data Emissão', 'Descrição', 'Valor (R$)']);

        const rows = receipts.map(r => toCsvRow([
            r.receiptNumber,
            r.patientId,
            formatDate(r.issueDate),
            r.description,
            formatCents(r.amountCents)
        ]));

        const csv = [header, ...rows].join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="recibos.csv"');
        res.write('﻿');
        res.end(csv);
    }

    async exportIrReport(req: Request, res: Response): Promise<void> {
        const tenantId = this.getTenantId(req);
        const year = parseInt(req.query.year as string, 10);

        const client = await this.dbPool.connect();
        try {
            // 1. Perfil do tenant (para cabeçalho do PDF)
            const tenantResult = await client.query(
                `SELECT name, full_name, document, professional_id, address, email
                 FROM tenants WHERE id = $1`,
                [tenantId],
            );
            const t = tenantResult.rows[0];

            // 2. Receita mensal (registros de faturamento)
            const revenueResult = await client.query<{ month: string; revenue_cents: string }>(
                `SELECT mr.month,
                        COALESCE(SUM(mr.received_amount_cents), 0)::bigint AS revenue_cents
                 FROM psychotherapy_monthly_records mr
                 WHERE mr.tenant_id = $1
                   AND EXTRACT(YEAR FROM mr.month::date)::int = $2
                 GROUP BY mr.month
                 ORDER BY mr.month`,
                [tenantId, year],
            );

            // 3. Despesas mensais
            const expensesResult = await client.query<{ month: string; expenses_cents: string }>(
                `SELECT TO_CHAR(DATE_TRUNC('month', date), 'YYYY-MM') AS month,
                        COALESCE(SUM(amount_cents), 0)::bigint AS expenses_cents
                 FROM psychotherapy_expenses
                 WHERE tenant_id = $1
                   AND EXTRACT(YEAR FROM date)::int = $2
                 GROUP BY 1
                 ORDER BY 1`,
                [tenantId, year],
            );

            // 4. Resumo por paciente
            const patientsResult = await client.query<{
                patient_id: string;
                patient_name: string;
                patient_full_name: string | null;
                document: string | null;
                total_paid_cents: string;
                session_count: string;
                months: string[];
            }>(
                `SELECT
                     p.id                                                    AS patient_id,
                     p.name                                                  AS patient_name,
                     p.full_name                                             AS patient_full_name,
                     p.document,
                     COALESCE(SUM(mr.received_amount_cents), 0)::bigint      AS total_paid_cents,
                     COALESCE(SUM(mr.paid_sessions), 0)::bigint              AS session_count,
                     ARRAY_AGG(mr.month ORDER BY mr.month)                   AS months
                 FROM psychotherapy_monthly_records mr
                 JOIN psychotherapy_patients p ON p.id = mr.patient_id
                 WHERE mr.tenant_id = $1
                   AND EXTRACT(YEAR FROM mr.month::date)::int = $2
                   AND mr.received_amount_cents > 0
                 GROUP BY p.id, p.name, p.full_name, p.document
                 ORDER BY p.name`,
                [tenantId, year],
            );

            // Monta breakdown mensal mesclando receita e despesas
            const revenueMap = new Map(revenueResult.rows.map(r => [r.month, parseInt(r.revenue_cents, 10)]));
            const expensesMap = new Map(expensesResult.rows.map(e => [e.month, parseInt(e.expenses_cents, 10)]));
            const allMonths = [...new Set([...revenueMap.keys(), ...expensesMap.keys()])].sort();

            const monthlyBreakdown = allMonths.map(month => ({
                month,
                revenueCents:   revenueMap.get(month)   ?? 0,
                expensesCents:  expensesMap.get(month)  ?? 0,
            }));

            const totalRevenueCents  = [...revenueMap.values()].reduce((s, v) => s + v, 0);
            const totalExpensesCents = [...expensesMap.values()].reduce((s, v) => s + v, 0);

            res.json({
                year,
                tenant: {
                    name:           t.name,
                    fullName:       t.full_name     ?? null,
                    document:       t.document      ?? null,
                    professionalId: t.professional_id ?? null,
                    address:        t.address       ?? null,
                    email:          t.email,
                },
                summary: {
                    totalRevenueCents,
                    totalExpensesCents,
                    netIncomeCents: totalRevenueCents - totalExpensesCents,
                    monthlyBreakdown,
                },
                patientSummaries: patientsResult.rows.map(r => ({
                    patientId:      r.patient_id,
                    patientName:    r.patient_name,
                    patientFullName: r.patient_full_name ?? null,
                    document:       r.document,
                    totalPaidCents: parseInt(r.total_paid_cents, 10),
                    sessionCount:   parseInt(r.session_count, 10),
                    months:         r.months,
                })),
            });
        } finally {
            client.release();
        }
    }

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }
}
