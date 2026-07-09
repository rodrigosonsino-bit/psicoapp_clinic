import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Plus, Edit2, Trash2, CheckCircle2, Clock,
  Tag, Link2, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';
import { fetchApi } from '../services/api';
import type {
  Patient, ClinicalNote, PaginatedResponse,
  Anamnesis, TreatmentPlan, TreatmentPlanStatus, BookingLinkResult, ReminderChannel,
} from '../types/api';
import { MODALIDADE_OPTIONS, getModalidadeValue } from '../constants/modalidade';
import type { ModalidadeValue } from '../constants/modalidade';
import { useToast } from '../context/ToastContext';
import { SkeletonTable } from '../components/Skeleton';
import ConfirmDialog from '../components/ConfirmDialog';
import { WhatsappConversationPanel } from '../components/WhatsappConversationPanel';

// ── Constantes ────────────────────────────────────────────────────────────────

type Tab = 'dados' | 'prontuario' | 'historico' | 'whatsapp' | 'grupos';

const STATUS_PLAN_LABEL: Record<TreatmentPlanStatus, string> = {
  active: 'Ativo', completed: 'Concluído', suspended: 'Suspenso',
};
const STATUS_PLAN_COLOR: Record<TreatmentPlanStatus, string> = {
  active: 'var(--status-success)', completed: 'var(--status-info)', suspended: 'var(--status-warning)',
};

// ── Componente principal ──────────────────────────────────────────────────────

export default function PatientProfile() {
  const { id: patientId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [loadingPatient, setLoadingPatient] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('dados');

  // ── Carrega paciente ──────────────────────────────────────────────────────
  const loadPatient = useCallback(async () => {
    if (!patientId) return;
    try {
      setLoadingPatient(true);
      const res = await fetchApi<Patient>(`/api/psychotherapy/patients/${patientId}`);
      setPatient(res);
    } catch {
      toast.error('Paciente não encontrado.');
      navigate('/patients');
    } finally {
      setLoadingPatient(false);
    }
  }, [patientId, toast, navigate]);

  useEffect(() => { loadPatient(); }, [loadPatient]);

  if (loadingPatient) {
    return (
      <div className="page-container">
        <SkeletonTable rows={4} cols={3} />
      </div>
    );
  }

  if (!patient) return null;

  const statusLabel = patient.status === 'inactive' ? 'Inativo' : 'Ativo';
  const statusColor = patient.status === 'inactive' ? 'var(--status-danger)' : 'var(--status-success)';

  return (
    <div className="page-container">
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/patients')} style={{ gap: '0.4rem' }}>
          <ArrowLeft size={16} /> Pacientes
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ margin: 0 }}>{patient.name}</h1>
            <span style={{
              fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem',
              borderRadius: '999px', background: statusColor + '22', color: statusColor,
            }}>
              {statusLabel}
            </span>
          </div>
          {patient.phone && (
            <div className="text-small" style={{ marginTop: '0.2rem', color: 'var(--text-secondary)' }}>
              {patient.phone}{patient.email ? ` · ${patient.email}` : ''}
            </div>
          )}
        </div>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '2px solid var(--border-color)', marginBottom: '1.5rem' }}>
        {(['dados', 'prontuario', 'historico', 'whatsapp', 'grupos'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.6rem 1.25rem', border: 'none', background: 'none', cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? 'var(--brand-primary)' : 'var(--text-secondary)',
              borderBottom: activeTab === tab ? '2px solid var(--brand-primary)' : '2px solid transparent',
              marginBottom: '-2px', transition: 'all 0.15s',
              fontSize: '0.9375rem',
            }}
          >
            {tab === 'dados' ? 'Dados Cadastrais' : tab === 'prontuario' ? 'Prontuário' : tab === 'historico' ? 'Histórico' : tab === 'whatsapp' ? 'WhatsApp' : 'Grupos'}
          </button>
        ))}
      </div>

      {/* Conteúdo da aba */}
      {activeTab === 'dados' && (
        <DadosCadastraisTab patient={patient} onSaved={setPatient} />
      )}
      {activeTab === 'prontuario' && (
        <ProntuarioTab patientId={patient.id} />
      )}
      {activeTab === 'historico' && (
        <HistoricoTab patientId={patient.id} patientName={patient.name} />
      )}
      {activeTab === 'whatsapp' && (
        <WhatsappTab patientId={patient.id} patientName={patient.name} />
      )}
      {activeTab === 'grupos' && (
        <GruposTab patientId={patient.id} />
      )}
    </div>
  );
}

