/**
 * Meta espera o campo `to` como dígitos com DDI, SEM o prefixo "+" (conteúdo é semanticamente
 * E.164, mas a representação em string não leva "+"). Validação estrita: números brasileiros de
 * 10/11 dígitos SEM o DDI "55" na frente eram aceitos por engano antes (só checava length>=10) e
 * seriam enviados para o destinatário errado — agora exigimos o DDI explicitamente.
 */
export function normalizePhoneDigits(phone: string): string {
    const digits = phone.replace(/\D/g, '');

    if (!/^\d{10,15}$/.test(digits)) {
        throw new Error('Telefone do paciente inválido/incompleto para envio via WhatsApp Cloud API.');
    }

    if (digits.startsWith('55')) {
        // DDI 55 + DDD (2) + número (8 fixo ou 9 celular) = 12 ou 13 dígitos.
        if (digits.length !== 12 && digits.length !== 13) {
            throw new Error('Telefone brasileiro com formato inválido (esperado DDI 55 + DDD + número).');
        }
    } else if (digits.length < 11) {
        // Sem DDI 55 e curto demais para conter DDI + DDD + número de outro país — provável
        // número BR salvo sem o código do país, que seria enviado para o destinatário errado.
        throw new Error('Telefone sem código do país (DDI) — inclua o DDI antes de enviar.');
    }

    return digits;
}
