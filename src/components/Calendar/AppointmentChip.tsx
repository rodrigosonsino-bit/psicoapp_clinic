import React, { useState, useRef, useEffect } from 'react';
import { Check, Edit2, Trash2, X, CheckCircle2, UserX, XCircle, Ban, MessageCircle, DollarSign, ExternalLink, Video, MapPin } from 'lucide-react';
import type { Appointment, AppointmentStatus } from '../../types/api';
import type { PositionedAppointment } from './calendarUtils';
import { topPx, heightPx } from './calendarUtils';
import { buildAppointmentConfirmMessage, buildWhatsAppSendUrl } from '../../utils/whatsapp';
import { getAppPublicBaseUrl } from '../../utils/formatters';

interface Props {
  appointment: PositionedAppointment;
  patientName: string;
  patientPhone?: string | null;
  isPaid?: boolean;
  onStatusUpdate: (id: string, status: AppointmentStatus) => void;
  onModalityUpdate: (id: string, modality: 'online' | 'presencial') => void;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
  onOpenProfile: (patientId: string) => void;
  onMarkPaid: (id: string) => void;
}

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  scheduled: 'var(--text-muted)',
  confirmed: 'var(--status-info)',
  attended: 'var(--status-success)',
  canceled: 'var(--status-danger)',
  no_show: 'var(--status-warning)',
};

