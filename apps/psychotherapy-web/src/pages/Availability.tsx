import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Clock, ToggleLeft, ToggleRight, Pencil, Link2 } from 'lucide-react';
import { fetchApi } from '../services/api';
import type { AvailabilitySlot, AvailabilityRecurrenceType, AvailabilityModality } from '../types/api';
import { useToast } from '../context/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonTable } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import './Availability.css';

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Gera opções de hora: 06:00 até 22:00 em blocos de 5 min
const TIME_OPTIONS = Array.from({ length: 193 }, (_, i) => {
  const totalMins = 6 * 60 + i * 5;
  const h = String(Math.floor(totalMins / 60)).padStart(2, '0');
  const m = String(totalMins % 60).padStart(2, '0');
  return `${h}:${m}`;
});

export default function Availability() {
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingSlot, setEditingSlot] = useState<AvailabilitySlot | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [formData, setFormData] = useState({
    dayOfWeek: 1,
    startTime: '09:00',
    durationMinutes: 50,
    notes: '',
    recurrenceType: 'weekly' as AvailabilityRecurrenceType,
    startDate: '',
    modality: 'presencial' as AvailabilityModality,
  });
  const [submitting, setSubmitting] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(false);
      const res = await fetchApi<{ data: AvailabilitySlot[] }>('/api/psychotherapy/availability');
      setSlots(res.data);
    } catch {
      setError(true);
      toast.error('Erro ao carregar horários disponíveis.');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const copyPublicLink = async () => {
    try {
      setCopyingLink(true);
      const res = await fetchApi<{ data: { url: string } }>('/api/psychotherapy/public-booking-token');
      await navigator.clipboard.writeText(res.data.url);
      toast.success('Link público de agendamento copiado!');
    } catch {
      toast.error('Falha ao gerar link.');
    } finally {
      setCopyingLink(false);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingSlot(null);
    setFormData({ dayOfWeek: 1, startTime: '09:00', durationMinutes: 50, notes: '', recurrenceType: 'weekly', startDate: '', modality: 'presencial' });
  };

  const openEdit = (slot: AvailabilitySlot) => {
    setEditingSlot(slot);
    setFormData({
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      durationMinutes: slot.durationMinutes,
      notes: slot.notes ?? '',
      recurrenceType: slot.recurrenceType,
      startDate: slot.startDate ? slot.startDate.slice(0, 10) : '',
      modality: slot.modality,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const base = { ...formData, startDate: formData.startDate || null };
      const payload = editingSlot ? { ...base, id: editingSlot.id } : base;
      await fetchApi('/api/psychotherapy/availability', { method: 'POST', body: JSON.stringify(payload) });
      toast.success(editingSlot ? 'Horário atualizado!' : 'Horário adicionado!');
      resetForm();
      load();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao salvar horário.');
    } finally { setSubmitting(false); }
  };

  const toggleActive = async (slot: AvailabilitySlot) => {
    try {
      await fetchApi('/api/psychotherapy/availability', {
        method: 'POST',
        body: JSON.stringify({
          id: slot.id,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          durationMinutes: slot.durationMinutes,
          isActive: !slot.isActive,
          recurrenceType: slot.recurrenceType,
          startDate: slot.startDate,
          modality: slot.modality
        })
      });
      toast.success(slot.isActive ? 'Horário desativado.' : 'Horário ativado.');
      load();
    } catch { toast.error('Falha ao alterar status.'); }
  };

  const handleDelete = async () => {
    if (!confirmDelete.id) return;
    try {
      await fetchApi(`/api/psychotherapy/availability/${confirmDelete.id}`, { method: 'DELETE' });
      toast.success('Horário removido.');
      load();
    } catch { toast.error('Falha ao remover horário.'); }
    finally { setConfirmDelete({ open: false, id: null }); }
  };

  // Agrupa slots recorrentes por dia da semana
  const recurringSlots = slots.filter(s => s.recurrenceType !== 'once');
  const byDay = DAY_NAMES.map((name, dow) => ({
    name, dow,
    slots: recurringSlots.filter(s => s.dayOfWeek === dow)
  })).filter(d => d.slots.length > 0);

  // Ordena os slots avulsos (once) por data
  const onceSlots = slots.filter(s => s.recurrenceType === 'once')
    .sort((a, b) => {
      const dateA = a.startDate ?? '';
      const dateB = b.startDate ?? '';
      const compareDate = dateA.localeCompare(dateB);
      if (compareDate !== 0) return compareDate;
      return a.startTime.localeCompare(b.startTime);
    });

  return (
    <div className="availability-page animate-fade-in">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-h1">Horários Disponíveis</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Defina os horários que você disponibiliza para agendamento pelos pacientes
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={copyPublicLink} disabled={copyingLink} title="Gera um link público para qualquer pessoa agendar sem precisar ser paciente cadastrado">
            <Link2 size={18} /> {copyingLink ? 'Gerando...' : 'Link público'}
          </button>
          <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus size={18} /> Adicionar Horário
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card mb-4" style={{ padding: '1.5rem', maxWidth: 480 }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>{editingSlot ? 'Editar Horário' : 'Novo Horário Disponível'}</h3>
          <form onSubmit={handleSubmit}>
            {/* Tipo de Recorrência */}
            <div className="form-group mb-3">
              <label className="form-label">Tipo</label>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                {(['weekly', 'biweekly', 'once'] as const).map(type => (
                  <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input
                      type="radio"
                      name="recurrenceType"
                      value={type}
                      checked={formData.recurrenceType === type}
                      onChange={() => setFormData(f => ({ ...f, recurrenceType: type, startDate: '' }))}
                      disabled={submitting}
                    />
                    {type === 'weekly' ? 'Semanal' : type === 'biweekly' ? 'Quinzenal' : 'Avulso'}
                  </label>
                ))}
              </div>
            </div>

            {/* Modalidade */}
            <div className="form-group mb-3">
              <label className="form-label">Modalidade</label>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                {(['presencial', 'online', 'both'] as const).map(m => (
                  <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input
                      type="radio"
                      name="modality"
                      value={m}
                      checked={formData.modality === m}
                      onChange={() => setFormData(f => ({ ...f, modality: m }))}
                      disabled={submitting}
                    />
                    {m === 'presencial' ? 'Presencial' : m === 'online' ? 'Online' : 'Ambos'}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3 mb-3">
              {/* Dia da semana — só para semanal/quinzenal */}
              {formData.recurrenceType !== 'once' && (
                <div className="form-group w-full">
                  <label className="form-label">Dia da Semana</label>
                  <select className="form-control" value={formData.dayOfWeek}
                    onChange={e => setFormData({ ...formData, dayOfWeek: Number(e.target.value) })} disabled={submitting}>
                    {DAY_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
                  </select>
                </div>
              )}

              {/* Data específica — para avulso */}
              {formData.recurrenceType === 'once' && (
                <div className="form-group w-full">
                  <label className="form-label">Data</label>
                  <input type="date" required className="form-control" value={formData.startDate}
                    onChange={e => setFormData({ ...formData, startDate: e.target.value })} disabled={submitting} />
                </div>
              )}

              <div className="form-group w-full">
                <label className="form-label">Horário</label>
                <select className="form-control" value={formData.startTime}
                  onChange={e => setFormData({ ...formData, startTime: e.target.value })} disabled={submitting}>
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ minWidth: 110 }}>
                <label className="form-label">Duração (min)</label>
                <input type="number" min={10} max={240} className="form-control" value={formData.durationMinutes}
                  onChange={e => setFormData({ ...formData, durationMinutes: Number(e.target.value) })} disabled={submitting} />
              </div>
            </div>

            {/* Data de início (âncora) — para quinzenal */}
            {formData.recurrenceType === 'biweekly' && (
              <div className="form-group mb-3">
                <label className="form-label">Data da primeira ocorrência</label>
                <input type="date" required className="form-control" value={formData.startDate}
                  onChange={e => setFormData({ ...formData, startDate: e.target.value })} disabled={submitting} />
                <small style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', display: 'block', marginTop: '0.25rem' }}>
                  O sistema vai calcular as semanas alternadas a partir dessa data.
                </small>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={submitting}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Salvando...' : editingSlot ? 'Salvar alterações' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? <SkeletonTable rows={4} cols={3} /> : error ? (
        <ErrorState title="Erro" message="Não foi possível carregar os horários." onRetry={load} />
      ) : slots.length === 0 ? (
        <div className="availability-empty">
          <Clock size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <p>Nenhum horário cadastrado ainda.</p>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Adicione horários para que seus pacientes possam agendar sessões.
          </p>
          <button className="btn btn-primary mt-3" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Adicionar primeiro horário
          </button>
        </div>
      ) : (
        <>
          {byDay.length > 0 && (
            <div className="mb-5">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Horários Recorrentes</h2>
              <div className="availability-grid">
                {byDay.map(({ name, slots: daySlots }) => (
                  <div key={name} className="card availability-day-card">
                    <h3 className="availability-day-title">{name}</h3>
                    <div className="availability-slots">
                      {daySlots.sort((a, b) => a.startTime.localeCompare(b.startTime)).map(slot => (
                        <div key={slot.id} className={`availability-slot-row ${!slot.isActive ? 'inactive' : ''}`} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="slot-time">
                              <strong>{slot.startTime}</strong>
                              <span>{slot.durationMinutes} min</span>
                            </div>
                            <div className="slot-actions">
                              <button className="btn-icon" title="Editar" onClick={() => openEdit(slot)}>
                                <Pencil size={15} />
                              </button>
                              <button className="btn-icon" title={slot.isActive ? 'Desativar' : 'Ativar'} onClick={() => toggleActive(slot)}>
                                {slot.isActive
                                  ? <ToggleRight size={20} style={{ color: 'var(--status-success)' }} />
                                  : <ToggleLeft size={20} style={{ color: 'var(--text-muted)' }} />}
                              </button>
                              <button className="btn-icon text-danger" title="Remover" onClick={() => setConfirmDelete({ open: true, id: slot.id })}>
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>

                          {/* Badges de Recorrência/Modalidade */}
                          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                            <span className={`badge badge-sm ${
                              slot.recurrenceType === 'biweekly' ? 'badge-warning' : 'badge-success'
                            }`}>
                              {slot.recurrenceType === 'biweekly' ? 'Quinzenal' : 'Semanal'}
                            </span>
                            <span className="badge badge-sm badge-secondary">
                              {slot.modality === 'presencial' ? '🏢 Presencial' :
                               slot.modality === 'online' ? '💻 Online' : '🏢💻 Ambos'}
                            </span>
                            {slot.startDate && slot.recurrenceType === 'biweekly' && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                desde {new Date(slot.startDate.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR')}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {onceSlots.length > 0 && (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Datas Avulsas</h2>
              <div className="availability-grid">
                <div className="card availability-day-card" style={{ gridColumn: '1 / -1' }}>
                  <div className="availability-slots" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                    {onceSlots.map(slot => {
                      const d = slot.startDate ? new Date(slot.startDate.slice(0, 10) + 'T12:00:00') : null;
                      return (
                        <div key={slot.id} className={`availability-slot-row ${!slot.isActive ? 'inactive' : ''}`} style={{ flexDirection: 'column', alignItems: 'stretch', padding: '0.75rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="slot-time">
                              <strong style={{ fontSize: '1.1rem' }}>{slot.startTime}</strong>
                              <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                📅 {d ? d.toLocaleDateString('pt-BR') : ''} ({d ? DAY_NAMES[d.getDay()] : ''})
                              </span>
                              <span>{slot.durationMinutes} min</span>
                            </div>
                            <div className="slot-actions">
                              <button className="btn-icon" title="Editar" onClick={() => openEdit(slot)}>
                                <Pencil size={15} />
                              </button>
                              <button className="btn-icon" title={slot.isActive ? 'Desativar' : 'Ativar'} onClick={() => toggleActive(slot)}>
                                {slot.isActive
                                  ? <ToggleRight size={20} style={{ color: 'var(--status-success)' }} />
                                  : <ToggleLeft size={20} style={{ color: 'var(--text-muted)' }} />}
                              </button>
                              <button className="btn-icon text-danger" title="Remover" onClick={() => setConfirmDelete({ open: true, id: slot.id })}>
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>

                          {/* Badges de Recorrência/Modalidade */}
                          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                            <span className="badge badge-sm badge-info">
                              Avulso
                            </span>
                            <span className="badge badge-sm badge-secondary">
                              {slot.modality === 'presencial' ? '🏢 Presencial' :
                               slot.modality === 'online' ? '💻 Online' : '🏢💻 Ambos'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog isOpen={confirmDelete.open} title="Remover horário"
        message="Este horário deixará de aparecer para agendamentos. Confirmar?"
        confirmLabel="Remover" cancelLabel="Cancelar" variant="danger"
        onConfirm={handleDelete} onCancel={() => setConfirmDelete({ open: false, id: null })} />
    </div>
  );
}
