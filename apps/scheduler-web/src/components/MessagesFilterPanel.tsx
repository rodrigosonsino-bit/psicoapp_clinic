import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform, StyleSheet } from 'react-native';
import { colors, radius, spacing, fontSize } from '../theme/tokens';

interface MessagesFilterPanelProps {
  openNewModal: () => void;
  selectedFilter: string;
  handleFilterChange: (filter: 'all' | 'today' | 'tomorrow' | '2days' | '3days' | 'custom', customVal?: string) => void;
  setShowFilterDatePicker: (show: boolean) => void;
  customDate: string | null;
  getLocalDateString: (offset: number) => string;
}

export function MessagesFilterPanel({
  openNewModal,
  selectedFilter,
  handleFilterChange,
  setShowFilterDatePicker,
  customDate,
  getLocalDateString
}: MessagesFilterPanelProps) {
  return (
    <View style={styles.filterCard}>
      <View style={styles.filterCardHeader}>
        <Text style={styles.filterTitle}>📅 Filtrar por Data de Envio</Text>
        {Platform.OS === 'web' && (
          <TouchableOpacity style={styles.filterNewBtn} onPress={openNewModal}>
            <Text style={styles.filterNewBtnText}>+ Novo Agendamento</Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterButtonsRow}
        contentContainerStyle={{ gap: 8, paddingRight: 10 }}
      >
        <TouchableOpacity
          style={[styles.filterBtn, selectedFilter === 'all' && styles.filterBtnActive]}
          onPress={() => handleFilterChange('all')}
        >
          <Text style={[styles.filterBtnText, selectedFilter === 'all' && styles.filterBtnTextActive]}>📂 Todos</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, selectedFilter === 'today' && styles.filterBtnActive]}
          onPress={() => handleFilterChange('today')}
        >
          <Text style={[styles.filterBtnText, selectedFilter === 'today' && styles.filterBtnTextActive]}>☀️ Hoje</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, selectedFilter === 'tomorrow' && styles.filterBtnActive]}
          onPress={() => handleFilterChange('tomorrow')}
        >
          <Text style={[styles.filterBtnText, selectedFilter === 'tomorrow' && styles.filterBtnTextActive]}>🌅 Amanhã</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, selectedFilter === '2days' && styles.filterBtnActive]}
          onPress={() => handleFilterChange('2days')}
        >
          <Text style={[styles.filterBtnText, selectedFilter === '2days' && styles.filterBtnTextActive]}>🗓️ 2 Dias</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, selectedFilter === '3days' && styles.filterBtnActive]}
          onPress={() => handleFilterChange('3days')}
        >
          <Text style={[styles.filterBtnText, selectedFilter === '3days' && styles.filterBtnTextActive]}>🗓️ 3 Dias</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, selectedFilter === 'custom' && styles.filterBtnActive]}
          onPress={() => {
            if (Platform.OS === 'web') {
              handleFilterChange('custom', customDate || getLocalDateString(0));
            } else {
              setShowFilterDatePicker(true);
            }
          }}
        >
          <Text style={[styles.filterBtnText, selectedFilter === 'custom' && styles.filterBtnTextActive]}>
            {selectedFilter === 'custom' && customDate ? `📅 ${customDate.split('-').reverse().join('/')}` : '🔍 Outra Data'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {selectedFilter === 'custom' && Platform.OS === 'web' && (
        <View style={styles.customDateWebContainer}>
          <Text style={styles.customDateWebLabel}>Selecione a data:</Text>
          <input
            type="date"
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #334155',
              fontSize: '14px',
              color: '#F8FAFC',
              backgroundColor: '#334155',
              outline: 'none',
              width: '100%',
              marginTop: 8,
              boxSizing: 'border-box',
              colorScheme: 'dark',
            }}
            value={customDate || getLocalDateString(0)}
            onChange={(e) => handleFilterChange('custom', e.target.value)}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filterCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  filterCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  filterTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  filterNewBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  filterNewBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  filterButtonsRow: {
    flexDirection: 'row',
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterBtnActive: {
    backgroundColor: '#DCFCE7',
    borderColor: colors.primary,
  },
  filterBtnText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  filterBtnTextActive: {
    color: colors.primaryDark,
  },
  customDateWebContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderDefault,
  },
  customDateWebLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
});
