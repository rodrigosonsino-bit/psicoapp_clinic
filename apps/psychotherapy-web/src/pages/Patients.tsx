import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, MessageCircle, Mail, Search, ChevronLeft, ChevronRight, Link2, ExternalLink, Pencil, Bell, BellOff, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchApi } from '../services/api';
import type { Patient, PaginatedResponse, BookingLinkResult, Broadcast, BroadcastPreview } from '../types/api';
import { useToast } from '../context/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonTable } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import './Patients.css';

const PAGE_SIZE = 20;

import { MODALIDADE_OPTIONS, getModalidadeLabel, getModalidadeValue } from '../constants/modalidade';
import type { ModalidadeValue } from '../constants/modalidade';
import type { ReminderChannel } from '../types/api';
import { formatCurrency } from '../utils/formatters';

export default function Patients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [editPatient, setEditPatient] = useState<Patient | null>(null);
  const [togglingReminderId, setTogglingReminderId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const handleEditPatient = (patient: Patient) => {
    setEditPatient(patient);
    setShowModal(true);
  };

  const loadPatients = useCallback(async (pg = page, q = search) => {
    try {
      setLoading(true);
      setError(false);
      const params = new URLSearchParams({ page: String(pg), limit: String(PAGE_SIZE), scope: 'individual' });
      if (q) params.set('search', q);
      const res = await fetchApi<PaginatedResponse<Patient>>(`/api/psychotherapy/patients?${params}`);
      setPatients(res.data);
      setTotal(res.meta.total);
    } catch (err) {
      console.error(err);
      setError(true);
      toast.error('Erro ao carregar lista de pacientes.');
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => { loadPatients(page, search); }, [page, search, loadPatients]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 350);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const askDeletePatient = (id: string) => setConfirmDelete({ open: true, id });

  const handleDelete = async () => {
    const id = confirmDelete.id;
    if (!id) return;
    try {
      await fetchApi(`/api/psychotherapy/patients/${id}`, { method: 'DELETE' });
      toast.success('Paciente excluído com sucesso.');
      loadPatients(page, search);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao excluir paciente.');
    } finally {
      setConfirmDelete({ open: false, id: null });
    }
  };

  const toggleReminder = async (patient: Patient) => {
    const newChannel: ReminderChannel = patient.reminderChannel === 'none' ? 'whatsapp' : 'none';
    setTogglingReminderId(patient.id);
    try {
      await fetchApi('/api/psychotherapy/patients', {
        method: 'POST',
        body: JSON.stringify({
          id: patient.id,
          name: patient.name,
          status: patient.status,
          paymentType: patient.paymentType,
          defaultSessionPriceCents: patient.defaultSessionPriceCents,
          notes: patient.notes,
          document: patient.document,
          phone: patient.phone,
          email: patient.email,
          fullName: patient.fullName,
          reminderChannel: newChannel,
        })
      });
      toast.success(newChannel === 'none' ? `Lembretes desativados para ${patient.name}.` : `Lembretes ativados para ${patient.name}.`);
      loadPatients(page, search);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao atualizar lembretes.');
    } finally {
      setTogglingReminderId(null);
    }
  };

  const generateBookingLink = async (patient: Patient) => {
    try {
      const res = await fetchApi<{ data: BookingLinkResult }>(`/api/psychotherapy/patients/${patient.id}/booking-link`, {
        method: 'POST', body: JSON.stringify({})
      });
      await navigator.clipboard.writeText(res.data.url);
      toast.success(`Link de agendamento copiado para ${patient.name}!`);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao gerar link.');
    }
  };

  return (
    <div className="patients-page animate-fade-in">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-h1">Pacientes</h1>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => setShowBroadcastModal(true)}>
            <Send size={18} /> Mensagem em massa
          </button>
          <button className="btn btn-primary" onClick={() => { setEditPatient(null); setShowModal(true); }}>
            <Plus size={18} /> Novo Paciente
          </button>
        </div>
      </div>

      {/* Busca */}
      <div className="patients-search-bar mb-4">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          className="form-control"
          placeholder="Buscar por nome..."
          value={searchInput}
          onChange={handleSearchChange}
          style={{ paddingLeft: '2.25rem' }}
        />
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={4} />
      ) : error ? (
        <ErrorState
          title="Erro ao obter pacientes"
          message="Não foi possível carregar a lista de pacientes."
          onRetry={() => loadPatients(page, search)}
        />
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Modalidade</th>
                  <th>Valor / Sessão</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {patients.map(p => (
                  <tr key={p.id}>
                    <td>
                      {/* Nome clicável → perfil do paciente */}
                      <button
                        className="btn-link"
                        style={{ fontWeight: 600, textAlign: 'left', color: 'var(--text-secondary)' }}
                        onClick={() => navigate(`/patients/${p.id}`)}
                      >
                        {p.name}
                      </button>
                      {p.document && <div className="text-small">CPF: {p.document}</div>}
                      <div className="flex flex-col gap-1 mt-1">
                        {p.phone && (
                          <a
                            href={`https://api.whatsapp.com/send?phone=${p.phone.replace(/\D/g, '')}`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1"
                            style={{ color: '#10b981', fontSize: '0.8125rem', fontWeight: 500 }}
                          >
                            <MessageCircle size={14} /> {p.phone}
                          </a>
                        )}
                        {p.email && (
                          <div className="text-small flex items-center gap-1" style={{ fontSize: '0.8125rem' }}>
                            <Mail size={14} /> {p.email}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-${p.status === 'inactive' ? 'danger' : 'success'}`}>
                        {getModalidadeLabel(p.status, p.paymentType ?? null)}
                      </span>
                    </td>
                    <td>{p.defaultSessionPriceCents != null ? formatCurrency(p.defaultSessionPriceCents) : '-'}</td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          className="btn-icon"
                          title="Abrir Prontuário"
                          onClick={() => navigate(`/patients/${p.id}`)}
                        >
                          <ExternalLink size={16} />
                        </button>
                        <button
                          className="btn-icon"
                          title="Editar"
                          onClick={() => handleEditPatient(p)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="btn-icon"
                          title={p.reminderChannel === 'none' ? 'Lembretes desativados — clique para ativar' : 'Lembretes ativados — clique para desativar'}
                          onClick={() => toggleReminder(p)}
                          disabled={togglingReminderId === p.id}
                          style={{ color: p.reminderChannel === 'none' ? 'var(--text-muted)' : 'var(--status-success)' }}
                        >
                          {p.reminderChannel === 'none' ? <BellOff size={16} /> : <Bell size={16} />}
                        </button>
                        <button
                          className="btn-icon"
                          title="Gerar link de agendamento"
                          onClick={() => generateBookingLink(p)}
                          style={{ color: 'var(--brand-secondary)' }}
                        >
                          <Link2 size={16} />
                        </button>
                        <button className="btn-icon text-danger" title="Excluir" onClick={() => askDeletePatient(p.id)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {patients.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                      {search ? `Nenhum paciente encontrado para "${search}".` : 'Nenhum paciente cadastrado.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="pagination">
              <span className="pagination-info">{total} paciente{total !== 1 ? 's' : ''}</span>
              <div className="pagination-controls">
                <button
                  className="btn-icon" disabled={page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="pagination-pages">
                  {page} / {totalPages}
                </span>
                <button
                  className="btn-icon" disabled={page === totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showModal && (
        <PatientModal
          patientToEdit={editPatient}
          onClose={() => { setShowModal(false); setEditPatient(null); }}
          onSave={() => { loadPatients(page, search); setShowModal(false); setEditPatient(null); }}
        />
      )}

      {showBroadcastModal && (
        <BroadcastDialog onClose={() => setShowBroadcastModal(false)} />
      )}

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title="Excluir paciente"
        message="Esta ação não pode ser desfeita. Tem certeza de que deseja remover permanentemente este paciente e todos os seus dados vinculados?"
        confirmLabel="Excluir" cancelLabel="Cancelar" variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, id: null })}
      />
    </div>
  );
}

// ── PatientModal (apenas para Novo Paciente) ──────────────────────────────────

interface PatientModalProps {
  patientToEdit?: Patient | null;
  onClose: () => void;
  onSave: () => void;
}

function PatientModal({ patientToEdit, onClose, onSave }: PatientModalProps) {
  const [formData, setFormData] = useState({
    name: patientToEdit?.name || '',
    fullName: patientToEdit?.fullName || '',
    modalidade: patientToEdit ? getModalidadeValue(patientToEdit.status, patientToEdit.paymentType) : 'sessao-semanal' as ModalidadeValue,
    isInactive: patientToEdit ? patientToEdit.status === 'inactive' : false,
    defaultSessionPriceCents: patientToEdit?.defaultSessionPriceCents ? String(patientToEdit.defaultSessionPriceCents / 100) : '',
    document: patientToEdit?.document || '',
    phone: patientToEdit?.phone || '',
    email: patientToEdit?.email || '',
    reminderChannel: patientToEdit?.reminderChannel || 'whatsapp' as ReminderChannel,
  });

  useEffect(() => {
    setFormData({
      name: patientToEdit?.name || '',
      fullName: patientToEdit?.fullName || '',
      modalidade: patientToEdit ? getModalidadeValue(patientToEdit.status, patientToEdit.paymentType) : 'sessao-semanal' as ModalidadeValue,
      isInactive: patientToEdit ? patientToEdit.status === 'inactive' : false,
      defaultSessionPriceCents: patientToEdit?.defaultSessionPriceCents ? String(patientToEdit.defaultSessionPriceCents / 100) : '',
      document: patientToEdit?.document || '',
      phone: patientToEdit?.phone || '',
      email: patientToEdit?.email || '',
      reminderChannel: patientToEdit?.reminderChannel || 'whatsapp' as ReminderChannel,
    });
  }, [patientToEdit]);

  const [submitting, setSubmitting] = useState(false);
  const [optIn, setOptIn] = useState(patientToEdit?.whatsappBulkOptIn ?? false);
  const [savingOptIn, setSavingOptIn] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setOptIn(patientToEdit?.whatsappBulkOptIn ?? false);
  }, [patientToEdit]);

  const handleOptInChange = async (checked: boolean) => {
    if (!patientToEdit) {
      setOptIn(checked);
      return;
    }
    setSavingOptIn(true);
    try {
      await fetchApi(`/api/psychotherapy/patients/${patientToEdit.id}/broadcast-opt-in`, {
        method: 'PATCH',
        body: JSON.stringify({ optIn: checked })
      });
      setOptIn(checked);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao salvar consentimento.');
    } finally {
      setSavingOptIn(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const option = MODALIDADE_OPTIONS.find(o => o.value === formData.modalidade)!;
      await fetchApi('/api/psychotherapy/patients', {
        method: 'POST',
        body: JSON.stringify({
          id: patientToEdit?.id,
          name: formData.name,
          fullName: formData.fullName || null,
          status: formData.isInactive ? 'inactive' : option.status,
          paymentType: option.paymentType,
          defaultSessionPriceCents: formData.defaultSessionPriceCents
            ? Math.round(Number(formData.defaultSessionPriceCents) * 100) : null,
          document: formData.document || null,
          phone: formData.phone || null,
          email: formData.email || null,
          reminderChannel: formData.reminderChannel,
        })
      });
      toast.success(patientToEdit ? 'Paciente atualizado com sucesso.' : 'Paciente criado com sucesso.');
      onSave();
    } catch (error) {
      toast.error((error instanceof Error ? error.message : String(error)) || (patientToEdit ? 'Falha ao atualizar paciente.' : 'Falha ao criar paciente.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-fade-in" style={{ maxWidth: '600px' }}>
        <h2 className="text-h2 mb-4">{patientToEdit ? 'Editar Paciente' : 'Novo Paciente'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Nome *</label>
            <input required type="text" className="form-control" value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })} disabled={submitting} />
          </div>
          <div className="form-group">
            <label className="form-label">Nome Completo (para Emissão de Recibo)</label>
            <input type="text" className="form-control" placeholder="Ex.: Ana de Souza Santos" value={formData.fullName}
              onChange={e => setFormData({ ...formData, fullName: e.target.value })} disabled={submitting} />
          </div>
          <div className="flex gap-4 items-end">
            <div className="form-group w-full">
              <label className="form-label">Modalidade *</label>
              <select className="form-control" value={formData.modalidade}
                onChange={e => setFormData({ ...formData, modalidade: e.target.value as ModalidadeValue })}
                disabled={submitting || formData.isInactive}>
                {MODALIDADE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ whiteSpace: 'nowrap', paddingBottom: '0.25rem' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formData.isInactive}
                  onChange={e => setFormData({ ...formData, isInactive: e.target.checked })}
                  disabled={submitting}
                  style={{ width: '1rem', height: '1rem' }}
                />
                Inativo
              </label>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="form-group w-full">
              <label className="form-label">Valor Padrão por Sessão (R$)</label>
              <input type="number" step="0.01" className="form-control" value={formData.defaultSessionPriceCents}
                onChange={e => setFormData({ ...formData, defaultSessionPriceCents: e.target.value })} disabled={submitting} />
            </div>
            <div className="form-group w-full">
              <label className="form-label">CPF / Documento</label>
              <input type="text" className="form-control" value={formData.document}
                onChange={e => setFormData({ ...formData, document: e.target.value })} disabled={submitting} />
            </div>
          </div>
          <div className="flex gap-4">
            <div className="form-group w-full">
              <label className="form-label">WhatsApp (com DDD)</label>
              <input type="text" className="form-control" placeholder="11999998888" value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })} disabled={submitting} />
            </div>
            <div className="form-group w-full">
              <label className="form-label">E-mail</label>
              <input type="email" className="form-control" value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })} disabled={submitting} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: patientToEdit ? 'pointer' : 'default' }}>
              <input
                type="checkbox"
                checked={optIn}
                onChange={e => handleOptInChange(e.target.checked)}
                disabled={submitting || savingOptIn || !patientToEdit}
                style={{ width: '1rem', height: '1rem' }}
              />
              Aceita receber mensagens em massa (broadcast) via WhatsApp
            </label>
            {!patientToEdit && (
              <p className="text-small text-muted mt-1">Disponível após criar o paciente.</p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Canal de Lembrete</label>
            <select className="form-control" value={formData.reminderChannel}
              onChange={e => setFormData({ ...formData, reminderChannel: e.target.value as ReminderChannel })}
              disabled={submitting}>
              <option value="whatsapp">📱 WhatsApp</option>
              <option value="email">📧 E-mail</option>
              <option value="both">📱 + 📧 Ambos</option>
              <option value="none">🔕 Nenhum</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (patientToEdit ? 'Salvando...' : 'Criando...') : (patientToEdit ? 'Salvar Alterações' : 'Criar Paciente')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── BroadcastDialog (mensagem em massa para pacientes ativos com opt-in) ────

const TERMINAL_BROADCAST_STATUSES: Broadcast['status'][] = ['completed', 'partial_failed', 'canceled'];

function isTerminalBroadcast(status: Broadcast['status']): boolean {
  return TERMINAL_BROADCAST_STATUSES.includes(status);
}

function BroadcastDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    textareaRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPreview = useCallback(async () => {
    try {
      setLoadingPreview(true);
      const res = await fetchApi<{ data: BroadcastPreview }>('/api/psychotherapy/broadcasts/preview');
      setPreview(res.data);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao carregar destinatários.');
    } finally {
      setLoadingPreview(false);
    }
  }, [toast]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  // Polling de status enquanto houver campanha ativa não-terminal
  useEffect(() => {
    if (!broadcast || isTerminalBroadcast(broadcast.status)) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetchApi<{ data: Broadcast }>(`/api/psychotherapy/broadcasts/${broadcast.id}`);
        setBroadcast(res.data);
      } catch {
        // erro de polling não é crítico; próxima rodada tenta novamente
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [broadcast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    try {
      setSubmitting(true);
      const res = await fetchApi<{ data: Broadcast }>('/api/psychotherapy/broadcasts', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ message: message.trim() })
      });
      setBroadcast(res.data);
      toast.success(`Campanha aceita para ${res.data.totalRecipients} paciente(s). O envio é assíncrono.`);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao criar campanha de mensagem em massa.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelBroadcast = async () => {
    if (!broadcast) return;
    try {
      await fetchApi(`/api/psychotherapy/broadcasts/${broadcast.id}/cancel`, { method: 'POST' });
      setBroadcast({ ...broadcast, status: 'canceled' });
      toast.success('Campanha cancelada. Mensagens já enviadas não podem ser desfeitas.');
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao cancelar campanha.');
    }
  };

  const handleNewCampaign = () => {
    setBroadcast(null);
    setMessage('');
    setIdempotencyKey(crypto.randomUUID());
    loadPreview();
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal-content animate-fade-in"
        style={{ maxWidth: '560px' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="broadcast-dialog-title"
        ref={dialogRef}
      >
        <h2 id="broadcast-dialog-title" className="text-h2 mb-4">Mensagem em massa</h2>

        {!broadcast ? (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="broadcast-preview">Destinatários</label>
              {loadingPreview ? (
                <p className="text-small">Calculando destinatários elegíveis...</p>
              ) : preview ? (
                <div id="broadcast-preview" className="text-small">
                  <p><strong>{preview.eligible}</strong> paciente(s) ativo(s), com opt-in e telefone válido receberão esta mensagem.</p>
                  {(preview.excluded.inactive > 0 || preview.excluded.withoutOptIn > 0 || preview.excluded.withoutPhone > 0 || preview.excluded.invalidPhone > 0) && (
                    <p className="text-muted mt-1">
                      Excluídos: {preview.excluded.inactive} inativos, {preview.excluded.withoutOptIn} sem opt-in, {preview.excluded.withoutPhone} sem telefone, {preview.excluded.invalidPhone} com telefone inválido.
                    </p>
                  )}
                  {preview.eligible > preview.maxRecipients && (
                    <p className="text-error mt-1">
                      O lote excede o limite atual de {preview.maxRecipients} destinatários por campanha.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="broadcast-message">Mensagem *</label>
              <textarea
                id="broadcast-message"
                ref={textareaRef}
                required
                className="form-control"
                rows={5}
                maxLength={1000}
                placeholder="Escreva a mensagem que será enviada a todos os pacientes ativos com opt-in..."
                value={message}
                onChange={e => setMessage(e.target.value)}
                disabled={submitting}
              />
              <p className="text-small text-muted mt-1">{message.length}/1000</p>
            </div>

            <p className="text-small text-muted">
              O envio é assíncrono e respeita um intervalo entre mensagens para reduzir o risco de bloqueio do WhatsApp.
              Mensagens já enviadas não podem ser desfeitas.
            </p>

            <div className="flex justify-end gap-2 mt-6">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !message.trim() || loadingPreview || !preview || preview.eligible === 0}
              >
                {submitting ? 'Enviando...' : `Enviar para ${preview?.eligible ?? 0} paciente(s)`}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p className="mb-2">Campanha aceita — {broadcast.totalRecipients} destinatário(s).</p>
            <p className="text-small text-muted mb-4">Status: {translateBroadcastStatus(broadcast.status)}</p>

            {broadcast.counts && (
              <ul className="text-small mb-4">
                <li>Enviadas: {broadcast.counts.sent}</li>
                <li>Aguardando envio: {broadcast.counts.queued + broadcast.counts.retry_wait + broadcast.counts.sending}</li>
                <li>Falhas: {broadcast.counts.failed}</li>
                <li>Status desconhecido: {broadcast.counts.delivery_unknown}</li>
                <li>Canceladas: {broadcast.counts.canceled}</li>
              </ul>
            )}

            <div className="flex justify-end gap-2 mt-6">
              {!isTerminalBroadcast(broadcast.status) && (
                <button type="button" className="btn btn-secondary" onClick={handleCancelBroadcast}>Cancelar campanha</button>
              )}
              {isTerminalBroadcast(broadcast.status) && (
                <button type="button" className="btn btn-secondary" onClick={handleNewCampaign}>Nova campanha</button>
              )}
              <button type="button" className="btn btn-primary" onClick={onClose}>Fechar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function translateBroadcastStatus(status: Broadcast['status']): string {
  switch (status) {
    case 'queued': return 'na fila';
    case 'processing': return 'enviando';
    case 'completed': return 'concluída';
    case 'partial_failed': return 'concluída com falhas parciais';
    case 'canceled': return 'cancelada';
    default: return status;
  }
}
