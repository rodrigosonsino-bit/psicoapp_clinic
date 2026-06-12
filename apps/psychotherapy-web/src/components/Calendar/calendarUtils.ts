import type { Appointment } from '../../types/api';

export const GRID_START_HOUR = 7;
export const GRID_END_HOUR = 22;
export const PX_PER_MINUTE = 1;

export function topPx(isoString: string): number {
  const d = new Date(isoString);
  const min = d.getHours() * 60 + d.getMinutes();
  return Math.max(0, (min - GRID_START_HOUR * 60) * PX_PER_MINUTE);
}

export function heightPx(durationMinutes: number): number {
  return Math.max(20, durationMinutes * PX_PER_MINUTE); // mínimo 20px para legibilidade
}

export const GRID_HEIGHT_PX = (GRID_END_HOUR - GRID_START_HOUR) * 60 * PX_PER_MINUTE;

export interface PositionedAppointment extends Appointment {
  trackIndex: number;  // qual trilha dentro do dia (0-based)
  trackCount: number;  // quantas trilhas existem no grupo de sobreposição
  _startMin?: number;
  _endMin?: number;
}

export function positionAppointments(appts: Appointment[]): PositionedAppointment[] {
  const sorted = [...appts].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );

  // trackEnds[i] = minuto em que a última sessão da trilha i termina
  const trackEnds: number[] = [];
  const positioned = sorted.map(appt => {
    const startMin = new Date(appt.scheduledAt).getHours() * 60
                   + new Date(appt.scheduledAt).getMinutes();
    const endMin   = startMin + appt.durationMinutes;

    let track = trackEnds.findIndex(end => end <= startMin);
    if (track === -1) track = trackEnds.length;
    trackEnds[track] = endMin;

    return { ...appt, trackIndex: track, trackCount: 0, _startMin: startMin, _endMin: endMin };
  });

  // Segunda passagem: definir trackCount como o máximo de trilhas ativas no grupo
  for (const appt of positioned) {
    const groupCount = positioned.filter(
      b => b._startMin! < appt._endMin! && b._endMin! > appt._startMin!
    ).length;
    appt.trackCount = Math.max(appt.trackCount, groupCount);
  }

  return positioned;
}

// Início da semana (segunda-feira) que contém a data
export function startOfWeekBRT(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // 0=seg
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
}

// Array dos 7 dias da semana
export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
}

// Label de hora para o eixo lateral: "07:00", "07:30", ...
export function timeSlotLabels(): string[] {
  const labels: string[] = [];
  for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) {
    labels.push(`${String(h).padStart(2,'0')}:00`);
    labels.push(`${String(h).padStart(2,'0')}:30`);
  }
  return labels;
}
