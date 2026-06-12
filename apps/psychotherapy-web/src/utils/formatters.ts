export const formatCurrency = (cents: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

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
