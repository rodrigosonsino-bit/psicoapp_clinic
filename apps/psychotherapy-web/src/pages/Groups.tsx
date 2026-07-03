import React, { useState, useEffect, useCallback } from 'react';
import type { Patient } from '../types/api';
import {
  Users, ChevronLeft, ChevronRight, ClipboardCheck,
  Clock, Calendar, CheckCircle2, XCircle, AlertCircle, RefreshCw,
  UserPlus, UserMinus, Search, Pencil, Trash2, Plus, CreditCard, Banknote, Wallet,
  TrendingUp, CircleDollarSign, Hourglass, Save
} from 'lucide-react';
import { fetchApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { SkeletonTable } from '../components/Skeleton';
import './Groups.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type PaymentStatus = 'paid' | 'partial' | 'pending';
type AttendanceStatus = 'present' | 'absent' | 'excused';

interface TherapyGroup {
  id: string;
  name: string;
  description: string | null;
  session_price_cents: number;
  day_of_week: number | null;
  start_time: string | null;
  duration_minutes: number;
  is_active: boolean;
  member_count: number;
  monthly_fee_cents: number | null;
  start_date: string | null;
  duration_months: number | null;
}

interface GroupMember {
  patient_id: string;
  name: string;
  phone: string | null;
  payment_type: string | null;
  patient_status: string;
  payment_status: PaymentStatus;
  paid_sessions: number;
  expected_sessions: number;
  absences: number;
}

interface SessionRecord {
  id: string;
  session_date: string;
  patient_id: string;
  patient_name: string;
  attendance_status: AttendanceStatus;
  payment_status: PaymentStatus | null;
  notes: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid: '✅ Pago',
  partial: '🟡 Parcial',
  pending: '🔴 Pendente',
};


function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function monthStr(d: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
}

function monthLabel(str: string) {
  const [y, m] = str.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Groups() {
  const toast = useToast();
  const [tab, setTab] = useState<'groups' | 'sessions'>('groups');
  const [subTab, setSubTab] = useState<'members' | 'payments'>('members');
  const [groups, setGroups] = useState<TherapyGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<TherapyGroup | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => monthStr(new Date()));
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);

  // Novos estados para CRUD de grupos e pagamentos
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupToEdit, setGroupToEdit] = useState<TherapyGroup | null>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentToConfirm, setPaymentToConfirm] = useState<any | null>(null);
  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);


  // Inline editing for session history
  const [editingPresenceId, setEditingPresenceId] = useState<string | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editingNotesValue, setEditingNotesValue] = useState('');
  const [savingRecordId, setSavingRecordId] = useState<string | null>(null);

  const updateAttendance = useCallback(async (record: SessionRecord, newStatus: AttendanceStatus) => {
    if (!selectedGroup) return;
    try {
      setSavingRecordId(record.id);
      await fetchApi(`/api/psychotherapy/groups/${selectedGroup.id}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          sessionDate: record.session_date.slice(0, 10),
          attendances: [{ patientId: record.patient_id, status: newStatus, notes: record.notes }]
        })
      });
      setSessionHistory(prev => prev.map(r =>
        r.id === record.id ? { ...r, attendance_status: newStatus } : r
      ));
      setEditingPresenceId(null);
      toast.success('Presença atualizada!');
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao atualizar presença.');
    } finally {
      setSavingRecordId(null);
    }
  }, [selectedGroup, toast]);

  const updateNotes = useCallback(async (record: SessionRecord, newNotes: string) => {
    if (!selectedGroup) return;
    try {
      setSavingRecordId(record.id);
      await fetchApi(`/api/psychotherapy/groups/${selectedGroup.id}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          sessionDate: record.session_date.slice(0, 10),
          attendances: [{ patientId: record.patient_id, status: record.attendance_status, notes: newNotes || null }]
        })
      });
      setSessionHistory(prev => prev.map(r =>
        r.id === record.id ? { ...r, notes: newNotes || null } : r
      ));
      setEditingNotesId(null);
      toast.success('Observação atualizada!');
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao atualizar observação.');
    } finally {
      setSavingRecordId(null);
    }
  }, [selectedGroup, toast]);

  // Load groups
  const loadGroups = useCallback(async (selectId?: string) => {
    try {
      setLoadingGroups(true);
      const res = await fetchApi<{ data: TherapyGroup[] }>('/api/psychotherapy/groups');
      setGroups(res.data);
      if (res.data.length > 0) {
        if (selectId) {
          const found = res.data.find(g => g.id === selectId);
          if (found) setSelectedGroup(found);
        } else if (!selectedGroup) {
          setSelectedGroup(res.data[0]);
        }
      } else {
        setSelectedGroup(null);
      }
    } catch {
      toast.error('Erro ao carregar grupos.');
    } finally {
      setLoadingGroups(false);
    }
  }, [toast, selectedGroup]);

  // Load members of selected group
  const loadMembers = useCallback(async (groupId: string, month: string) => {
    try {
      setLoadingMembers(true);
      const res = await fetchApi<{ data: GroupMember[] }>(
        `/api/psychotherapy/groups/${groupId}/members?month=${month}`
      );
      setMembers(res.data);
    } catch {
      toast.error('Erro ao carregar membros.');
    } finally {
      setLoadingMembers(false);
    }
  }, [toast]);

  // Load session history
  const loadHistory = useCallback(async (groupId: string, month: string) => {
    try {
      const res = await fetchApi<{ data: SessionRecord[] }>(
        `/api/psychotherapy/groups/${groupId}/sessions?month=${month}`
      );
      setSessionHistory(res.data);
    } catch {
      setSessionHistory([]);
    }
  }, []);

  // Load payments
  const loadPayments = useCallback(async (groupId: string, month: string) => {
    try {
      setLoadingPayments(true);
      const res = await fetchApi<{ data: any[] }>(
        `/api/psychotherapy/groups/${groupId}/payments?month=${month}`
      );
      setPayments(res.data);
    } catch {
      toast.error('Erro ao carregar pagamentos.');
    } finally {
      setLoadingPayments(false);
    }
  }, [toast]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  useEffect(() => {
    if (selectedGroup) {
      loadMembers(selectedGroup.id, currentMonth);
      loadHistory(selectedGroup.id, currentMonth);
      loadPayments(selectedGroup.id, currentMonth);
    }
  }, [selectedGroup, currentMonth, loadMembers, loadHistory, loadPayments]);

  const prevMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setCurrentMonth(monthStr(d));
  };

  const nextMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    setCurrentMonth(monthStr(d));
  };

  const removeMember = async (patientId: string, name: string) => {
    if (!selectedGroup) return;
    if (!window.confirm(`Tem certeza que deseja remover ${name} do grupo ${selectedGroup.name}?\n\nO histórico financeiro anterior será mantido.`)) {
      return;
    }
    try {
      await fetchApi(`/api/psychotherapy/groups/${selectedGroup.id}/members/${patientId}`, {
        method: 'DELETE'
      });
      toast.success('Membro removido com sucesso!');
      loadMembers(selectedGroup.id, currentMonth);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao remover membro.');
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este grupo? Esta ação não pode ser desfeita.')) return;
    try {
      await fetchApi(`/api/psychotherapy/groups/${groupId}`, { method: 'DELETE' });
      toast.success('Grupo excluído com sucesso!');
      setSelectedGroup(null);
      loadGroups();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao excluir grupo.');
    }
  };

  const handleVoidPayment = async (payment: any) => {
    const reason = window.prompt('Qual o motivo do estorno / cancelamento desta cobrança?');
    if (!reason || !reason.trim()) {
      return;
    }

    try {
      await fetchApi(`/api/psychotherapy/group-payments/${payment.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      toast.success('Cobrança cancelada/estornada com sucesso!');
      if (selectedGroup) {
        loadPayments(selectedGroup.id, currentMonth);
      }
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao estornar cobrança.');
    }
  };

  const openGroupModal = (group: TherapyGroup | null) => {
    setGroupToEdit(group);
    setShowGroupModal(true);
  };

  // Group sessions by date for history view
  const groupedHistory = sessionHistory.reduce<Record<string, SessionRecord[]>>((acc, r) => {
    const date = r.session_date.slice(0, 10);
    (acc[date] = acc[date] || []).push(r);
    return acc;
  }, {});
  const historyDates = Object.keys(groupedHistory).sort().reverse();

  return (
    <div className="groups-page">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-h1">Grupos Terapêuticos</h1>
          <p className="text-body" style={{ marginTop: '0.25rem' }}>
            Gerencie sessões, presenças e faturamento dos grupos
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => openGroupModal(null)}>
            <Plus size={16} />
            Novo Grupo
          </button>
          {selectedGroup && (
            <button
              id="btn-register-group-session"
              className="btn btn-primary"
              onClick={() => setShowRegisterModal(true)}
            >
              <ClipboardCheck size={16} />
              Registrar Sessão
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="groups-tabs">
        <button
          id="tab-groups-list"
          className={`groups-tab ${tab === 'groups' ? 'active' : ''}`}
          onClick={() => setTab('groups')}
        >
          Grupos
        </button>
        <button
          id="tab-sessions-history"
          className={`groups-tab ${tab === 'sessions' ? 'active' : ''}`}
          onClick={() => setTab('sessions')}
        >
          Histórico de Sessões
        </button>
      </div>

      {/* Month Navigator */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="month-nav">
          <button id="btn-prev-month-groups" onClick={prevMonth}><ChevronLeft size={16} /></button>
          <span className="month-label">{monthLabel(currentMonth)}</span>
          <button id="btn-next-month-groups" onClick={nextMonth}><ChevronRight size={16} /></button>
        </div>
        <span className="text-small">
          {groups.length} grupo{groups.length !== 1 ? 's' : ''}
        </span>
      </div>

      {tab === 'groups' ? (
        // ── Groups + Members view ──────────────────────────────────────────
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.25rem', alignItems: 'start' }}>
          {/* Left: group cards */}
          <div>
            {loadingGroups ? (
              <SkeletonTable rows={3} cols={1} />
            ) : groups.length === 0 ? (
              <div className="groups-empty">
                <Users size={36} />
                <p>Nenhum grupo encontrado.</p>
                <p className="text-small">Crie um grupo utilizando o botão "Novo Grupo" no topo.</p>
              </div>
            ) : (
              <div className="groups-grid" style={{ gridTemplateColumns: '1fr' }}>
                {groups.map(g => (
                  <div
                    key={g.id}
                    id={`group-card-${g.id}`}
                    className={`group-card ${selectedGroup?.id === g.id ? 'selected' : ''}`}
                    onClick={() => setSelectedGroup(g)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && setSelectedGroup(g)}
                  >
                    <div className="group-card-header">
                      <span className="group-card-name">{g.name}</span>
                      <span className={`badge ${g.is_active ? 'badge-success' : 'badge-danger'}`}>
                        {g.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <div className="group-card-meta">
                      {g.day_of_week !== null && (
                        <span className="group-meta-row">
                          <Calendar size={12} />
                          {DAY_NAMES[g.day_of_week]}
                          {g.start_time ? ` • ${g.start_time.slice(0, 5)}` : ''}
                        </span>
                      )}
                      <span className="group-meta-row">
                        <Clock size={12} />
                        {g.duration_minutes} min • {g.monthly_fee_cents !== null && g.monthly_fee_cents > 0 ? `${formatCurrency(g.monthly_fee_cents)}/mês` : `${formatCurrency(g.session_price_cents)}/sessão`}
                      </span>
                      {g.duration_months && (
                        <span className="group-meta-row">
                          <Calendar size={12} />
                          {g.duration_months} meses {g.start_date ? `• início ${formatDate(g.start_date)}` : ''}
                        </span>
                      )}
                    </div>
                    <div className="group-card-footer">
                      <span className="group-member-count">
                        <Users size={12} />
                        {g.member_count} membro{g.member_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: members of selected group */}
          <div>
            {selectedGroup ? (
              <div className="group-detail-panel">
                <div className="group-panel-header">
                  <span className="group-panel-title">
                    <Users size={18} />
                    {selectedGroup.name}
                  </span>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                      title="Editar grupo"
                      onClick={() => openGroupModal(selectedGroup)}
                    >
                      <Pencil size={13} /> Editar
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                      title="Excluir grupo"
                      onClick={() => handleDeleteGroup(selectedGroup.id)}
                    >
                      <Trash2 size={13} /> Excluir
                    </button>
                    <button
                      id="btn-add-member"
                      className="btn btn-secondary"
                      style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                      onClick={() => setShowAddMemberModal(true)}
                    >
                      <UserPlus size={13} />
                      Membro
                    </button>
                    <button
                      id="btn-refresh-members"
                      className="btn btn-secondary"
                      style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                      onClick={() => {
                        loadMembers(selectedGroup.id, currentMonth);
                        loadPayments(selectedGroup.id, currentMonth);
                      }}
                    >
                      <RefreshCw size={13} />
                      Atualizar
                    </button>
                  </div>
                </div>

                {/* Resumo Financeiro */}
                <FinancialSummary
                  group={selectedGroup}
                  members={members}
                  payments={payments}
                  loading={loadingMembers || loadingPayments}
                />

                {/* Sub-Abas: Membros | Pagamentos */}
                <div className="groups-subtabs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <button
                      className={`groups-subtab ${subTab === 'members' ? 'active' : ''}`}
                      onClick={() => setSubTab('members')}
                    >
                      Membros
                    </button>
                    <button
                      className={`groups-subtab ${subTab === 'payments' ? 'active' : ''}`}
                      onClick={() => setSubTab('payments')}
                    >
                      Pagamentos
                    </button>
                  </div>
                  
                  {subTab === 'payments' && (
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                      onClick={async () => {
                        try {
                          await fetchApi(`/api/psychotherapy/groups/${selectedGroup.id}/charges`, {
                            method: 'POST',
                            body: JSON.stringify({ referenceMonth: currentMonth })
                          });
                          toast.success('Cobranças geradas com sucesso!');
                          loadPayments(selectedGroup.id, currentMonth);
                        } catch (err) {
                          toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao gerar cobranças.');
                        }
                      }}
                    >
                      <CircleDollarSign size={13} style={{ marginRight: '4px' }} />
                      Gerar Cobranças
                    </button>
                  )}
                </div>

                {subTab === 'payments' ? (
                  /* ── Sub-Aba Pagamentos ── */
                  loadingPayments ? (
                    <SkeletonTable rows={4} cols={4} />
                  ) : payments.length === 0 ? (
                    <div className="groups-empty">
                      <Users size={28} />
                      <p>Nenhum membro ativo neste grupo.</p>
                    </div>
                  ) : (
                    <div className="table-container">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Paciente</th>
                            <th>Status</th>
                            <th>Total Pago</th>
                            <th style={{ width: '150px', textAlign: 'right' }}>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.map(m => {
                            const hasPayments = m.payments && m.payments.length > 0;
                            const isExpanded = expandedPatientId === m.patient_id;

                            return (
                              <React.Fragment key={m.patient_id}>
                                <tr>
                                  <td>
                                    <strong style={{ color: 'var(--text-primary)' }}>{m.name}</strong>
                                    {isExpanded && hasPayments && (
                                      <div className="payment-history-list">
                                        {m.payments.map((p: any) => (
                                          <div key={p.id} className="payment-history-item">
                                            <span>
                                              {formatCurrency(p.amount_cents)} 
                                              {p.status === 'paid' && p.payment_method && ` (${p.payment_method === 'pix' ? 'PIX' : p.payment_method === 'cash' ? 'Dinheiro' : p.payment_method === 'debit_card' ? 'Débito' : 'Crédito'})`}
                                              <span className={`payment-pill ${p.status}`} style={{ display: 'inline-flex', padding: '0.1rem 0.4rem', fontSize: '0.65rem', marginLeft: '0.5rem' }}>
                                                {p.status === 'paid' ? 'Pago' : p.status === 'pending' ? 'Pendente' : 'Cancelado'}
                                              </span>
                                            </span>
                                            <div className="flex gap-1">

                                              {p.status !== 'voided' && (
                                                <button
                                                  className="icon-btn danger"
                                                  style={{ padding: '2px' }}
                                                  onClick={() => handleVoidPayment(p)}
                                                  title="Estornar/Cancelar esta cobrança"
                                                >
                                                  <Trash2 size={12} />
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td>
                                    <span className={`payment-pill ${m.payment_status}`}>
                                      <span className={`payment-dot ${m.payment_status}`} />
                                      {PAYMENT_LABEL[m.payment_status as PaymentStatus]}
                                    </span>
                                  </td>
                                  <td>
                                    <strong>{formatCurrency(m.total_paid_cents)}</strong>
                                    {m.total_installments && m.total_installments > 1 && (
                                      <div className="text-small" style={{ color: 'var(--text-muted)' }}>
                                        {m.payments_count} de {m.total_installments} parcelas
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <div className="flex gap-2 justify-end">
                                      {m.payment_status === 'pending' && (
                                        <button
                                          className="btn btn-primary btn-sm"
                                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                          onClick={() => {
                                            const pending = m.payments?.find((p: any) => p.status === 'pending');
                                            if (pending) {
                                              setPaymentToConfirm(pending);
                                              setShowPaymentModal(true);
                                            } else {
                                              toast.error('Nenhuma cobrança pendente gerada. Clique em Gerar Cobranças.');
                                            }
                                          }}
                                        >
                                          Registrar
                                        </button>
                                      )}
                                      {m.payment_status === 'partial' && (
                                        <button
                                          className="btn btn-secondary btn-sm"
                                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                          onClick={() => {
                                            const pending = m.payments?.find((p: any) => p.status === 'pending' || p.status === 'partial');
                                            if (pending) {
                                              setPaymentToConfirm(pending);
                                              setShowPaymentModal(true);
                                            }
                                          }}
                                        >
                                          + Parcela
                                        </button>
                                      )}
                                      {hasPayments && (
                                        <button
                                          className="btn btn-secondary btn-sm"
                                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                          onClick={() => setExpandedPatientId(isExpanded ? null : m.patient_id)}
                                        >
                                          {isExpanded ? 'Ocultar' : 'Ver'}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  /* ── Sub-Aba Membros ── */
                  loadingMembers ? (
                    <SkeletonTable rows={4} cols={4} />
                  ) : members.length === 0 ? (
                    <div className="groups-empty">
                      <Users size={28} />
                      <p>Nenhum membro ativo neste grupo.</p>
                    </div>
                  ) : (
                    <div className="table-container">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Paciente</th>
                            <th>Sessões</th>
                            <th style={{ textAlign: 'center' }}>Status {currentMonth.slice(0, 7)}</th>
                            <th>Tipo</th>
                            <th style={{ width: '40px' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {members.map(m => (
                            <tr key={m.patient_id}>
                              <td>
                                <strong style={{ color: 'var(--text-primary)' }}>{m.name}</strong>
                                {m.phone && <div className="text-small">{m.phone}</div>}
                              </td>
                              <td>
                                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                  {m.paid_sessions}/{m.expected_sessions}
                                  {m.absences > 0 && (
                                    <span style={{ color: 'var(--status-warning)', marginLeft: '0.35rem' }}>
                                      ({m.absences} falta{m.absences !== 1 ? 's' : ''})
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span className={`payment-pill ${m.payment_status}`}>
                                  <span className={`payment-dot ${m.payment_status}`} />
                                  {PAYMENT_LABEL[m.payment_status]}
                                </span>
                              </td>
                              <td>
                                <span className="text-small" style={{ textTransform: 'capitalize' }}>
                                  {m.payment_type === 'monthly' ? 'Mensal' : 'Por sessão'}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="icon-btn danger"
                                  title="Remover Membro"
                                  onClick={() => removeMember(m.patient_id, m.name)}
                                >
                                  <UserMinus size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            ) : (
              <div className="groups-empty" style={{ height: '100%', minHeight: '200px' }}>
                <Users size={28} />
                <p>Selecione um grupo para ver os membros e pagamentos</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        // ── Session History view ───────────────────────────────────────────
        <div>
          {!selectedGroup ? (
            <div className="groups-empty">
              <Users size={28} />
              <p>Selecione um grupo na aba "Grupos" primeiro.</p>
            </div>
          ) : historyDates.length === 0 ? (
            <div className="groups-empty">
              <ClipboardCheck size={28} />
              <p>Nenhuma sessão registrada em {monthLabel(currentMonth)}.</p>
            </div>
          ) : (
            <div>
              {historyDates.map(date => (
                <div key={date} className="session-date-group">
                  <div className="session-date-label">
                    {new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', {
                      weekday: 'long', day: '2-digit', month: 'long'
                    })}
                  </div>
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Paciente</th>
                          <th>Presença</th>
                          <th>Obs.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedHistory[date].map(r => (
                          <tr key={r.id}>
                            <td>
                              <strong style={{ color: 'var(--text-primary)' }}>{r.patient_name}</strong>
                            </td>
                            <td>
                              {editingPresenceId === r.id ? (
                                <div className="attendance-toggle" style={{ display: 'flex', gap: '0.25rem' }}>
                                  <button
                                    type="button"
                                    className={`attendance-btn ${r.attendance_status === 'present' ? 'active-present' : ''}`}
                                    onClick={() => updateAttendance(r, 'present')}
                                    disabled={savingRecordId === r.id}
                                  >✓ Pres.</button>
                                  <button
                                    type="button"
                                    className={`attendance-btn ${r.attendance_status === 'absent' ? 'active-absent' : ''}`}
                                    onClick={() => updateAttendance(r, 'absent')}
                                    disabled={savingRecordId === r.id}
                                  >✗ Falta</button>
                                  <button
                                    type="button"
                                    className={`attendance-btn ${r.attendance_status === 'excused' ? 'active-excused' : ''}`}
                                    onClick={() => updateAttendance(r, 'excused')}
                                    disabled={savingRecordId === r.id}
                                  >⚠ Just.</button>
                                  <button
                                    type="button"
                                    className="attendance-btn"
                                    onClick={() => setEditingPresenceId(null)}
                                    title="Cancelar"
                                  >✕</button>
                                </div>
                              ) : (
                                <span
                                  className="flex items-center gap-2"
                                  style={{ cursor: 'pointer', ...(r.attendance_status === 'present' ? { color: 'var(--status-success)' } : r.attendance_status === 'absent' ? { color: 'var(--status-danger)' } : { color: 'var(--status-warning)' }) }}
                                  onClick={() => setEditingPresenceId(r.id)}
                                  title="Clique para editar presença"
                                >
                                  {r.attendance_status === 'present' && <><CheckCircle2 size={14} /> Presente</>}
                                  {r.attendance_status === 'absent' && <><XCircle size={14} /> Faltou</>}
                                  {r.attendance_status === 'excused' && <><AlertCircle size={14} /> Justificado</>}
                                  <Pencil size={11} style={{ opacity: 0.4, marginLeft: '0.15rem' }} />
                                </span>
                              )}
                            </td>
                            <td className="text-small">
                              {editingNotesId === r.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    className="form-control"
                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', minWidth: '120px' }}
                                    value={editingNotesValue}
                                    onChange={e => setEditingNotesValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') { e.preventDefault(); updateNotes(r, editingNotesValue); }
                                      if (e.key === 'Escape') { setEditingNotesId(null); }
                                    }}
                                    autoFocus
                                    disabled={savingRecordId === r.id}
                                  />
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    onClick={() => updateNotes(r, editingNotesValue)}
                                    disabled={savingRecordId === r.id}
                                    title="Salvar"
                                  >
                                    <Save size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    onClick={() => setEditingNotesId(null)}
                                    title="Cancelar"
                                  >
                                    <XCircle size={12} />
                                  </button>
                                </div>
                              ) : (
                                <span
                                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                  onClick={() => { setEditingNotesId(r.id); setEditingNotesValue(r.notes ?? ''); }}
                                  title="Clique para editar observação"
                                >
                                  {r.notes ?? <em style={{ color: 'var(--text-muted)' }}>—</em>}
                                  <Pencil size={10} style={{ opacity: 0.35, flexShrink: 0 }} />
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Register Session Modal */}
      {showRegisterModal && selectedGroup && (
        <RegisterSessionModal
          group={selectedGroup}
          members={members}
          onClose={() => setShowRegisterModal(false)}
          onSuccess={() => {
            setShowRegisterModal(false);
            toast.success('Sessão registrada com sucesso!');
            loadMembers(selectedGroup.id, currentMonth);
            loadHistory(selectedGroup.id, currentMonth);
          }}
        />
      )}

      {/* Add Member Modal */}
      {showAddMemberModal && selectedGroup && (
        <AddMemberModal
          group={selectedGroup}
          currentMembers={members}
          onClose={() => setShowAddMemberModal(false)}
          onSuccess={() => {
            setShowAddMemberModal(false);
            toast.success('Membro adicionado com sucesso!');
            loadMembers(selectedGroup.id, currentMonth);
          }}
        />
      )}

      {/* Group Form Modal */}
      {showGroupModal && (
        <GroupFormModal
          group={groupToEdit}
          onClose={() => setShowGroupModal(false)}
          onSuccess={(savedGroup) => {
            setShowGroupModal(false);
            toast.success(groupToEdit ? 'Grupo atualizado com sucesso!' : 'Grupo criado com sucesso!');
            loadGroups(savedGroup.id);
          }}
        />
      )}



      {/* Payment Modal */}
      {showPaymentModal && selectedGroup && paymentToConfirm && (
        <ConfirmPaymentModal
          payment={paymentToConfirm}
          onClose={() => {
            setShowPaymentModal(false);
            setPaymentToConfirm(null);
          }}
          onSuccess={() => {
            setShowPaymentModal(false);
            setPaymentToConfirm(null);
            toast.success('Pagamento registrado com sucesso!');
            loadPayments(selectedGroup.id, currentMonth);
          }}
        />
      )}
    </div>
  );
}



// ── Financial Summary ─────────────────────────────────────────────────────────

function FinancialSummary({
  group, members, payments, loading
}: {
  group: TherapyGroup;
  members: GroupMember[];
  payments: any[];
  loading: boolean;
}) {
  if (loading || members.length === 0) return null;

  const feePerMember = group.monthly_fee_cents ?? 0;
  const totalExpected = members.length * feePerMember;
  const totalReceived = payments.reduce((sum: number, p: any) => sum + (p.total_paid_cents || 0), 0);
  // Cálculo por paciente: evita que pagamento excedente de um membro mascare dívida de outro
  const totalPending = payments.reduce((sum: number, p: any) => {
    const fee = p.monthly_fee_cents ?? feePerMember;
    const paid = p.total_paid_cents ?? 0;
    return sum + Math.max(0, fee - paid);
  }, 0);

  const paidCount = payments.filter((p: any) => p.payment_status === 'paid').length;
  const partialCount = payments.filter((p: any) => p.payment_status === 'partial').length;
  const pendingCount = payments.filter((p: any) => p.payment_status === 'pending').length;
  const total = payments.length;
  const adimplencia = total > 0 ? Math.round((paidCount / total) * 100) : 0;

  return (
    <div className="fin-summary">
      <div className="fin-kpi-row">
        <div className="fin-kpi fin-kpi--neutral">
          <span className="fin-kpi-icon"><CircleDollarSign size={15} /></span>
          <div>
            <span className="fin-kpi-label">Receita esperada</span>
            <span className="fin-kpi-value">{formatCurrency(totalExpected)}</span>
          </div>
        </div>
        <div className="fin-kpi fin-kpi--success">
          <span className="fin-kpi-icon"><TrendingUp size={15} /></span>
          <div>
            <span className="fin-kpi-label">Recebido</span>
            <span className="fin-kpi-value">{formatCurrency(totalReceived)}</span>
          </div>
        </div>
        <div className="fin-kpi fin-kpi--danger">
          <span className="fin-kpi-icon"><Hourglass size={15} /></span>
          <div>
            <span className="fin-kpi-label">Pendente</span>
            <span className="fin-kpi-value">{formatCurrency(totalPending)}</span>
          </div>
        </div>
      </div>

      <div className="fin-status-row">
        <span className="fin-status-pill fin-status-pill--paid">
          <span className="payment-dot paid" />
          {paidCount} pago{paidCount !== 1 ? 's' : ''}
        </span>
        <span className="fin-status-pill fin-status-pill--partial">
          <span className="payment-dot partial" />
          {partialCount} parcial{partialCount !== 1 ? 'is' : ''}
        </span>
        <span className="fin-status-pill fin-status-pill--pending">
          <span className="payment-dot pending" />
          {pendingCount} pendente{pendingCount !== 1 ? 's' : ''}
        </span>
        <span className="fin-adimplencia">
          {adimplencia}% adimplência
        </span>
      </div>
    </div>
  );
}

// ── Register Session Modal ────────────────────────────────────────────────────

function RegisterSessionModal({
  group, members, onClose, onSuccess
}: {
  group: TherapyGroup;
  members: GroupMember[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();

  // Default date = today
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const [sessionDate, setSessionDate] = useState(today);
  const [sessionNotes, setSessionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Attendance state per member: default = 'present'
  const [attendances, setAttendances] = useState<Record<string, AttendanceStatus>>(
    () => Object.fromEntries(members.map(m => [m.patient_id, 'present' as AttendanceStatus]))
  );

  const setStatus = (patientId: string, status: AttendanceStatus) => {
    setAttendances(prev => ({ ...prev, [patientId]: status }));
    setConfirmed(false); // reset confirmation when attendance changes
  };

  const counts = {
    present: Object.values(attendances).filter(s => s === 'present').length,
    absent: Object.values(attendances).filter(s => s === 'absent').length,
    excused: Object.values(attendances).filter(s => s === 'excused').length,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!confirmed) {
      setConfirmed(true);
      return; // first click = show confirmation summary
    }

    try {
      setSubmitting(true);
      await fetchApi(`/api/psychotherapy/groups/${group.id}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          sessionDate,
          sessionNotes: sessionNotes || null,
          attendances: members.map(m => ({
            patientId: m.patient_id,
            status: attendances[m.patient_id] ?? 'present',
          })),
        }),
      });
      onSuccess();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao registrar sessão.');
      setConfirmed(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-fade-in" style={{ maxWidth: '580px' }}>
        <h2 className="text-h2 mb-4">Registrar Sessão — {group.name}</h2>

        <form onSubmit={handleSubmit}>
          {/* Date & Notes */}
          <div className="flex gap-4 mb-4">
            <div className="form-group w-full">
              <label className="form-label">Data da Sessão *</label>
              <input
                id="input-session-date"
                type="date"
                required
                className="form-control"
                value={sessionDate}
                onChange={e => { setSessionDate(e.target.value); setConfirmed(false); }}
                disabled={submitting}
              />
            </div>
            <div className="form-group w-full">
              <label className="form-label">Notas da Sessão</label>
              <input
                id="input-session-notes"
                type="text"
                className="form-control"
                placeholder="Opcional"
                value={sessionNotes}
                onChange={e => setSessionNotes(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {/* Attendance list */}
          <div className="form-group">
            <label className="form-label">Presença dos Membros ({members.length})</label>
            <div className="attendance-list">
              {members.map(m => (
                <div key={m.patient_id} className="attendance-row">
                  <span className="attendance-name">{m.name}</span>
                  <div className="attendance-toggle">
                    <button
                      type="button"
                      id={`att-present-${m.patient_id}`}
                      className={`attendance-btn ${attendances[m.patient_id] === 'present' ? 'active-present' : ''}`}
                      onClick={() => setStatus(m.patient_id, 'present')}
                      title="Presente"
                    >
                      ✓ Pres.
                    </button>
                    <button
                      type="button"
                      id={`att-absent-${m.patient_id}`}
                      className={`attendance-btn ${attendances[m.patient_id] === 'absent' ? 'active-absent' : ''}`}
                      onClick={() => setStatus(m.patient_id, 'absent')}
                      title="Faltou"
                    >
                      ✗ Falta
                    </button>
                    <button
                      type="button"
                      id={`att-excused-${m.patient_id}`}
                      className={`attendance-btn ${attendances[m.patient_id] === 'excused' ? 'active-excused' : ''}`}
                      onClick={() => setStatus(m.patient_id, 'excused')}
                      title="Falta Justificada"
                    >
                      ⚠ Just.
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Confirmation summary (shown after first click) */}
          {confirmed && (
            <div className="register-summary">
              <div>
                <strong>{sessionDate}</strong> — {group.name}<br />
                <span style={{ fontSize: '0.8rem' }}>
                  ✅ {counts.present} presentes &nbsp;|&nbsp;
                  ❌ {counts.absent} faltas &nbsp;|&nbsp;
                  ⚠️ {counts.excused} justificados
                </span>
              </div>
            </div>
          )}

          {confirmed && (
            <p className="submit-guard-hint">
              Confirma o registro acima? Clique em <strong>Confirmar Sessão</strong> para salvar.
            </p>
          )}

          <div className="flex justify-end gap-2" style={{ marginTop: '1.25rem' }}>
            <button
              id="btn-cancel-register-session"
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              id="btn-submit-register-session"
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting
                ? 'Salvando...'
                : confirmed
                  ? '✓ Confirmar Sessão'
                  : 'Revisar & Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Member Modal ──────────────────────────────────────────────────────────

function AddMemberModal({
  group, currentMembers, onClose, onSuccess
}: {
  group: TherapyGroup;
  currentMembers: GroupMember[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<'search' | 'create'>('search');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Formulário para novo paciente
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [document] = useState('');
  const [email, setEmail] = useState('');
  const [paymentType, setPaymentType] = useState('none');
  const [requestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        const params = new URLSearchParams({ limit: '100' });
        if (search) {
          params.set('search', search);
        }
        const res = await fetchApi<{ data: Patient[] }>(`/api/psychotherapy/patients?${params}`);
        if (active) {
          setPatients(res.data);
        }
      } catch {
        if (active) {
          toast.error('Erro ao carregar pacientes.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    if (tab === 'search') {
      const timer = setTimeout(() => {
        load();
      }, 300);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }
  }, [search, tab, toast]);

  const currentIds = new Set(currentMembers.map(m => m.patient_id));
  const availablePatients = patients.filter(p => !currentIds.has(p.id));

  const handleAddExisting = async (patientId: string) => {
    try {
      setSubmitting(true);
      await fetchApi(`/api/psychotherapy/groups/${group.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ patientId })
      });
      onSuccess();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao adicionar membro.');
      setSubmitting(false);
    }
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('O nome é obrigatório.');
      return;
    }
    try {
      setSubmitting(true);
      await fetchApi(`/api/psychotherapy/groups/${group.id}/members-new`, {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          name,
          phone,
          document,
          email,
          paymentType
        })
      });
      toast.success('Membro criado e adicionado com sucesso!');
      onSuccess();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao criar novo membro.');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-fade-in" style={{ maxWidth: '480px' }}>
        <h2 className="text-h2 mb-4">Adicionar Membro — {group.name}</h2>

        <div className="tabs mb-4">
          <button
            className={`tab ${tab === 'search' ? 'active' : ''}`}
            onClick={() => setTab('search')}
          >
            Buscar Existente
          </button>
          <button
            className={`tab ${tab === 'create' ? 'active' : ''}`}
            onClick={() => setTab('create')}
          >
            Criar Novo
          </button>
        </div>

        {tab === 'search' && (
          <>
            <div className="search-bar" style={{ marginBottom: '1rem', position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: '#999' }} />
              <input
                type="text"
                className="form-control"
                placeholder="Buscar paciente..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: '36px' }}
                autoFocus
              />
            </div>

            <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: '6px' }}>
              {loading ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Carregando...</div>
              ) : patients.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  {search ? 'Nenhum paciente encontrado na busca.' : 'Nenhum paciente cadastrado.'}
                </div>
              ) : availablePatients.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Todos os pacientes correspondentes já estão neste grupo.
                </div>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {availablePatients.map(p => (
                    <li 
                      key={p.id} 
                      style={{ 
                        padding: '0.75rem 1rem', 
                        borderBottom: '1px solid var(--border-light)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <strong>{p.name}</strong>
                        <div className="text-small" style={{ color: 'var(--text-secondary)' }}>
                          {p.status === 'inactive' ? 'Inativo' : 'Ativo'}
                        </div>
                      </div>
                      <button 
                        className="btn btn-primary"
                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => handleAddExisting(p.id)}
                        disabled={submitting}
                      >
                        Adicionar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {tab === 'create' && (
          <form onSubmit={handleCreateNew} id="create-member-form">
            <div className="form-group">
              <label className="form-label">Nome Completo *</label>
              <input
                type="text"
                className="form-control"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                disabled={submitting}
                autoFocus
              />
            </div>
            <div className="form-group mt-3">
              <label className="form-label">Celular</label>
              <input
                type="text"
                className="form-control"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="Ex: (11) 99999-9999"
                disabled={submitting}
              />
            </div>
            <div className="form-group mt-3">
              <label className="form-label">E-mail</label>
              <input
                type="email"
                className="form-control"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="form-group mt-3">
              <label className="form-label">Forma de Pagamento Base</label>
              <select
                className="form-control"
                value={paymentType}
                onChange={e => setPaymentType(e.target.value)}
                disabled={submitting}
              >
                <option value="none">Paga pelo Grupo (Recomendado)</option>
                <option value="session">Por Sessão</option>
                <option value="monthly">Mensalidade</option>
              </select>
              <span className="text-small text-secondary mt-1 block">
                Pacientes exclusivos de grupo não devem gerar faturamento na aba Pacientes.
              </span>
            </div>
          </form>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button
            className="btn btn-secondary"
            onClick={onClose}
            disabled={submitting}
            type="button"
          >
            Cancelar
          </button>
          {tab === 'create' && (
            <button
              className="btn btn-primary"
              type="submit"
              form="create-member-form"
              disabled={submitting || !name.trim()}
            >
              {submitting ? 'Criando...' : 'Criar e Adicionar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Group Form Modal (Criar/Editar Grupo) ──────────────────────────────────────

function GroupFormModal({
  group, onClose, onSuccess
}: {
  group: TherapyGroup | null;
  onClose: () => void;
  onSuccess: (savedGroup: TherapyGroup) => void;
}) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [monthlyFee, setMonthlyFee] = useState(group?.monthly_fee_cents ? String(group.monthly_fee_cents / 100) : '0');
  const [dayOfWeek, setDayOfWeek] = useState(group?.day_of_week !== null && group?.day_of_week !== undefined ? String(group.day_of_week) : '');
  const [startTime, setStartTime] = useState(group?.start_time ? group.start_time.slice(0, 5) : '');
  const [durationMinutes, setDurationMinutes] = useState(group?.duration_minutes ? String(group.duration_minutes) : '90');
  const [startDate, setStartDate] = useState(group?.start_date ? group.start_date.slice(0, 10) : '');
  const [durationMonths, setDurationMonths] = useState(group?.duration_months ? String(group.duration_months) : '');

  const calculateEndDate = (startDateStr: string, monthsStr: string) => {
    if (!startDateStr || !monthsStr) return '';
    const months = parseInt(monthsStr, 10);
    if (isNaN(months) || months <= 0) return '';
    const [y, m, d] = startDateStr.split('-').map(Number);
    const date = new Date(y, m - 1 + months, d);
    return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name) {
      toast.error('Nome do grupo é obrigatório');
      return;
    }

    try {
      setSubmitting(true);
      const url = group ? `/api/psychotherapy/groups/${group.id}` : '/api/psychotherapy/groups';
      const method = group ? 'PUT' : 'POST';

      const res = await fetchApi<{ data: TherapyGroup }>(url, {
        method,
        body: JSON.stringify({
          name,
          description: description || null,
          monthly_fee_cents: Math.round(parseFloat(monthlyFee) * 100),
          day_of_week: dayOfWeek !== '' ? parseInt(dayOfWeek, 10) : null,
          start_time: startTime || null,
          duration_minutes: parseInt(durationMinutes, 10),
          start_date: startDate || null,
          duration_months: durationMonths !== '' ? parseInt(durationMonths, 10) : null
        })
      });

      onSuccess(res.data);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao salvar grupo.');
    } finally {
      setSubmitting(false);
    }
  };

  const endPreview = calculateEndDate(startDate, durationMonths);

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-fade-in" style={{ maxWidth: '540px' }}>
        <h2 className="text-h2 mb-4">{group ? 'Editar Grupo' : 'Novo Grupo'}</h2>

        <form onSubmit={handleSubmit}>
          <div className="form-group mb-3">
            <label className="form-label">Nome do Grupo *</label>
            <input
              type="text"
              className="form-control"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <div className="form-group mb-3">
            <label className="form-label">Descrição</label>
            <textarea
              className="form-control"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              disabled={submitting}
            />
          </div>

          <div className="flex gap-4 mb-3">
            <div className="form-group w-full">
              <label className="form-label">Mensalidade (R$) *</label>
              <input
                type="number"
                className="form-control"
                value={monthlyFee}
                onChange={e => setMonthlyFee(e.target.value)}
                min="0"
                step="0.01"
                required
                disabled={submitting}
              />
            </div>
            <div className="form-group w-full">
              <label className="form-label">Duração da Sessão (min) *</label>
              <input
                type="number"
                className="form-control"
                value={durationMinutes}
                onChange={e => setDurationMinutes(e.target.value)}
                min="10"
                required
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex gap-4 mb-3">
            <div className="form-group w-full">
              <label className="form-label">Dia da Semana</label>
              <select
                className="form-control"
                value={dayOfWeek}
                onChange={e => setDayOfWeek(e.target.value)}
                disabled={submitting}
              >
                <option value="">Sem dia fixo</option>
                <option value="1">Segunda-feira</option>
                <option value="2">Terça-feira</option>
                <option value="3">Quarta-feira</option>
                <option value="4">Quinta-feira</option>
                <option value="5">Sexta-feira</option>
                <option value="6">Sábado</option>
                <option value="0">Domingo</option>
              </select>
            </div>
            <div className="form-group w-full">
              <label className="form-label">Horário</label>
              <input
                type="time"
                className="form-control"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex gap-4 mb-3">
            <div className="form-group w-full">
              <label className="form-label">Data de Início</label>
              <input
                type="date"
                className="form-control"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="form-group w-full">
              <label className="form-label">Duração do Programa (meses)</label>
              <input
                type="number"
                className="form-control"
                value={durationMonths}
                onChange={e => setDurationMonths(e.target.value)}
                min="1"
                disabled={submitting}
              />
            </div>
          </div>

          {endPreview && (
            <div className="mb-4 text-small" style={{ color: 'var(--brand-primary)', fontWeight: 500 }}>
              📅 Término previsto: <span style={{ textTransform: 'capitalize' }}>{endPreview}</span>
            </div>
          )}

          <div className="flex justify-end gap-2" style={{ marginTop: '1.25rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? 'Salvando...' : 'Salvar grupo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Payment Modal (Registrar Pagamento de Grupo) ──────────────────────────────────

function ConfirmPaymentModal({
  payment, onClose, onSuccess
}: {
  payment: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'cash' | 'debit_card' | 'credit_card'>('pix');
  const [amount, setAmount] = useState(String((payment.amount_cents || 0) / 100));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      toast.error('Valor inválido');
      return;
    }

    try {
      setSubmitting(true);
      await fetchApi(`/api/psychotherapy/group-payments/${payment.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod,
          amountPaidCents: amountCents
        })
      });
      onSuccess();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao confirmar pagamento.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-fade-in" style={{ maxWidth: '480px' }}>
        <h2 className="text-h2 mb-2">Confirmar Pagamento</h2>
        <p className="text-body mb-4" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Mês de referência: <span style={{ textTransform: 'capitalize' }}>{monthLabel(payment.reference_month)}</span><br />
          Valor Original: <strong>{formatCurrency(payment.amount_cents)}</strong>
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group mb-4">
            <label className="form-label">Forma de Pagamento</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <button
                type="button"
                className={`btn ${paymentMethod === 'pix' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ justifyContent: 'center', gap: '0.35rem', fontSize: '0.85rem', padding: '0.5rem' }}
                onClick={() => setPaymentMethod('pix')}
              >
                <Wallet size={14} /> PIX
              </button>
              <button
                type="button"
                className={`btn ${paymentMethod === 'cash' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ justifyContent: 'center', gap: '0.35rem', fontSize: '0.85rem', padding: '0.5rem' }}
                onClick={() => setPaymentMethod('cash')}
              >
                <Banknote size={14} /> Dinheiro
              </button>
              <button
                type="button"
                className={`btn ${paymentMethod === 'debit_card' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ justifyContent: 'center', gap: '0.35rem', fontSize: '0.85rem', padding: '0.5rem' }}
                onClick={() => setPaymentMethod('debit_card')}
              >
                <CreditCard size={14} /> Débito
              </button>
              <button
                type="button"
                className={`btn ${paymentMethod === 'credit_card' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ justifyContent: 'center', gap: '0.35rem', fontSize: '0.85rem', padding: '0.5rem' }}
                onClick={() => setPaymentMethod('credit_card')}
              >
                <CreditCard size={14} /> Crédito
              </button>
            </div>
          </div>

          <div className="form-group mb-3">
            <label className="form-label">Valor Efetivamente Pago (R$)</label>
            <input
              type="number"
              className="form-control"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              min="0.01"
              step="0.01"
              required
              disabled={submitting}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? 'Salvando...' : 'Confirmar pagamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
