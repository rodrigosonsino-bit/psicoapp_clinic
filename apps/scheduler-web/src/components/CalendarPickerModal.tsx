import React from 'react';
import { View, Text, Modal, TouchableOpacity, ActivityIndicator, FlatList, StyleSheet } from 'react-native';
import { GoogleCalendarItem, GoogleCalendarStatus } from '../services/api';

interface CalendarPickerModalProps {
  visible: boolean;
  onClose: () => void;
  calendarList: GoogleCalendarItem[];
  calendarListLoading: boolean;
  calendarStatus: GoogleCalendarStatus;
  onSelectCalendar: (item: GoogleCalendarItem) => void;
}

export function CalendarPickerModal({
  visible,
  onClose,
  calendarList,
  calendarListLoading,
  calendarStatus,
  onSelectCalendar
}: CalendarPickerModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.calPickerOverlay}>
        <View style={styles.calPickerContainer}>
          <View style={styles.calPickerHeader}>
            <Text style={styles.calPickerTitle}>📅 Selecione a Agenda</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.calPickerCloseBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.calPickerSubtitle}>
            Escolha qual agenda do Google Calendar será monitorada para enviar lembretes automáticos:
          </Text>
          {calendarListLoading ? (
            <ActivityIndicator size="large" color="#2E7D32" style={{ marginVertical: 30 }} />
          ) : (
            <FlatList
              data={calendarList}
              keyExtractor={item => item.id}
              style={{ maxHeight: 350 }}
              renderItem={({ item }) => {
                const isSelected = calendarStatus.calendarId === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.calPickerItem, isSelected && styles.calPickerItemSelected]}
                    onPress={() => onSelectCalendar(item)}
                  >
                    <View style={[styles.calPickerDot, { backgroundColor: item.backgroundColor || '#4285f4' }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.calPickerItemName, isSelected && styles.calPickerItemNameSelected]}>
                        {item.summary} {item.primary ? '(Principal)' : ''}
                      </Text>
                      {item.description ? <Text style={styles.calPickerItemDesc}>{item.description}</Text> : null}
                    </View>
                    {isSelected && <Text style={styles.calPickerCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#999', marginVertical: 20 }}>Nenhuma agenda encontrada.</Text>}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  calPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  calPickerContainer: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 500,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  calPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  calPickerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E293B',
  },
  calPickerCloseBtn: {
    fontSize: 20,
    color: '#64748B',
    fontWeight: '700',
    padding: 4,
  },
  calPickerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 15,
  },
  calPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  calPickerItemSelected: {
    borderColor: '#4F46E5',
    backgroundColor: '#EEF2FF',
  },
  calPickerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  calPickerItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  calPickerItemNameSelected: {
    color: '#4F46E5',
  },
  calPickerItemDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  calPickerCheck: {
    fontSize: 16,
    fontWeight: '800',
    color: '#4F46E5',
    marginLeft: 8,
  },
});
