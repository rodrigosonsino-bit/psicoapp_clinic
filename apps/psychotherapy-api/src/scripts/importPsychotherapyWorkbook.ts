import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { Pool } from 'pg';
import { unzipSync, strFromU8 } from 'fflate';
import { PatientStatus, PaymentType } from '../domain/models/PsychotherapyPatient';
import { PaymentStatus } from '../domain/models/PsychotherapyMonthlyRecord';
import { logger } from '../infrastructure/logger';

dotenv.config();

interface ImportRow {
    month: string;
    name: string;
    status: PatientStatus;
    paymentType: PaymentType | null;
    sessionPriceCents: number | null;
    paymentStatus: PaymentStatus;
    paidSessions: number;
    absences: number;
    notes: string | null;
    previousMonthPaidCents: number;
}

interface WorkbookSheet {
    name: string;
    rows: unknown[][];
}

const workbookPath = process.argv[2] || process.env.PSYCHOTHERAPY_WORKBOOK_PATH || '';
if (!workbookPath) {
    logger.error(
        'Erro: informe o caminho do arquivo XLSX como argumento ou defina a variável PSYCHOTHERAPY_WORKBOOK_PATH.\n' +
        'Uso: npm run import:workbook -- /caminho/para/arquivo.xlsx'
    );
    process.exit(1);
}
const tenantEmail = process.env.PSYCHOTHERAPY_TENANT_EMAIL;
if (!tenantEmail) {
    logger.error('Erro: defina a variável de ambiente PSYCHOTHERAPY_TENANT_EMAIL com o e-mail do tenant.');
    process.exit(1);
}

const dbPool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('railway.app') || process.env.DATABASE_URL.includes('supabase.com')
            ? { rejectUnauthorized: false }
            : undefined
    })
    : new Pool({
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'whatsapp_scheduler',
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT || '5432', 10)
    });

const statusMap: Record<string, PatientStatus> = {
    semanal: 'weekly',
    quinzenal: 'biweekly',
    avulso: 'one_off',
    inativo: 'inactive'
};

const paymentTypeMap: Record<string, PaymentType> = {
    'por mês': 'monthly',
    'por mes': 'monthly',
    'por sessão': 'per_session',
    'por sessao': 'per_session'
};

async function main(): Promise<void> {
    await ensureSchema();
    const tenantId = await ensureTenant();
    const rows = readWorkbook(workbookPath);

    const patientsByName = new Map<string, string>();
    const latestPatientData = selectLatestPatientRows(rows);

    for (const row of latestPatientData.values()) {
        const patientId = await upsertPatient(tenantId, row);
        patientsByName.set(normalizeName(row.name), patientId);
    }

    for (const row of rows) {
        let patientId = patientsByName.get(normalizeName(row.name));
        if (!patientId) {
            patientId = await upsertPatient(tenantId, row);
            patientsByName.set(normalizeName(row.name), patientId);
        }

        await upsertMonthlyRecord(tenantId, patientId, row);
    }

    const summaries = await dbPool.query(`
        SELECT
            month,
            COUNT(*)::int AS records,
            SUM(CASE WHEN status <> 'inactive' THEN 1 ELSE 0 END)::int AS active_records,
            SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END)::int AS paid_records,
            SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END)::int AS pending_records,
            SUM(COALESCE(session_price_cents, 0) * paid_sessions + previous_month_paid_cents)::int AS received_cents
        FROM psychotherapy_monthly_records
        WHERE tenant_id = $1
        GROUP BY month
        ORDER BY month;
    `, [tenantId]);

    logger.info(`Importação concluída: ${patientsByName.size} pacientes e ${rows.length} registros mensais.`);
    for (const row of summaries.rows) {
        logger.info(`${row.month}: ${row.records} registros, ${row.active_records} ativos, ${row.paid_records} pagos, ${row.pending_records} pendentes, recebido ${formatCurrency(row.received_cents)}`);
    }
}

