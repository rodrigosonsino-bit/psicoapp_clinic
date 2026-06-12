import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, Clock, CheckCircle, XCircle, Loader } from 'lucide-react';
import './ConfirmAppointment.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

interface AppointmentInfo {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  confirmedAt: string | null;
  alreadyProcessed: boolean;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  });
}

export default function ConfirmAppointment() {
  const { token } = useParams<{ token: string }>();
  const [appointment, setAppointment] = useState<AppointmentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/appointments/confirm/${token}`)
      .then(r => r.json())
      .then(res => {
        if (res.error) { setError(res.error); return; }
        setAppointment(res.data);
        if (res.data.status === 'confirmed' || res.data.confirmedAt) setConfirmed(true);
      })
      .catch(() => setError('Não foi possível carregar os dados do agendamento.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleConfirm = async () => {
    if (!token) return;
    setConfirming(true);
    try {
      const res = await fetch(`${API_BASE}/api/appointments/confirm/${token}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao confirmar.'); return; }
      setConfirmed(true);
    } catch {
      setError('Falha ao confirmar presença. Tente novamente.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="confirm-page">
      <div className="confirm-card">
        <div className="confirm-logo">PsicoApp</div>

        {loading && (
          <div className="confirm-loading">
            <Loader size={32} className="spin" />
            <p>Carregando...</p>
          </div>
        )}

        {!loading && error && (
          <div className="confirm-error">
            <XCircle size={48} />
            <h2>Link inválido</h2>
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && appointment && (
          <>
            <div className="confirm-header">
              <CalendarCheck size={40} className="confirm-icon" />
              <h1>Confirmação de Sessão</h1>
              <p>Verifique os dados da sua sessão abaixo</p>
            </div>

            <div className="confirm-details">
              <div className="confirm-detail-row">
                <CalendarCheck size={18} />
                <div>
                  <span className="detail-label">Data e Hora</span>
                  <span className="detail-value">{formatDateTime(appointment.scheduledAt)}</span>
                </div>
              </div>
              <div className="confirm-detail-row">
                <Clock size={18} />
                <div>
                  <span className="detail-label">Duração</span>
                  <span className="detail-value">{appointment.durationMinutes} minutos</span>
                </div>
              </div>
            </div>

            {confirmed || appointment.alreadyProcessed ? (
              <div className="confirm-success">
                <CheckCircle size={40} />
                <h2>
                  {appointment.status === 'canceled' ? 'Sessão cancelada' :
                   appointment.status === 'attended' ? 'Sessão realizada' :
                   'Presença confirmada!'}
                </h2>
                <p>
                  {appointment.status === 'canceled'
                    ? 'Esta sessão foi cancelada. Entre em contato com seu terapeuta.'
                    : appointment.status === 'attended'
                    ? 'Esta sessão já foi registrada como realizada.'
                    : 'Obrigado! Seu terapeuta foi notificado da sua confirmação.'}
                </p>
              </div>
            ) : (
              <div className="confirm-actions">
                <p className="confirm-prompt">
                  Você confirma sua presença nesta sessão?
                </p>
                <button
                  className="confirm-btn"
                  onClick={handleConfirm}
                  disabled={confirming}
                >
                  {confirming ? (
                    <><Loader size={18} className="spin" /> Confirmando...</>
                  ) : (
                    <><CheckCircle size={18} /> Confirmar Presença</>
                  )}
                </button>
              </div>
            )}
          </>
        )}

        <footer className="confirm-footer">
          Gerenciado pelo <strong>PsicoApp</strong>
        </footer>
      </div>
    </div>
  );
}
