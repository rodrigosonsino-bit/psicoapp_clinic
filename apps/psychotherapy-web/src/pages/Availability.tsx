import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Clock, ToggleLeft, ToggleRight } from 'lucide-react';
import { fetchApi } from '../services/api';
import type { AvailabilitySlot } from '../types/api';
import { useToast } from '../context/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonTable } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import './Availability.css';

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Gera opções de hora: 06:00 até 22:00 em blocos de 30 min
const TIME_OPTIONS = Array.from({ length: 33 }, (_, i) => {
  const totalMins = 6 * 60 + i * 30;
  const h = String(Math.floor(totalMins / 60)).padStart(2, '0');
  const m = String(totalMins % 60).padStart(2, '0');
  return `${h}:${m}`;
});

export default function Availability() {
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [formData, setFormData] = useState({ dayOfWeek: 1, startTime: '09:00', durationMinutes: 50, notes: '' });
  const [submitting, setSubmitting] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await fetchApi('/api/psychotherapy/availability', { method: 'POST', body: JSON.stringify(formData) });
      toast.success('Horário adicionado!');
      setShowForm(false);
      setFormData({ dayOfWeek: 1, startTime: '09:00', durationMinutes: 50, notes: '' });
      load();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao salvar horário.');
    } finally { setSubmitting(false); }
  };

  const toggleActive = async (slot: AvailabilitySlot) => {
    try {
      await fetchApi('/api/psychotherapy/availability', {
        method: 'POST',
        body: JSON.stringify({ id: slot.id, dayOfWeek: slot.dayOfWeek, startTime: slot.startTime, durationMinutes: slot.durationMinutes, isActive: !slot.isActive })
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

  // Agrupa por dia da semana
  const byDay = DAY_NAMES.map((name, dow) => ({
    name, dow,
    slots: slots.filter(s => s.dayOfWeek === dow)
  })).filter(d => d.slots.length > 0);

  return (
    <div className="availability-page animate-fade-in">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-h1">Horários Disponíveis</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Defina os horários que você disponibiliza para agendamento pelos pacientes
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={18} /> Adicionar Horário
        </button>
      </div>

      {showForm && (
        <div className="card mb-4" style={{ padding: '1.5rem', maxWidth: 480 }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Novo Horário Disponível</h3>
          <form onSubmit={handleSubmit}>
            <div className="flex gap-3 mb-3">
              <div className="form-group w-full">
                <label className="form-label">Dia da Semana</label>
                <select className="form-control" value={formData.dayOfWeek}
                  onChange={e => setFormData({ ...formData, dayOfWeek: Number(e.target.value) })} disabled={submitting}>
                  {DAY_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
                </select>
              </div>
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
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={submitting}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Salvando...' : 'Adicionar'}
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
        <div className="availability-grid">
          {byDay.map(({ name, slots: daySlots }) => (
            <div key={name} className="card availability-day-card">
              <h3 className="availability-day-title">{name}</h3>
              <div className="availability-slots">
                {daySlots.sort((a, b) => a.startTime.localeCompare(b.startTime)).map(slot => (
                  <div key={slot.id} className={`availability-slot-row ${!slot.isActive ? 'inactive' : ''}`}>
                    <div className="slot-time">
                      <strong>{slot.startTime}</strong>
                      <span>{slot.durationMinutes} min</span>
                    </div>
                    <div className="slot-actions">
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
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog isOpen={confirmDelete.open} title="Remover horário"
        message="Este horário deixará de aparecer para agendamentos. Confirmar?"
        confirmLabel="Remover" cancelLabel="Cancelar" variant="danger"
        onConfirm={handleDelete} onCancel={() => setConfirmDelete({ open: false, id: null })} />
    </div>
  );
}
