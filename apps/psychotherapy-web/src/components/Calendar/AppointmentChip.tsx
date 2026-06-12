import React, { useState, useRef, useEffect } from 'react';
import { Check, Edit2, Trash2, X, CheckCircle2, UserX, XCircle, Ban } from 'lucide-react';
import type { Appointment, AppointmentStatus } from '../../types/api';
import type { PositionedAppointment } from './calendarUtils';
import { topPx, heightPx } from './calendarUtils';

interface Props {
  appointment: PositionedAppointment;
  patientName: string;
  onStatusUpdate: (id: string, status: AppointmentStatus) => void;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
}

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  scheduled: 'var(--status-info)',
  confirmed: '#10b981',
  attended: '#059669',
  canceled: 'var(--status-danger)',
  no_show: 'var(--status-warning)',
};

export default function AppointmentChip({ appointment, patientName, onStatusUpdate, onEdit, onDelete }: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

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

  return (
    <>
      <div
        className={`appointment-chip ${isShort ? 'is-short' : ''}`}
        style={{
          top: tPx,
          height: hPx,
          left: `calc(${appointment.trackIndex} * (100% / ${Math.max(1, appointment.trackCount)}))`,
          width: `calc(100% / ${Math.max(1, appointment.trackCount)} - 3px)`,
          borderLeftColor: STATUS_COLOR[appointment.status],
          opacity: (appointment.status === 'canceled' || appointment.status === 'no_show') ? 0.6 : 1
        }}
        onClick={(e) => {
          e.stopPropagation();
          setShowPopover(!showPopover);
        }}
      >
        <div className="chip-time">{timeStr}</div>
        <div className="chip-name">{patientName}</div>
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
          <div className="popover-header">
            {timeStr} — {patientName}
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

              <button 
                className={`popover-btn ${appointment.status === 'no_show' ? 'active' : ''}`} 
                onClick={(e) => handleAction(e, () => onStatusUpdate(appointment.id, 'no_show'))}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <UserX size={14} style={{ color: '#f59e0b' }} />
                  <span>Paciente faltou (cobrar)</span>
                </div>
                {appointment.status === 'no_show' && <Check size={14} style={{ marginLeft: 'auto', color: 'var(--brand-primary, #6d5dfc)' }} />}
              </button>

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
            </>
          )}

          <hr style={{ margin: '0.25rem 0', borderColor: 'var(--border-color)' }} />
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
