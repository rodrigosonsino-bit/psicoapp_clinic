import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';
import { inject } from 'tsyringe';
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
        @inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository
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

    private getTenantId(req: Request): string {
        const tenantId = (req as AuthenticatedRequest).tenantId || (req as AuthenticatedRequest).userId;
        if (!tenantId) throw new AppError('Tenant não identificado', 401);
        return tenantId;
    }
}