function readWorkbook(path: string): ImportRow[] {
    const workbook = readXlsx(path);
    const rows: ImportRow[] = [];

    for (const sheet of workbook) {
        const month = parseMonth(sheet.name);
        if (!month) continue;

        for (let index = 1; index < sheet.rows.length; index++) {
            const row = sheet.rows[index];
            const name = text(row[0]);
            if (!name || name.toUpperCase().startsWith('SOMA')) continue;

            const status = statusMap[normalizeText(row[1])];
            if (!status) continue;

            const paymentType = paymentTypeMap[normalizeText(row[2])] || null;
            const sessionPriceCents = parseCurrencyToCents(row[3]);
            const paymentStatus = parsePaymentStatus(row[4], status);
            const paidSessions = parsePaymentCount(row[5], paymentStatus, status);
            const absences = parseInteger(row[6]);
            const notes = text(row[7]) || null;
            const previousMonthPaidCents = parseCurrencyToCents(row[8]) || 0;

            rows.push({
                month,
                name,
                status,
                paymentType,
                sessionPriceCents,
                paymentStatus,
                paidSessions,
                absences,
                notes,
                previousMonthPaidCents
            });
        }
    }

    return rows;
}

function readXlsx(path: string): WorkbookSheet[] {
    const zip = unzipSync(fs.readFileSync(path));
    const readZipText = (name: string): string => {
        const entry = zip[name];
        if (!entry) throw new Error(`Arquivo interno não encontrado no XLSX: ${name}`);
        return strFromU8(entry);
    };

    const workbookXml = readZipText('xl/workbook.xml');
    const workbookRelsXml = readZipText('xl/_rels/workbook.xml.rels');
    const sharedStringsXml = zip['xl/sharedStrings.xml'] ? strFromU8(zip['xl/sharedStrings.xml']) : '';
    const sharedStrings = parseSharedStrings(sharedStringsXml);
    const relationships = parseRelationships(workbookRelsXml);
    const sheets = parseWorkbookSheets(workbookXml);

    return sheets.map(sheet => {
        const target = relationships.get(sheet.relationshipId);
        if (!target) throw new Error(`Relacionamento não encontrado para aba ${sheet.name}`);
        const normalizedTarget = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^xl\//, '')}`;
        return {
            name: sheet.name,
            rows: parseWorksheet(readZipText(normalizedTarget), sharedStrings)
        };
    });
}

function parseWorkbookSheets(xml: string): Array<{ name: string; relationshipId: string }> {
    const sheets: Array<{ name: string; relationshipId: string }> = [];
    const sheetRegex = /<sheet\b([^>]*)\/>/g;
    let match: RegExpExecArray | null;

    while ((match = sheetRegex.exec(xml))) {
        const attrs = parseAttributes(match[1]);
        if (attrs.name && attrs['r:id']) {
            sheets.push({ name: decodeXml(attrs.name), relationshipId: attrs['r:id'] });
        }
    }

    return sheets;
}

function parseRelationships(xml: string): Map<string, string> {
    const relationships = new Map<string, string>();
    const relRegex = /<Relationship\b([^>]*)\/>/g;
    let match: RegExpExecArray | null;

    while ((match = relRegex.exec(xml))) {
        const attrs = parseAttributes(match[1]);
        if (attrs.Id && attrs.Target) {
            relationships.set(attrs.Id, decodeXml(attrs.Target));
        }
    }

    return relationships;
}

function parseSharedStrings(xml: string): string[] {
    if (!xml) return [];

    const strings: string[] = [];
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let match: RegExpExecArray | null;

    while ((match = siRegex.exec(xml))) {
        const textParts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
            .map(part => decodeXml(part[1]));
        strings.push(textParts.join(''));
    }

    return strings;
}

function parseWorksheet(xml: string, sharedStrings: string[]): unknown[][] {
    const rows: unknown[][] = [];
    const rowRegex = /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(xml))) {
        const rowIndex = Number(rowMatch[1]) - 1;
        const row: unknown[] = [];
        const cellRegex = /<c\b([^>\/]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
        let cellMatch: RegExpExecArray | null;

        while ((cellMatch = cellRegex.exec(rowMatch[2]))) {
            const attrs = parseAttributes(cellMatch[1] || cellMatch[2]);
            const columnIndex = columnNameToIndex((attrs.r || '').replace(/\d+/g, ''));
            if (columnIndex < 0) continue;
            row[columnIndex] = cellMatch[1] ? '' : parseCellValue(attrs, cellMatch[3], sharedStrings);
        }

        rows[rowIndex] = row;
    }

    return rows.map(row => row || []);
}

