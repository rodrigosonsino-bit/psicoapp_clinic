import { useState } from 'react';
import { Alert } from 'react-native';
import { listGoogleCalendars, selectGoogleCalendar, GoogleCalendarItem, GoogleCalendarEvent, getGoogleCalendarEvents, toggleEventAutoSend } from '../services/api';

export function useCalendarData(setCalendarStatus: React.Dispatch<React.SetStateAction<any>>) {
  const [calendarList, setCalendarList] = useState<GoogleCalendarItem[]>([]);
  const [showCalendarPickerModal, setShowCalendarPickerModal] = useState(false);
  const [calendarListLoading, setCalendarListLoading] = useState(false);

  const [calendarEvents, setCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventsPanel, setShowEventsPanel] = useState(false);

  const fetchCalendarEvents = async () => {
    setEventsLoading(true);
    try {
      const events = await getGoogleCalendarEvents();
      setCalendarEvents(events);
    } catch (error) {
      console.log('Error fetching calendar events', error);
    } finally {
      setEventsLoading(false);
    }
  };

  const handleOpenCalendarPicker = async () => {
    setCalendarListLoading(true);
    setShowCalendarPickerModal(true);
    try {
      const calendars = await listGoogleCalendars();
      setCalendarList(calendars);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível carregar as agendas da sua conta Google.');
      setShowCalendarPickerModal(false);
    } finally {
      setCalendarListLoading(false);
    }
  };

  const handleSelectCalendar = async (cal: GoogleCalendarItem) => {
    try {
      await selectGoogleCalendar(cal.id, cal.summary);
      setCalendarStatus((prev: any) => ({ ...prev, calendarId: cal.id, calendarName: cal.summary }));
      setShowCalendarPickerModal(false);
      Alert.alert('Sucesso', `Agenda "${cal.summary}" selecionada com sucesso!`);
      fetchCalendarEvents(); // Reload events for the new calendar
    } catch (error) {
      Alert.alert('Erro', 'Falha ao selecionar a agenda.');
    }
  };

  const handleToggleAutoSend = async (event: GoogleCalendarEvent) => {
    const newVal = !event.autoSend;
    try {
      await toggleEventAutoSend(event.id, newVal);
      setCalendarEvents(prev => prev.map(e => e.id === event.id ? { ...e, autoSend: newVal } : e));
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível alterar a configuração de envio automático.');
    }
  };

  const formatEventDateTime = (isoString: string) => {
    const d = new Date(isoString);
    return `${d.toLocaleDateString()} às ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return {
    calendarList,
    setCalendarList,
    showCalendarPickerModal,
    setShowCalendarPickerModal,
    calendarListLoading,
    setCalendarListLoading,
    calendarEvents,
    setCalendarEvents,
    eventsLoading,
    setEventsLoading,
    showEventsPanel,
    setShowEventsPanel,
    fetchCalendarEvents,
    handleOpenCalendarPicker,
    handleSelectCalendar,
    handleToggleAutoSend,
    formatEventDateTime
  };
}
