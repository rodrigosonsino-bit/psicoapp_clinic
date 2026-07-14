import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchApi } from '../services/api';
import type { Patient, Session, PaginatedResponse } from '../types/api';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Trash2, Download, Plus, Edit2 } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonTable } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import './Sessions.css';

type SessionStatus = 'attended' | 'justified_absence' | 'unjustified_absence' | 'canceled';

export default function Sessions() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [currentSession, setCurrentSession] = useState<Partial<Session> | null>(null);

  // Confirmation dialog state
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });

  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const [patientsData, sessionsData] = await Promise.all([
        fetchApi<PaginatedResponse<Patient>>('/api/psychotherapy/patients?limit=200'),
        fetchApi<PaginatedResponse<Session>>('/api/psychotherapy/sessions')
      ]);
      setPatients((patientsData.data || []).filter(p => p.status !== 'inactive'));
      setSessions(sessionsData.data || []);
    } catch (err) {
      console.error(err);
      setError(true);
      toast.error('Erro ao carregar os dados de sessões.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Atalho "Ver Sessão" vindo da tela de Agendamentos (?openId=<sessionId>) — abre o modal de
  // edição direto na sessão vinculada assim que a lista carregar, sem o usuário precisar procurar
  // manualmente. Limpa o parâmetro da URL depois (replace, sem entrada nova no histórico) pra não
  // reabrir o modal num refresh de página.
  useEffect(() => {
    const openId = searchParams.get('openId');
    if (!openId || sessions.length === 0) return;
    const target = sessions.find(s => s.id === openId);
    if (target) {
      setCurrentSession(target);
      setShowModal(true);
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('openId');
      return next;
    }, { replace: true });
  }, [sessions, searchParams, setSearchParams]);

  const openModal = (session: Partial<Session> | null = null) => {
    setCurrentSession(session);
    setShowModal(true);
  };

  const askDeleteSession = (id: string) => {
    setConfirmDelete({ open: true, id });
  };

  const handleDelete = async () => {
    const id = confirmDelete.id;
    if (!id) return;

    try {
      await fetchApi(`/api/psychotherapy/sessions/${id}`, { method: 'DELETE' });
      toast.success('Sessão excluída com sucesso.');
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao excluir registro de sessão.');
    } finally {
      setConfirmDelete({ open: false, id: null });
    }
  };

  const getStatusBadge = (status: SessionStatus) => {
    switch (status) {
      case 'attended': return <span className="badge attended">Presente</span>;
      case 'justified_absence': return <span className="badge justified_absence">Falta Justificada</span>;
      case 'unjustified_absence': return <span className="badge unjustified_absence">Falta Injustificada</span>;
      case 'canceled': return <span className="badge canceled">Cancelado</span>;
      default: return null;
    }
  };

  const getPatientName = (id: string) => {
    const p = patients.find(p => p.id === id);
    return p ? p.name : 'Paciente Desconhecido';
  };

  const handleExport = async () => {
    try {
      const blob = await fetchApi<Blob>('/api/psychotherapy/export/sessions', {
        headers: { Accept: 'text/csv' },
        responseType: 'blob'
      });
      const url = URL.createObjectURL(new Blob([blob], { type: 'text/csv' }));
      Object.assign(document.createElement('a'), { href: url, download: 'sessoes.csv' }).click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao exportar sessões.');
    }
  };

  return (
    <div className="sessions-container animate-fade-in">
      <div className="sessions-header flex justify-between items-center mb-6">
        <div>
          <h1 className="text-h1">Diário de Sessões</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}
          >
            <Download size={16} /> CSV
          </button>
          <button className="btn btn-primary" onClick={() => openModal()}>
            <Plus size={18} /> Nova Sessão
          </button>
        </div>
      </div>


      {loading ? (
        <SkeletonTable rows={5} cols={4} />
      ) : error ? (
        <ErrorState
          title="Erro ao obter sessões"
          message="Não foi possível recuperar os dados de sessões agendadas."
          onRetry={loadData}
        />
      ) : (
        <div className="sessions-list">
          {sessions.length === 0 ? (
            <div className="empty-state">Nenhuma sessão registrada.</div>
          ) : (
            sessions.map(session => (
              <div key={session.id} className="session-item animate-fade-in">
                <div className="session-info">
                  <span className="session-patient">{getPatientName(session.patientId)}</span>
                  <span className="session-date">
                    {format(new Date(session.date), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                    {session.notes && ` - Nota: ${session.notes}`}
                  </span>
                </div>
                <div className="session-status">
                  {getStatusBadge(session.status)}
                  <div className="flex gap-2">
                    <button className="btn-icon" onClick={() => openModal(session)}>
                      <Edit2 size={16} />
                    </button>
                    <button className="btn-icon text-danger" onClick={() => askDeleteSession(session.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title="Excluir Registro de Sessão"
        message="Esta ação irá remover permanentemente o registro desta sessão. Tem certeza que deseja prosseguir?"
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, id: null })}
      />

      {showModal && (
        <SessionModal
          session={currentSession}
          patients={patients}
          onClose={() => setShowModal(false)}
          onSave={() => loadData()}
        />
      )}
    </div>
  );
}

// ── SessionModal ──────────────────────────────────────────────────────────────

interface SessionModalProps {
  session: Partial<Session> | null;
  patients: Patient[];
  onClose: () => void;
  onSave: () => void;
}

function SessionModal({ session, patients, onClose, onSave }: SessionModalProps) {
  const getLocalDatetimeString = (isoString?: string) => {
    const d = isoString ? new Date(isoString) : new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().substring(0, 16);
  };

  const [formData, setFormData] = useState({
    id: session?.id,
    patientId: session?.patientId || '',
    date: getLocalDatetimeString(session?.date),
    status: (session?.status || 'attended') as SessionStatus,
    notes: session?.notes || ''
  });

  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await fetchApi('/api/psychotherapy/sessions', {
        method: 'POST',
        body: JSON.stringify({
          id: formData.id,
          patientId: formData.patientId,
          date: new Date(formData.date).toISOString(),
          status: formData.status,
          notes: formData.notes || null
        })
      });
      toast.success(session?.id ? 'Sessão atualizada com sucesso.' : 'Sessão registrada com sucesso.');
      onSave();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao salvar sessão.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-fade-in" style={{ maxWidth: '500px' }}>
        <h2 className="text-h2 mb-4">{session?.id ? 'Editar Sessão' : 'Nova Sessão'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Paciente *</label>
            <select 
              required 
              value={formData.patientId} 
              onChange={e => setFormData({ ...formData, patientId: e.target.value })} 
              className="form-control"
              disabled={submitting}
            >
              <option value="">Selecione o paciente...</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label className="form-label">Data e Hora *</label>
            <input 
              type="datetime-local" 
              required 
              value={formData.date} 
              onChange={e => setFormData({ ...formData, date: e.target.value })} 
              className="form-control"
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Status *</label>
            <select 
              required 
              value={formData.status} 
              onChange={e => setFormData({ ...formData, status: e.target.value as SessionStatus })} 
              className="form-control"
              disabled={submitting}
            >
              <option value="attended">Presente</option>
              <option value="justified_absence">Falta Justificada (Não cobra)</option>
              <option value="unjustified_absence">Falta Injustificada (Cobra)</option>
              <option value="canceled">Cancelado pelo Terapeuta</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Anotações (opcional)</label>
            <input 
              type="text" 
              value={formData.notes} 
              onChange={e => setFormData({ ...formData, notes: e.target.value })} 
              className="form-control" 
              placeholder="Ex: Trânsito, atestado..." 
              disabled={submitting}
            />
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!formData.patientId || submitting}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
