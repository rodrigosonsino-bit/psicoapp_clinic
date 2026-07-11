import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';
import { IncomingMessageContext } from '@antigravity/whatsapp-core';
import { logger } from '../logger';
import { incrementPaidSessions } from '../db/incrementPaidSessions';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Converte uma Date para o formato YYYY-MM no fuso America/Sao_Paulo de forma segura
function getSaoPauloMonth(date: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(date);
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    return `${y}-${m}`;
}

// ── 1. Extrair valor do comprovante via Claude Vision ─────────────────────────

async function extractAmountFromReceipt(
    mediaData: { mimeType: string; data: string }
): Promise<number | null> {
    try {
        const response = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-latest',
            max_tokens: 256,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mediaData.mimeType as any,
                            data: mediaData.data,
                        },
                    },
                    {
                        type: 'text',
                        text: `Esta é uma imagem de comprovante de pagamento (PIX, TED, DOC, boleto ou recibo).
Extraia SOMENTE o valor total transferido/pago.
Responda APENAS com o número em centavos inteiros, sem pontos, vírgulas ou símbolos.
Exemplos: "35000" para R$ 350,00 | "15000" para R$ 150,00
Se não for um comprovante financeiro ou não conseguir identificar o valor, responda: "INVALIDO"`
                    }
                ]
            }]
        });

        const textBlock = response.content.find(block => block.type === 'text');
        const text = textBlock && 'text' in textBlock ? textBlock.text.trim() : null;
        
        logger.info({ text }, '[Receipt] Resposta do Claude Vision');

        if (!text || text === 'INVALIDO' || !/^\d+$/.test(text)) return null;
        return parseInt(text, 10);
    } catch (err) {
        logger.error({ err }, '[Receipt] Erro ao chamar Claude Vision');
        return null;
    }
}

// ── 2. Buscar paciente pelo telefone ─────────────────────────────────────────

async function findPatientByPhone(
    dbPool: Pool,
    tenantId: string,
    fromJid: string
): Promise<{ id: string; name: string; sessionPriceCents: number | null; paymentType: string | null } | null> {
    // JID do WhatsApp: "5511999999999@s.whatsapp.net" → limpa para só números
    const phone = fromJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');

    // Tenta match nos últimos 8 dígitos (cobre DDD diferentes, +55 etc.)
    const result = await dbPool.query(`
        SELECT id, name, default_session_price_cents AS session_price_cents, payment_type
        FROM psychotherapy_patients
        WHERE tenant_id = $1
          AND status != 'inactive'
          AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE $2
        LIMIT 1
    `, [tenantId, `%${phone.slice(-8)}`]);

    return result.rows[0] ?? null;
}

// ── 3. Buscar ou criar monthly_record do mês atual ───────────────────────────

async function getOrCreateMonthlyRecord(
    dbPool: Pool,
    tenantId: string,
    patientId: string,
    month: string   // 'YYYY-MM'
): Promise<{ id: string; paidSessions: number; expectedSessions: number; absences: number; sessionPriceCents: number | null; paymentType: string | null } | null> {
    const result = await dbPool.query(`
        SELECT id, paid_sessions, expected_sessions, absences,
               session_price_cents, payment_type
        FROM psychotherapy_monthly_records
        WHERE tenant_id = $1 AND patient_id = $2 AND month = $3
        LIMIT 1
    `, [tenantId, patientId, month]);

    return result.rows[0]
        ? {
            id: result.rows[0].id,
            paidSessions: result.rows[0].paid_sessions,
            expectedSessions: result.rows[0].expected_sessions,
            absences: result.rows[0].absences,
            sessionPriceCents: result.rows[0].session_price_cents,
            paymentType: result.rows[0].payment_type,
        }
        : null;
}

// ── 4. Calcular sessões pagas pelo valor recebido ────────────────────────────

function calcSessionsFromAmount(
    amountCents: number,
    record: { paidSessions: number; expectedSessions: number; absences: number; sessionPriceCents: number | null; paymentType: string | null }
): { sessionsToAdd: number; isFullPayment: boolean } {
    const price = record.sessionPriceCents;
    if (!price || price <= 0) return { sessionsToAdd: 0, isFullPayment: false };

    const remaining = Math.max(record.expectedSessions - record.absences - record.paidSessions, 0);

    if (record.paymentType === 'monthly') {
        // Pagamento mensal: valor = preço integral do mês
        const isFullPayment = amountCents >= price;
        const sessionsToAdd = isFullPayment ? remaining : Math.floor(amountCents / (price / Math.max(record.expectedSessions, 1)));
        return { sessionsToAdd, isFullPayment };
    }

    // Per session: cada sessão tem preço fixo
    const sessionsToAdd = Math.min(Math.floor(amountCents / price), remaining);
    const isFullPayment = sessionsToAdd >= remaining;
    return { sessionsToAdd, isFullPayment };
}

