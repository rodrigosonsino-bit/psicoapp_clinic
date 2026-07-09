export const formatCurrency = (cents: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

/**
 * Domínio público estável do app, usado para montar links compartilhados com pacientes (ex:
 * confirmação de agendamento). NUNCA usar window.location.origin para isso — se o profissional
 * estiver acessando por uma URL de deploy específica da Vercel (não o alias estável), o link
 * copiado herda esse domínio errado e quebra (404) quando o paciente clica.
 */
export const getAppPublicBaseUrl = (): string =>
  import.meta.env.VITE_APP_PUBLIC_URL || window.location.origin;

export const translateAppointmentStatus = (status: string): string => {
  const map: Record<string, string> = {
    scheduled: 'Agendado',
    confirmed: 'Confirmado',
    attended: 'Realizado',
    canceled: 'Cancelado',
    no_show: 'Faltou',
  };
  return map[status] || status;
};
