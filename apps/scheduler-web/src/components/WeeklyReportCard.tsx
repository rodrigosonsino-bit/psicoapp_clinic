import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useWeeklyReport } from '../hooks/useWeeklyReport';

interface WeeklyReportCardProps {
  isAuthenticated: boolean;
  getWeeklyReportCsvUrl: (recipientId?: string) => string;
}

export function WeeklyReportCard({ isAuthenticated, getWeeklyReportCsvUrl }: WeeklyReportCardProps) {
  const {
    reportStats,
    reportLoading,
    apiError,
    reportSearchRecipient,
    activeReportSearch,
    setReportSearchRecipient,
    fetchReport
  } = useWeeklyReport(isAuthenticated);

  const handleApplyReportFilter = () => {
    fetchReport(reportSearchRecipient.trim() || undefined);
  };

  const handleClearReportFilter = () => {
    setReportSearchRecipient('');
    fetchReport();
  };

  const handleExportCsv = () => {
    if (Platform.OS === 'web') {
      window.open(getWeeklyReportCsvUrl(activeReportSearch || undefined), '_blank');
    }
  };

  // Optimization: Pre-calculate maxCount once outside map
  const dailyStats = reportStats?.dailyStats || [];
  const maxCount = Math.max(...dailyStats.map((d: any) => d.count), 1);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>📊 Relatório Semanal & Métricas</Text>
        <TouchableOpacity onPress={() => fetchReport(activeReportSearch || undefined)} disabled={reportLoading}>
          {reportLoading ? (
            <ActivityIndicator size="small" color="#4F46E5" />
          ) : (
            <Text style={styles.reloadText}>🔄 Recarregar</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Barra de Pesquisa de Contato */}
      <View style={styles.reportSearchContainer}>
        <TextInput
          style={styles.reportSearchInput}
          value={reportSearchRecipient}
          onChangeText={setReportSearchRecipient}
          placeholder="Buscar contato nos últimos 7 dias (ex: 99807)..."
          placeholderTextColor="#94A3B8"
          onSubmitEditing={handleApplyReportFilter}
        />
        <TouchableOpacity style={styles.reportSearchBtn} onPress={handleApplyReportFilter}>
          <Text style={styles.reportSearchBtnText}>🔍 Filtrar</Text>
        </TouchableOpacity>
        {activeReportSearch ? (
          <TouchableOpacity style={styles.reportSearchClearBtn} onPress={handleClearReportFilter}>
            <Text style={styles.reportSearchClearBtnText}>❌ Limpar</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {activeReportSearch ? (
        <View style={styles.filterBanner}>
          <Text style={styles.filterBannerText}>
            ℹ️ Mostrando estatísticas exclusivas para o contato: <Text style={{ fontWeight: '700' }}>{activeReportSearch}</Text>
          </Text>
        </View>
      ) : null}

      {apiError ? (
        <Text style={styles.errorText}>Erro ao carregar métricas: {apiError}</Text>
      ) : reportStats ? (
        <View>
          {/* KPI Grid */}
          <View style={styles.kpiGrid}>
            <View style={[styles.kpiCard, styles.kpiIndigo]}>
              <Text style={styles.kpiTitle}>Total Processado</Text>
              <Text style={styles.kpiValue}>{reportStats.total} msg</Text>
            </View>

            <View style={[styles.kpiCard, styles.kpiGreen]}>
              <Text style={styles.kpiTitle}>Enviadas com Sucesso</Text>
              <Text style={styles.kpiValue}>{reportStats.sent} ✅</Text>
            </View>

            <View style={[styles.kpiCard, styles.kpiAmber]}>
              <Text style={styles.kpiTitle}>Taxa de Entrega</Text>
              <Text style={styles.kpiValue}>{reportStats.successRate?.toFixed(1)}% 🚀</Text>
            </View>

            <View style={[styles.kpiCard, styles.kpiRed]}>
              <Text style={styles.kpiTitle}>Pendentes / Falhas</Text>
              <Text style={styles.kpiValue}>{reportStats.pending + reportStats.failed} ⏳</Text>
            </View>
          </View>

          {/* Mini Gráfico de Barras Verticais */}
          <View style={styles.chartContainer}>
            <Text style={styles.chartTitle}>📅 Distribuição Diária de Envios</Text>
            <View style={styles.barChartRow}>
              {dailyStats.map((item: any, index: number) => {
                const pct = (item.count / maxCount) * 100;
                return (
                  <View key={index} style={styles.barColumn}>
                    <View style={styles.barWrapper}>
                      <View style={[styles.barFill, { height: `${pct}%` }]} />
                      {item.count > 0 && (
                        <View style={styles.barTooltip}>
                          <Text style={styles.barTooltipText}>{item.count}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.barLabel}>{item.day}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Botão de Exportação de Relatório (Apenas Web) */}
          {Platform.OS === 'web' && (
            <TouchableOpacity style={styles.exportBtn} onPress={handleExportCsv}>
              <Text style={styles.exportBtnText}>📥 Exportar Planilha de Auditoria (CSV)</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  reloadText: {
    fontSize: 14,
    color: '#4F46E5',
    fontWeight: '600',
  },
  reportSearchContainer: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  reportSearchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  reportSearchBtn: {
    backgroundColor: '#EEF2FF',
    borderColor: '#4F46E5',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    marginLeft: 6,
  },
  reportSearchBtnText: {
    fontSize: 12,
    color: '#4F46E5',
    fontWeight: '700',
  },
  reportSearchClearBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#F87171',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    justifyContent: 'center',
    marginLeft: 6,
  },
  reportSearchClearBtnText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '700',
  },
  filterBanner: {
    marginBottom: 12,
    padding: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  filterBannerText: {
    fontSize: 13,
    color: '#1E40AF',
    fontWeight: '500',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginVertical: 10,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  kpiCard: {
    width: '48%',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  kpiIndigo: {
    backgroundColor: '#4F46E5',
  },
  kpiGreen: {
    backgroundColor: '#059669',
  },
  kpiAmber: {
    backgroundColor: '#D97706',
  },
  kpiRed: {
    backgroundColor: '#EF4444',
  },
  kpiTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.8)',
    textTransform: 'uppercase',
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFF',
    marginTop: 4,
  },
  chartContainer: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 16,
  },
  chartTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 12,
  },
  barChartRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 100,
    paddingHorizontal: 8,
  },
  barColumn: {
    alignItems: 'center',
    flex: 1,
  },
  barWrapper: {
    height: 70,
    width: 14,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'visible',
    position: 'relative',
  },
  barFill: {
    backgroundColor: '#818CF8',
    borderRadius: 4,
    width: '100%',
  },
  barTooltip: {
    position: 'absolute',
    top: -20,
    backgroundColor: '#1E293B',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    alignItems: 'center',
    minWidth: 18,
  },
  barTooltipText: {
    fontSize: 8,
    color: '#FFF',
    fontWeight: '700',
  },
  barLabel: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 6,
    fontWeight: '600',
  },
  exportBtn: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  exportBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
});
