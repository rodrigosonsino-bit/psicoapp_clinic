import { useState } from 'react';
import { Alert } from 'react-native';
import { listGoogleCalendars, selectGoogleCalendar, GoogleCalendarItem } from '../services/api';

export function useCalendarData(setCalendarStatus: React.Dispatch<React.SetStateAction<any>>) {
  const [calendarList, setCalendarList] = useState<GoogleCalendarItem[]>([]);
  const [showCalendarPickerModal, setShowCalendarPickerModal] = useState(false);
  const [calendarListLoading, setCalendarListLoading] = useState(false);

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
    } catch (error) {
      Alert.alert('Erro', 'Falha ao selecionar a agenda.');
    }
  };

  return {
    calendarList,
    setCalendarList,
    showCalendarPickerModal,
    setShowCalendarPickerModal,
    calendarListLoading,
    setCalendarListLoading,
    handleOpenCalendarPicker,
    handleSelectCalendar
  };
}
