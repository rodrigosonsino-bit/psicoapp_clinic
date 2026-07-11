#!/usr/bin/env node
/**
 * import_patients_csv.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Importa pacientes de uma planilha CSV para o PsicoApp via API REST.
 *
 * USO:
 *   node import_patients_csv.js --file pacientes.csv --token <jwt> [--dry-run] [--group-id <uuid>]
 *
 * FORMATO DO CSV (padrão, separado por vírgula ou ponto-e-vírgula):
 *   nome,telefone,email,tipo_pagamento,preco_sessao,status,observacoes
 *
 *   - nome          : obrigatório
 *   - telefone      : opcional — ex: "11999999999" ou "+5511999999999"
 *   - email         : opcional
 *   - tipo_pagamento: "mensal" ou "por_sessao" (default: "por_sessao")
 *   - preco_sessao  : valor em R$ (ex: "150" ou "150,00") — converte para centavos
 *   - status        : "semanal" | "quinzenal" | "avulso" | "inativo" (default: "semanal")
 *   - observacoes   : texto livre, opcional
 *
 * OPÇÕES:
 *   --file <path>     Caminho do arquivo CSV (obrigatório)
 *   --token <jwt>     JWT de autenticação (ou use a variável de ambiente API_TOKEN)
 *   --base-url <url>  URL base da API (padrão: http://localhost:3333)
 *   --dry-run         Apenas valida e mostra o que seria importado, sem enviar
 *   --group-id <uuid> Adicionar todos os pacientes importados a este grupo
 *   --delimiter <,|;> Delimitador do CSV (default: auto-detecta)
 *   --skip-header     Pular a primeira linha (default: true)
 *   --match-existing  Tenta encontrar paciente existente por nome (ILIKE) antes de criar
 *
 * SAÍDA:
 *   - Relatório linha a linha: ✅ criado | ⚠️ já existe | ❌ erro
 *   - Resumo final com totais
 *   - Salva import_report_<timestamp>.json com todos os resultados
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const https    = require('https');
const http     = require('http');

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, fallback = null) {
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
        return args[idx + 1];
    }
    return fallback;
}
function hasFlag(name) { return args.includes(`--${name}`); }

const CSV_FILE    = getArg('file');
const JWT_TOKEN   = getArg('token') || process.env.API_TOKEN;
const BASE_URL    = getArg('base-url', 'http://localhost:3333');
const DRY_RUN     = hasFlag('dry-run');
const GROUP_ID    = getArg('group-id');
const SKIP_HEADER = !hasFlag('no-skip-header');
const MATCH_EXISTING = hasFlag('match-existing');
let   DELIMITER   = getArg('delimiter');

if (!CSV_FILE) {
    console.error('❌ --file é obrigatório. Ex: node import_patients_csv.js --file pacientes.csv --token <jwt>');
    process.exit(1);
}
if (!JWT_TOKEN && !DRY_RUN) {
    console.error('❌ --token (ou variável de ambiente API_TOKEN) é obrigatório para enviar dados.');
    process.exit(1);
}
if (!fs.existsSync(CSV_FILE)) {
    console.error(`❌ Arquivo não encontrado: ${CSV_FILE}`);
    process.exit(1);
}

// ── CSV Parser ─────────────────────────────────────────────────────────────────

function detectDelimiter(line) {
    const semicolons = (line.match(/;/g) || []).length;
    const commas     = (line.match(/,/g) || []).length;
    return semicolons >= commas ? ';' : ',';
}

function parseCSVLine(line, delimiter) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === delimiter && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

// ── Data normalization ─────────────────────────────────────────────────────────

const STATUS_MAP = {
    'semanal':    'weekly',
    'quinzenal':  'biweekly',
    'avulso':     'one_off',
    'avulsa':     'one_off',
    'one_off':    'one_off',
    'inativo':    'inactive',
    'inactive':   'inactive',
    'weekly':     'weekly',
    'biweekly':   'biweekly',
};

const PAYMENT_MAP = {
    'mensal':       'monthly',
    'monthly':      'monthly',
    'por_sessao':   'per_session',
    'por sessão':   'per_session',
    'per_session':  'per_session',
    'sessão':       'per_session',
    'sessao':       'per_session',
};

function normalizePhone(raw) {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    // Normalize to E.164-like format for Brazil
    if (digits.length === 11 && digits.startsWith('0')) return `+55${digits.slice(1)}`;
    if (digits.length === 11) return `+55${digits}`;
    if (digits.length === 13 && digits.startsWith('55')) return `+${digits}`;
    if (digits.length === 14 && digits.startsWith('055')) return `+${digits.slice(1)}`;
    return digits; // return as-is if unknown format
}

function normalizePrice(raw) {
    if (!raw) return null;
    // "R$ 150,00" → 15000 cents
    const cleaned = raw.replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.').trim();
    const value = parseFloat(cleaned);
    if (isNaN(value) || value < 0) return null;
    return Math.round(value * 100);
}

function normalizeRow(fields, headers) {
    const get = (key) => {
        const idx = headers.indexOf(key);
        return idx >= 0 ? (fields[idx] || '').trim() : '';
    };

    const name = get('nome') || get('name') || fields[0]?.trim();
    if (!name) return null;

    const rawStatus    = (get('status') || 'semanal').toLowerCase();
    const rawPayment   = (get('tipo_pagamento') || get('payment_type') || 'por_sessao').toLowerCase();
    const rawPhone     = get('telefone') || get('phone');
    const rawEmail     = get('email');
    const rawPrice     = get('preco_sessao') || get('price') || get('valor');
    const rawNotes     = get('observacoes') || get('notes');

    return {
        name,
        status:                   STATUS_MAP[rawStatus]  || 'weekly',
        paymentType:              PAYMENT_MAP[rawPayment] || 'per_session',
        phone:                    normalizePhone(rawPhone),
        email:                    rawEmail || null,
        defaultSessionPriceCents: normalizePrice(rawPrice),
        notes:                    rawNotes || null,
    };
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function apiRequest(method, urlPath, body = null) {
    return new Promise((resolve, reject) => {
        const fullUrl = `${BASE_URL}${urlPath}`;
        const url = new URL(fullUrl);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;

        const bodyStr = body ? JSON.stringify(body) : null;
        const options = {
            hostname: url.hostname,
            port:     url.port || (isHttps ? 443 : 80),
            path:     url.pathname + url.search,
            method,
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${JWT_TOKEN}`,
                ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
            },
        };

        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = data ? JSON.parse(data) : null;
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        reject(new Error(parsed?.error || parsed?.message || `HTTP ${res.statusCode}`));
                    }
                } catch {
                    reject(new Error(`Resposta inválida do servidor: ${data.slice(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

// ── Patient matching ──────────────────────────────────────────────────────────
// Uses the API to search for existing patients by name (ILIKE match)

async function findExistingPatient(name) {
    try {
        const encoded = encodeURIComponent(name);
        const res = await apiRequest('GET', `/api/psychotherapy/patients?search=${encoded}&limit=5`);
        const patients = res?.data ?? res ?? [];
        if (!Array.isArray(patients)) return null;

        // Exact match first
        const exact = patients.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (exact) return exact;

        // Partial match — only if unambiguous (1 result)
        if (patients.length === 1) return patients[0];

        // Multiple partial matches — cannot auto-bind (avoid clinical error)
        if (patients.length > 1) {
            console.log(`  ⚠️  Múltiplos pacientes encontrados para "${name}":`,
                patients.map(p => p.name).join(', '));
            console.log(`     Nenhum será vinculado automaticamente — requer confirmação manual.`);
            return 'AMBIGUOUS';
        }

        return null;
    } catch {
        return null;
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log(' 📋  PsicoApp — Importação de Pacientes CSV');
    console.log('═'.repeat(60));
    console.log(`  Arquivo : ${path.resolve(CSV_FILE)}`);
    console.log(`  Destino : ${BASE_URL}`);
    console.log(`  Modo    : ${DRY_RUN ? '🔍 DRY RUN (sem alterações)' : '🚀 IMPORTAÇÃO REAL'}`);
    if (GROUP_ID)  console.log(`  Grupo   : ${GROUP_ID}`);
    console.log('─'.repeat(60) + '\n');

    // ── Read CSV ──────────────────────────────────────────────────────────────
    const rawLines = fs.readFileSync(CSV_FILE, 'utf8').split(/\r?\n/).filter(l => l.trim());

    if (rawLines.length === 0) {
        console.error('❌ Arquivo CSV vazio.');
        process.exit(1);
    }

    // Auto-detect delimiter from first line
    if (!DELIMITER) DELIMITER = detectDelimiter(rawLines[0]);
    console.log(`  Delimitador detectado: "${DELIMITER}"\n`);

    // Parse header
    const headerLine = SKIP_HEADER ? rawLines[0] : null;
    const headers = headerLine
        ? parseCSVLine(headerLine.toLowerCase(), DELIMITER)
        : ['nome', 'telefone', 'email', 'tipo_pagamento', 'preco_sessao', 'status', 'observacoes'];

    const dataLines = SKIP_HEADER ? rawLines.slice(1) : rawLines;

    // ── Process each row ──────────────────────────────────────────────────────
    const results = [];
    let created = 0, skipped = 0, errors = 0, ambiguous = 0;

    for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i];
        if (!line.trim()) continue;

        const fields = parseCSVLine(line, DELIMITER);
        const data   = normalizeRow(fields, headers);

        if (!data) {
            console.log(`  [Linha ${i + 2}] ⏭️  Pulada — nome vazio`);
            skipped++;
            results.push({ line: i + 2, status: 'skipped', reason: 'nome vazio', raw: line });
            continue;
        }

        process.stdout.write(`  [Linha ${i + 2}] ${data.name.padEnd(30)} `);

        // ── Match existing patient if requested ───────────────────────────────
        if (MATCH_EXISTING && !DRY_RUN) {
            const existing = await findExistingPatient(data.name);
            if (existing === 'AMBIGUOUS') {
                console.log(`⚠️  Ambíguo — requer confirmação manual`);
                ambiguous++;
                results.push({ line: i + 2, status: 'ambiguous', data, raw: line });
                continue;
            }
            if (existing) {
                console.log(`⚠️  Já existe (id: ${existing.id.slice(0, 8)}...) — pulando`);
                skipped++;
                results.push({ line: i + 2, status: 'existing', patientId: existing.id, data, raw: line });
                continue;
            }
        }

        if (DRY_RUN) {
            console.log(`✅ [DRY] status=${data.status} pagamento=${data.paymentType} preço=${data.defaultSessionPriceCents ?? '–'}¢`);
            results.push({ line: i + 2, status: 'dry_run', data });
            created++;
            continue;
        }

        // ── Create patient ────────────────────────────────────────────────────
        try {
            const patient = await apiRequest('POST', '/api/psychotherapy/patients', data);
            console.log(`✅ Criado (id: ${patient?.data?.id?.slice(0, 8) ?? '?'}...)`);
            created++;
            results.push({ line: i + 2, status: 'created', patientId: patient?.data?.id, data });
        } catch (err) {
            console.log(`❌ Erro: ${err.message}`);
            errors++;
            results.push({ line: i + 2, status: 'error', error: err.message, data, raw: line });
        }

        // Small delay to avoid overwhelming the API
        await new Promise(r => setTimeout(r, 120));
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(60));
    console.log(' 📊  Resumo da Importação');
    console.log('─'.repeat(60));
    console.log(`  ✅  Criados    : ${created}`);
    console.log(`  ⚠️   Pulados    : ${skipped}`);
    if (ambiguous) console.log(`  ❓  Ambíguos  : ${ambiguous} (requer confirmação manual)`);
    if (errors)    console.log(`  ❌  Erros     : ${errors}`);
    console.log('─'.repeat(60));

    // ── Save report ───────────────────────────────────────────────────────────
    const reportFile = `import_report_${Date.now()}.json`;
    fs.writeFileSync(reportFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        file: path.resolve(CSV_FILE),
        dryRun: DRY_RUN,
        groupId: GROUP_ID,
        totals: { created, skipped, ambiguous, errors },
        results,
    }, null, 2));
    console.log(`\n  📄  Relatório salvo: ${reportFile}\n`);

    if (errors > 0) process.exit(1);
}

main().catch(err => {
    console.error('\n❌ Erro crítico:', err.message);
    process.exit(1);
});
