import { logger } from '../logger';

export interface AppointmentReminderParams {
    to: string;
    patientName: string;
    therapistName: string;
    scheduledAt: Date;
    durationMinutes: number;
}

function formatDateTimeBR(date: Date): string {
    return date.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function buildEmailHtml(p: AppointmentReminderParams): string {
    const dateStr = formatDateTimeBR(p.scheduledAt);
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Helvetica Neue',Arial,sans-serif;color:#1f2937;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <!-- Header -->
        <tr><td style="background:#4f46e5;padding:28px 32px;">
          <h1 style="margin:0;font-size:20px;color:#ffffff;font-weight:600;">🗓️ Lembrete de Sessão</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;">Olá, <strong>${p.patientName}</strong>!</p>
          <p style="margin:0 0 24px;color:#4b5563;">Lembramos que você tem uma sessão de psicoterapia marcada:</p>
          <div style="background:#f3f4f6;border-radius:8px;padding:20px;margin-bottom:24px;">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr><td style="padding:6px 0;font-size:15px;">📅 <strong>Data e Hora:</strong> ${dateStr}</td></tr>
              <tr><td style="padding:6px 0;font-size:15px;">⏱️ <strong>Duração:</strong> ${p.durationMinutes} minutos</td></tr>
              <tr><td style="padding:6px 0;font-size:15px;">👩‍⚕️ <strong>Terapeuta:</strong> ${p.therapistName}</td></tr>
            </table>
          </div>
          <p style="margin:0 0 8px;color:#4b5563;">Em caso de imprevistos, entre em contato com antecedência para que possamos reorganizar a agenda.</p>
          <p style="margin:24px 0 0;color:#9ca3af;font-size:13px;">Este é um lembrete automático gerado pelo PsicoApp. Por favor, não responda este e-mail.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildEmailText(p: AppointmentReminderParams): string {
    const dateStr = formatDateTimeBR(p.scheduledAt);
    return [
        `Olá, ${p.patientName}!`,
        '',
        'Lembramos que você tem uma sessão de psicoterapia marcada:',
        `  Data e Hora : ${dateStr}`,
        `  Duração     : ${p.durationMinutes} minutos`,
        `  Terapeuta   : ${p.therapistName}`,
        '',
        'Em caso de imprevistos, entre em contato com antecedência.',
        '',
        'Este é um lembrete automático. Por favor, não responda este e-mail.',
    ].join('\n');
}

export class EmailService {
    /**
     * Envia lembrete de consulta via Resend (https://resend.com).
     * Variáveis de ambiente:
     *   RESEND_API_KEY  — chave de API (obrigatório para envio real)
     *   RESEND_FROM_EMAIL — endereço remetente (padrão: onboarding@resend.dev para testes)
     *
     * ⚠️  onboarding@resend.dev só funciona para envio ao email do dono da conta Resend.
     *     Para produção, configure um domínio verificado no Resend e ajuste RESEND_FROM_EMAIL.
     */
    async sendAppointmentReminder(params: AppointmentReminderParams): Promise<void> {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
            throw new Error('RESEND_API_KEY não configurado — email não enviado');
        }

        const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
        const dateStr = formatDateTimeBR(params.scheduledAt);
        const subject = `🗓️ Lembrete: sessão amanhã com ${params.therapistName} — ${dateStr}`;

        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from,
                to: [params.to],
                subject,
                html: buildEmailHtml(params),
                text: buildEmailText(params),
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Resend API retornou ${response.status}: ${body}`);
        }

        logger.info({ to: params.to, subject }, '📧 E-mail de lembrete enviado via Resend');
    }
}
