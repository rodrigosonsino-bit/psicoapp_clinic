import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { useCalendar } from '../context/CalendarContext';
import { GoogleCalendarEvent, getGoogleCalendarEvents, toggleEventAutoSend } from '../services/api';

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
        <ActivityIndicator size="small" color="#4F46E5" style={{ marginVertical: 10 }} />
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
            Sua agenda <Text style={{ fontWeight: 'bold' }}>{calendarStatus.email}</Text> está integrada. O sistema monitora seus compromissos e envia mensagens autônomas.
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
                <ActivityIndicator size="small" color="#334155" />
              ) : (
                <Text style={styles.calendarActionButtonText}>🔄 Sincronizar Agora</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.calendarActionButton, styles.calendarDisconnectButton]} onPress={disconnectCalendar}>
              <Text style={styles.calendarActionButtonText}>❌ Desconectar</Text>
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
                <ActivityIndicator size="small" color="#4F46E5" style={{ marginVertical: 12 }} />
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
                        <Text style={styles.evtToggleText}>
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
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  calendarCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  calendarCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  connectedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#DCFCE7',
  },
  connectedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
  },
  calendarCardDescription: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 16,
  },
  calendarConnectButton: {
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarConnectButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  calendarSelectorButton: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  calendarSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  calendarSelectorLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginBottom: 2,
  },
  calendarSelectorValue: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '700',
  },
  calendarSelectorArrow: {
    fontSize: 12,
    color: '#64748B',
    marginLeft: 8,
  },
  calendarActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 8,
  },
  calendarActionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFF',
  },
  calendarActionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  calendarDisconnectButton: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  evtPanelToggle: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    alignItems: 'center',
  },
  evtPanelToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4F46E5',
  },
  evtPanel: {
    marginTop: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  evtEmptyText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginVertical: 10,
  },
  evtScrollContainer: {
    maxHeight: 200,
  },
  evtItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  evtItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  evtItemTime: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  evtToggle: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  evtToggleOn: {
    backgroundColor: '#DCFCE7',
  },
  evtToggleOff: {
    backgroundColor: '#F1F5F9',
  },
  evtToggleText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
  },
});
