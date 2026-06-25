import React from 'react';
import { View, Text, Modal, TouchableOpacity, ActivityIndicator, FlatList, StyleSheet } from 'react-native';
import { GoogleCalendarItem, GoogleCalendarStatus } from '../services/api';
import { colors, spacing, radius, fontSize } from '../theme/tokens';

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
            <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: 30 }} />
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
                    <View style={[styles.calPickerDot, { backgroundColor: item.backgroundColor || colors.primary }]} />
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
              ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.textMuted, marginVertical: 20 }}>Nenhuma agenda encontrada.</Text>}
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
    backgroundColor: colors.bgOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  calPickerContainer: {
    backgroundColor: colors.bgBase,
    borderRadius: radius.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 500,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  calPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  calPickerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  calPickerCloseBtn: {
    fontSize: fontSize.xl,
    color: colors.textSecondary,
    fontWeight: '700',
    padding: spacing.xs,
  },
  calPickerSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  calPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgSurface,
    marginBottom: spacing.sm,
  },
  calPickerItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  calPickerDot: {
    width: 12,
    height: 12,
    borderRadius: radius.full,
    marginRight: spacing.sm,
  },
  calPickerItemName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  calPickerItemNameSelected: {
    color: colors.primary,
    fontWeight: '800',
  },
  calPickerItemDesc: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  calPickerCheck: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.primary,
    marginLeft: spacing.sm,
  },
});
