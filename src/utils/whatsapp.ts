export function buildAppointmentConfirmMessage(patientName: string, scheduledAt: string, confirmUrl: string): string {
  const firstName = patientName.split(' ')[0];
  const dateStr = new Date(scheduledAt).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  return `Olá ${firstName}! Confirme sua sessão de ${dateStr} clicando no link: ${confirmUrl}`;
}

// wa.me exige o número completo com DDI, só dígitos (sem "+"). Telefones já são
// salvos com DDI (ex: "+5561993228642") — só se faltar, assume Brasil (55).
export function buildWhatsAppSendUrl(phone: string, message: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
