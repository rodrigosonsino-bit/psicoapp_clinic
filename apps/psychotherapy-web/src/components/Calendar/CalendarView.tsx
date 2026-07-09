import type { Appointment, AppointmentStatus, Patient } from '../../types/api';
import MonthGrid from './MonthGrid';
import WeekGrid from './WeekGrid';
import { weekDays, startOfWeekBRT } from './calendarUtils';
import './Calendar.css';

interface CalendarViewProps {
  mode: 'day' | 'week' | 'month';
  currentDate: Date;
  appointments: Appointment[];
  patients: Patient[];
  groups: { id: string; name: string }[];
  coveredAppointmentIds: Set<string>;
  onSlotClick: (date: Date) => void;
  onStatusUpdate: (id: string, status: AppointmentStatus) => void;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
  onDayClick: (date: Date) => void;
  onOpenProfile: (patientId: string) => void;
  onMarkPaid: (id: string) => void;
}

export default function CalendarView(props: CalendarViewProps) {
  if (props.mode === 'month') {
    return <MonthGrid {...props} />;
  }
  
  const days = props.mode === 'week'
    ? weekDays(startOfWeekBRT(props.currentDate))
    : [props.currentDate];
    
  return <WeekGrid days={days} {...props} />;
}
