import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Calendar, Clock, CheckCircle, XCircle, Loader, ChevronLeft, ChevronRight } from 'lucide-react';
import type { BookingPageInfo, AvailableSlot } from '../types/api';
import './BookAppointment.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatFull(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function groupByDate(slots: AvailableSlot[]) {
  const map = new Map<string, AvailableSlot[]>();
  for (const s of slots) {
    const d = new Date(s.datetime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return map;
}

export default function BookAppointment() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<BookingPageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/book/${token}`)
      .then(r => r.json())
      .then(res => { if (res.error) setError(res.error); else setInfo(res.data); })
      .catch(() => setError('Não foi possível carregar os horários disponíveis.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleBook = async () => {
    if (!selectedSlot || !token) return;
    setBooking(true);
    try {
      const res = await fetch(`${API_BASE}/api/book/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: selectedSlot.datetime })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao confirmar agendamento.'); return; }
      setBooked(true);
    } catch { setError('Falha ao confirmar. Tente novamente.'); }
    finally { setBooking(false); }
  };

  if (loading) return (
    <div className="book-page">
      <div className="book-card">
        <div className="book-logo">PsicoApp</div>
        <div className="book-loading"><Loader size={32} className="spin" /><p>Carregando...</p></div>
      </div>
    </div>
  );

  if (error) return (
    <div className="book-page">
      <div className="book-card">
        <div className="book-logo">PsicoApp</div>
        <div className="book-error"><XCircle size={48} /><h2>Link inválido</h2><p>{error}</p></div>
      </div>
    </div>
  );

  if (!info) return null;

  if (info.isExpired) return (
    <div className="book-page">
      <div className="book-card">
        <div className="book-logo">PsicoApp</div>
        <div className="book-error">
          <XCircle size={48} /><h2>Link expirado</h2>
          <p>Este link de agendamento expirou. Solicite um novo ao seu terapeuta.</p>
        </div>
      </div>
    </div>
  );

  if (booked && selectedSlot) return (
    <div className="book-page">
      <div className="book-card">
        <div className="book-logo">PsicoApp</div>
        <div className="book-success">
          <CheckCircle size={56} />
          <h2>Sessão agendada!</h2>
          <p className="book-datetime">{formatFull(selectedSlot.datetime)}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Duração: {selectedSlot.durationMinutes} minutos
          </p>
          <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', fontSize: '0.9rem' }}>
            Seu terapeuta receberá a confirmação automaticamente.
          </p>
        </div>
      </div>
    </div>
  );

  // Agrupa slots por data e filtra pela semana exibida
  const allByDate = groupByDate(info.availableSlots);
  const sortedDates = Array.from(allByDate.keys()).sort();

  // Semanas únicas (segunda a sexta de cada semana)
  const weeks = new Map<string, string[]>();
  for (const dateKey of sortedDates) {
    const d = new Date(dateKey);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const weekKey = monday.toISOString().slice(0, 10);
    if (!weeks.has(weekKey)) weeks.set(weekKey, []);
    weeks.get(weekKey)!.push(dateKey);
  }

  const weekKeys = Array.from(weeks.keys());
  const currentWeekKey = weekKeys[weekOffset] ?? weekKeys[0];
  const currentDates = weeks.get(currentWeekKey) ?? [];

  return (
    <div className="book-page">
      <div className="book-card wide">
        <div className="book-logo">PsicoApp</div>

        <div className="book-header">
          <Calendar size={36} className="book-icon" />
          <h1>Agendar Sessão</h1>
          <p>Olá, <strong>{info.patientName}</strong>! Escolha um horário disponível.</p>
          {info.tenantName && <p className="book-therapist">Terapeuta: {info.tenantName}</p>}
        </div>

        {info.availableSlots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            <Clock size={40} style={{ marginBottom: '0.75rem' }} />
            <p>Nenhum horário disponível no momento.</p>
            <p style={{ fontSize: '0.85rem' }}>Entre em contato com seu terapeuta.</p>
          </div>
        ) : (
          <>
            {/* Navegação por semana */}
            <div className="book-week-nav">
              <button className="btn-icon" disabled={weekOffset === 0} onClick={() => setWeekOffset(w => w - 1)}>
                <ChevronLeft size={20} />
              </button>
              <span className="book-week-label">
                {(() => {
                  if (!currentWeekKey) return '';
                  const d = new Date(currentWeekKey + 'T12:00:00');
                  return `${DAY_NAMES[1]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
                })()}
              </span>
              <button className="btn-icon" disabled={weekOffset >= weekKeys.length - 1} onClick={() => setWeekOffset(w => w + 1)}>
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Grid de datas/horários */}
            <div className="book-dates-grid">
              {currentDates.map(dateKey => {
                const d = new Date(dateKey + 'T12:00:00');
                const daySlots = allByDate.get(dateKey) ?? [];
                return (
                  <div key={dateKey} className="book-date-col">
                    <div className="book-date-header">
                      <span className="book-dow">{DAY_NAMES[d.getDay()]}</span>
                      <span className="book-day">{d.getDate()}</span>
                      <span className="book-month">{MONTH_NAMES[d.getMonth()]}</span>
                    </div>
                    <div className="book-times">
                      {daySlots.map(slot => (
                        <button
                          key={slot.datetime}
                          className={`book-time-btn ${selectedSlot?.datetime === slot.datetime ? 'selected' : ''}`}
                          onClick={() => setSelectedSlot(selectedSlot?.datetime === slot.datetime ? null : slot)}
                        >
                          {new Date(slot.datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Painel de confirmação */}
            {selectedSlot && (
              <div className="book-confirm-panel">
                <div className="book-selected-info">
                  <CheckCircle size={18} style={{ color: 'var(--status-success)' }} />
                  <div>
                    <strong>{formatFull(selectedSlot.datetime)}</strong>
                    <span> · {selectedSlot.durationMinutes} min</span>
                  </div>
                </div>
                <button className="book-confirm-btn" onClick={handleBook} disabled={booking}>
                  {booking ? <><Loader size={16} className="spin" /> Confirmando...</> : 'Confirmar Agendamento'}
                </button>
              </div>
            )}
          </>
        )}

        <footer className="book-footer">Gerenciado pelo <strong>PsicoApp</strong></footer>
      </div>
    </div>
  );
}
