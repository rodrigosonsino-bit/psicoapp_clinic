import { format, isSameDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import type { Appointment, Patient } from '../../types/api';

interface Props {
  currentDate: Date;
  appointments: Appointment[];
  patients: Patient[];
  groups: { id: string; name: string }[];
  coveredAppointmentIds: Set<string>;
  onDayClick: (date: Date) => void;
}

const STATUS_COLOR: Record<string, string> = {
  scheduled: 'var(--text-muted)',
  confirmed: 'var(--status-info)',
  attended: 'var(--status-success)',
  canceled: 'var(--status-danger)',
  no_show: 'var(--status-warning)',
};

export default function MonthGrid({ currentDate, appointments, patients, groups, coveredAppointmentIds, onDayClick }: Props) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  
  // Get all days to display (including overflow from prev/next months to complete the grid)
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday start
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
  
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDaysHeaders = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  const getPatientFirstName = (a: Appointment) => {
    if (a.notes?.startsWith('[PASTORAL_SUMMARY]:')) {
      const summary = a.notes.replace('[PASTORAL_SUMMARY]:', '').split('\n')[0].trim();
      return summary.split(' ')[0];
    }
    if (a.groupId) {
      return groups.find(g => g.id === a.groupId)?.name ?? 'Grupo';
    }
    const name = patients.find(p => p.id === a.patientId)?.name ?? 'Paciente';
    return name.split(' ')[0];
  };

  return (
    <div>
      <div className="calendar-month-headers">
        {weekDaysHeaders.map(day => (
          <div key={day}>{day}</div>
        ))}
      </div>
      
      <div className="month-grid">
        {days.map((day, i) => {
          const dayAppts = appointments
            .filter(a => isSameDay(new Date(a.scheduledAt), day))
            .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
            
          const isToday = isSameDay(day, new Date());
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();

          return (
            <div 
              key={i} 
              className={`month-cell ${isToday ? 'today' : ''}`}
              onClick={() => onDayClick(day)}
              style={{ opacity: isCurrentMonth ? 1 : 0.4 }}
            >
              <span className="month-cell-day">{day.getDate()}</span>
              
              {dayAppts.slice(0, 3).map(a => (
                <div 
                  key={a.id} 
                  className="month-chip"
                  style={{
                    borderLeftColor: STATUS_COLOR[a.status],
                    opacity: (a.status === 'canceled' || a.status === 'no_show') ? 0.6 : 1,
                    boxShadow: coveredAppointmentIds.has(a.id) ? 'inset 0 0 0 1px rgba(255,255,255,0.7)' : undefined
                  }}
                  title={coveredAppointmentIds.has(a.id) ? 'Sessão paga' : undefined}
                >
                  <span style={{ fontWeight: 600 }}>{format(new Date(a.scheduledAt), 'HH:mm')}</span> {getPatientFirstName(a)}
                </div>
              ))}
              
              {dayAppts.length > 3 && (
                <div className="month-chip-more">+{dayAppts.length - 3} mais</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
