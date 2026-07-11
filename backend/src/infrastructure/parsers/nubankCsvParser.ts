import { parse as csvParse } from 'csv-parse/sync';

export interface ParsedBankTransaction {
    fitid: string;
    postedAt: string; // 'YYYY-MM-DD'
    amountCents: number;
    rawDescription: string;
    payerNameGuess: string | null;
    /** Dígitos extraídos do documento do pagador — 6 dígitos do meio do CPF
     * mascarado, ou os 14 dígitos completos do CNPJ. null se não identificado. */
    payerDocDigits: string | null;
    payerDocType: 'cpf_masked' | 'cnpj' | null;
}

export interface ParseNubankCsvResult {
    transactions: ParsedBankTransaction[];
    skippedLineCount: number;
    periodStart: string | null;
    periodEnd: string | null;
}

const EXPECTED_HEADER = ['Data', 'Valor', 'Identificador', 'Descrição'];
const MAX_ROWS = 5000;

// Âncora nos 2 padrões confirmados com extrato real (ver
// docs/bank-statement-reconciliation-plan.md, seção 2). O caractere de
// máscara do CPF é especificamente '•' (U+2022 BULLET), não asterisco.
const DESCRIPTION_PATTERN =
    /^Transferência (?:recebida pelo Pix|Recebida) - (.+?) - ([•0-9][\d.\/•-]*) - /u;

const CPF_MASK_PATTERN = /\.(\d{3})\.(\d{3})-/;
const CNPJ_PATTERN = /^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})$/;

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parseia AAAA-MM-DD estrito a partir de DD/MM/AAAA — nunca usa
 * `new Date(string)`, que aceita formatos ambíguos/inválidos e pode
 * interpretar DD/MM como MM/DD dependendo do locale do processo.
 */
function parseStrictDateBR(value: string): string | null {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    if (!match) return null;

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    // Round-trip via Date.UTC pra rejeitar dias inválidos (ex: 31/02).
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
        return null;
    }

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Converte "7200.00" / "-20.00" pra centavos via manipulação de string —
 * nunca `parseFloat(valor) * 100`, que introduz erro de ponto flutuante
 * (ex: 0.1 + 0.2 !== 0.3 em JS) em valor financeiro.
 */
function parseAmountToCents(value: string): number | null {
    const match = /^(-?)(\d+)\.(\d{2})$/.exec(value.trim());
    if (!match) return null;

    const [, sign, intPart, fracPart] = match;
    const cents = parseInt(intPart, 10) * 100 + parseInt(fracPart, 10);
    return sign === '-' ? -cents : cents;
}

function extractPayerInfo(description: string): {
    payerNameGuess: string | null;
    payerDocDigits: string | null;
    payerDocType: 'cpf_masked' | 'cnpj' | null;
} {
    const match = DESCRIPTION_PATTERN.exec(description);
    if (!match) {
        return { payerNameGuess: null, payerDocDigits: null, payerDocType: null };
    }

    const [, name, doc] = match;

    const cnpjMatch = CNPJ_PATTERN.exec(doc);
    if (cnpjMatch) {
        return {
            payerNameGuess: name.trim(),
            payerDocDigits: cnpjMatch.slice(1).join(''),
            payerDocType: 'cnpj'
        };
    }

    const cpfMatch = CPF_MASK_PATTERN.exec(doc);
    if (cpfMatch) {
        return {
            payerNameGuess: name.trim(),
            payerDocDigits: cpfMatch[1] + cpfMatch[2],
            payerDocType: 'cpf_masked'
        };
    }

    // Nome reconhecido mas documento em formato não identificado — ainda
    // assim retorna o nome, só sem reforço de documento.
    return { payerNameGuess: name.trim(), payerDocDigits: null, payerDocType: null };
}

/**
 * Parser estrito do CSV exportado pelo Nubank (Data,Valor,Identificador,Descrição).
 * Só processa transações de crédito (Valor > 0). Linha que não bate as 4
 * colunas esperadas, ou tem data/valor inválido, é pulada e contada em
 * skippedLineCount — nunca aborta o import inteiro.
 */
export function parseNubankCsv(fileBuffer: Buffer): ParseNubankCsvResult {
    const text = stripBom(fileBuffer.toString('utf8')).replace(/\r\n/g, '\n');

    let rows: string[][];
    try {
        rows = csvParse(text, {
            columns: false,
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true
        }) as string[][];
    } catch {
        return { transactions: [], skippedLineCount: 0, periodStart: null, periodEnd: null };
    }

    if (rows.length === 0) {
        return { transactions: [], skippedLineCount: 0, periodStart: null, periodEnd: null };
    }

    const header = rows[0].map(h => h.trim());
    const headerOk = EXPECTED_HEADER.every((expected, i) => header[i]?.toLowerCase() === expected.toLowerCase());
    if (!headerOk) {
        throw new Error(
            `Cabeçalho do CSV não reconhecido — esperado "${EXPECTED_HEADER.join(',')}", recebido "${header.join(',')}"`
        );
    }

    const dataRows = rows.slice(1, 1 + MAX_ROWS);
    const transactions: ParsedBankTransaction[] = [];
    let skippedLineCount = 0;
    let periodStart: string | null = null;
    let periodEnd: string | null = null;

    for (const row of dataRows) {
        // Linha estrita de 4 colunas — coluna a mais/a menos vira skip, não
        // corrompe o parsing das colunas seguintes.
        if (row.length !== 4) {
            skippedLineCount++;
            continue;
        }

        const [dataRaw, valorRaw, identificadorRaw, descricaoRaw] = row;

        const postedAt = parseStrictDateBR(dataRaw);
        const amountCents = parseAmountToCents(valorRaw);
        const fitid = identificadorRaw?.trim().toLowerCase();

        if (!postedAt || amountCents === null || !fitid) {
            skippedLineCount++;
            continue;
        }

        // Só crédito — débito nem chega a ser regex-parseado pra extração de nome.
        if (amountCents <= 0) continue;

        const rawDescription = descricaoRaw?.trim() ?? '';
        const { payerNameGuess, payerDocDigits, payerDocType } = extractPayerInfo(rawDescription);

        transactions.push({
            fitid,
            postedAt,
            amountCents,
            rawDescription,
            payerNameGuess,
            payerDocDigits,
            payerDocType
        });

        if (!periodStart || postedAt < periodStart) periodStart = postedAt;
        if (!periodEnd || postedAt > periodEnd) periodEnd = postedAt;
    }

    return { transactions, skippedLineCount, periodStart, periodEnd };
}
