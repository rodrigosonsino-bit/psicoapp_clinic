import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, CheckCircle, XCircle, Loader, ChevronLeft, ChevronRight, User, Phone, ShieldCheck } from 'lucide-react';
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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '🩺';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function modalityLabel(m: string) {
  return m === 'presencial' ? '🏢 Presencial' : m === 'online' ? '💻 Online' : '🏢💻 Presencial ou Online';
}
function modalityIcon(m: string) {
  return m === 'presencial' ? '🏢' : m === 'online' ? '💻' : '🏢💻';
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

function Brand() {
  return (
    <div className="book-brand">
      <span className="book-brand-dot" />
      <span>PsicoApp</span>
    </div>
  );
}

function TherapistHero({ name, subtitle }: { name: string; subtitle: string }) {
  return (
    <div className="book-hero">
      <div className="book-avatar">{initials(name)}</div>
      <p className="book-hero-title">Agende sua sessão com</p>
      <h1 className="book-therapist-name">{name || 'Seu terapeuta'}</h1>
      <span className="book-role-badge"><ShieldCheck size={13} /> Psicoterapeuta</span>
      <p className="book-subtitle">{subtitle}</p>
    </div>
  );
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
        <Brand />
        <div className="book-loading"><Loader size={32} className="spin" /><p>Carregando horários...</p></div>
      </div>
    </div>
  );

  if (pageError) return (
    <div className="book-page">
      <div className="book-card">
        <Brand />
        <div className="book-error"><XCircle size={48} /><h2>Link inválido</h2><p>{pageError}</p></div>
      </div>
    </div>
  );

  if (!info) return null;

  // ── Sucesso ───────────────────────────────────────────────────────────────

  if (step === 'booked' && selectedSlot) return (
    <div className="book-page">
      <div className="book-card">
        <Brand />
        <div className="book-success">
          <div className="book-success-icon"><CheckCircle size={48} /></div>
          <h2>Sessão agendada!</h2>
          <div className="book-success-card">
            <p className="book-datetime">{formatFull(selectedSlot.datetime)}</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
              {selectedSlot.durationMinutes} min · {modalityLabel(selectedSlot.modality)}
            </p>
          </div>
          {info.tenantName && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{info.tenantName}</strong> receberá a confirmação automaticamente.
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
        <Brand />
        <TherapistHero name={info.tenantName} subtitle="Informe seus dados para ver os horários disponíveis e confirmar sua sessão." />

        <form onSubmit={handleFormSubmit} className="book-form">
          <div className="book-field">
            <label className="book-label"><User size={14} /> Nome completo</label>
            <input
              type="text"
              className="book-input"
              placeholder="Seu nome"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="book-field">
            <label className="book-label"><Phone size={14} /> Celular / WhatsApp</label>
            <input
              type="tel"
              className="book-input"
              placeholder="(51) 99999-9999"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
          </div>

          {formError && <p className="book-error-text">{formError}</p>}

          <button type="submit" className="book-confirm-btn" style={{ width: '100%' }}>
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
        <Brand />

        <div className="book-hero">
          <div className="book-avatar">{initials(info.tenantName)}</div>
          <h1 className="book-therapist-name">Escolha um horário</h1>
          <p className="book-subtitle">
            Olá, <strong style={{ color: 'var(--text-primary)' }}>{name}</strong>!{' '}
            {info.tenantName && <>Sessão com <strong style={{ color: 'var(--text-primary)' }}>{info.tenantName}</strong>.</>}
          </p>
          <button
            className="book-link-btn"
            onClick={() => { setStep('form'); setSelectedSlot(null); setBookError(''); }}
          >
            ← Alterar meus dados
          </button>
        </div>

        {info.availableSlots.length === 0 ? (
          <div className="book-empty">
            <Clock size={40} />
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
                          <span>{new Date(slot.datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                          <span style={{ fontSize: '0.7rem', opacity: 0.85 }}>{modalityIcon(slot.modality)}</span>
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
                  <CheckCircle size={18} style={{ color: 'var(--status-success)', flexShrink: 0 }} />
                  <div>
                    <strong>{formatFull(selectedSlot.datetime)}</strong>
                    <span style={{ color: 'var(--text-secondary)' }}> · {selectedSlot.durationMinutes} min · {modalityLabel(selectedSlot.modality)}</span>
                  </div>
                </div>
                {bookError && <p className="book-error-text" style={{ width: '100%' }}>{bookError}</p>}
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
