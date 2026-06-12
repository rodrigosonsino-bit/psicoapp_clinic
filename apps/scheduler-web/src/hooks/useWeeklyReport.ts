import { useState, useEffect } from 'react';
import { getWeeklyReport, WeeklyReportStats } from '../services/api';

export function useWeeklyReport(isAuthenticated: boolean) {
  const [reportStats, setReportStats] = useState<WeeklyReportStats | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [reportSearchRecipient, setReportSearchRecipient] = useState('');
  const [activeReportSearch, setActiveReportSearch] = useState('');

  const fetchReport = async (recipientId?: string) => {
    setReportLoading(true);
    setApiError(null);
    try {
      const stats = await getWeeklyReport(recipientId);
      setReportStats(stats);
      setActiveReportSearch(recipientId || '');
    } catch (error: any) {
      console.log('Erro ao obter relatório semanal:', error);
      setApiError(error?.message || 'Falha ao buscar relatório');
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchReport();
    }
  }, [isAuthenticated]);

  return {
    reportStats,
    reportLoading,
    apiError,
    reportSearchRecipient,
    activeReportSearch,
    setReportSearchRecipient,
    setActiveReportSearch,
    fetchReport
  };
}