// ── 6. Handler principal ──────────────────────────────────────────────────────

export function createPaymentReceiptHandler(dbPool: Pool) {
    return async (ctx: IncomingMessageContext): Promise<string | null> => {
        // Só processa imagens e documentos
        if (!ctx.isImage && !ctx.isDocument) return null;
        if (!ctx.mediaData) return null;

        const mime = ctx.mediaData.mimeType.toLowerCase();

        // Se for PDF, avisa para enviar imagem/print screen (Vision API não lê PDF diretamente)
        if (ctx.isDocument && mime.includes('pdf')) {
            logger.info({ from: ctx.from, tenantId: ctx.tenantId }, '[Receipt] Recebido documento PDF — solicitando print/imagem');
            return 'Recebi seu documento em PDF! 📄\nPara que eu consiga ler o comprovante e processar o pagamento automaticamente, por favor envie uma foto ou print screen dele. Obrigado!';
        }

        // Ignora mimeTypes claramente não relacionados a imagens suportadas
        const supportedImages = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        const isSupportedImage = supportedImages.some(type => mime.includes(type));
        if (!isSupportedImage) return null;

        logger.info({ from: ctx.from, tenantId: ctx.tenantId }, '[Receipt] Imagem recebida — processando como possível comprovante');

        // 1. Extrair valor
        const amountCents = await extractAmountFromReceipt(ctx.mediaData);
        if (!amountCents) {
            logger.info({ from: ctx.from }, '[Receipt] Claude não identificou comprovante válido — ignorando');
            return null; // Não responde — pode ser foto qualquer
        }

        const amountBRL = (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        // 2. Encontrar paciente
        const patient = await findPatientByPhone(dbPool, ctx.tenantId, ctx.from);
        if (!patient) {
            logger.warn({ from: ctx.from, tenantId: ctx.tenantId }, '[Receipt] Paciente não encontrado pelo telefone');
            return `Recebi seu comprovante de ${amountBRL} ✅\nNão encontrei seu cadastro pelo número. Por favor, confirme com seu terapeuta.`;
        }

        // 3. Buscar registro mensal baseado no fuso horário America/Sao_Paulo
        const month = getSaoPauloMonth();
        const record = await getOrCreateMonthlyRecord(dbPool, ctx.tenantId, patient.id, month);

        if (!record || !record.sessionPriceCents) {
            logger.warn({ patientId: patient.id, month }, '[Receipt] Registro mensal não encontrado ou sem preço');
            return `Recebi seu comprovante de ${amountBRL} ✅\nCadastro financeiro não encontrado para o mês atual. Seu terapeuta será avisado.`;
        }

        // 4. Calcular quantas sessões o valor cobriria (prévia — só pra decidir
        // se vale a pena chamar o banco; o valor real aplicado vem do UPDATE
        // atômico no passo 5, que revalida o saldo no momento da escrita)
        const { sessionsToAdd } = calcSessionsFromAmount(amountCents, record);
        if (sessionsToAdd <= 0) {
            return `Recebi o comprovante de ${amountBRL} ✅\nSuas sessões de ${month.substring(5, 7)}/${month.substring(0, 4)} já estão todas pagas. Obrigada!`;
        }

        // 5. Aplicar pagamento — UPDATE atômico de linha única (elimina a race
        // entre este handler e outro escritor concorrente de paid_sessions,
        // ex. o endpoint de conciliação bancária; ver
        // docs/bank-statement-reconciliation-plan.md)
        const { paidSessions: newPaidSessions, appliedSessions } = await incrementPaidSessions(
            dbPool, ctx.tenantId, record.id, sessionsToAdd
        );

        logger.info({ patientId: patient.id, amountCents, sessionsToAdd, appliedSessions, newPaidSessions }, '[Receipt] Pagamento registrado com sucesso');

        // 6. Montar resposta a partir do que foi REALMENTE aplicado pelo UPDATE
        // (appliedSessions pode ser menor que sessionsToAdd se o saldo mudou
        // entre a leitura do passo 3 e a escrita, ex. concorrência) — nunca do
        // valor pré-calculado no passo 4.
        const remaining = Math.max(record.expectedSessions - record.absences - newPaidSessions, 0);
        const sessionWord = appliedSessions === 1 ? 'sessão registrada' : 'sessões registradas';
        const suffix = remaining <= 0
            ? 'Pagamento do mês quitado! ✅'
            : `Faltam ${remaining} sessão(ões) para quitar o mês.`;

        return `✅ Pagamento de ${amountBRL} confirmado!\n${appliedSessions} ${sessionWord} em ${month}.\n${suffix}\n\nObrigada, ${patient.name.split(' ')[0]}! 🙏`;
    };
}
