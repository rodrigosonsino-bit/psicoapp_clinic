import { useState, useEffect, useCallback } from 'react';
import { format, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, RefreshCw, CheckCircle, Clock, MessageCircle, Download, Search } from 'lucide-react';
import { fetchApi } from '../services/api';
import type { MonthlyRecord, Patient, MonthResponse, PaginatedResponse } from '../types/api';

import { MODALIDADE_OPTIONS, getModalidadeValue } from '../constants/modalidade';
import { formatCurrency } from '../utils/formatters';
import { useToast } from '../context/ToastContext';
import { SkeletonTable } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';

const normalizeString = (str: string) => 
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default function MonthlyRecords() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [records, setRecords] = useState<MonthlyRecord[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [reminderText, setReminderText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'partial' | 'paid'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  // Adiantamento de sessão(ões) para o próximo mês (paciente paga mais do que o
  // esperado neste mês). Controla qual linha está com o mini-formulário aberto.
  const [advancingRecordId, setAdvancingRecordId] = useState<string | null>(null);
  const [advanceSessionsInput, setAdvanceSessionsInput] = useState('1');
  const [submittingAdvance, setSubmittingAdvance] = useState(false);

  const monthStr = format(currentDate, 'yyyy-MM');
  const displayMonth = format(currentDate, 'MM/yyyy');

  const toast = useToast();

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [monthsRes, patientsRes] = await Promise.all([
        fetchApi<MonthResponse>(`/api/psychotherapy/months/${monthStr}`),
        fetchApi<PaginatedResponse<Patient>>('/api/psychotherapy/patients')
      ]);
      setRecords(monthsRes.records || []);
      setPatients(patientsRes.data || []);
    } catch (err) {
      console.error(err);
      setError(true);
      toast.error('Erro ao carregar faturamentos.');
    } finally {
      setLoading(false);
    }
  }, [monthStr, toast]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await fetchApi(`/api/psychotherapy/months/${monthStr}/generate`, { method: 'POST' });
      toast.success('Mês gerado com sucesso.');
      await loadRecords();
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao gerar registros para o mês.');
    } finally {
      setGenerating(false);
    }
  };

  const updatePaidSessions = async (record: MonthlyRecord, newPaidSessions: number) => {
    const targetSessions = Math.max(0, record.expectedSessions - record.absences);
    if (newPaidSessions < 0 || newPaidSessions > targetSessions) return;
    
    let newStatus: 'paid' | 'pending' | 'partial' = 'pending';
    if (newPaidSessions >= targetSessions) {
      newStatus = 'paid';
    } else if (newPaidSessions > 0) {
      newStatus = 'partial';
    }

    const previousRecords = [...records];
    setRecords(prev => prev.map(r => 
      r.id === record.id 
        ? { ...r, paidSessions: newPaidSessions, paymentStatus: newStatus }
        : r
    ));

    try {
      await fetchApi(`/api/psychotherapy/months/${monthStr}/records`, {
        method: 'POST',
        body: JSON.stringify({
          ...record,
          paidSessions: newPaidSessions,
          paymentStatus: newStatus
        })
      });
      toast.success('Sessões pagas atualizadas.');
      await loadRecords();
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao atualizar faturamento.');
      setRecords(previousRecords);
    }
  };

  const updatePaymentStatus = async (record: MonthlyRecord, newStatus: 'paid' | 'pending' | 'partial') => {
    let newPaidSessions = record.paidSessions;
    if (newStatus === 'paid') {
      // expectedSessions não tem mais piso fixo pro Mensal (reflete a contagem real de
      // agendamentos do mês, igual Por Sessão) — "Dar Baixa" não pode mais gravar um número
      // de sessões pagas maior que o que de fato aconteceu no mês. Achado real: Lucas, Mensal
      // com só 1 sessão real, "Dar Baixa" gravava paid_sessions=4 (2026-07-06).
      newPaidSessions = Math.max(0, record.expectedSessions - record.absences);
    } else if (newStatus === 'pending') {
      newPaidSessions = 0;
    }

    const previousRecords = [...records];
    setRecords(prev => prev.map(r => 
      r.id === record.id 
        ? { ...r, paymentStatus: newStatus, paidSessions: newPaidSessions }
        : r
    ));

    try {
      await fetchApi(`/api/psychotherapy/months/${monthStr}/records`, {
        method: 'POST',
        body: JSON.stringify({
          ...record,
          paymentStatus: newStatus,
          paidSessions: newPaidSessions
        })
      });
      toast.success('Status de pagamento atualizado.');
      await loadRecords();
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao atualizar faturamento.');
      setRecords(previousRecords);
    }
  };

  const updateModalidade = async (record: MonthlyRecord, modalidadeValue: string) => {
    const option = MODALIDADE_OPTIONS.find(o => o.value === modalidadeValue);
    if (!option) return;
    const newExpected = (option.value === 'avulsa' && record.expectedSessions > 0)
      ? record.expectedSessions
      : option.sessions;
    const newPaid = Math.min(record.paidSessions, newExpected);
    const target = Math.max(0, newExpected - record.absences);
    const newPaymentStatus: 'paid' | 'partial' | 'pending' =
      newPaid === 0 ? 'pending' : newPaid >= target ? 'paid' : 'partial';

    const previousRecords = [...records];
    setRecords(prev => prev.map(r => 
      r.id === record.id 
        ? { 
            ...r, 
            status: option.status, 
            paymentType: option.paymentType, 
            expectedSessions: newExpected,
            paidSessions: newPaid,
            paymentStatus: newPaymentStatus
          }
        : r
    ));

    try {
      await fetchApi(`/api/psychotherapy/months/${monthStr}/records`, {
        method: 'POST',
        body: JSON.stringify({
          ...record,
          status: option.status,
          paymentType: option.paymentType,
          expectedSessions: newExpected,
          paidSessions: newPaid,
          paymentStatus: newPaymentStatus,
        })
      });
      toast.success('Modalidade atualizada.');
      await loadRecords();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao atualizar.');
      setRecords(previousRecords);
    }
  };

  const updateSessionPrice = async (record: MonthlyRecord, priceStr: string) => {
    const priceNumber = Number(priceStr.replace(',', '.'));
    if (isNaN(priceNumber) || priceNumber < 0) return;
    const newPriceCents = Math.round(priceNumber * 100);
    if (newPriceCents === record.sessionPriceCents) return;

    const previousRecords = [...records];
    setRecords(prev => prev.map(r => 
      r.id === record.id 
        ? { ...r, sessionPriceCents: newPriceCents }
        : r
    ));

    try {
      await fetchApi(`/api/psychotherapy/months/${monthStr}/records`, {
        method: 'POST',
        body: JSON.stringify({
          ...record,
          sessionPriceCents: newPriceCents
        })
      });
      toast.success('Valor atualizado.');
      await loadRecords();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao atualizar valor.');
      setRecords(previousRecords);
    }
  };


  const handleAddAdvanceCredit = async (record: MonthlyRecord) => {
    const sessionsCount = parseInt(advanceSessionsInput, 10);
    if (isNaN(sessionsCount) || sessionsCount <= 0) {
      toast.error('Número de sessões inválido.');
      return;
    }
    if (!record.patientId) {
      toast.error('Paciente não identificado neste registro.');
      return;
    }
    const amountCents = sessionsCount * (record.sessionPriceCents || 0);
    if (amountCents <= 0) {
      toast.error('Configure o valor da sessão antes de adiantar.');
      return;
    }
    const targetMonth = format(addMonths(currentDate, 1), 'yyyy-MM');

    setSubmittingAdvance(true);
    try {
      await fetchApi(`/api/psychotherapy/patients/${record.patientId}/advance-credit`, {
        method: 'POST',
        body: JSON.stringify({ targetMonth, amountCents })
      });
      toast.success(`${sessionsCount} sessão(ões) (${formatCurrency(amountCents)}) creditada(s) para ${format(addMonths(currentDate, 1), 'MM/yyyy')}.`);
      setAdvancingRecordId(null);
      setAdvanceSessionsInput('1');
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao adiantar sessão.');
    } finally {
      setSubmittingAdvance(false);
    }
  };

  const getExpectedAmount = (record: MonthlyRecord) => {
    if (record.paymentType === 'monthly') return record.sessionPriceCents || 0;
    const billableSessions = Math.max(0, (record.expectedSessions || 0) - (record.absences || 0));
    return (record.sessionPriceCents || 0) * billableSessions;
  };

  const getReceivedAmount = (record: MonthlyRecord) => {
    // Both monthly and per_session: received = price × paid sessions + crédito adiantado
    // recebido de um mês anterior (previousMonthPaidCents). Cada sessão paga = dinheiro
    // real recebido, independente do ciclo de cobrança.
    return (record.sessionPriceCents || 0) * (record.paidSessions || 0) + (record.previousMonthPaidCents || 0);
  };

  const handleSendReminder = (record: MonthlyRecord, patient: Patient) => {
    const amountFormatted = formatCurrency(getExpectedAmount(record));
    const sessionsText = record.paymentType === 'monthly' ? '' : ` referente a ${record.expectedSessions} sessões`;
    const defaultText = `Olá, ${patient.name}! Tudo bem? 🌸\n\nPassando para enviar o fechamento de faturamento de psicoterapia referente ao mês de ${displayMonth}${sessionsText}.\n\nO valor total é de ${amountFormatted}.\n\nCaso prefira pagar via PIX, fique à vontade. Agradeço desde já!`;
    
    setSelectedPatient(patient);
    setReminderText(defaultText);
    setShowReminderModal(true);
  };

  const handleConfirmSend = () => {
    if (!selectedPatient?.phone) return;
    const cleanPhone = selectedPatient.phone.replace(/\D/g, '');
    const url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(reminderText)}`;
    window.open(url, '_blank');
    setShowReminderModal(false);
  };

  const handleExport = async () => {
    try {
      const blob = await fetchApi<Blob>(`/api/psychotherapy/export/months/${monthStr}`, {
        headers: { Accept: 'text/csv' },
        responseType: 'blob'
      });
      const url = URL.createObjectURL(new Blob([blob], { type: 'text/csv' }));
      Object.assign(document.createElement('a'), { href: url, download: `faturamento-${monthStr}.csv` }).click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao exportar faturamento.');
    }
  };

  const filteredRecords = records.filter(r => {
    const matchesStatus = statusFilter === 'all' || r.paymentStatus === statusFilter;
    const matchesSearch = !searchQuery || normalizeString(r.patientNameSnapshot).includes(normalizeString(searchQuery));
    return matchesStatus && matchesSearch;
  });

  const totalExpected = filteredRecords.reduce((acc, r) => acc + getExpectedAmount(r), 0);
  const totalReceived = filteredRecords.reduce((acc, r) => acc + getReceivedAmount(r), 0);
  const totalPending = totalExpected - totalReceived;

  return (
    <div className="animate-fade-in">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-h1">Faturamento Mensal</h1>
          <p className="text-body">Acompanhamento e baixas de pagamentos</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-md overflow-hidden">
            <button className="btn-icon p-2" onClick={() => setCurrentDate(subMonths(currentDate, 1))}>
              <ChevronLeft size={20} />
            </button>
            <span className="px-4 font-semibold">{displayMonth}</span>
            <button className="btn-icon p-2" onClick={() => setCurrentDate(addMonths(currentDate, 1))}>
              <ChevronRight size={20} />
            </button>
          </div>
          
          <button
            onClick={handleExport}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}
          >
            <Download size={16} /> CSV
          </button>

          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating}
          >
            <RefreshCw size={18} className={generating ? 'animate-spin' : ''} />
            Gerar Mês
          </button>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4 gap-4">
        <div style={{ position: 'relative', width: '300px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            className="form-control"
            placeholder="Buscar por nome..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.25rem', height: '32px', fontSize: '0.875rem' }}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-small text-muted font-medium">Filtrar:</span>
          <select 
            className="form-control" 
            style={{ width: 'auto', padding: '0.25rem 2rem 0.25rem 0.75rem', height: '32px', fontSize: '0.875rem' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'pending' | 'partial' | 'paid')}
          >
            <option value="all">Todos os Status</option>
            <option value="pending">Pendentes</option>
            <option value="partial">Parciais</option>
            <option value="paid">Pagos</option>
          </select>
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : error ? (
        <ErrorState
          title="Erro ao obter registros mensais"
          message="Não foi possível obter os dados de faturamento do mês atual do servidor."
          onRetry={loadRecords}
        />
      ) : records.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-body mb-4">Nenhum registro para {displayMonth}</p>
          <button className="btn btn-primary" onClick={handleGenerate}>
            Gerar agora
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Status Sessões</th>
                <th>Valor Esperado</th>
                <th>Pagamento</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map(r => {
                const patient = patients.find(p => p.id === r.patientId);
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.patientNameSnapshot}</strong>
                      <div style={{ marginTop: '4px' }}>
                        <select
                          className="form-control"
                          style={{ fontSize: '0.75rem', padding: '2px 6px', height: 'auto' }}
                          value={getModalidadeValue(r.status, r.paymentType)}
                          onChange={e => updateModalidade(r, e.target.value)}
                        >
                          {MODALIDADE_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      {patient?.phone && (
                        <div className="text-small" style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                          <MessageCircle size={12} /> {patient.phone}
                        </div>
                      )}
                    </td>
                    <td>
                      {r.expectedSessions === 0 ? (
                        <span className="text-small" style={{ opacity: 0.6 }}>Sem sessões no mês</span>
                      ) : (
                        <div className="sessions-counter-container" style={{ userSelect: 'none' }}>
                          <button
                            className="btn btn-secondary"
                            style={{
                              padding: '2px 8px',
                              minWidth: '24px',
                              height: '24px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            onClick={() => updatePaidSessions(r, r.paidSessions - 1)}
                            disabled={r.paidSessions <= 0}
                          >
                            -
                          </button>
                          <span style={{ minWidth: '16px', display: 'inline-block', textAlign: 'center', fontWeight: 'bold' }}>
                            {r.paidSessions}
                          </span>
                          <button
                            className="btn btn-secondary"
                            style={{
                              padding: '2px 8px',
                              minWidth: '24px',
                              height: '24px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            onClick={() => updatePaidSessions(r, r.paidSessions + 1)}
                            disabled={r.paidSessions >= Math.max(0, r.expectedSessions - r.absences)}
                          >
                            +
                          </button>
                          <span className="text-small" style={{ opacity: 0.6 }}>
                            / {Math.max(0, r.expectedSessions - r.absences)} sessões
                            {r.absences > 0 && ` (${r.absences} falta${r.absences !== 1 ? 's' : ''})`}
                          </span>
                          {r.patientId && (
                            advancingRecordId === r.id ? (
                              <div className="flex items-center gap-1" style={{ marginTop: '4px' }}>
                                <input
                                  type="number"
                                  min="1"
                                  className="form-control"
                                  style={{ width: '48px', height: '24px', fontSize: '0.75rem', padding: '2px 4px' }}
                                  value={advanceSessionsInput}
                                  onChange={e => setAdvanceSessionsInput(e.target.value)}
                                  disabled={submittingAdvance}
                                />
                                <span className="text-small" style={{ opacity: 0.6 }}>sessão(ões) → mês seguinte</span>
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: '2px 6px', fontSize: '0.7rem', height: '24px' }}
                                  onClick={() => handleAddAdvanceCredit(r)}
                                  disabled={submittingAdvance}
                                >
                                  OK
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: '2px 6px', fontSize: '0.7rem', height: '24px' }}
                                  onClick={() => setAdvancingRecordId(null)}
                                  disabled={submittingAdvance}
                                >
                                  X
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '2px 6px', fontSize: '0.7rem', marginTop: '4px' }}
                                onClick={() => { setAdvancingRecordId(r.id); setAdvanceSessionsInput('1'); }}
                                title="Registrar pagamento adiantado de sessão(ões) do próximo mês"
                              >
                                Adiantar p/ próximo mês
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>R$</span>
                          <input
                            type="text"
                            className="form-control"
                            key={`${r.id}-${r.sessionPriceCents}`}
                            style={{ 
                              width: '72px', 
                              height: '26px', 
                              fontSize: '0.8125rem', 
                              padding: '2px 6px', 
                              fontWeight: '600',
                              textAlign: 'left'
                            }}
                            defaultValue={((r.sessionPriceCents || 0) / 100).toFixed(2).replace('.', ',')}
                            onBlur={e => updateSessionPrice(r, e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                          />
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {r.paymentType === 'monthly' ? '/mês' : '/sessão'}
                          </span>
                        </div>
                        {r.paymentType !== 'monthly' && r.expectedSessions > 0 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '500' }}>
                            Total: {formatCurrency(getExpectedAmount(r))}
                          </div>
                        )}
                        {r.previousMonthPaidCents > 0 && (
                          <div className="text-small" style={{ color: 'var(--status-success, #16a34a)' }}>
                            + {formatCurrency(r.previousMonthPaidCents)} adiantado(s)
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      {r.paymentType === 'monthly' && r.expectedSessions === 0 ? (
                        <span className="badge" style={{ backgroundColor: 'rgba(148, 163, 184, 0.1)', color: 'var(--text-secondary)' }}>
                          Sem Sessões
                        </span>
                      ) : (
                        <span className={`badge badge-${r.paymentStatus === 'paid' ? 'success' : r.paymentStatus === 'partial' ? 'warning' : 'danger'}`}>
                          {r.paymentStatus === 'paid' ? 'Pago' : r.paymentStatus === 'partial' ? 'Parcial' : 'Pendente'}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-2 actions-cell">
                        {(r.expectedSessions > 0 || r.paymentType === 'per_session') && (
                          r.paymentStatus !== 'paid' ? (
                            <button 
                              className="btn btn-secondary" 
                              style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
                              onClick={() => updatePaymentStatus(r, 'paid')}
                            >
                              <CheckCircle size={14} className="text-success" /> Dar Baixa
                            </button>
                          ) : (
                            <button 
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
                              onClick={() => updatePaymentStatus(r, 'pending')}
                            >
                              <Clock size={14} /> Desfazer
                            </button>
                          )
                        )}
                        {patient?.phone && (r.expectedSessions > 0 || r.paymentType === 'per_session') && r.paymentStatus !== 'paid' && (
                          <button 
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', borderColor: '#10b981' }}
                            onClick={() => handleSendReminder(r, patient)}
                            title="Enviar cobrança via WhatsApp"
                          >
                            <MessageCircle size={14} className="text-success" /> Cobrar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
                <td colSpan={2} style={{ textAlign: 'right', fontWeight: 'bold' }}>Totais (Exibe os valores filtrados):</td>
                <td style={{ fontWeight: 'bold' }}>{formatCurrency(totalExpected)}</td>
                <td style={{ fontWeight: 'bold' }}>
                  <span className="text-success" title="Recebido">{formatCurrency(totalReceived)}</span> / <span className="text-danger" title="Pendente">{formatCurrency(totalPending)}</span>
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showReminderModal && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in" style={{ maxWidth: '500px' }}>
            <h2 className="text-h2 mb-4 flex items-center gap-2">
              <MessageCircle className="text-success" /> Lembrete de Cobrança
            </h2>
            <p className="text-body mb-4" style={{ fontSize: '0.9rem' }}>
              Personalize a mensagem abaixo antes de enviar para <strong>{selectedPatient?.name}</strong>:
            </p>
            <div className="form-group">
              <textarea
                className="form-control"
                rows={6}
                value={reminderText}
                onChange={e => setReminderText(e.target.value)}
                style={{ resize: 'vertical', minHeight: '150px', fontSize: '0.875rem', lineHeight: '1.4' }}
              />
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button className="btn btn-secondary" onClick={() => setShowReminderModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleConfirmSend}>Enviar WhatsApp</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