export default function AppointmentChip({ appointment, patientName, patientPhone, isPaid, onStatusUpdate, onModalityUpdate, onEdit, onDelete, onOpenProfile, onMarkPaid }: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isPastoral = appointment.notes?.startsWith('[PASTORAL_SUMMARY]:') ?? false;
  const isShort = appointment.durationMinutes < 40;
  const isPast = new Date(appointment.scheduledAt) < new Date();
  const tPx = topPx(appointment.scheduledAt);
  const hPx = heightPx(appointment.durationMinutes);
  
  // Format time "14:00"
  const d = new Date(appointment.scheduledAt);
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  // Close popover when clicking outside or pressing Escape
  useEffect(() => {
    if (!showPopover) return;
    const handleDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPopover(false);
    };
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showPopover]);

  const handleAction = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    setShowPopover(false);
    action();
  };

  const sendConfirmWhatsApp = () => {
    if (!patientPhone || !appointment.confirmToken) return;
    const confirmUrl = `${getAppPublicBaseUrl()}/confirm/${appointment.confirmToken}`;
    const message = buildAppointmentConfirmMessage(patientName, appointment.scheduledAt, confirmUrl);
    window.open(buildWhatsAppSendUrl(patientPhone, message), '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <div
        className={`appointment-chip ${isShort ? 'is-short' : ''} ${isPastoral ? 'is-pastoral' : ''}`}
        style={{
          top: tPx,
          height: hPx,
          left: `calc(${appointment.trackIndex} * (100% / ${Math.max(1, appointment.trackCount)}))`,
          width: `calc(100% / ${Math.max(1, appointment.trackCount)} - 3px)`,
          borderLeftColor: STATUS_COLOR[appointment.status],
          opacity: (appointment.status === 'canceled' || appointment.status === 'no_show') ? 0.6 : 1,
          // Sessão paga: anel branco sutil por cima da cor de status normal (não substitui,
          // só sinaliza pagamento — status continua distinguível pela cor da aba esquerda).
          boxShadow: isPaid ? 'inset 0 0 0 1px rgba(255,255,255,0.7)' : undefined
        }}
        onClick={(e) => {
          e.stopPropagation();
          setShowPopover(!showPopover);
        }}
        title={isPaid ? 'Sessão paga' : undefined}
      >
        <div className="chip-time">{timeStr}</div>
        <div className="chip-name" style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {appointment.modality === 'presencial' ? <MapPin size={10} /> : <Video size={10} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{patientName}</span>
        </div>
      </div>

      {showPopover && (
        <div
          ref={popoverRef}
          className="appointment-popover"
          style={{
            top: tPx + (isShort ? hPx : Math.min(hPx, 40)), // popover opens slightly below top or below short chip
            left: `calc(${appointment.trackIndex} * (100% / ${Math.max(1, appointment.trackCount)}) + 10px)`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="popover-header" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div>{timeStr} — {patientName}</div>
            <div 
              style={{ fontSize: '0.75rem', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'normal', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                onModalityUpdate(appointment.id, appointment.modality === 'online' ? 'presencial' : 'online');
              }}
              title="Clique para alterar a modalidade"
            >
              {appointment.modality === 'presencial' ? (
                <><MapPin size={12} /> Presencial</>
              ) : (
                <><Video size={12} /> Online</>
              )}
            </div>
          </div>

          {isPast ? (
            /* ── Sessão passada: desfecho rápido / visualização de status ── */
            <>
              <button 
                className={`popover-btn ${appointment.status === 'attended' ? 'active' : ''}`} 
                onClick={(e) => handleAction(e, () => onStatusUpdate(appointment.id, 'attended'))}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 size={14} style={{ color: 'var(--status-success)' }} />
                  <span>Realizado</span>
                </div>
                {appointment.status === 'attended' && <Check size={14} style={{ marginLeft: 'auto', color: 'var(--brand-primary, #6d5dfc)' }} />}
              </button>

              {appointment.status === 'attended' && !appointment.groupId && !isPaid && (
                <button
                  className="popover-btn"
                  onClick={(e) => handleAction(e, () => onMarkPaid(appointment.id))}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <DollarSign size={14} style={{ color: 'var(--status-success)' }} />
                    <span>Marcar sessão como paga</span>
                  </div>
                </button>
              )}

              {!isPastoral && (
                <button 
                  className={`popover-btn ${appointment.status === 'no_show' ? 'active' : ''}`} 
                  onClick={(e) => handleAction(e, () => onStatusUpdate(appointment.id, 'no_show'))}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <UserX size={14} style={{ color: 'var(--status-danger)' }} />
                    <span>Paciente faltou (cobrar)</span>
                  </div>
                  {appointment.status === 'no_show' && <Check size={14} style={{ marginLeft: 'auto', color: 'var(--brand-primary, #6d5dfc)' }} />}
                </button>
              )}

              <button 
                className={`popover-btn ${appointment.status === 'canceled' ? 'active' : ''}`} 
                onClick={(e) => handleAction(e, () => onStatusUpdate(appointment.id, 'canceled'))}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <XCircle size={14} style={{ color: 'var(--text-muted)' }} />
                  <span>Faltou / remarcou (não cobrar)</span>
                </div>
                {appointment.status === 'canceled' && <Check size={14} style={{ marginLeft: 'auto', color: 'var(--brand-primary, #6d5dfc)' }} />}
              </button>

              <button 
                className={`popover-btn danger ${appointment.status === 'canceled' ? 'active' : ''}`} 
                onClick={(e) => handleAction(e, () => onStatusUpdate(appointment.id, 'canceled'))}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Ban size={14} />
                  <span>Cancelado pelo terapeuta</span>
                </div>
                {appointment.status === 'canceled' && <Check size={14} style={{ marginLeft: 'auto', color: 'var(--brand-primary, #6d5dfc)' }} />}
              </button>
            </>
          ) : (
            /* ── Sessão futura ── */
            <>
              {(appointment.status === 'scheduled' || appointment.status === 'confirmed') && (
                <button className="popover-btn" onClick={(e) => handleAction(e, () => onStatusUpdate(appointment.id, 'confirmed'))}>
                  <Check size={14} /> Confirmar presença
                </button>
              )}
              {appointment.status !== 'attended' && appointment.status !== 'canceled' && appointment.status !== 'no_show' && (
                <button className="popover-btn danger" onClick={(e) => handleAction(e, () => onStatusUpdate(appointment.id, 'canceled'))}>
                  <X size={14} /> Cancelar
                </button>
              )}
              {!isPastoral && patientPhone && appointment.confirmToken && (
                <button className="popover-btn" onClick={(e) => handleAction(e, sendConfirmWhatsApp)}>
                  <MessageCircle size={14} style={{ color: '#25D366' }} /> Enviar confirmação por WhatsApp
                </button>
              )}
            </>
          )}

          <hr style={{ margin: '0.25rem 0', borderColor: 'var(--border-color)' }} />
          {!appointment.groupId && !isPastoral && (
            <button className="popover-btn" onClick={(e) => handleAction(e, () => onOpenProfile(appointment.patientId))}>
              <ExternalLink size={14} /> Abrir Prontuário
            </button>
          )}
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button className="popover-btn" style={{ flex: 1, justifyContent: 'center' }} onClick={(e) => handleAction(e, () => onEdit(appointment))}>
              <Edit2 size={14} /> Editar
            </button>
            <button className="popover-btn danger" style={{ flex: 1, justifyContent: 'center' }} onClick={(e) => handleAction(e, () => onDelete(appointment.id))}>
              <Trash2 size={14} /> Excluir
            </button>
          </div>
        </div>
      )}
    </>
  );
}
