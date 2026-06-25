import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { useCalendar } from '../context/CalendarContext';
import { GoogleCalendarEvent, getGoogleCalendarEvents, toggleEventAutoSend } from '../services/api';
import { colors, spacing, radius, fontSize } from '../theme/tokens';

interface CalendarIntegrationCardProps {
  onOpenCalendarPicker: () => void;
  onRefreshMessages: () => void;
}

export function CalendarIntegrationCard({ onOpenCalendarPicker, onRefreshMessages }: CalendarIntegrationCardProps) {
  const {
    calendarStatus,
    calendarLoading,
    syncingCalendar,
    connectCalendar,
    disconnectCalendar,
    syncCalendar
  } = useCalendar();

  const [calendarEvents, setCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventsPanel, setShowEventsPanel] = useState(false);

  const fetchCalendarEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const events = await getGoogleCalendarEvents();
      setCalendarEvents(events);
    } catch (error) {
      console.log('Erro ao buscar eventos do calendário:', error);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const handleToggleAutoSend = useCallback(async (event: GoogleCalendarEvent) => {
    const newVal = !event.autoSend;
    // Optimistic update
    setCalendarEvents(prev => prev.map(e => e.id === event.id ? { ...e, autoSend: newVal } : e));
    try {
      await toggleEventAutoSend(event.id, newVal, event.summary, event.start);
    } catch (error) {
      // Revert on failure
      setCalendarEvents(prev => prev.map(e => e.id === event.id ? { ...e, autoSend: !newVal } : e));
      Alert.alert('Erro', 'Falha ao alterar preferência.');
    }
  }, []);

  // Fetch events when panel is expanded or calendar changes
  useEffect(() => {
    if (showEventsPanel && calendarStatus.connected) {
      fetchCalendarEvents();
    }
  }, [showEventsPanel, calendarStatus.connected, calendarStatus.calendarId, fetchCalendarEvents]);

  const formatEventDateTime = (isoString: string) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={styles.calendarCard}>
      <View style={styles.calendarCardHeader}>
        <Text style={styles.calendarCardTitle}>📅 Automação Google Calendar</Text>
        {calendarStatus.connected && (
          <View style={styles.connectedBadge}>
            <Text style={styles.connectedBadgeText}>ATIVO</Text>
          </View>
        )}
      </View>
      
      {calendarLoading ? (
        <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 10 }} />
      ) : !calendarStatus.connected ? (
        <View>
          <Text style={styles.calendarCardDescription}>
            Agende lembretes de WhatsApp automatizados 24h antes para seus clientes e 30 min antes para você, direto da sua agenda!
          </Text>
          <TouchableOpacity style={styles.calendarConnectButton} onPress={() => connectCalendar(onRefreshMessages)}>
            <Text style={styles.calendarConnectButtonText}>🔌 Conectar Agenda Google</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <Text style={styles.calendarCardDescription}>
            Sua agenda <Text style={{ fontWeight: 'bold', color: colors.textPrimary }}>{calendarStatus.email}</Text> está integrada. O sistema monitora seus compromissos e envia mensagens autônomas.
          </Text>
          
          {/* Calendar Selector */}
          <TouchableOpacity style={styles.calendarSelectorButton} onPress={onOpenCalendarPicker}>
            <View style={styles.calendarSelectorRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.calendarSelectorLabel}>Agenda Selecionada:</Text>
                <Text style={styles.calendarSelectorValue}>📅 {calendarStatus.calendarName || 'Principal'}</Text>
              </View>
              <Text style={styles.calendarSelectorArrow}>▼</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.calendarActionsRow}>
            <TouchableOpacity 
              style={[styles.calendarActionButton, syncingCalendar && { opacity: 0.7 }]} 
              onPress={() => syncCalendar(onRefreshMessages)}
              disabled={syncingCalendar}
            >
              {syncingCalendar ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <Text style={styles.calendarActionButtonText}>🔄 Sincronizar Agora</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.calendarActionButton, styles.calendarDisconnectButton]} onPress={disconnectCalendar}>
              <Text style={styles.calendarActionDisconnectText}>❌ Desconectar</Text>
            </TouchableOpacity>
          </View>

          {/* Events Panel Toggle */}
          <TouchableOpacity 
            style={styles.evtPanelToggle}
            onPress={() => {
              setShowEventsPanel(p => !p);
            }}
          >
            <Text style={styles.evtPanelToggleText}>
              {showEventsPanel ? '▲' : '▼'} Compromissos Próximos ({calendarEvents.length})
            </Text>
          </TouchableOpacity>

          {showEventsPanel && (
            <View style={styles.evtPanel}>
              {eventsLoading ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 12 }} />
              ) : calendarEvents.length === 0 ? (
                <Text style={styles.evtEmptyText}>Nenhum compromisso nos próximos 7 dias.</Text>
              ) : (
                <ScrollView style={styles.evtScrollContainer} nestedScrollEnabled={true}>
                  {calendarEvents.map(evt => (
                    <View key={evt.id} style={styles.evtItem}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.evtItemTitle}>{evt.summary}</Text>
                        <Text style={styles.evtItemTime}>📅 {formatEventDateTime(evt.start)}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.evtToggle, evt.autoSend ? styles.evtToggleOn : styles.evtToggleOff]}
                        onPress={() => handleToggleAutoSend(evt)}
                      >
                        <Text style={evt.autoSend ? styles.evtToggleTextOn : styles.evtToggleTextOff}>
                          {evt.autoSend ? '✉️ ON' : '🔇 OFF'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  calendarCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  calendarCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  calendarCardTitle: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  connectedBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.borderPrimary,
  },
  connectedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  calendarCardDescription: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  calendarConnectButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarConnectButtonText: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: fontSize.md,
  },
  calendarSelectorButton: {
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  calendarSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  calendarSelectorLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: 2,
  },
  calendarSelectorValue: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  calendarSelectorArrow: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  calendarActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  calendarActionButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  calendarActionButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  calendarDisconnectButton: {
    backgroundColor: colors.dangerMuted,
    borderColor: colors.dangerBorder,
  },
  calendarActionDisconnectText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.danger,
  },
  evtPanelToggle: {
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderMuted,
    alignItems: 'center',
  },
  evtPanelToggleText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  evtPanel: {
    marginTop: spacing.sm,
    backgroundColor: colors.bgRaised,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  evtEmptyText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  evtScrollContainer: {
    maxHeight: 250,
  },
  evtItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderMuted,
  },
  evtItemTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  evtItemTime: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  evtToggle: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  evtToggleOn: {
    backgroundColor: colors.primaryMuted,
    borderColor: colors.borderPrimary,
  },
  evtToggleOff: {
    backgroundColor: colors.bgBase,
    borderColor: colors.borderMuted,
  },
  evtToggleTextOn: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
  },
  evtToggleTextOff: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textMuted,
  },
});

