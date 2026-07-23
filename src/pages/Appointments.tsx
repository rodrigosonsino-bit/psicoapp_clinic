import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, ChevronLeft, ChevronRight, Check, X, Clock, Link2, CalendarCheck, CheckCircle2, UserX, XCircle, Ban, RefreshCw, MessageCircle, FileText } from 'lucide-react';
import { fetchApi } from '../services/api';
import type { Appointment, AppointmentStatus, Patient, PaginatedResponse, MonthResponse } from '../types/api';
import { useToast } from '../context/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonTable } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import { CalendarView } from '../components/Calendar';
import { buildAppointmentConfirmMessage, buildWhatsAppSendUrl } from '../utils/whatsapp';
import { getAppPublicBaseUrl } from '../utils/formatters';
import './Appointments.css';

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  attended: 'Realizado',
  canceled: 'Cancelado',
  no_show: 'Faltou',
};

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  scheduled: 'muted',
  confirmed: 'info',
  attended: 'success',
  canceled: 'danger',
  no_show: 'warning',
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Formata em hora LOCAL (não UTC) no formato exigido pelo <input type="datetime-local">.
// toISOString() sempre retorna UTC — usá-la aqui faria o campo mostrar um horário
// diferente do que foi de fato agendado (ex: 16:30 local exibido como 19:30).
function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Appointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [filterPatientId, setFilterPatientId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editAppointment, setEditAppointment] = useState<Appointment | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [deleteSeriesDialog, setDeleteSeriesDialog] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [confirmRecurrence, setConfirmRecurrence] = useState<{ open: boolean; appointment: Appointment | null; newRecurrence: Appointment['recurrence'] | null }>({ open: false, appointment: null, newRecurrence: null });
  const [viewType, setViewType] = useState<'all' | 'day' | 'week' | 'month'>('week');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [prefilledDate, setPrefilledDate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [coveredAppointmentIds, setCoveredAppointmentIds] = useState<Set<string>>(new Set());
  const [sessionLinkByAppointmentId, setSessionLinkByAppointmentId] = useState<Record<string, string>>({});
  const toast = useToast();
  const navigate = useNavigate();
  const PAGE_SIZE = 20;

  const loadPatients = useCallback(async () => {
    try {
      const res = await fetchApi<PaginatedResponse<Patient>>('/api/psychotherapy/patients?limit=100');
      // Mantém TODOS os pacientes (inclusive inativos) para que o nome continue
      // aparecendo nas sessões já realizadas por quem foi marcado como inativo.
      // O backend já ordena os inativos por último, então os ativos vêm primeiro.
      setPatients(res.data);
    } catch { /* silently ignore */ }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetchApi<{ data: { id: string; name: string }[] }>('/api/psychotherapy/groups');
      setGroups(res.data);
    } catch { /* silently ignore — agendamentos de grupo mostram um rótulo genérico se isso falhar */ }
  }, []);

  // "Coberta pelo pagamento": mesmo conceito já usado no modal de pendências do Dashboard
  // (sessões cronologicamente cobertas pelas `paid_sessions` do mês), agora sinalizado na
  // aba do agendamento. Busca por mês (não por intervalo visível) porque o cálculo precisa
  // do mês inteiro do paciente pra ficar com a ordinalidade certa — um único agendamento
  // fora de ordem mudaria quais sessões contam como "pagas".
  const loadCoveredAppointmentIds = useCallback(async (appts: Appointment[]) => {
    const months = new Set(appts.map(a => a.scheduledAt.slice(0, 7)));
    if (months.size === 0) { setCoveredAppointmentIds(new Set()); return; }
    try {
      const results = await Promise.all(
        Array.from(months).map(month =>
          fetchApi<{ data: string[] }>(`/api/psychotherapy/appointments/covered/${month}`).catch(() => ({ data: [] }))
        )
      );
      setCoveredAppointmentIds(new Set(results.flatMap(r => r.data)));
    } catch { /* silently ignore — só afeta o indicador visual, não bloqueia a tela */ }
  }, []);

  // Atalho "Ver Sessão": mapa appointmentId -> sessionId (só para agendamentos Realizados que já
  // têm sessão vinculada, migration 082) — evita o usuário precisar ir manualmente no Diário de
  // Sessões procurar o registro correspondente. Mesmo padrão de busca por mês que
  // loadCoveredAppointmentIds, por consistência.
  const loadSessionLinks = useCallback(async (appts: Appointment[]) => {
    const months = new Set(appts.map(a => a.scheduledAt.slice(0, 7)));
    if (months.size === 0) { setSessionLinkByAppointmentId({}); return; }
    try {
      const results = await Promise.all(
        Array.from(months).map(month =>
          fetchApi<{ data: Record<string, string> }>(`/api/psychotherapy/appointments/session-links/${month}`).catch(() => ({ data: {} }))
        )
      );
      setSessionLinkByAppointmentId(Object.assign({}, ...results.map(r => r.data)));
    } catch { /* silently ignore — só afeta o atalho, não bloqueia a tela */ }
  }, []);

  const loadAppointments = useCallback(async (pg = page, patientId = filterPatientId, vt = viewType, dt = currentDate) => {
    try {
      setLoading(true);
      setError(false);
      const params = new URLSearchParams();
      if (patientId) params.set('patientId', patientId);

      if (vt === 'all') {
        params.set('page', String(pg));
        params.set('limit', String(PAGE_SIZE));
      } else {
        params.set('page', '1');
        params.set('limit', '100');

        let start: Date;
        let end: Date;

        if (vt === 'week') {
          const day = (dt.getDay() + 6) % 7;
          const startOfWeek = new Date(dt);
          startOfWeek.setDate(dt.getDate() - day);
          startOfWeek.setHours(0, 0, 0, 0);

          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(startOfWeek.getDate() + 6);
          endOfWeek.setHours(23, 59, 59, 999);

          start = startOfWeek;
          end = endOfWeek;
        } else if (vt === 'day') {
          start = new Date(dt); start.setHours(0, 0, 0, 0);
          end = new Date(dt); end.setHours(23, 59, 59, 999);
        } else {
          start = new Date(dt.getFullYear(), dt.getMonth(), 1, 0, 0, 0, 0);
          end = new Date(dt.getFullYear(), dt.getMonth() + 1, 0, 23, 59, 59, 999);
        }

        params.set('start', start.toISOString());
        params.set('end', end.toISOString());
      }
      params.set('_t', Date.now().toString());

      const res = await fetchApi<PaginatedResponse<Appointment>>(`/api/psychotherapy/appointments?${params}`, {
        cache: 'no-store'
      });
      setAppointments(res.data);
      setTotal(res.meta.total);
      loadCoveredAppointmentIds(res.data);
      loadSessionLinks(res.data);
    } catch (err) {
      console.error(err);
      setError(true);
      toast.error('Erro ao carregar agendamentos.');
    } finally {
      setLoading(false);
    }
  }, [page, filterPatientId, viewType, currentDate, toast, loadCoveredAppointmentIds, loadSessionLinks]);

  useEffect(() => { loadPatients(); }, [loadPatients]);
  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => { loadAppointments(page, filterPatientId, viewType, currentDate); }, [page, filterPatientId, viewType, currentDate, loadAppointments]);

  const handleStatusUpdate = async (id: string, status: AppointmentStatus) => {
    // Optimistic UI update
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    
    try {
      await fetchApi(`/api/psychotherapy/appointments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      toast.success('Status atualizado.');
      loadAppointments(page, filterPatientId, viewType, currentDate);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao atualizar status.');
      // Revert optimistic update by reloading
      loadAppointments(page, filterPatientId, viewType, currentDate);
    }
  };

  const handleModalityUpdate = async (id: string, modality: 'online' | 'presencial') => {
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, modality } : a));
    
    try {
      await fetchApi(`/api/psychotherapy/appointments/${id}/modality`, {
        method: 'PATCH',
        body: JSON.stringify({ modality })
      });
      toast.success('Modalidade atualizada.');
      loadAppointments(page, filterPatientId, viewType, currentDate);
    } catch (err) {
      toast.error('Erro ao atualizar modalidade');
      loadAppointments(page, filterPatientId, viewType, currentDate);
    }
  };

  const openPatientProfile = (patientId: string) => navigate(`/patients/${patientId}`);

  // Atalho de "Agendamentos": marca +1 sessão paga no registro de Faturamento Mensal do
  // paciente, reusando o MESMO endpoint (POST /months/:month/records) e a mesma lógica de
  // paidSessions/paymentStatus que a tela de Faturamento Mensal já usa (MonthlyRecords.tsx,
  // updatePaidSessions) — evita duplicar a regra de negócio em dois lugares.
  const handleMarkSessionPaid = async (id: string) => {
    const appointment = appointments.find(a => a.id === id);
    if (!appointment) return;
    const month = appointment.scheduledAt.slice(0, 7);
    try {
      const monthRes = await fetchApi<MonthResponse>(`/api/psychotherapy/months/${month}`);
      const record = monthRes.records.find(r => r.patientId === appointment.patientId);
      if (!record) {
        toast.error('Nenhum registro de Faturamento Mensal encontrado para esse paciente neste mês. Abra Faturamento Mensal e gere o mês primeiro.');
        return;
      }
      const targetSessions = Math.max(0, record.expectedSessions - record.absences);
      const newPaidSessions = Math.min(record.paidSessions + 1, targetSessions);
      if (newPaidSessions === record.paidSessions) {
        toast.info('Esse mês já está com todas as sessões esperadas marcadas como pagas.');
        return;
      }
      const newStatus: 'paid' | 'partial' | 'pending' =
        newPaidSessions >= targetSessions ? 'paid' : newPaidSessions > 0 ? 'partial' : 'pending';
      await fetchApi(`/api/psychotherapy/months/${month}/records`, {
        method: 'POST',
        body: JSON.stringify({ ...record, paidSessions: newPaidSessions, paymentStatus: newStatus })
      });
      toast.success(`Sessão marcada como paga (${newPaidSessions}/${targetSessions} pagas em ${month}).`);
      await loadAppointments(page, filterPatientId, viewType, currentDate);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao marcar sessão como paga.');
    }
  };

  // Retorna true se o agendamento já passou e ainda está pendente de desfecho
  const needsOutcome = (a: Appointment) =>
    new Date(a.scheduledAt) < new Date() &&
    (a.status === 'scheduled' || a.status === 'confirmed');

  const openDeleteDialog = (id: string) => {
    const appt = appointments.find(a => a.id === id);
    const isSeries = appt ? (appt.parentId !== null || appt.recurrence !== 'none') : false;
    if (isSeries) {
      setDeleteSeriesDialog({ open: true, id });
    } else {
      setConfirmDelete({ open: true, id });
    }
  };

  const handleDelete = async (mode: 'single' | 'all' = 'single') => {
    const id = confirmDelete.id || deleteSeriesDialog.id;
    if (!id) return;
    try {
      await fetchApi(`/api/psychotherapy/appointments/${id}?mode=${mode}`, { method: 'DELETE' });
      toast.success(mode === 'all' ? 'Série excluída.' : 'Agendamento excluído.');
      await loadAppointments(page, filterPatientId, viewType, currentDate);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao excluir.');
    } finally {
      setConfirmDelete({ open: false, id: null });
      setDeleteSeriesDialog({ open: false, id: null });
    }
  };

  const requestRecurrenceUpdate = (appointment: Appointment, newRecurrence: Appointment['recurrence']) => {
    if (newRecurrence === appointment.recurrence) return;
    setConfirmRecurrence({ open: true, appointment, newRecurrence });
  };

  const updateRecurrence = async (appointment: Appointment, newRecurrence: Appointment['recurrence']) => {
    let newEndDate = appointment.recurrenceEndDate;
    if (newRecurrence !== 'none' && !newEndDate) {
      const baseDate = new Date(appointment.scheduledAt);
      baseDate.setMonth(baseDate.getMonth() + 3);
      newEndDate = baseDate.toISOString();
    } else if (newRecurrence === 'none') {
      newEndDate = null;
    }

    const previousAppointments = [...appointments];
    setAppointments(prev => prev.map(a => 
      a.id === appointment.id 
        ? { ...a, recurrence: newRecurrence, recurrenceEndDate: newEndDate }
        : a
    ));

    try {
      await fetchApi('/api/psychotherapy/appointments', {
        method: 'POST',
        body: JSON.stringify({
          ...appointment,
          recurrence: newRecurrence,
          recurrenceEndDate: newEndDate
        })
      });
      toast.success('Recorrência atualizada.');
      await loadAppointments(page, filterPatientId, viewType, currentDate);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao atualizar recorrência.');
      setAppointments(previousAppointments);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const patientName = (id: string) => patients.find(p => p.id === id)?.name ?? id.slice(0, 8);
  const patientPhone = (id: string) => patients.find(p => p.id === id)?.phone ?? null;
  // Rótulo pra listagem "Todos": mostra o nome do grupo em agendamentos de grupo, em vez de
  // tentar achar um paciente individual (que não existe nesse caso — mesmo bug do calendário).
  const appointmentLabel = (a: Appointment) =>
    a.groupId ? (groups.find(g => g.id === a.groupId)?.name ?? 'Grupo') : patientName(a.patientId);

  const copyConfirmLink = (token: string) => {
    const url = `${getAppPublicBaseUrl()}/confirm/${token}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Link copiado! Envie para o paciente.'));
  };

  const sendConfirmWhatsApp = (a: Appointment) => {
    const phone = patientPhone(a.patientId);
    if (!phone || !a.confirmToken) return;
    const confirmUrl = `${getAppPublicBaseUrl()}/confirm/${a.confirmToken}`;
    const message = buildAppointmentConfirmMessage(patientName(a.patientId), a.scheduledAt, confirmUrl);
    window.open(buildWhatsAppSendUrl(phone, message), '_blank', 'noopener,noreferrer');
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      // O sync roda em segundo plano no servidor (pode levar até ~1 min).
      await fetchApi('/auth/google/sync', { method: 'POST' });
      toast.success('Sincronização iniciada. Os agendamentos serão atualizados em instantes.');
      // Recarrega ao longo do tempo para refletir o resultado conforme conclui.
      setTimeout(() => loadAppointments(), 12000);
      setTimeout(() => { loadAppointments(); setSyncing(false); }, 35000);
    } catch {
      toast.error('Falha ao iniciar sincronização. Tente novamente.');
      setSyncing(false);
    }
  };

  const handleSlotClick = (date: Date) => {
    setEditAppointment(null);
    setPrefilledDate(toLocalDatetimeInputValue(date));
    setShowModal(true);
  };

  const getDateRangeLabel = () => {
    if (viewType === 'week') {
      const day = (currentDate.getDay() + 6) % 7;
      const startOfWeek = new Date(currentDate);
      startOfWeek.setDate(currentDate.getDate() - day);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);

      const formatLabelDate = (d: Date) => {
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      };
      
      return `Semana de ${formatLabelDate(startOfWeek)} a ${formatLabelDate(endOfWeek)}`;
    } else if (viewType === 'day') {
      return currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).replace(/^\w/, (c) => c.toUpperCase());
    } else {
      return currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, (c) => c.toUpperCase());
    }
  };

  const handlePrevPeriod = () => {
    setCurrentDate(prev => {
      const next = new Date(prev);
      if (viewType === 'week') {
        next.setDate(prev.getDate() - 7);
      } else if (viewType === 'day') {
        next.setDate(prev.getDate() - 1);
      } else {
        next.setMonth(prev.getMonth() - 1);
      }
      return next;
    });
  };

  const handleNextPeriod = () => {
    setCurrentDate(prev => {
      const next = new Date(prev);
      if (viewType === 'week') {
        next.setDate(prev.getDate() + 7);
      } else if (viewType === 'day') {
        next.setDate(prev.getDate() + 1);
      } else {
        next.setMonth(prev.getMonth() + 1);
      }
      return next;
    });
  };

  return (
    <div className="appointments-page animate-fade-in">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-h1">Agendamentos</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={handleSyncNow} disabled={syncing} title="Sincronizar com Google Calendar">
            <RefreshCw size={16} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
            {syncing ? 'Sincronizando...' : 'Sincronizar'}
          </button>
          <button className="btn btn-primary" onClick={() => { setEditAppointment(null); setPrefilledDate(null); setShowModal(true); }}>
            <Plus size={18} /> Novo Agendamento
          </button>
        </div>
      </div>

      {/* Filtro e Seletor de Visualização */}
      <div className="flex justify-between items-center gap-3 mb-4 flex-wrap">
        <select className="form-control" style={{ minWidth: '220px' }}
          value={filterPatientId} onChange={e => { setFilterPatientId(e.target.value); setPage(1); }}>
          <option value="">Todos os pacientes</option>
          {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Botões de Visualização */}
        <div className="flex gap-1 bg-surface p-1 rounded-md border border-color">
          <button 
            type="button"
            className={`btn-toggle ${viewType === 'all' ? 'active' : ''}`} 
            onClick={() => { setViewType('all'); setPage(1); }}
          >
            Todos
          </button>
          <button 
            type="button"
            className={`btn-toggle ${viewType === 'day' ? 'active' : ''}`} 
            onClick={() => { setViewType('day'); }}
          >
            Dia
          </button>
          <button 
            type="button"
            className={`btn-toggle ${viewType === 'week' ? 'active' : ''}`} 
            onClick={() => { setViewType('week'); }}
          >
            Semana
          </button>
          <button 
            type="button"
            className={`btn-toggle ${viewType === 'month' ? 'active' : ''}`} 
            onClick={() => { setViewType('month'); }}
          >
            Mês
          </button>
        </div>
      </div>

      {/* Navegador de Data (Semana / Mês) */}
      {viewType !== 'all' && (
        <div className="flex justify-center w-full mb-4">
          <div className="flex items-center gap-4 card" style={{ padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)' }}>
            <button type="button" className="btn-icon" onClick={handlePrevPeriod} style={{ padding: '0.25rem' }}>
              <ChevronLeft size={20} />
            </button>
            <span style={{ fontWeight: 600, minWidth: '240px', textAlign: 'center', fontSize: '0.95rem' }}>
              {getDateRangeLabel()}
            </span>
            <button type="button" className="btn-icon" onClick={handleNextPeriod} style={{ padding: '0.25rem' }}>
              <ChevronRight size={20} />
            </button>
            <button 
              type="button" 
              className="btn btn-secondary" 
              style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', margin: 0 }} 
              onClick={() => setCurrentDate(new Date())}
            >
              Hoje
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : error ? (
        <ErrorState title="Erro ao carregar" message="Não foi possível carregar os agendamentos." onRetry={() => loadAppointments(page, filterPatientId, viewType, currentDate)} />
      ) : viewType === 'all' ? (
        <>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Data / Hora</th>
                  <th>Paciente</th>
                  <th>Duração</th>
                  <th>Recorrência</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map(a => (
                  <tr key={a.id}>
                    <td>
                      <strong>{formatDateTime(a.scheduledAt)}</strong>
                      {a.notes && <div className="text-small" style={{ color: 'var(--text-muted)' }}>{a.notes}</div>}
                    </td>
                    <td>{appointmentLabel(a)}</td>
                    <td><Clock size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />{a.durationMinutes} min</td>
                    <td>
                      <select
                        className="form-control"
                        style={{ fontSize: '0.75rem', padding: '2px 6px', height: 'auto', width: '110px' }}
                        value={a.recurrence}
                        onChange={e => requestRecurrenceUpdate(a, e.target.value as Appointment['recurrence'])}
                      >
                        <option value="none">Avulsa</option>
                        <option value="weekly">Semanal</option>
                        <option value="biweekly">Quinzenal</option>
                        <option value="monthly">Mensal</option>
                      </select>
                    </td>
                    <td>
                      <span className={`badge badge-${STATUS_BADGE[a.status]}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                      {coveredAppointmentIds.has(a.id) && (
                        <span title="Sessão paga" style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4 }}>
                          <CheckCircle2 size={13} style={{ color: '#ffffff' }} />
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1 items-center flex-wrap">
                        {needsOutcome(a) ? (
                          /* ── Sessão passada pendente: botões de desfecho rápido ── */
                          <>
                            <button
                              className="btn-icon"
                              title="Sessão realizada"
                              style={{ color: 'var(--status-success)' }}
                              onClick={() => handleStatusUpdate(a.id, 'attended')}
                            >
                              <CheckCircle2 size={16} />
                            </button>
                            <button
                              className="btn-icon"
                              title="Paciente faltou (cobrar)"
                              style={{ color: 'var(--status-danger)' }}
                              onClick={() => handleStatusUpdate(a.id, 'no_show')}
                            >
                              <UserX size={16} />
                            </button>
                            <button
                              className="btn-icon"
                              title="Faltou / Remarcou (não cobrar)"
                              style={{ color: 'var(--text-muted)' }}
                              onClick={() => handleStatusUpdate(a.id, 'canceled')}
                            >
                              <XCircle size={16} />
                            </button>
                            <button
                              className="btn-icon"
                              title="Cancelado pelo terapeuta"
                              style={{ color: 'var(--status-danger)' }}
                              onClick={() => handleStatusUpdate(a.id, 'canceled')}
                            >
                              <Ban size={16} />
                            </button>
                          </>
                        ) : (
                          /* ── Sessão futura ou já com desfecho: ações padrão ── */
                          <>
                            {a.status === 'scheduled' && (
                              <button className="btn-icon" title="Confirmar presença" onClick={() => handleStatusUpdate(a.id, 'confirmed')}>
                                <Check size={14} style={{ color: 'var(--status-success)' }} />
                              </button>
                            )}
                            {a.confirmToken && (
                              <button
                                className="btn-icon"
                                title="Copiar link de confirmação para o paciente"
                                onClick={() => copyConfirmLink(a.confirmToken!)}
                              >
                                <Link2 size={14} />
                              </button>
                            )}
                            {a.confirmToken && patientPhone(a.patientId) && (
                              <button
                                className="btn-icon"
                                title="Enviar confirmação por WhatsApp"
                                onClick={() => sendConfirmWhatsApp(a)}
                              >
                                <MessageCircle size={14} style={{ color: '#25D366' }} />
                              </button>
                            )}
                          </>
                        )}
                        {a.googleEventUrl && (
                          <a
                            href={a.googleEventUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-icon"
                            title="Ver no Google Calendar"
                            style={{ color: '#4285f4' }}
                          >
                            <CalendarCheck size={14} />
                          </a>
                        )}
                        {a.status === 'attended' && sessionLinkByAppointmentId[a.id] && (
                          <button
                            className="btn-icon"
                            title="Ver Sessão vinculada"
                            onClick={() => navigate(`/sessions?openId=${sessionLinkByAppointmentId[a.id]}`)}
                          >
                            <FileText size={14} />
                          </button>
                        )}
                        <button className="btn-icon" title="Editar" onClick={() => { setEditAppointment(a); setShowModal(true); }}>
                          <Edit2 size={14} />
                        </button>
                        <button className="btn-icon text-danger" title="Excluir" onClick={() => openDeleteDialog(a.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {appointments.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                      Nenhum agendamento encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {viewType === 'all' && totalPages > 1 && (
            <div className="pagination">
              <span className="pagination-info">{total} agendamento{total !== 1 ? 's' : ''}</span>
              <div className="pagination-controls">
                <button className="btn-icon" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft size={16} />
                </button>
                <span className="pagination-pages">{page} / {totalPages}</span>
                <button className="btn-icon" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <CalendarView
          mode={viewType}
          currentDate={currentDate}
          appointments={appointments}
          patients={patients}
          groups={groups}
          coveredAppointmentIds={coveredAppointmentIds}
          onSlotClick={handleSlotClick}
          onStatusUpdate={handleStatusUpdate}
          onModalityUpdate={handleModalityUpdate}
          onEdit={a => { setEditAppointment(a); setShowModal(true); }}
          onDelete={id => openDeleteDialog(id)}
          onDayClick={date => { setCurrentDate(date); setViewType('day'); }}
          onOpenProfile={openPatientProfile}
          onMarkPaid={handleMarkSessionPaid}
        />
      )}

      {showModal && (
        <AppointmentModal
          appointment={editAppointment}
          initialScheduledAt={prefilledDate}
          patients={patients}
          onClose={() => { setShowModal(false); setPrefilledDate(null); }}
          onSave={() => loadAppointments(page, filterPatientId, viewType, currentDate)}
          onPatientCreated={p => setPatients(prev => [...prev, p])}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title="Excluir agendamento"
        message="Confirma a exclusão deste agendamento?"
        confirmLabel="Excluir" cancelLabel="Cancelar" variant="danger"
        onConfirm={() => handleDelete('single')}
        onCancel={() => setConfirmDelete({ open: false, id: null })}
      />

      <ConfirmDialog
        isOpen={confirmRecurrence.open}
        title="Alterar recorrência"
        message={
          confirmRecurrence.newRecurrence === 'none'
            ? 'Esta sessão passará a ser avulsa. Todas as sessões futuras desta série (ainda não realizadas) serão excluídas automaticamente. Sessões já realizadas ou canceladas não são afetadas.'
            : `A recorrência será alterada para "${confirmRecurrence.newRecurrence === 'weekly' ? 'Semanal' : confirmRecurrence.newRecurrence === 'biweekly' ? 'Quinzenal' : 'Mensal'}" a partir desta sessão. As sessões futuras que não se encaixarem no novo padrão (ainda não realizadas) serão excluídas automaticamente. Sessões já realizadas ou canceladas não são afetadas.`
        }
        confirmLabel="Confirmar" cancelLabel="Cancelar" variant="danger"
        onConfirm={() => {
          if (confirmRecurrence.appointment && confirmRecurrence.newRecurrence) {
            updateRecurrence(confirmRecurrence.appointment, confirmRecurrence.newRecurrence);
          }
          setConfirmRecurrence({ open: false, appointment: null, newRecurrence: null });
        }}
        onCancel={() => setConfirmRecurrence({ open: false, appointment: null, newRecurrence: null })}
      />

      {deleteSeriesDialog.open && (
        <div className="confirm-overlay" onClick={() => setDeleteSeriesDialog({ open: false, id: null })}>
          <div className="confirm-content animate-fade-in" onClick={e => e.stopPropagation()}>
            <button type="button" className="confirm-close-btn" onClick={() => setDeleteSeriesDialog({ open: false, id: null })}>
              <X size={18} />
            </button>
            <div className="confirm-header">
              <div className="confirm-icon-wrapper wrapper-danger">
                <Trash2 className="confirm-icon icon-danger" size={28} />
              </div>
              <div className="confirm-title-wrapper">
                <h3>Excluir agendamento</h3>
                <p>Este agendamento faz parte de uma série recorrente. O que deseja excluir?</p>
              </div>
            </div>
            <div className="confirm-actions" style={{ flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-danger confirm-submit-btn"
                style={{ width: '100%' }}
                onClick={() => handleDelete('all')}
              >
                Excluir toda a série
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: '100%', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                onClick={() => handleDelete('single')}
              >
                Excluir somente este
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: '100%' }}
                onClick={() => setDeleteSeriesDialog({ open: false, id: null })}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AppointmentModal ──────────────────────────────────────────────────────────

function AppointmentModal({ appointment, patients, initialScheduledAt, onClose, onSave, onPatientCreated }: {
  appointment: Appointment | null;
  patients: Patient[];
  initialScheduledAt?: string | null;
  onClose: () => void;
  onSave: () => void;
  onPatientCreated: (patient: Patient) => void;
}) {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());

  const getDefaultEndDate = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().slice(0, 10);
  };

  const getInitialRecurrenceInfo = () => {
    if (appointment) {
      return {
        recurrence: appointment.recurrence,
        recurrenceEndDate: appointment.recurrenceEndDate
          ? appointment.recurrenceEndDate.slice(0, 10)
          : ''
      };
    }
    const firstPatient = patients[0];
    if (firstPatient) {
      const rec = firstPatient.status === 'weekly' ? 'weekly' : firstPatient.status === 'biweekly' ? 'biweekly' : 'none';
      return {
        recurrence: rec,
        recurrenceEndDate: rec !== 'none' ? getDefaultEndDate(now.toISOString()) : ''
      };
    }
    return { recurrence: 'none' as const, recurrenceEndDate: '' };
  };

  const initialRecInfo = getInitialRecurrenceInfo();

  const [isPastoral, setIsPastoral] = useState(
    appointment?.notes?.startsWith('[PASTORAL_SUMMARY]:') ?? false
  );
  const [pastoralTitle, setPastoralTitle] = useState(
    appointment?.notes?.startsWith('[PASTORAL_SUMMARY]:')
      ? appointment.notes.replace('[PASTORAL_SUMMARY]:', '').split('\n')[0].trim()
      : ''
  );

  const [formData, setFormData] = useState({
    id: appointment?.id,
    patientId: appointment?.patientId || (patients[0]?.id ?? ''),
    scheduledAt: appointment
      ? toLocalDatetimeInputValue(new Date(appointment.scheduledAt))
      : (initialScheduledAt || now.toISOString().slice(0, 16)),
    durationMinutes: appointment?.durationMinutes ?? 50,
    status: appointment?.status ?? 'scheduled',
    recurrence: initialRecInfo.recurrence,
    recurrenceEndDate: initialRecInfo.recurrenceEndDate,
    notes: appointment?.notes
      ? (appointment.notes.startsWith('[PASTORAL_SUMMARY]:')
        ? appointment.notes.split('\n').slice(1).join('\n').trim()
        : appointment.notes)
      : '',
    modality: appointment?.modality ?? 'online'
  });

  const handlePatientChange = (patientId: string) => {
    const selected = patients.find(p => p.id === patientId);
    let newRecurrence: Appointment['recurrence'] = 'none';
    let newEndDate = '';
    
    if (selected) {
      if (selected.status === 'weekly') newRecurrence = 'weekly';
      else if (selected.status === 'biweekly') newRecurrence = 'biweekly';
      else if (selected.status === 'monthly') newRecurrence = 'monthly';
      
      if (newRecurrence !== 'none') {
        newEndDate = getDefaultEndDate(formData.scheduledAt);
      }
    }

    setFormData(prev => ({
      ...prev,
      patientId,
      recurrence: newRecurrence,
      recurrenceEndDate: newEndDate
    }));
  };

  const [submitting, setSubmitting] = useState(false);
  const [retroactive, setRetroactive] = useState(false);
  // "Agora" capturado uma vez na montagem do modal (inicializador lazy do useState) — evita chamar
  // Date.now() durante o render (impuro) só pra decidir se o horário escolhido já passou.
  const [nowMs] = useState(() => Date.now());
  const toast = useToast();

  // Cadastro rápido de paciente sem sair do modal de agendamento (ex: alguém liga pedindo
  // horário e ainda não é paciente). Modalidade fixa em "Avulsa" (one_off/per_session, 0
  // sessões esperadas) — a terapeuta ajusta a modalidade de verdade depois em Pacientes,
  // isso aqui só evita bloquear o agendamento por falta de cadastro.
  const [showQuickAddPatient, setShowQuickAddPatient] = useState(false);
  const [quickPatientName, setQuickPatientName] = useState('');
  const [quickPatientPhone, setQuickPatientPhone] = useState('');
  const [creatingPatient, setCreatingPatient] = useState(false);

  const handleQuickCreatePatient = async () => {
    if (!quickPatientName.trim()) {
      toast.error('Informe o nome do paciente.');
      return;
    }
    setCreatingPatient(true);
    try {
      const res = await fetchApi<{ data: Patient }>('/api/psychotherapy/patients', {
        method: 'POST',
        body: JSON.stringify({
          name: quickPatientName.trim(),
          status: 'one_off',
          paymentType: 'per_session',
          phone: quickPatientPhone.trim() || null,
          reminderChannel: 'whatsapp',
        })
      });
      onPatientCreated(res.data);
      handlePatientChange(res.data.id);
      toast.success(`Paciente ${res.data.name} cadastrado.`);
      setShowQuickAddPatient(false);
      setQuickPatientName('');
      setQuickPatientPhone('');
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao cadastrar paciente.');
    } finally {
      setCreatingPatient(false);
    }
  };

  // Sessão no passado só pode ser criada (novo agendamento) como registro retroativo.
  const isPastNew = !appointment && !!formData.scheduledAt &&
    new Date(formData.scheduledAt).getTime() < nowMs - 60_000;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPastNew && !retroactive) {
      toast.error("Esse horário já passou. Marque \"Atendimento retroativo (já realizado)\" para registrar.");
      return;
    }
    try {
      setSubmitting(true);
      const notesValue = isPastoral
        ? `[PASTORAL_SUMMARY]: ${pastoralTitle}\n${formData.notes}`.trim()
        : formData.notes;

      const retro = isPastNew && retroactive;
      const body: Record<string, unknown> = {
        ...formData,
        scheduledAt: new Date(formData.scheduledAt).toISOString(),
        recurrenceEndDate: formData.recurrenceEndDate || null,
        notes: notesValue || null,
        // Atendimento retroativo: libera data passada, registra como realizado e força avulsa.
        ...(retro ? { allowPast: true, status: 'attended', recurrence: 'none', recurrenceEndDate: null } : {})
      };
      await fetchApi('/api/psychotherapy/appointments', { method: 'POST', body: JSON.stringify(body) });
      toast.success(appointment ? 'Agendamento atualizado.' : 'Agendamento criado.');
      onSave();
      onClose();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao salvar agendamento.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-fade-in" style={{ maxWidth: '560px' }}>
        <h2 className="text-h2 mb-4">{appointment ? 'Editar Agendamento' : 'Novo Agendamento'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={isPastoral}
                onChange={e => {
                  const checked = e.target.checked;
                  setIsPastoral(checked);
                  if (checked && !pastoralTitle) {
                    setPastoralTitle('Compromisso Pastoral');
                  }
                  if (!checked && formData.patientId === appointment?.patientId) {
                    setFormData(prev => ({ ...prev, patientId: patients[0]?.id ?? '' }));
                  }
                }}
                disabled={submitting}
              />
              Compromisso Pastoral (Não cobrado)
            </label>
          </div>

          {isPastoral ? (
            <div className="form-group animate-fade-in">
              <label className="form-label">Assunto do Compromisso Pastoral *</label>
              <input
                required
                type="text"
                className="form-control"
                placeholder="Ex: Reunião do Conselho, Visita, etc."
                value={pastoralTitle}
                onChange={e => setPastoralTitle(e.target.value)}
                disabled={submitting}
              />
            </div>
          ) : (
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label">Paciente *</label>
                {!showQuickAddPatient && (
                  <button
                    type="button"
                    className="popover-btn"
                    style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
                    onClick={() => setShowQuickAddPatient(true)}
                    disabled={submitting}
                  >
                    <Plus size={12} /> Novo Paciente
                  </button>
                )}
              </div>

              {showQuickAddPatient ? (
                <div className="card animate-fade-in" style={{ padding: '0.75rem', marginBottom: '0.5rem' }}>
                  <div className="flex gap-4" style={{ marginBottom: '0.5rem' }}>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Nome do paciente *"
                      value={quickPatientName}
                      onChange={e => setQuickPatientName(e.target.value)}
                      disabled={creatingPatient}
                      autoFocus
                    />
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Celular (opcional)"
                      value={quickPatientPhone}
                      onChange={e => setQuickPatientPhone(e.target.value)}
                      disabled={creatingPatient}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                      onClick={handleQuickCreatePatient}
                      disabled={creatingPatient}
                    >
                      {creatingPatient ? 'Cadastrando...' : 'Cadastrar e selecionar'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                      onClick={() => { setShowQuickAddPatient(false); setQuickPatientName(''); setQuickPatientPhone(''); }}
                      disabled={creatingPatient}
                    >
                      Cancelar
                    </button>
                  </div>
                  <p className="text-small" style={{ marginTop: '0.4rem', marginBottom: 0 }}>
                    Cadastrado como "Avulsa" — ajuste a modalidade depois em Pacientes.
                  </p>
                </div>
              ) : (
                <select required className="form-control" value={formData.patientId}
                  onChange={e => handlePatientChange(e.target.value)} disabled={submitting}>
                  {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
          )}

          <div className="flex gap-4">
            <div className="form-group w-full">
              <label className="form-label">Data e Hora *</label>
              <input required type="datetime-local" className="form-control"
                value={formData.scheduledAt}
                onChange={e => setFormData({ ...formData, scheduledAt: e.target.value })} disabled={submitting} />
            </div>
            <div className="form-group" style={{ minWidth: '130px' }}>
              <label className="form-label">Duração (min)</label>
              <input type="number" min={10} max={240} className="form-control"
                value={formData.durationMinutes}
                onChange={e => setFormData({ ...formData, durationMinutes: Number(e.target.value) })} disabled={submitting} />
            </div>
            <div className="form-group" style={{ minWidth: '130px' }}>
              <label className="form-label">Modalidade</label>
              <select className="form-control" value={formData.modality} onChange={e => setFormData({ ...formData, modality: e.target.value as 'online' | 'presencial' })} disabled={submitting}>
                <option value="online">Online</option>
                <option value="presencial">Presencial</option>
              </select>
            </div>
          </div>

          {isPastNew && (
            <div className="form-group" style={{
              marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '8px',
              border: '1px solid var(--status-warning)', background: 'rgba(245, 158, 11, 0.08)'
            }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={retroactive}
                  onChange={e => {
                    const checked = e.target.checked;
                    setRetroactive(checked);
                    if (checked) setFormData(prev => ({ ...prev, recurrence: 'none', recurrenceEndDate: '' }));
                  }}
                  disabled={submitting}
                  style={{ marginTop: '0.2rem' }}
                />
                <span>
                  <strong>Atendimento retroativo (já realizado)</strong>
                  <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Esse horário já passou. Marque para registrar uma sessão que já aconteceu — será salva como <strong>Realizada</strong>.
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="flex gap-4">
            <div className="form-group w-full">
              <label className="form-label">Recorrência</label>
              <select className="form-control" value={formData.recurrence}
                onChange={e => {
                  const rec = e.target.value as Appointment['recurrence'];
                  const endDate = rec !== 'none' && !formData.recurrenceEndDate
                    ? getDefaultEndDate(formData.scheduledAt)
                    : rec === 'none' ? '' : formData.recurrenceEndDate;
                  setFormData({ ...formData, recurrence: rec, recurrenceEndDate: endDate });
                }} disabled={submitting || (isPastNew && retroactive)}>
                <option value="none">Avulsa</option>
                <option value="weekly">Semanal</option>
                <option value="biweekly">Quinzenal</option>
                <option value="monthly">Mensal</option>
              </select>
            </div>
            {formData.recurrence !== 'none' && (
              <div className="form-group w-full">
                <label className="form-label">Repetir até</label>
                <input required={formData.recurrence !== ('none' as string)} type="date" className="form-control"
                  value={formData.recurrenceEndDate}
                  onChange={e => setFormData({ ...formData, recurrenceEndDate: e.target.value })} disabled={submitting} />
              </div>
            )}
          </div>

          {appointment && (
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-control" value={formData.status}
                onChange={e => setFormData({ ...formData, status: e.target.value as AppointmentStatus })} disabled={submitting}>
                <option value="scheduled">Agendado</option>
                <option value="confirmed">Confirmado</option>
                <option value="attended">Realizado</option>
                <option value="canceled">Cancelado</option>
                <option value="no_show">Faltou</option>
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Observações</label>
            <input type="text" className="form-control" placeholder="Opcional"
              value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} disabled={submitting} />
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
