export const MODALIDADE_OPTIONS = [
  { value: 'mensal-semanal',    label: 'Mensal (Semanal)',       status: 'weekly'   as const, paymentType: 'monthly'     as const, sessions: 4 },
  { value: 'mensal-quinzenal',  label: 'Mensal (Quinzenal)',     status: 'biweekly' as const, paymentType: 'monthly'     as const, sessions: 2 },
  { value: 'sessao-semanal',    label: 'Por Sessão (Semanal)',   status: 'weekly'   as const, paymentType: 'per_session' as const, sessions: 4 },
  { value: 'sessao-quinzenal',  label: 'Por Sessão (Quinzenal)', status: 'biweekly' as const, paymentType: 'per_session' as const, sessions: 2 },
  { value: 'avulsa',            label: 'Avulsa',                 status: 'one_off'  as const, paymentType: 'per_session' as const, sessions: 0 },
] as const;

export type ModalidadeValue = typeof MODALIDADE_OPTIONS[number]['value'];

export function getModalidadeValue(status: string, paymentType: string | null): ModalidadeValue {
  const found = MODALIDADE_OPTIONS.find(o => o.status === status && o.paymentType === paymentType);
  return found ? found.value : 'sessao-semanal';
}

export function getModalidadeLabel(status: string, paymentType: string | null): string {
  if (status === 'inactive') return 'Inativo';
  return MODALIDADE_OPTIONS.find(o => o.status === status && o.paymentType === paymentType)?.label ?? '—';
}
