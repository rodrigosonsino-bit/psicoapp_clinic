import React, { useState, useEffect, useRef } from 'react';
import { format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Appointment, AppointmentStatus, Patient } from '../../types/api';
import { GRID_START_HOUR, PX_PER_MINUTE, timeSlotLabels, topPx, positionAppointments } from './calendarUtils';
import AppointmentChip from './AppointmentChip';

interface Props {
  days: Date[]; // 7 days for week view, 1 day for day view
  appointments: Appointment[];
  patients: Patient[];
  groups: { id: string; name: string }[];
  coveredAppointmentIds: Set<string>;
  onSlotClick: (date: Date) => void;
  onStatusUpdate: (id: string, status: AppointmentStatus) => void;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
}

export default function WeekGrid({ days, appointments, patients, groups, coveredAppointmentIds, onSlotClick, onStatusUpdate, onEdit, onDelete }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [nowTop, setNowTop] = useState(() => topPx(new Date().toISOString()));

  useEffect(() => {
    const interval = setInterval(() => setNowTop(topPx(new Date().toISOString())), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Scroll to current time or 8am on mount
    if (gridRef.current) {
      gridRef.current.scrollTo({ top: Math.max(0, nowTop - 100), behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  const handleColumnClick = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const totalMin = Math.round(offsetY / PX_PER_MINUTE / 30) * 30; // snap to 30 min
    const date = new Date(day);
    date.setHours(GRID_START_HOUR + Math.floor(totalMin / 60), totalMin % 60, 0, 0);
    onSlotClick(date);
  };

  const getPatientName = (appt: Appointment) => {
    if (appt.notes?.startsWith('[PASTORAL_SUMMARY]:')) {
      return appt.notes.replace('[PASTORAL_SUMMARY]:', '').split('\n')[0].trim();
    }
    // Agendamento de grupo: mostra o nome do grupo, não tenta achar um paciente individual
    // (o patientId nesse caso não corresponde a um paciente com registro próprio na lista).
    if (appt.groupId) {
      return groups.find(g => g.id === appt.groupId)?.name ?? 'Grupo';
    }
    return patients.find(p => p.id === appt.patientId)?.name ?? appt.patientId.slice(0, 8);
  };

  const getPatientPhone = (appt: Appointment) =>
    patients.find(p => p.id === appt.patientId)?.phone ?? null;

  return (
    <div className="calendar-grid-scroll" ref={gridRef}>
      <div className="calendar-header-row">
        <div className="time-axis" style={{ border: 'none' }} /> {/* Espaço vazio para alinhar */}
        {days.map((d, i) => {
          const isToday = isSameDay(d, new Date());
          return (
            <div key={i} className={`calendar-header-cell ${isToday ? 'today' : ''}`}>
              <div style={{ textTransform: 'capitalize' }}>{format(d, 'eee', { locale: ptBR })}</div>
              <div style={{ fontSize: '1.25rem' }}>{format(d, 'dd')}</div>
            </div>
          );
        })}
      </div>

      <div className="calendar-body">
        {/* Time Labels */}
        <div className="time-axis">
          {timeSlotLabels().map((label, i) => (
            <div key={i} className="time-slot-label" style={{ 
              visibility: label.endsWith(':30') ? 'hidden' : 'visible' 
            }}>
              {label}
            </div>
          ))}
        </div>

        {/* Grid Lines */}
        <div className="time-grid-lines">
          {timeSlotLabels().filter(l => l.endsWith(':00')).map((_, i) => (
            <div key={i} className="time-grid-line-hour" />
          ))}
        </div>

        {/* Day Columns */}
        {days.map((day, i) => {
          const isToday = isSameDay(day, new Date());
          const dayAppts = appointments.filter(a => isSameDay(new Date(a.scheduledAt), day));
          const positionedAppts = positionAppointments(dayAppts);

          return (
            <div key={i} className="day-column" onClick={(e) => handleColumnClick(day, e)}>
              {isToday && <div className="now-indicator" style={{ top: nowTop }} />}
              
              {positionedAppts.map(appt => (
                <AppointmentChip
                  key={appt.id}
                  appointment={appt}
                  patientName={getPatientName(appt)}
                  patientPhone={getPatientPhone(appt)}
                  isPaid={coveredAppointmentIds.has(appt.id)}
                  onStatusUpdate={onStatusUpdate}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
