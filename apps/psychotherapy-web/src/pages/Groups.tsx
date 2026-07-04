import React, { useState, useEffect, useCallback } from 'react';
import type { Patient, TenantProfile, CardFeeRates } from '../types/api';
import {
  Users, ChevronLeft, ChevronRight, ClipboardCheck,
  Clock, Calendar, CheckCircle2, XCircle, AlertCircle, RefreshCw,
  UserPlus, UserMinus, Search, Pencil, Trash2, Plus, CreditCard, Banknote, Wallet,
  TrendingUp, CircleDollarSign, Hourglass, Save, X
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
  payment_type: BillingType | null;
  patient_status: string;
  payment_status: PaymentStatus;
  paid_sessions: number;
  expected_sessions: number;
  absences: number;
}

/** billing_type vindo do backend: 'group_default' (mensal), 'upfront' (pacote), 'exempt' (isento). */
type BillingType = 'group_default' | 'upfront' | 'exempt' | string;

interface GroupPaymentSummary {
  patient_id: string;
  group_member_id: string;
  name: string;
  payment_type: BillingType;
  total_paid_cents: number;
  total_net_cents: number;
  total_fee_cents: number;
  payments_count: number;
  total_installments: number | null;
  monthly_fee_cents: number | null;
  payment_status: PaymentStatus;
  payments: any[];
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

/**
 * billing_type real do backend só assume 'group_default' | 'upfront' | 'exempt'
 * (therapy_group_member_billing_policies, migration 079) — não 'monthly'/'installments',
 * que nunca chegam a existir. "Parcelado" não é um tipo de plano nesta modelagem: um membro
 * mensal que pré-pagou meses futuros (via "Adiantar Parcelas") continua sendo 'group_default'.
 */
function billingTypeLabel(type: BillingType | null | undefined): string {
  switch (type) {
    case 'upfront': return 'Pacote Completo';
    case 'exempt': return 'Isento';
    case 'group_default':
    default: return 'Mensal';
  }
}


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
  const [payments, setPayments] = useState<GroupPaymentSummary[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentToConfirm, setPaymentToConfirm] = useState<any | null>(null);
  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);

  // Novos estados para o modal de pacote (Upfront Payment)
  const [showUpfrontModal, setShowUpfrontModal] = useState(false);
  const [eligibleUpfrontMembers, setEligibleUpfrontMembers] = useState<any[]>([]);
  const [selectedUpfrontMemberId, setSelectedUpfrontMemberId] = useState<string>('');
  const [upfrontAmountStr, setUpfrontAmountStr] = useState<string>('');
  const [submittingUpfront, setSubmittingUpfront] = useState(false);

  // Novos estados para o modal de adiantar parcelas
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [memberToAdvance, setMemberToAdvance] = useState<any | null>(null);
  const [monthsToAdvance, setMonthsToAdvance] = useState('1');
  const [submittingAdvance, setSubmittingAdvance] = useState(false);

  // Inline editing for session history
  const [editingPresenceId, setEditingPresenceId] = useState<string | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editingNotesValue, setEditingNotesValue] = useState('');
  const [savingRecordId, setSavingRecordId] = useState<string | null>(null);

  // Taxas de cartão configuradas no perfil (sugestão no modal de confirmação de pagamento).
  // Buscado uma vez aqui (não existe contexto/hook de perfil compartilhado no app hoje) e
  // repassado como prop pro ConfirmPaymentModal.
  const [cardFeeRates, setCardFeeRates] = useState<CardFeeRates | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchApi<TenantProfile>('/api/profile');
        setCardFeeRates(data.cardFeeRates ?? null);
      } catch {
        // silencioso: sem sugestão de taxa, modal continua funcionando com entrada manual
      }
    })();
  }, []);

  const loadUpfrontEligibleMembers = useCallback(async (groupId: string) => {
    try {
      const res: any = await fetchApi(`/api/psychotherapy/groups/${groupId}/eligible-upfront-payments`);
      setEligibleUpfrontMembers(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedUpfrontMemberId(res.data[0].group_member_id);
        setUpfrontAmountStr((res.data[0].default_upfront_price_cents / 100).toFixed(2));
      } else {
        setSelectedUpfrontMemberId('');
        setUpfrontAmountStr('');
      }
    } catch (err) {
      toast.error('Erro ao carregar membros elegíveis para pacote.');
    }
  }, [toast]);

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
      const res = await fetchApi<{ data: GroupPaymentSummary[] }>(
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
                    <div className="flex gap-2">
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => {
                          if (selectedGroup) {
                            loadUpfrontEligibleMembers(selectedGroup.id);
                            setShowUpfrontModal(true);
                          }
                        }}
                      >
                        <Wallet size={13} style={{ marginRight: '4px' }} />
                        Receber Pacote
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={async () => {
                          try {
                            await fetchApi(`/api/psychotherapy/groups/${selectedGroup.id}/charges`, {
                              method: 'POST',
                              body: JSON.stringify({ 
                                referenceMonth: currentMonth,
                                dueDate: `${currentMonth}-10` // Default due date to the 10th of the month
                              })
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
                    </div>
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
                            <th>Tipo</th>
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
                                    {isExpanded && (
                                      <div className="payment-history-list">
                                        {!hasPayments && (
                                          <div style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                            Nenhuma cobrança gerada para este mês.
                                          </div>
                                        )}
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
                                                <>
                                                  <button
                                                    className="icon-btn"
                                                    style={{ padding: '2px' }}
                                                    onClick={() => {
                                                      setPaymentToConfirm({ ...p, patientName: m.name });
                                                      setShowPaymentModal(true);
                                                    }}
                                                    title="Editar/Registrar pagamento"
                                                  >
                                                    <Pencil size={12} />
                                                  </button>
                                                  <button
                                                    className="icon-btn danger"
                                                    style={{ padding: '2px' }}
                                                    onClick={() => handleVoidPayment(p)}
                                                    title="Estornar/Cancelar esta cobrança"
                                                  >
                                                    <Trash2 size={12} />
                                                  </button>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                        <div style={{ marginTop: '0.5rem', textAlign: 'right' }}>
                                          <button 
                                            className="btn btn-secondary btn-sm"
                                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                            onClick={() => {
                                              setMemberToAdvance(m);
                                              setShowAdvanceModal(true);
                                            }}
                                          >
                                            Adiantar Parcelas
                                          </button>
                                        </div>
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
                                    <span className="text-small">{billingTypeLabel(m.payment_type)}</span>
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
                                    <div className="flex gap-2 justify-end items-center" style={{ minWidth: '135px' }}>
                                      {m.payment_status === 'pending' && (
                                        <button
                                          className="btn btn-primary btn-sm"
                                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                          onClick={() => {
                                            const pending = m.payments?.find((p: any) => p.status === 'pending');
                                            if (pending) {
                                              setPaymentToConfirm({ ...pending, patientName: m.name });
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
                                              setPaymentToConfirm({ ...pending, patientName: m.name });
                                              setShowPaymentModal(true);
                                            }
                                          }}
                                        >
                                          + Parcela
                                        </button>
                                      )}
                                        <button
                                          className="btn btn-secondary btn-sm"
                                          style={{
                                            padding: '0.25rem 0.5rem',
                                            fontSize: '0.75rem'
                                          }}
                                          onClick={() => setExpandedPatientId(isExpanded ? null : m.patient_id)}
                                        >
                                          {isExpanded ? 'Ocultar' : 'Ver'}
                                        </button>
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
                                <span className="text-small">
                                  {billingTypeLabel(m.payment_type)}
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
          cardFeeRates={cardFeeRates}
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

      {showUpfrontModal && selectedGroup && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>Pagamento à Vista (Pacote Completo)</h3>
              <button className="icon-btn" onClick={() => setShowUpfrontModal(false)}>
                <XCircle size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-small" style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
                Selecione o membro que fará o pagamento à vista de todo o grupo. Ao gerar esta cobrança, as parcelas mensais futuras serão abatidas automaticamente.
              </p>
              
              <div className="form-group mb-3">
                <label className="form-label">Membro Elegível</label>
                <select
                  className="form-control"
                  value={selectedUpfrontMemberId}
                  onChange={(e) => {
                    setSelectedUpfrontMemberId(e.target.value);
                    const member = eligibleUpfrontMembers.find(m => m.group_member_id === e.target.value);
                    if (member) {
                      setUpfrontAmountStr((member.default_upfront_price_cents / 100).toFixed(2));
                    }
                  }}
                  disabled={eligibleUpfrontMembers.length === 0}
                >
                  {eligibleUpfrontMembers.length === 0 && <option value="">Nenhum membro elegível</option>}
                  {eligibleUpfrontMembers.map(m => (
                    <option key={m.group_member_id} value={m.group_member_id}>
                      {m.patient_name} (Sugerido: {(m.default_upfront_price_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group mb-3">
                <label className="form-label">Valor Total do Pacote (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-control"
                  value={upfrontAmountStr}
                  onChange={(e) => setUpfrontAmountStr(e.target.value)}
                  disabled={!selectedUpfrontMemberId}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2" style={{ marginTop: '1rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowUpfrontModal(false)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                disabled={submittingUpfront || !selectedUpfrontMemberId || !upfrontAmountStr}
                onClick={async () => {
                  setSubmittingUpfront(true);
                  try {
                    const cents = Math.round(parseFloat(upfrontAmountStr) * 100);
                    await fetchApi(`/api/psychotherapy/groups/${selectedGroup.id}/upfront-charge`, {
                      method: 'POST',
                      body: JSON.stringify({
                        groupMemberId: selectedUpfrontMemberId,
                        overrideTotalCents: cents
                      })
                    });
                    toast.success('Cobrança de pacote gerada! Agora basta registrar o pagamento dela.');
                    setShowUpfrontModal(false);
                    loadPayments(selectedGroup.id, currentMonth);
                  } catch (err) {
                    toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao gerar pacote.');
                  } finally {
                    setSubmittingUpfront(false);
                  }
                }}
              >
                {submittingUpfront ? 'Gerando...' : 'Gerar Cobrança Única'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advance Installments Modal */}
      {showAdvanceModal && memberToAdvance && selectedGroup && (
        <div className="modal-overlay" onClick={() => setShowAdvanceModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>Adiantar Parcelas</h3>
              <button className="icon-btn" onClick={() => setShowAdvanceModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-small" style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
                Deseja gerar cobranças antecipadas para <strong>{memberToAdvance.name}</strong>?
                Isso criará cobranças com status "Pendente" para os próximos meses, permitindo que você registre o pagamento delas agora.
              </p>
              
              <div className="form-group mb-3">
                <label className="form-label">Número de meses a adiantar</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="24"
                  className="form-control"
                  value={monthsToAdvance}
                  onChange={(e) => setMonthsToAdvance(e.target.value)}
                  disabled={submittingAdvance}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2" style={{ marginTop: '1rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowAdvanceModal(false)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                disabled={submittingAdvance || !monthsToAdvance || parseInt(monthsToAdvance) < 1}
                onClick={async () => {
                  setSubmittingAdvance(true);
                  try {
                    await fetchApi(`/api/psychotherapy/groups/${selectedGroup.id}/members/${memberToAdvance.group_member_id}/advance-installments`, {
                      method: 'POST',
                      body: JSON.stringify({
                        monthsToAdvance: parseInt(monthsToAdvance)
                      })
                    });
                    toast.success('Cobranças antecipadas geradas com sucesso!');
                    setShowAdvanceModal(false);
                    loadPayments(selectedGroup.id, currentMonth);
                  } catch (err) {
                    toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao adiantar parcelas.');
                  } finally {
                    setSubmittingAdvance(false);
                  }
                }}
              >
                {submittingAdvance ? 'Gerando...' : 'Gerar Cobranças'}
              </button>
            </div>
          </div>
        </div>
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
  payments: GroupPaymentSummary[];
  loading: boolean;
}) {
  if (loading || members.length === 0) return null;

  const feePerMember = group.monthly_fee_cents ?? 0;

  // Membros isentos não geram expectativa; membros de pacote (upfront) já quitado (payment_status
  // 'paid' via pagamento à vista, ver listGroupPayments) também não — o valor deles já entrou
  // no "Recebido" no mês em que o pacote foi pago, não deve continuar "esperado" todo mês depois.
  const expectedForPayment = (p: GroupPaymentSummary): number => {
    if (p.payment_type === 'exempt') return 0;
    if (p.payment_type === 'upfront' && p.payment_status === 'paid') return 0;
    return p.monthly_fee_cents ?? feePerMember;
  };

  const totalExpected = payments.reduce((sum, p) => sum + expectedForPayment(p), 0);
  const totalReceived = payments.reduce((sum, p) => sum + (p.total_paid_cents || 0), 0);
  const totalFees = payments.reduce((sum, p) => sum + (p.total_fee_cents || 0), 0);
  const totalNetReceived = payments.reduce((sum, p) => sum + (p.total_net_cents || 0), 0);
  // Cálculo por paciente: evita que pagamento excedente de um membro mascare dívida de outro
  const totalPending = payments.reduce((sum, p) => {
    const paid = p.total_paid_cents ?? 0;
    return sum + Math.max(0, expectedForPayment(p) - paid);
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
        {totalFees > 0 && (
          <div className="fin-kpi fin-kpi--neutral">
            <span className="fin-kpi-icon"><CreditCard size={15} /></span>
            <div>
              <span className="fin-kpi-label">Taxas descontadas</span>
              <span className="fin-kpi-value">{formatCurrency(totalFees)}</span>
            </div>
          </div>
        )}
        {totalFees > 0 && (
          <div className="fin-kpi fin-kpi--success">
            <span className="fin-kpi-icon"><Wallet size={15} /></span>
            <div>
              <span className="fin-kpi-label">Recebido líquido</span>
              <span className="fin-kpi-value">{formatCurrency(totalNetReceived)}</span>
            </div>
          </div>
        )}
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
  payment, cardFeeRates, onClose, onSuccess
}: {
  payment: any;
  cardFeeRates?: CardFeeRates | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'cash' | 'debit_card' | 'credit_card'>(payment.payment_method || 'pix');
  const [amount, setAmount] = useState(String((payment.amount_cents || 0) / 100));
  const [netAmount, setNetAmount] = useState(''); // vazio = sem taxa (líquido = valor pago)
  const [observations, setObservations] = useState(payment.notes || '');

  // Parcelas do cartão: campo local/efêmero, usado só pra procurar a taxa sugerida em
  // cardFeeRates. NÃO é o mesmo conceito de total_installments (parcelamento da mensalidade
  // do curso) — aqui é o parcelamento da transação na maquininha/gateway.
  const [cardInstallments, setCardInstallments] = useState(1);
  // Uma vez que o operador edite o líquido manualmente, a sugestão nunca mais sobrescreve.
  const [netAmountTouched, setNetAmountTouched] = useState(false);

  const nominalCents = payment.amount_cents || 0;
  const paidCents = Math.round((parseFloat(amount) || 0) * 100);
  const netCents = netAmount.trim() === '' ? paidCents : Math.round((parseFloat(netAmount) || 0) * 100);
  const discountCents = Math.max(0, nominalCents - paidCents);
  const feeCents = Math.max(0, paidCents - netCents);

  const suggestedFeeBps = paymentMethod === 'credit_card'
    ? cardFeeRates?.[String(cardInstallments)] ?? null
    : null;

  useEffect(() => {
    if (netAmountTouched || suggestedFeeBps === null || paidCents <= 0) return;
    const suggestedNetCents = Math.round(paidCents * (1 - suggestedFeeBps / 10000));
    if (suggestedNetCents > 0) {
      setNetAmount((suggestedNetCents / 100).toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedFeeBps, cardInstallments, paidCents, paymentMethod]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      toast.error('Valor inválido');
      return;
    }

    let netAmountCents: number | undefined;
    if (netAmount.trim() !== '') {
      netAmountCents = Math.round(parseFloat(netAmount) * 100);
      if (isNaN(netAmountCents) || netAmountCents <= 0) {
        toast.error('Crédito líquido inválido');
        return;
      }
      if (netAmountCents > amountCents) {
        toast.error('O crédito líquido não pode ser maior que o valor pago');
        return;
      }
    }

    if (!payment?.id) {
      toast.error('ID da cobrança não encontrado. Atualize a página e tente novamente.');
      return;
    }

    try {
      setSubmitting(true);
      await fetchApi(`/api/psychotherapy/group-payments/${payment.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod,
          amountPaidCents: amountCents,
          ...(netAmountCents !== undefined ? { netAmountCents } : {}),
          observations,
          // Auditoria: registra o que originou a sugestão de líquido exibida (mesmo que o
          // operador tenha editado o valor depois) — não é usado para recalcular nada.
          ...(paymentMethod === 'credit_card' ? { cardInstallments } : {}),
          ...(suggestedFeeBps !== null ? { appliedFeeBps: suggestedFeeBps } : {})
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
        <h2 className="text-h2 mb-2">Editar Pagamento</h2>
        {payment.patientName && (
          <p className="text-body mb-4" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            {payment.patientName}
          </p>
        )}

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
            <label className="form-label">Valor Pago pelo Paciente (R$)</label>
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

          {paymentMethod === 'credit_card' && (
            <div className="form-group mb-3">
              <label className="form-label">Parcelas no cartão</label>
              <select
                className="form-control"
                value={cardInstallments}
                onChange={e => setCardInstallments(Number(e.target.value))}
                disabled={submitting}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}x</option>
                ))}
              </select>
              {suggestedFeeBps !== null && (
                <p className="text-small" style={{ color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Taxa configurada para {cardInstallments}x: {(suggestedFeeBps / 100).toFixed(2)}% — líquido sugerido abaixo (editável).
                </p>
              )}
            </div>
          )}

          <div className="form-group mb-3">
            <label className="form-label">Crédito Líquido em Conta (Opcional)</label>
            <input
              type="number"
              className="form-control"
              value={netAmount}
              onChange={e => { setNetAmount(e.target.value); setNetAmountTouched(true); }}
              min="0.01"
              step="0.01"
              placeholder="Deixe em branco se não houve taxa (cartão/adquirente)"
              disabled={submitting}
            />
          </div>

          {(discountCents > 0 || feeCents > 0) && paidCents > 0 && (
            <div
              className="mb-4"
              style={{
                fontSize: '0.85rem',
                padding: '0.75rem',
                borderRadius: '8px',
                background: 'var(--bg-surface-secondary, rgba(0,0,0,0.03))',
                display: 'grid',
                gap: '0.25rem',
              }}
            >
              <div className="flex justify-between"><span>Valor nominal</span><span>R$ {(nominalCents / 100).toFixed(2)}</span></div>
              {discountCents > 0 && (
                <div className="flex justify-between" style={{ color: 'var(--color-warning, #b45309)' }}>
                  <span>Desconto comercial</span><span>- R$ {(discountCents / 100).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between"><span>Pago pelo paciente</span><span>R$ {(paidCents / 100).toFixed(2)}</span></div>
              {feeCents > 0 && (
                <div className="flex justify-between" style={{ color: 'var(--color-danger, #b91c1c)' }}>
                  <span>Taxa da adquirente</span><span>- R$ {(feeCents / 100).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between" style={{ fontWeight: 600, borderTop: '1px solid var(--border-color, rgba(0,0,0,0.08))', paddingTop: '0.25rem' }}>
                <span>Crédito líquido em conta</span><span>R$ {(netCents / 100).toFixed(2)}</span>
              </div>
            </div>
          )}

          <div className="form-group mb-4">
            <label className="form-label">Observações</label>
            <textarea
              className="form-control"
              rows={3}
              value={observations}
              onChange={e => setObservations(e.target.value)}
              placeholder="Opcional"
              disabled={submitting}
              style={{ resize: 'vertical' }}
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
              {submitting ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
