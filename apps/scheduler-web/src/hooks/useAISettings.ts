import { useState, useEffect } from 'react';
import { getAISettings, saveAISettings, OfficeHours } from '../services/api';

export function useAISettings(isAuthenticated: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [officeHours, setOfficeHours] = useState<OfficeHours>({
    segunda: ['09:00', '10:00', '11:00', '13:00', '14:00'],
    terca: ['10:00', '11:00', '14:00', '15:00'],
    quarta: ['10:00', '11:00', '14:00', '15:00'],
    quinta: ['08:00', '09:00', '13:00', '14:00'],
    sexta: [],
    sabado: [],
    domingo: []
  });
  const [receiveWeeklyReport, setReceiveWeeklyReport] = useState(false);
  const [weeklyReportDay, setWeeklyReportDay] = useState('1');
  const [weeklyReportTime, setWeeklyReportTime] = useState('08:00');
  const [loading, setLoading] = useState(false);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const settings = await getAISettings();
      setEnabled(settings.enabled);
      setInstructions(settings.instructions || '');
      if (settings.officeHours) setOfficeHours(settings.officeHours);
      if (settings.receiveWeeklyReport !== undefined) setReceiveWeeklyReport(settings.receiveWeeklyReport);
      if (settings.weeklyReportDay !== undefined) setWeeklyReportDay(settings.weeklyReportDay);
      if (settings.weeklyReportTime !== undefined) setWeeklyReportTime(settings.weeklyReportTime);
    } catch (error) {
      console.log('Erro ao buscar configurações de IA:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (
    newEnabled: boolean,
    newInstructions: string,
    newOfficeHours: OfficeHours,
    newReceiveWeeklyReport: boolean,
    newWeeklyReportDay: string,
    newWeeklyReportTime: string
  ) => {
    setLoading(true);
    try {
      await saveAISettings(newEnabled, newInstructions, newOfficeHours, newReceiveWeeklyReport, newWeeklyReportDay, newWeeklyReportTime);
      setEnabled(newEnabled);
      setInstructions(newInstructions);
      setOfficeHours(newOfficeHours);
      setReceiveWeeklyReport(newReceiveWeeklyReport);
      setWeeklyReportDay(newWeeklyReportDay);
      setWeeklyReportTime(newWeeklyReportTime);
      return true;
    } catch (e) {
      console.log('Erro ao salvar configurações de IA:', e);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const toggleEnabled = async () => {
    const newVal = !enabled;
    setEnabled(newVal);
    try {
      await saveAISettings(newVal, instructions, officeHours, receiveWeeklyReport, weeklyReportDay, weeklyReportTime);
    } catch (e) {
      setEnabled(enabled);
      console.log('Erro ao salvar toggle de IA:', e);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchSettings();
    }
  }, [isAuthenticated]);

  return {
    enabled,
    instructions,
    officeHours,
    receiveWeeklyReport,
    weeklyReportDay,
    weeklyReportTime,
    loading,
    setEnabled,
    setInstructions,
    setOfficeHours,
    setReceiveWeeklyReport,
    setWeeklyReportDay,
    setWeeklyReportTime,
    setLoading,
    fetchSettings,
    saveSettings,
    toggleEnabled
  };
}