// ── Aba 1: Dados Cadastrais ───────────────────────────────────────────────────

function DadosCadastraisTab({ patient, onSaved }: { patient: Patient; onSaved: (p: Patient) => void }) {
  const toast = useToast();
  const isInactiveInit = patient.status === 'inactive';
  const [form, setForm] = useState({
    name: patient.name,
    modalidade: isInactiveInit
      ? 'sessao-semanal' as ModalidadeValue
      : getModalidadeValue(patient.status, patient.paymentType ?? 'monthly'),
    isInactive: isInactiveInit,
    defaultSessionPriceCents: patient.defaultSessionPriceCents != null
      ? String(patient.defaultSessionPriceCents / 100) : '',
    document: patient.document ?? '',
    phone: patient.phone ?? '',
    email: patient.email ?? '',
    notes: patient.notes ?? '',
    reminderChannel: (patient.reminderChannel ?? 'whatsapp') as ReminderChannel,
  });
  const [submitting, setSubmitting] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const option = MODALIDADE_OPTIONS.find(o => o.value === form.modalidade)!;
      const updated = await fetchApi<Patient>(`/api/psychotherapy/patients`, {
        method: 'POST',
        body: JSON.stringify({
          id: patient.id,
          name: form.name,
          status: form.isInactive ? 'inactive' : option.status,
          paymentType: option.paymentType,
          defaultSessionPriceCents: form.defaultSessionPriceCents
            ? Math.round(Number(form.defaultSessionPriceCents) * 100) : null,
          document: form.document || null,
          phone: form.phone || null,
          email: form.email || null,
          notes: form.notes || null,
          reminderChannel: form.reminderChannel,
        }),
      });
      onSaved(updated);
      toast.success('Dados atualizados com sucesso.');
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao salvar dados.');
    } finally {
      setSubmitting(false);
    }
  };

  const generateBookingLink = async () => {
    try {
      setLinkLoading(true);
      const res = await fetchApi<{ data: BookingLinkResult }>(
        `/api/psychotherapy/patients/${patient.id}/booking-link`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      await navigator.clipboard.writeText(res.data.url);
      toast.success('Link de agendamento copiado!');
    } catch {
      toast.error('Falha ao gerar link.');
    } finally {
      setLinkLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '640px' }}>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Nome *</label>
          <input required type="text" className="form-control" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} disabled={submitting} />
        </div>

        <div className="flex gap-4 items-end">
          <div className="form-group w-full">
            <label className="form-label">Modalidade *</label>
            <select className="form-control" value={form.modalidade}
              onChange={e => setForm({ ...form, modalidade: e.target.value as ModalidadeValue })}
              disabled={submitting || form.isInactive}>
              {MODALIDADE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ whiteSpace: 'nowrap', paddingBottom: '0.25rem' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.isInactive}
                onChange={e => setForm({ ...form, isInactive: e.target.checked })} disabled={submitting}
                style={{ width: '1rem', height: '1rem' }} />
              Inativo
            </label>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="form-group w-full">
            <label className="form-label">Valor Padrão por Sessão (R$)</label>
            <input type="number" step="0.01" className="form-control" value={form.defaultSessionPriceCents}
              onChange={e => setForm({ ...form, defaultSessionPriceCents: e.target.value })} disabled={submitting} />
          </div>
          <div className="form-group w-full">
            <label className="form-label">CPF / Documento</label>
            <input type="text" className="form-control" value={form.document}
              onChange={e => setForm({ ...form, document: e.target.value })} disabled={submitting} />
          </div>
        </div>

        <div className="flex gap-4">
          <div className="form-group w-full">
            <label className="form-label">WhatsApp (com DDD)</label>
            <input type="text" className="form-control" placeholder="11999998888" value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })} disabled={submitting} />
          </div>
          <div className="form-group w-full">
            <label className="form-label">E-mail</label>
            <input type="email" className="form-control" value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })} disabled={submitting} />
          </div>
        </div>

        <div className="flex gap-4">
          <div className="form-group w-full">
            <label className="form-label">Observações internas</label>
            <textarea className="form-control" rows={3} value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })} disabled={submitting}
              placeholder="Notas sobre contato, plano de saúde, preferências..." style={{ resize: 'vertical' }} />
          </div>
          <div className="form-group" style={{ minWidth: 190 }}>
            <label className="form-label">Lembrete automático</label>
            <select className="form-control" value={form.reminderChannel}
              onChange={e => setForm({ ...form, reminderChannel: e.target.value as ReminderChannel })}
              disabled={submitting}>
              <option value="whatsapp">📱 WhatsApp</option>
              <option value="email">📧 E-mail</option>
              <option value="both">📱 + 📧 Ambos</option>
              <option value="none">🔕 Nenhum</option>
            </select>
          </div>
        </div>

        <div className="flex gap-3 mt-4" style={{ flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : <><Save size={15} /> Salvar Dados</>}
          </button>
          <button type="button" className="btn btn-secondary" onClick={generateBookingLink} disabled={linkLoading}>
            <Link2 size={15} /> {linkLoading ? 'Gerando...' : 'Copiar Link de Agendamento'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Aba 2: Prontuário (Anamnese + Plano Terapêutico) ─────────────────────────

function ProntuarioTab({ patientId }: { patientId: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <AnamnesisSection patientId={patientId} />
      <TreatmentPlansSection patientId={patientId} />
    </div>
  );
}

// ── Anamnese ──────────────────────────────────────────────────────────────────

type AnamnesisForm = Omit<Anamnesis, 'id' | 'createdAt' | 'updatedAt'>;

function AnamnesisSection({ patientId }: { patientId: string }) {
  const toast = useToast();
  const [data, setData] = useState<Anamnesis | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [collapsed, setCollapsed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchApi<Anamnesis>(`/api/psychotherapy/patients/${patientId}/anamnesis`);
        setData(res);
      } catch {
        toast.error('Erro ao carregar anamnese.');
      } finally {
        setLoading(false);
      }
    })();
  }, [patientId, toast]);

  const save = useCallback(async (fields: AnamnesisForm) => {
    setSaveStatus('saving');
    try {
      const updated = await fetchApi<Anamnesis>(`/api/psychotherapy/patients/${patientId}/anamnesis`, {
        method: 'PUT',
        body: JSON.stringify(fields),
      });
      setData(updated);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
      toast.error('Erro ao salvar anamnese.');
    }
  }, [patientId, toast]);

  const handleChange = (field: keyof AnamnesisForm, value: string | string[]) => {
    if (!data) return;
    const updated = { ...data, [field]: value };
    setData(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(updated), 1200);
  };

  const textArea = (field: keyof AnamnesisForm, label: string, placeholder = '') => (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <textarea className="form-control" rows={3} value={(data?.[field] as string) ?? ''}
        onChange={e => handleChange(field, e.target.value)}
        placeholder={placeholder} style={{ resize: 'vertical', fontFamily: 'inherit' }}
        disabled={loading} />
    </div>
  );

  return (
    <div className="card">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '1rem 1.25rem', marginBottom: collapsed ? 0 : '0.75rem' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h3 className="card-title" style={{ margin: 0 }}>Anamnese</h3>
          {saveStatus === 'saving' && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}><Loader2 size={13} className="animate-spin" style={{ display: 'inline' }} /> Salvando...</span>}
          {saveStatus === 'saved' && <span style={{ fontSize: '0.8rem', color: 'var(--status-success)' }}>✓ Salvo</span>}
        </div>
        {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </div>

      {!collapsed && (
        <div style={{ padding: '0 1.25rem 1.25rem' }}>
          {loading ? <SkeletonTable rows={3} cols={1} /> : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1.25rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                {textArea('chiefComplaint', 'Queixa Principal', 'O que trouxe o paciente à terapia...')}
              </div>
              {textArea('onsetDescription', 'Início e Contexto', 'Quando começou, o que desencadeou...')}
              {textArea('previousTreatment', 'Tratamentos Anteriores', 'Terapias, internações, acompanhamentos...')}
              {textArea('medications', 'Medicamentos em Uso', 'Nome, dose, frequência...')}
              {textArea('familyHistory', 'Histórico Familiar', 'Doenças, padrões, dinâmicas relevantes...')}
              <div style={{ gridColumn: '1 / -1' }}>
                {textArea('relevantHistory', 'Histórico Relevante', 'Traumas, marcos de vida, condições de saúde...')}
              </div>
              {textArea('therapeuticApproach', 'Abordagem Terapêutica', 'TCC, psicanálise, ACT, EMDR...')}
              <div className="form-group">
                <label className="form-label">Códigos CID (um por linha)</label>
                <textarea className="form-control" rows={3}
                  value={(data?.cidCodes ?? []).join('\n')}
                  onChange={e => handleChange('cidCodes', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
                  placeholder={'F33.1\nZ73.1'} style={{ fontFamily: 'monospace', resize: 'vertical' }}
                  disabled={loading} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Planos Terapêuticos ───────────────────────────────────────────────────────

function TreatmentPlansSection({ patientId }: { patientId: string }) {
  const toast = useToast();
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmClose, setConfirmClose] = useState<{ open: boolean; plan: TreatmentPlan | null; newStatus: TreatmentPlanStatus }>({ open: false, plan: null, newStatus: 'completed' });

  const load = useCallback(async () => {
    try {
      const res = await fetchApi<{ data: TreatmentPlan[] }>(`/api/psychotherapy/patients/${patientId}/treatment-plans`);
      setPlans(res.data);
    } catch {
      toast.error('Erro ao carregar planos terapêuticos.');
    } finally {
      setLoading(false);
    }
  }, [patientId, toast]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (plan: TreatmentPlan, status: TreatmentPlanStatus) => {
    try {
      await fetchApi(`/api/psychotherapy/patients/${patientId}/treatment-plans/${plan.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      toast.success(status === 'completed' ? 'Plano concluído.' : status === 'suspended' ? 'Plano suspenso.' : 'Plano reativado.');
      load();
    } catch {
      toast.error('Falha ao atualizar status do plano.');
    }
  };

  const activePlan = plans.find(p => p.status === 'active');
  const pastPlans = plans.filter(p => p.status !== 'active');

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem 0.75rem' }}>
        <h3 className="card-title" style={{ margin: 0 }}>Plano Terapêutico</h3>
        {!activePlan && !showForm && (
          <button className="btn btn-primary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
            onClick={() => setShowForm(true)}>
            <Plus size={14} /> Novo Plano
          </button>
        )}
      </div>

      <div style={{ padding: '0 1.25rem 1.25rem' }}>
        {loading ? <SkeletonTable rows={2} cols={1} /> : (
          <>
            {showForm && (
              <NewPlanForm
                patientId={patientId}
                onSaved={() => { setShowForm(false); load(); }}
                onCancel={() => setShowForm(false)}
              />
            )}

            {activePlan && (
              <PlanCard
                plan={activePlan}
                onChangeStatus={(p, s) => setConfirmClose({ open: true, plan: p, newStatus: s })}
                onReopen={() => {}}
              />
            )}

            {!activePlan && !showForm && plans.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0.5rem 0 0' }}>
                Nenhum plano terapêutico registrado.
              </p>
            )}

            {pastPlans.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Planos Anteriores
                </p>
                {pastPlans.map(p => (
                  <PlanCard key={p.id} plan={p}
                    onChangeStatus={(pl, s) => setConfirmClose({ open: true, plan: pl, newStatus: s })}
                    onReopen={pl => changeStatus(pl, 'active')}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmClose.open}
        title={confirmClose.newStatus === 'completed' ? 'Concluir plano' : 'Suspender plano'}
        message={`Deseja marcar o plano "${confirmClose.plan?.title}" como ${STATUS_PLAN_LABEL[confirmClose.newStatus].toLowerCase()}?`}
        confirmLabel="Confirmar" cancelLabel="Cancelar" variant="warning"
        onConfirm={() => {
          if (confirmClose.plan) changeStatus(confirmClose.plan, confirmClose.newStatus);
          setConfirmClose({ open: false, plan: null, newStatus: 'completed' });
        }}
        onCancel={() => setConfirmClose({ open: false, plan: null, newStatus: 'completed' })}
      />
    </div>
  );
}

function PlanCard({ plan, onChangeStatus, onReopen }: {
  plan: TreatmentPlan;
  onChangeStatus: (p: TreatmentPlan, s: TreatmentPlanStatus) => void;
  onReopen: (p: TreatmentPlan) => void;
}) {
  const color = STATUS_PLAN_COLOR[plan.status];
  return (
    <div style={{ border: `1px solid ${color}44`, borderLeft: `4px solid ${color}`, borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '0.75rem', background: color + '08' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem', gap: '0.5rem' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{plan.title}</span>
          <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', color, fontWeight: 600 }}>
            [{STATUS_PLAN_LABEL[plan.status]}]
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
          {plan.status === 'active' && (
            <>
              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
                onClick={() => onChangeStatus(plan, 'completed')}>
                <CheckCircle2 size={12} /> Concluir
              </button>
              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
                onClick={() => onChangeStatus(plan, 'suspended')}>
                <Clock size={12} /> Suspender
              </button>
            </>
          )}
          {plan.status !== 'active' && (
            <button className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
              onClick={() => onReopen(plan)}>
              Reativar
            </button>
          )}
        </div>
      </div>
      {plan.goals.length > 0 && (
        <ul style={{ margin: '0.5rem 0', padding: '0 0 0 1.2rem', fontSize: '0.875rem', lineHeight: 1.6 }}>
          {plan.goals.map((g, i) => <li key={i}>{g}</li>)}
        </ul>
      )}
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
        Iniciado em {new Date(plan.startedAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
        {plan.targetSessions ? ` · Meta: ${plan.targetSessions} sessões` : ''}
        {plan.endedAt ? ` · Encerrado em ${new Date(plan.endedAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : ''}
      </div>
    </div>
  );
}

function NewPlanForm({ patientId, onSaved, onCancel }: { patientId: string; onSaved: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', goals: '', approach: '', targetSessions: '' });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await fetchApi(`/api/psychotherapy/patients/${patientId}/treatment-plans`, {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          goals: form.goals.split('\n').map(g => g.trim()).filter(Boolean),
          approach: form.approach || null,
          targetSessions: form.targetSessions ? parseInt(form.targetSessions, 10) : null,
        }),
      });
      toast.success('Plano criado.');
      onSaved();
    } catch {
      toast.error('Falha ao criar plano.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1rem', background: 'var(--bg-surface)' }}>
      <div className="form-group">
        <label className="form-label">Título do Plano *</label>
        <input required type="text" className="form-control" value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })} disabled={submitting}
          placeholder="Ex: Ciclo Inicial — Ansiedade" />
      </div>
      <div className="flex gap-4">
        <div className="form-group w-full">
          <label className="form-label">Objetivos (um por linha)</label>
          <textarea className="form-control" rows={4} value={form.goals}
            onChange={e => setForm({ ...form, goals: e.target.value })} disabled={submitting}
            placeholder={'Reduzir crises de ansiedade\nMelhorar autorregulação emocional'} style={{ resize: 'vertical' }} />
        </div>
        <div className="form-group w-full">
          <div className="form-group">
            <label className="form-label">Abordagem</label>
            <input type="text" className="form-control" value={form.approach}
              onChange={e => setForm({ ...form, approach: e.target.value })} disabled={submitting}
              placeholder="TCC, Psicanálise, ACT..." />
          </div>
          <div className="form-group">
            <label className="form-label">Meta de Sessões</label>
            <input type="number" min="1" className="form-control" value={form.targetSessions}
              onChange={e => setForm({ ...form, targetSessions: e.target.value })} disabled={submitting}
              placeholder="Ex: 20" />
          </div>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Criando...' : 'Criar Plano'}
        </button>
      </div>
    </form>
  );
}

// ── Aba 3: Histórico (notas clínicas livres) ──────────────────────────────────

function HistoricoTab({ patientId, patientName }: { patientId: string; patientName: string }) {
  const toast = useToast();
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [editNote, setEditNote] = useState<ClinicalNote | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ noteDate: new Date().toISOString().slice(0, 10), content: '', tags: '' });
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetchApi<PaginatedResponse<ClinicalNote>>(`/api/psychotherapy/patients/${patientId}/notes`);
      setNotes(res.data);
    } catch {
      toast.error('Erro ao carregar histórico.');
    } finally {
      setLoading(false);
    }
  }, [patientId, toast]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const openForm = (note: ClinicalNote | null = null) => {
    setEditNote(note);
    setFormData({
      noteDate: note ? note.noteDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      content: note?.content ?? '',
      tags: note?.tags.join(', ') ?? '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const tags = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
      await fetchApi(`/api/psychotherapy/patients/${patientId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ id: editNote?.id, noteDate: formData.noteDate, content: formData.content, tags }),
      });
      toast.success(editNote ? 'Nota atualizada.' : 'Nota criada.');
      setShowForm(false);
      loadNotes();
    } catch {
      toast.error('Falha ao salvar nota.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete.id) return;
    try {
      await fetchApi(`/api/psychotherapy/notes/${confirmDelete.id}`, { method: 'DELETE' });
      toast.success('Nota excluída.');
      loadNotes();
    } catch {
      toast.error('Falha ao excluir nota.');
    } finally {
      setConfirmDelete({ open: false, id: null });
    }
  };

  const patientNameShort = patientName.split(' ')[0];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h3 style={{ margin: 0, fontWeight: 600, fontSize: '1rem' }}>
          Evoluções clínicas de {patientNameShort}
        </h3>
        {!showForm && (
          <button className="btn btn-primary" onClick={() => openForm()}>
            <Plus size={15} /> Nova Nota
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: '1.25rem', padding: '1.25rem' }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Data</label>
              <input type="date" className="form-control" value={formData.noteDate}
                onChange={e => setFormData({ ...formData, noteDate: e.target.value })} disabled={submitting} style={{ width: '180px' }} />
            </div>
            <div className="form-group">
              <label className="form-label">Conteúdo *</label>
              <textarea required className="form-control" rows={8}
                placeholder="Evolução clínica, observações, hipóteses diagnósticas..."
                value={formData.content}
                onChange={e => setFormData({ ...formData, content: e.target.value })}
                disabled={submitting} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <div className="form-group">
              <label className="form-label">Tags (separadas por vírgula)</label>
              <input type="text" className="form-control" placeholder="Ex: TCC, ansiedade, trauma"
                value={formData.tags} onChange={e => setFormData({ ...formData, tags: e.target.value })} disabled={submitting} />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={submitting}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Salvando...' : 'Salvar Nota'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={4} cols={1} />
      ) : notes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Nenhuma nota clínica registrada para {patientNameShort}.
        </div>
      ) : (
        <div>
          {notes.map(note => (
            <div key={note.id} className="card mb-3" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  {new Date(note.noteDate).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn-icon" title="Editar" onClick={() => openForm(note)}><Edit2 size={14} /></button>
                  <button className="btn-icon text-danger" title="Excluir"
                    onClick={() => setConfirmDelete({ open: true, id: note.id })}><Trash2 size={14} /></button>
                </div>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: '0 0 0.75rem', fontSize: '0.9375rem' }}>{note.content}</p>
              {note.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {note.tags.map(tag => (
                    <span key={tag} style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '999px', background: 'var(--brand-primary)18', color: 'var(--brand-primary)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <Tag size={10} /> {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title="Excluir nota"
        message="Esta nota será removida permanentemente. Deseja continuar?"
        confirmLabel="Excluir" cancelLabel="Cancelar" variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, id: null })}
      />
    </div>
  );
}

// ── Aba: Conversa WhatsApp (só visualização, sem automação) ──────────────────

function WhatsappTab({ patientId, patientName }: { patientId: string; patientName: string }) {
  return <WhatsappConversationPanel patientId={patientId} patientName={patientName} />;
}

// ── Aba 4: Grupos Terapêuticos ───────────────────────────────────────────────

function GruposTab({ patientId }: { patientId: string }) {
  const toast = useToast();
  const [patientGroups, setPatientGroups] = useState<any[]>([]);
  const [allGroups, setAllGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [pgRes, allRes] = await Promise.all([
        fetchApi<{ success: boolean; data: any[] }>(`/api/psychotherapy/patients/${patientId}/groups`),
        fetchApi<{ success: boolean; data: any[] }>('/api/psychotherapy/groups?includeInactive=false')
      ]);
      setPatientGroups(pgRes.data || pgRes || []);
      setAllGroups(allRes.data || allRes || []);
    } catch (err) {
      toast.error('Erro ao carregar dados dos grupos.');
    } finally {
      setLoading(false);
    }
  }, [patientId, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId) return;

    try {
      setSubmitting(true);
      await fetchApi(`/api/psychotherapy/groups/${selectedGroupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ patientId })
      });
      toast.success('Paciente adicionado ao grupo com sucesso!');
      setSelectedGroupId('');
      loadData();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao adicionar ao grupo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveGroup = async (groupId: string, groupName: string) => {
    if (!confirm(`Remover o paciente deste grupo ("${groupName}")?\n\nIsso não apagará o histórico financeiro.`)) {
      return;
    }

    try {
      setSubmitting(true);
      await fetchApi(`/api/psychotherapy/groups/${groupId}/members/${patientId}`, {
        method: 'DELETE'
      });
      toast.success('Paciente removido do grupo com sucesso!');
      loadData();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao remover do grupo.');
    } finally {
      setSubmitting(false);
    }
  };

  const currentGroupIds = new Set(patientGroups.map(g => g.id));
  const availableGroups = allGroups.filter(g => !currentGroupIds.has(g.id));

  const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  const formatGroupDetails = (g: any) => {
    const details: string[] = [];
    if (g.day_of_week != null) details.push(DAY_NAMES[g.day_of_week]);
    if (g.start_time) details.push(g.start_time.slice(0, 5));
    if (g.duration_minutes) details.push(`${g.duration_minutes} min`);
    return details.join(' · ');
  };

  return (
    <div style={{ maxWidth: '640px' }}>
      {/* Adicionar a um grupo */}
      <div className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius)', background: 'var(--bg-panel)' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', fontWeight: 600 }}>Vincular a um Grupo Terapêutico</h3>
        
        {loading ? (
          <div style={{ color: 'var(--text-secondary)' }}>Carregando grupos...</div>
        ) : availableGroups.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Este paciente já faz parte de todos os grupos ativos disponíveis.</p>
        ) : (
          <form onSubmit={handleAddGroup} style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 600 }}>Selecione o Grupo</label>
              <select
                className="form-control"
                value={selectedGroupId}
                onChange={e => setSelectedGroupId(e.target.value)}
                required
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)' }}
              >
                <option value="">-- Selecione um grupo --</option>
                {availableGroups.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.name} {g.day_of_week != null ? `(${DAY_NAMES[g.day_of_week]})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={submitting || !selectedGroupId}
              style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0 1rem' }}
            >
              <Plus size={16} /> Vincular
            </button>
          </form>
        )}
      </div>

      {/* Listagem de grupos atuais */}
      <div className="panel" style={{ padding: '1.25rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius)', background: 'var(--bg-panel)' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', fontWeight: 600 }}>Grupos Vinculados</h3>
        
        {loading ? (
          <div style={{ color: 'var(--text-secondary)' }}>Carregando grupos vinculados...</div>
        ) : patientGroups.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Este paciente não está vinculado a nenhum grupo terapêutico.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {patientGroups.map(g => (
              <div 
                key={g.id} 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  padding: '0.75rem 1rem', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '6px', 
                  background: 'var(--bg-item, rgba(0,0,0,0.02))' 
                }}
              >
                <div>
                  <strong style={{ fontSize: '0.9375rem', color: 'var(--text-primary)' }}>{g.name}</strong>
                  <div className="text-small" style={{ color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    {formatGroupDetails(g)}
                  </div>
                  {g.joined_at && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginTop: '0.15rem' }}>
                      Entrou em: {new Date(g.joined_at).toLocaleDateString('pt-BR')}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-icon text-danger"
                  title="Remover do Grupo"
                  disabled={submitting}
                  onClick={() => handleRemoveGroup(g.id, g.name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem' }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
