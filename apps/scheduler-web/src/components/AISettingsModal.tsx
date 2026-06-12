import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { OfficeHours } from '../services/api';

interface AISettingsModalProps {
  visible: boolean;
  onClose: () => void;
  aiSettings: {
    enabled: boolean;
    instructions: string;
    officeHours: OfficeHours;
    receiveWeeklyReport: boolean;
    weeklyReportDay: string;
    weeklyReportTime: string;
    loading: boolean;
    saveSettings: (
      enabled: boolean,
      instructions: string,
      officeHours: OfficeHours,
      receiveWeeklyReport: boolean,
      weeklyReportDay: string,
      weeklyReportTime: string
    ) => Promise<boolean>;
  };
}

export function AISettingsModal({ visible, onClose, aiSettings }: AISettingsModalProps) {
  const [localEnabled, setLocalEnabled] = useState(aiSettings.enabled);
  const [localInstructions, setLocalInstructions] = useState(aiSettings.instructions);
  const [localOfficeHours, setLocalOfficeHours] = useState<OfficeHours>(aiSettings.officeHours);
  const [localReceiveWeeklyReport, setLocalReceiveWeeklyReport] = useState(aiSettings.receiveWeeklyReport);
  const [localWeeklyReportDay, setLocalWeeklyReportDay] = useState(aiSettings.weeklyReportDay);
  const [localWeeklyReportTime, setLocalWeeklyReportTime] = useState(aiSettings.weeklyReportTime);
  const [saving, setSaving] = useState(false);

  // Sync draft state with hook state when modal opens
  useEffect(() => {
    if (visible) {
      setLocalEnabled(aiSettings.enabled);
      setLocalInstructions(aiSettings.instructions);
      setLocalOfficeHours(JSON.parse(JSON.stringify(aiSettings.officeHours))); // deep copy
      setLocalReceiveWeeklyReport(aiSettings.receiveWeeklyReport);
      setLocalWeeklyReportDay(aiSettings.weeklyReportDay);
      setLocalWeeklyReportTime(aiSettings.weeklyReportTime);
    }
  }, [visible, aiSettings]);

  const handleToggleHourSlot = (day: string, hour: string) => {
    const slots = localOfficeHours[day] || [];
    let newSlots: string[];
    if (slots.includes(hour)) {
      newSlots = slots.filter(h => h !== hour);
    } else {
      newSlots = [...slots, hour].sort();
    }
    setLocalOfficeHours({
      ...localOfficeHours,
      [day]: newSlots
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const success = await aiSettings.saveSettings(
        localEnabled,
        localInstructions,
        localOfficeHours,
        localReceiveWeeklyReport,
        localWeeklyReportDay,
        localWeeklyReportTime
      );
      if (success) {
        Alert.alert('Sucesso', 'Configurações da Secretária de IA salvas com sucesso!');
        onClose();
      }
    } catch (e) {
      Alert.alert('Erro', 'Falha ao salvar configurações.');
    } finally {
      setSaving(false);
    }
  };

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
            <Text style={styles.calPickerTitle}>⚙️ Configuração da Secretária Sarah</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.calPickerCloseBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={{ maxHeight: 500, width: '100%' }} showsVerticalScrollIndicator={false} nestedScrollEnabled={true}>
            <Text style={styles.sectionSubtitle}>✍️ Regras & Personalidade</Text>
            <Text style={styles.gridInstruction}>
              Escreva as regras que a Sarah deve seguir ao responder autonomamente aos clientes pelo WhatsApp:
            </Text>
            <TextInput
              style={styles.aiInstructionsInput}
              multiline
              numberOfLines={6}
              value={localInstructions}
              onChangeText={setLocalInstructions}
              placeholder="Ex: Você é a Secretária Virtual do Rodrigo Sonsino. Seja sempre prestativa, use emojis simpáticos..."
            />

            <Text style={[styles.sectionSubtitle, { marginTop: 20 }]}>🕒 Horários de Atendimento Disponíveis</Text>
            <Text style={styles.gridInstruction}>
              Selecione os dias e horários em que a Sarah poderá agendar sessões (toque para ativar/desativar):
            </Text>

            {Object.keys(localOfficeHours).map(day => {
              const dayLabelMap: Record<string, string> = {
                segunda: 'Segunda',
                terca: 'Terça',
                quarta: 'Quarta',
                quinta: 'Quinta',
                sexta: 'Sexta',
                sabado: 'Sábado',
                domingo: 'Domingo'
              };
              
              const timeSlots = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
              const activeHours = localOfficeHours[day] || [];

              return (
                <View key={day} style={styles.gridDayRow}>
                  <View style={styles.gridDayHeader}>
                    <Text style={styles.gridDayLabel}>{dayLabelMap[day] || day}</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gridHoursScroll} nestedScrollEnabled={true}>
                    {timeSlots.map(hour => {
                      const isSelected = activeHours.includes(hour);
                      return (
                        <TouchableOpacity
                          key={hour}
                          style={[styles.gridHourBtn, isSelected && styles.gridHourBtnActive]}
                          onPress={() => handleToggleHourSlot(day, hour)}
                        >
                          <Text style={[styles.gridHourText, isSelected && styles.gridHourTextActive]}>
                            {hour}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              );
            })}
          </ScrollView>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 }}>
            <TouchableOpacity 
              style={[styles.button, styles.cancelButton, { flex: 1, marginRight: 10 }]} 
              onPress={onClose}
            >
              <Text style={styles.buttonText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.button, { flex: 1, backgroundColor: '#4F46E5', justifyContent: 'center', alignItems: 'center', borderRadius: 10 }]} 
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.buttonText, { color: '#fff' }]}>Salvar Tudo</Text>
              )}
            </TouchableOpacity>
          </View>
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
    maxWidth: 550,
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
  sectionSubtitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 6,
  },
  gridInstruction: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 12,
  },
  aiInstructionsInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  gridDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 8,
  },
  gridDayHeader: {
    width: 70,
  },
  gridDayLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  gridHoursScroll: {
    flex: 1,
  },
  gridHourBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    marginRight: 6,
  },
  gridHourBtnActive: {
    backgroundColor: '#E0E7FF',
  },
  gridHourText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  gridHourTextActive: {
    color: '#4F46E5',
  },
  button: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F1F5F9',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
});
