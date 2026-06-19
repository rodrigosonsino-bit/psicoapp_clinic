import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Calendar, Clock, CheckCircle, XCircle, Loader, ChevronLeft, ChevronRight, User, Phone } from 'lucide-react';
import type { AvailableSlot } from '../types/api';
import './BookAppointment.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface PublicBookingPageInfo {
  tenantName: string;
  availableSlots: AvailableSlot[];
}

function formatFull(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
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

export default function SelfBookAppointment() {
  const { token } = useParams<{ token: string }>();

  // Dados da página
  const [info, setInfo] = useState<PublicBookingPageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Etapas: 'form' → 'slots' → 'booked'
  const [step, setStep] = useState<'form' | 'slots' | 'booked'>('form');

  // Dados do novo paciente
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [formError, setFormError] = useState('');

  // Seleção de horário
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/book-public/${token}`)
      .then(r => r.json())
      .then(res => { if (res.error) setPageError(res.error); else setInfo(res.data); })
      .catch(() => setPageError('Não foi possível carregar os horários disponíveis.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) { setFormError('Por favor, informe seu nome completo.'); return; }
    if (phone.trim().length < 8) { setFormError('Por favor, informe um celular válido.'); return; }
    setFormError('');
    setStep('slots');
  };

  const handleBook = async () => {
    if (!selectedSlot || !token) return;
    setBooking(true);
    setBookError('');
    try {
      const res = await fetch(`${API_BASE}/api/book-public/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), scheduledAt: selectedSlot.datetime })
      });
      const data = await res.json();
      if (!res.ok) { setBookError(data.error || 'Erro ao confirmar agendamento.'); return; }
      setStep('booked');
    } catch { setBookError('Falha ao confirmar. Tente novamente.'); }
    finally { setBooking(false); }
  };

  // ── Estados de carregamento / erro ────────────────────────────────────────

  if (loading) return (
    <div className="book-page">
      <div className="book-card">
        <div className="book-logo">PsicoApp</div>
        <div className="book-loading"><Loader size={32} className="spin" /><p>Carregando...</p></div>
      </div>
    </div>
  );

  if (pageError) return (
    <div className="book-page">
      <div className="book-card">
        <div className="book-logo">PsicoApp</div>
        <div className="book-error"><XCircle size={48} /><h2>Link inválido</h2><p>{pageError}</p></div>
      </div>
    </div>
  );

  if (!info) return null;

  // ── Sucesso ───────────────────────────────────────────────────────────────

  if (step === 'booked' && selectedSlot) return (
    <div className="book-page">
      <div className="book-card">
        <div className="book-logo">PsicoApp</div>
        <div className="book-success">
          <CheckCircle size={56} />
          <h2>Sessão agendada!</h2>
          <p className="book-datetime">{formatFull(selectedSlot.datetime)}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Duração: {selectedSlot.durationMinutes} min · {
              selectedSlot.modality === 'presencial' ? '🏢 Presencial' :
              selectedSlot.modality === 'online' ? '💻 Online' : '🏢💻 Presencial ou Online'
            }
          </p>
          {info.tenantName && (
            <p style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Seu terapeuta receberá a confirmação automaticamente.
            </p>
          )}
        </div>
        <footer className="book-footer">Gerenciado pelo <strong>PsicoApp</strong></footer>
      </div>
    </div>
  );

  // ── Etapa 1: Formulário de identificação ─────────────────────────────────

  if (step === 'form') return (
    <div className="book-page">
      <div className="book-card">
        <div className="book-logo">PsicoApp</div>
        <div className="book-header">
          <Calendar size={36} className="book-icon" />
          <h1>Agendar Sessão</h1>
          {info.tenantName && <p className="book-therapist">com <strong>{info.tenantName}</strong></p>}
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Informe seus dados para prosseguir com o agendamento.
          </p>
        </div>

        <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              <User size={14} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
              Nome completo
            </label>
            <input
              type="text"
              className="form-control"
              placeholder="Seu nome"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              style={{ fontSize: '1rem', padding: '0.65rem 0.9rem' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              <Phone size={14} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
              Celular / WhatsApp
            </label>
            <input
              type="tel"
              className="form-control"
              placeholder="(51) 99999-9999"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              style={{ fontSize: '1rem', padding: '0.65rem 0.9rem' }}
            />
          </div>

          {formError && (
            <p style={{ color: 'var(--status-danger)', fontSize: '0.85rem', margin: 0 }}>{formError}</p>
          )}

          <button
            type="submit"
            className="book-confirm-btn"
            style={{ marginTop: '0.5rem', width: '100%', justifyContent: 'center' }}
          >
            Ver horários disponíveis
          </button>
        </form>

        <footer className="book-footer">Gerenciado pelo <strong>PsicoApp</strong></footer>
      </div>
    </div>
  );

  // ── Etapa 2: Seleção de horário ───────────────────────────────────────────

  const allByDate = groupByDate(info.availableSlots);
  const sortedDates = Array.from(allByDate.keys()).sort();

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
          <h1>Escolha um horário</h1>
          <p>
            Olá, <strong>{name}</strong>!{' '}
            {info.tenantName && <>Sessão com <strong>{info.tenantName}</strong>.</>}
          </p>
          <button
            onClick={() => { setStep('form'); setSelectedSlot(null); setBookError(''); }}
            style={{ background: 'none', border: 'none', color: 'var(--brand-primary)', cursor: 'pointer', fontSize: '0.85rem', marginTop: '0.25rem' }}
          >
            ← Alterar dados
          </button>
        </div>

        {info.availableSlots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            <Clock size={40} style={{ marginBottom: '0.75rem' }} />
            <p>Nenhum horário disponível no momento.</p>
          </div>
        ) : (
          <>
            <div className="book-week-nav">
              <button className="btn-icon" disabled={weekOffset === 0} onClick={() => setWeekOffset(w => w - 1)}>
                <ChevronLeft size={20} />
              </button>
              <span className="book-week-label">
                {currentWeekKey && (() => {
                  const d = new Date(currentWeekKey + 'T12:00:00');
                  return `Semana de ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
                })()}
              </span>
              <button className="btn-icon" disabled={weekOffset >= weekKeys.length - 1} onClick={() => setWeekOffset(w => w + 1)}>
                <ChevronRight size={20} />
              </button>
            </div>

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
                          <span className="book-time-value">
                            {new Date(slot.datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span style={{ marginLeft: '4px', fontSize: '0.75rem', opacity: 0.8 }}>
                            {slot.modality === 'presencial' ? '🏢' : slot.modality === 'online' ? '💻' : '🏢💻'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedSlot && (
              <div className="book-confirm-panel">
                <div className="book-selected-info">
                  <CheckCircle size={18} style={{ color: 'var(--status-success)' }} />
                  <div>
                    <strong>{formatFull(selectedSlot.datetime)}</strong>
                    <span> · {selectedSlot.durationMinutes} min · {
                      selectedSlot.modality === 'presencial' ? '🏢 Presencial' :
                      selectedSlot.modality === 'online' ? '💻 Online' : '🏢💻 Presencial/Online'
                    }</span>
                  </div>
                </div>
                {bookError && <p style={{ color: 'var(--status-danger)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{bookError}</p>}
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
