const fs = require('fs');

const raw = fs.readFileSync('planilha_real.csv', 'utf8');
const lines = raw.split(/\r?\n/);
const headers = lines[0].split(','); // simple since first line has no quotes in headers

const out = [];
out.push(['nome', 'tipo_pagamento', 'preco_sessao', 'status', 'observacoes'].join(','));

for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse naive CSV considering quotes
    const fields = [];
    let current = '';
    let inQuotes = false;
    for(let j = 0; j < line.length; j++) {
        if(line[j] === '"') inQuotes = !inQuotes;
        else if(line[j] === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += line[j];
        }
    }
    fields.push(current);

    let nome = fields[0] ? fields[0].trim() : '';
    if (!nome) continue; // skip empty rows

    let status = 'semanal';
    if (nome.toLowerCase().includes('desistiu')) {
        status = 'inativo';
        nome = nome.replace(/-\s*desistiu/i, '').trim();
    }

    let rawForma = (fields[1] || '').trim().toLowerCase();
    let tipoPagamento = 'por_sessao';
    if (rawForma.includes('mês') || rawForma.includes('mes')) tipoPagamento = 'mensal';

    let precoSessao = '';
    // Tenta achar o preço na primeira parcela
    let pg1 = (fields[2] || '').trim();
    if (pg1.includes('-')) {
        let parts = pg1.split('-');
        precoSessao = parts[1].trim().replace(',', '.');
    }

    let obs = fields[9] || '';

    // CSV escape
    const esc = (s) => `"${s.replace(/"/g, '""')}"`;
    out.push([esc(nome), tipoPagamento, precoSessao, status, esc(obs)].join(','));
}

fs.writeFileSync('planilha_real_normalized.csv', out.join('\n'), 'utf8');
console.log('Normalização concluída: planilha_real_normalized.csv');