function parseCellValue(attrs: Record<string, string>, body: string, sharedStrings: string[]): unknown {
    if (attrs.t === 'inlineStr') {
        const inlineMatch = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        return inlineMatch ? decodeXml(inlineMatch[1]) : '';
    }

    const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
    if (!valueMatch) return '';

    const value = decodeXml(valueMatch[1]);
    if (attrs.t === 's') return sharedStrings[Number(value)] || '';
    if (attrs.t === 'str') return value;

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
}

function parseAttributes(source: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const attrRegex = /([\w:]+)="([^"]*)"/g;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(source))) {
        attrs[match[1]] = match[2];
    }

    return attrs;
}

function columnNameToIndex(columnName: string): number {
    if (!columnName) return -1;
    let index = 0;
    for (const char of columnName) {
        index = index * 26 + char.toUpperCase().charCodeAt(0) - 64;
    }
    return index - 1;
}

function selectLatestPatientRows(rows: ImportRow[]): Map<string, ImportRow> {
    const selected = new Map<string, ImportRow>();
    for (const row of rows.sort((a, b) => a.month.localeCompare(b.month))) {
        selected.set(normalizeName(row.name), row);
    }
    return selected;
}

async function ensureSchema(): Promise<void> {
    await dbPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS tenants (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            plan VARCHAR(50) DEFAULT 'starter',
            status VARCHAR(20) DEFAULT 'trial',
            max_messages_per_month INT DEFAULT 200,
            whatsapp_connected BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS psychotherapy_patients (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            status VARCHAR(20) NOT NULL CHECK (status IN ('weekly', 'biweekly', 'one_off', 'inactive')),
            payment_type VARCHAR(20) CHECK (payment_type IN ('monthly', 'per_session')),
            default_session_price_cents INT CHECK (default_session_price_cents IS NULL OR default_session_price_cents >= 0),
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_psychotherapy_patients_tenant ON psychotherapy_patients(tenant_id, name);

        CREATE TABLE IF NOT EXISTS psychotherapy_monthly_records (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            patient_id UUID REFERENCES psychotherapy_patients(id) ON DELETE SET NULL,
            month CHAR(7) NOT NULL CHECK (month ~ '^\\d{4}-\\d{2}$'),
            patient_name_snapshot VARCHAR(255) NOT NULL,
            status VARCHAR(20) NOT NULL CHECK (status IN ('weekly', 'biweekly', 'one_off', 'inactive')),
            payment_type VARCHAR(20) CHECK (payment_type IN ('monthly', 'per_session')),
            session_price_cents INT CHECK (session_price_cents IS NULL OR session_price_cents >= 0),
            expected_sessions INT NOT NULL DEFAULT 0 CHECK (expected_sessions >= 0),
            paid_sessions INT NOT NULL DEFAULT 0 CHECK (paid_sessions >= 0),
            absences INT NOT NULL DEFAULT 0 CHECK (absences >= 0),
            payment_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('paid', 'pending', 'partial')),
            notes TEXT,
            previous_month_paid_cents INT NOT NULL DEFAULT 0 CHECK (previous_month_paid_cents >= 0),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_psychotherapy_monthly_patient
            ON psychotherapy_monthly_records(tenant_id, month, patient_id)
            WHERE patient_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_psychotherapy_monthly_tenant_month
            ON psychotherapy_monthly_records(tenant_id, month);
    `);
}

async function ensureTenant(): Promise<string> {
    const result = await dbPool.query(`
        INSERT INTO tenants (name, email, password_hash, plan, status, max_messages_per_month)
        VALUES ('Rodrigo', $1, $2, 'business', 'active', 5000)
        ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
        RETURNING id::text;
    `, [tenantEmail, process.env.DEV_ADMIN_PASSWORD_HASH || 'local-import-only']);
    return result.rows[0].id;
}

async function upsertPatient(tenantId: string, row: ImportRow): Promise<string> {
    const existing = await dbPool.query(`
        SELECT id::text
        FROM psychotherapy_patients
        WHERE tenant_id = $1 AND lower(name) = lower($2)
        LIMIT 1;
    `, [tenantId, row.name]);

    if (existing.rows[0]) {
        await dbPool.query(`
            UPDATE psychotherapy_patients
            SET status = $3,
                payment_type = $4,
                default_session_price_cents = $5,
                notes = COALESCE($6, notes),
                updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2;
        `, [tenantId, existing.rows[0].id, row.status, row.paymentType, row.sessionPriceCents, row.notes]);
        return existing.rows[0].id;
    }

    const inserted = await dbPool.query(`
        INSERT INTO psychotherapy_patients (
            tenant_id, name, status, payment_type, default_session_price_cents, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id::text;
    `, [tenantId, row.name, row.status, row.paymentType, row.sessionPriceCents, row.notes]);

    return inserted.rows[0].id;
}

async function upsertMonthlyRecord(tenantId: string, patientId: string, row: ImportRow): Promise<void> {
    await dbPool.query(`
        INSERT INTO psychotherapy_monthly_records (
            tenant_id, patient_id, month, patient_name_snapshot, status, payment_type,
            session_price_cents, expected_sessions, paid_sessions, absences,
            payment_status, notes, previous_month_paid_cents
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (tenant_id, month, patient_id) WHERE patient_id IS NOT NULL DO UPDATE SET
            patient_name_snapshot = EXCLUDED.patient_name_snapshot,
            status = EXCLUDED.status,
            payment_type = EXCLUDED.payment_type,
            session_price_cents = EXCLUDED.session_price_cents,
            expected_sessions = EXCLUDED.expected_sessions,
            paid_sessions = EXCLUDED.paid_sessions,
            absences = EXCLUDED.absences,
            payment_status = EXCLUDED.payment_status,
            notes = EXCLUDED.notes,
            previous_month_paid_cents = EXCLUDED.previous_month_paid_cents,
            updated_at = NOW();
    `, [
        tenantId,
        patientId,
        row.month,
        row.name,
        row.status,
        row.paymentType,
        row.sessionPriceCents,
        expectedSessions(row.status, row.paidSessions),
        row.paidSessions,
        row.absences,
        row.paymentStatus,
        row.notes,
        row.previousMonthPaidCents
    ]);
}

function parseMonth(sheetName: string): string | null {
    const normalized = normalizeText(sheetName);
    const match = normalized.match(/^(janeiro|jan|fevereiro|fev|marco|março|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez)(\d{2})$/);
    if (!match) return null;

    const monthIndex: Record<string, string> = {
        janeiro: '01', jan: '01',
        fevereiro: '02', fev: '02',
        marco: '03', março: '03', mar: '03',
        abril: '04', abr: '04',
        maio: '05', mai: '05',
        junho: '06', jun: '06',
        julho: '07', jul: '07',
        agosto: '08', ago: '08',
        setembro: '09', set: '09',
        outubro: '10', out: '10',
        novembro: '11', nov: '11',
        dezembro: '12', dez: '12'
    };

    return `20${match[2]}-${monthIndex[match[1]]}`;
}

function parseCurrencyToCents(value: unknown): number | null {
    const raw = text(value).replace(/[R$\s]/g, '');
    if (!raw) return null;

    const normalized = raw.includes(',')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100);
}

function parsePaymentStatus(value: unknown, status: PatientStatus): PaymentStatus {
    if (status === 'inactive') return 'paid';
    const normalized = normalizeText(value);
    if (normalized === 'pago') return 'paid';
    if (normalized === 'parcial') return 'partial';
    return 'pending';
}

function parsePaymentCount(value: unknown, paymentStatus: PaymentStatus, status: PatientStatus): number {
    const parsed = parseInteger(value);
    if (parsed > 0) return parsed;
    if (status === 'one_off' && paymentStatus === 'paid') return 1;
    return 0;
}

function parseInteger(value: unknown): number {
    const match = text(value).match(/\d+/);
    return match ? Number(match[0]) : 0;
}

function expectedSessions(status: PatientStatus, paidSessions: number): number {
    if (status === 'weekly') return 4;
    if (status === 'biweekly') return 2;
    if (status === 'one_off') return Math.max(1, paidSessions);
    return 0;
}

function normalizeName(value: string): string {
    return normalizeText(value);
}

function normalizeText(value: unknown): string {
    return text(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function text(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function decodeXml(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function formatCurrency(cents: number): string {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format((cents || 0) / 100);
}

main()
    .catch((error) => {
        logger.error({ err: error }, 'Erro na importação');
        process.exitCode = 1;
    })
    .finally(async () => {
        await dbPool.end();
    });
