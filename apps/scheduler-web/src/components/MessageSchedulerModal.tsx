import React, { useState, useEffect } from 'react';
import { View, Text, Modal, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet, Image, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MessagePlatform, RecurrenceType, ScheduledMessage, WhatsappConnectionStatus, scheduleMessage, updateMessage, askAISecretary } from '../services/api';

interface MessageSchedulerModalProps {
  visible: boolean;
  onClose: () => void;
  editingMessage: ScheduledMessage | null;
  isResending: boolean;
  whatsappStatus: WhatsappConnectionStatus;
  onSaveSuccess: () => void;
  recipientSelection: string;
  onOpenGroups: () => void;
  onOpenContacts: () => void;
  clearRecipientSelection: () => void;
  prefillData?: {
    recipientId?: string;
    content?: string;
    sendAt?: string;
    platform?: MessagePlatform;
  } | null;
  onClearPrefill: () => void;
}

export function MessageSchedulerModal({
  visible,
  onClose,
  editingMessage,
  isResending,
  whatsappStatus,
  onSaveSuccess,
  recipientSelection,
  onOpenGroups,
  onOpenContacts,
  clearRecipientSelection,
  prefillData,
  onClearPrefill
}: MessageSchedulerModalProps) {
  const [content, setContent] = useState('');
  const [recipient, setRecipient] = useState('');
  const [platform, setPlatform] = useState<MessagePlatform>('whatsapp');
  const [date, setDate] = useState(new Date());
  const [recurrence, setRecurrence] = useState<RecurrenceType>('Única');
  const [imageBase64, setImageBase64] = useState<string | undefined>(undefined);
  const [imagePreview, setImagePreview] = useState<string | undefined>(undefined);
  
  // DateTimePicker state
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // AI Assistant states
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [showAiInput, setShowAiInput] = useState(false);

  // Sync state when editingMessage or isResending changes
  useEffect(() => {
    if (visible) {
      if (editingMessage) {
        setContent(editingMessage.content);
        setRecipient(editingMessage.recipientId);
        setPlatform(editingMessage.platform || 'whatsapp');
        setRecurrence(editingMessage.metadata?.recurrence || 'Única');
        setImageBase64(undefined);
        setImagePreview(undefined);
        if (isResending) {
          const futureDate = new Date();
          futureDate.setMinutes(futureDate.getMinutes() + 5);
          setDate(futureDate);
        } else {
          setDate(new Date(editingMessage.sendAt));
        }
      } else if (isResending) {
        // Keeps recipient/platform but sets date to future 5 mins
        const futureDate = new Date();
        futureDate.setMinutes(futureDate.getMinutes() + 5);
        setDate(futureDate);
      } else {
        // New Message
        setContent('');
        setRecipient('');
        setPlatform('whatsapp');
        setRecurrence('Única');
        setImageBase64(undefined);
        setImagePreview(undefined);
        setDate(new Date());
      }
      setAiPrompt('');
      setAiExplanation(null);
      setShowAiInput(false);
    }
  }, [visible, editingMessage, isResending]);

  // Sync recipient selection from parent contacts/groups modals
  useEffect(() => {
    if (visible && recipientSelection) {
      setRecipient(recipientSelection);
      clearRecipientSelection();
    }
  }, [visible, recipientSelection, clearRecipientSelection]);

  // Sync prefill data when visible and prefillData is provided
  useEffect(() => {
    if (visible && prefillData) {
      if (prefillData.content) setContent(prefillData.content);
      if (prefillData.recipientId) setRecipient(prefillData.recipientId);
      if (prefillData.platform) setPlatform(prefillData.platform);
      if (prefillData.sendAt) setDate(new Date(prefillData.sendAt));
      onClearPrefill();
    }
  }, [visible, prefillData, onClearPrefill]);

  const handlePickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permissão Negada', 'Precisamos de acesso à sua galeria para escolher uma imagem.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets && result.assets[0]) {
      setImageBase64(`data:${result.assets[0].mimeType || 'image/jpeg'};base64,${result.assets[0].base64}`);
      setImagePreview(result.assets[0].uri);
    }
  };

  const handleAskAISecretary = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiExplanation(null);
    try {
      const res = await askAISecretary(aiPrompt, content);
      if (res.data?.content) {
        setContent(res.data.content);
      }
      if (res.data?.sendAt) {
        setDate(new Date(res.data.sendAt));
      }
      if (res.data?.platform) {
        setPlatform(res.data.platform);
      }
      if (res.data?.recipientId) {
        setRecipient(res.data.recipientId);
      }
      setAiExplanation(res.explanation);
      setAiPrompt('');
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível contatar a secretária de IA.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async () => {
    if (!content.trim() || !recipient.trim()) {
      Alert.alert('Atenção', 'Preencha todos os campos corretamente.');
      return;
    }

    if (!editingMessage && date <= new Date()) {
      Alert.alert('Atenção', 'A data/hora de envio deve ser no futuro. Ajuste a data antes de agendar.');
      return;
    }

    if (platform === 'whatsapp' && !whatsappStatus.connected) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const proceed = window.confirm(
          '⚠️ Atenção: Seu WhatsApp está desconectado no momento.\n\n' +
          'A mensagem será agendada, mas só será enviada automaticamente quando a conexão for restabelecida.\n\n' +
          'Deseja continuar mesmo assim?'
        );
        if (!proceed) return;
      } else {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            '⚠️ WhatsApp Desconectado',
            'Seu WhatsApp está desconectado. A mensagem será agendada, mas o envio só ocorrerá quando a conexão for restabelecida.\n\nDeseja continuar?',
            [
              { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Continuar', style: 'default', onPress: () => resolve(true) },
            ]
          );
        });
        if (!proceed) return;
      }
    }

    const utcDateStr = date.toISOString();
    setSubmitting(true);
    try {
      if (editingMessage && !isResending) {
        await updateMessage(editingMessage.id, {
          content,
          recipientId: recipient,
          sendAt: utcDateStr,
          platform,
          recurrence,
          imageBase64,
        });
        Alert.alert('Sucesso', 'Mensagem atualizada com sucesso!');
      } else {
        await scheduleMessage(content, recipient, utcDateStr, platform, recurrence, imageBase64);
        Alert.alert('Sucesso', 'Mensagem agendada com sucesso!');
      }
      onSaveSuccess();
      onClose();
    } catch (error: any) {
      Alert.alert('Erro', error?.response?.data?.error || 'Erro ao processar a operação');
    } finally {
      setSubmitting(false);
    }
  };

  const showDatepicker = () => setShowDatePicker(true);
  const showTimepicker = () => setShowTimePicker(true);

  const onDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const currentDate = selectedDate;
      const combined = new Date(date);
      combined.setFullYear(currentDate.getFullYear());
      combined.setMonth(currentDate.getMonth());
      combined.setDate(currentDate.getDate());
      setDate(combined);
    }
  };

  const onTimeChange = (event: any, selectedTime?: Date) => {
    setShowTimePicker(false);
    if (selectedTime) {
      const currentTime = selectedTime;
      const combined = new Date(date);
      combined.setHours(currentTime.getHours());
      combined.setMinutes(currentTime.getMinutes());
      setDate(combined);
    }
  };

  const dateString = date.toLocaleDateString();
  const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <ScrollView
          style={{ width: '100%', maxWidth: 550 }}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.modalView}>
            <Text style={styles.modalTitle}>
              {isResending ? '🔁 Reenviar Mensagem' : editingMessage ? 'Editar Agendamento' : 'Novo Agendamento'}
            </Text>

            {/* IA Secretary Assistant Section */}
            <View style={styles.aiAssistantCard}>
              <TouchableOpacity 
                style={styles.aiAssistantHeader} 
                onPress={() => setShowAiInput(!showAiInput)}
              >
                <Text style={styles.aiAssistantHeaderTitle}>🪄 Secretária IA Co-piloto</Text>
                <Text style={styles.aiAssistantHeaderToggle}>{showAiInput ? 'Esconder' : 'Abrir'}</Text>
              </TouchableOpacity>

              {showAiInput && (
                <View style={styles.aiAssistantContent}>
                  <Text style={styles.aiAssistantInstructions}>
                    Instrua a Sarah a redigir ou reprogramar sua mensagem (ex: "agende uma mensagem de cobrança educada para segunda às 10h"):
                  </Text>
                  <View style={styles.aiInputRow}>
                    <TextInput
                      style={styles.aiTextInput}
                      placeholder="Pedir para Sarah..."
                      placeholderTextColor="#94A3B8"
                      value={aiPrompt}
                      onChangeText={setAiPrompt}
                      onSubmitEditing={handleAskAISecretary}
                    />
                    <TouchableOpacity 
                      style={styles.aiSubmitBtn} 
                      onPress={handleAskAISecretary}
                      disabled={aiLoading}
                    >
                      {aiLoading ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.aiSubmitBtnText}>Enviar</Text>}
                    </TouchableOpacity>
                  </View>
                  {aiExplanation && (
                    <View style={styles.aiExplanationBox}>
                      <Text style={styles.aiExplanationTitle}>💡 Sarah diz:</Text>
                      <Text style={styles.aiExplanationText}>{aiExplanation}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>

            <Text style={styles.label}>Destinatário</Text>
            {platform === 'whatsapp' && (
              <View style={styles.selectButtonsRow}>
                <TouchableOpacity style={styles.selectGroupButton} onPress={onOpenGroups}>
                  <Text style={styles.selectGroupText}>📁 Grupo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.selectContactButton} onPress={onOpenContacts}>
                  <Text style={styles.selectContactText}>👤 Contato</Text>
                </TouchableOpacity>
              </View>
            )}
            <TextInput
              style={styles.input}
              placeholder={platform === 'whatsapp' ? "Número ou ID do Grupo (@g.us)" : "Chat ID (Ex: -100...)"}
              value={recipient}
              onChangeText={setRecipient}
              keyboardType={platform === 'whatsapp' ? "phone-pad" : "default"}
            />

            <View style={styles.platformSelector}>
              <TouchableOpacity 
                style={[styles.platformButton, platform === 'whatsapp' && styles.activePlatform]} 
                onPress={() => setPlatform('whatsapp')}
              >
                <Text style={[styles.platformButtonText, platform === 'whatsapp' && styles.activePlatformText]}>WhatsApp</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.platformButton, platform === 'telegram' && styles.activePlatform]} 
                onPress={() => setPlatform('telegram')}
              >
                <Text style={[styles.platformButtonText, platform === 'telegram' && styles.activePlatformText]}>Telegram</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Mensagem</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Digite o conteúdo da mensagem..."
              multiline
              numberOfLines={4}
              value={content}
              onChangeText={setContent}
            />

            {/* Imagem em anexo (Apenas WhatsApp) */}
            {platform === 'whatsapp' && (
              <View style={{ marginBottom: 15, width: '100%' }}>
                <Text style={styles.label}>Anexo de Imagem (Opcional)</Text>
                {imagePreview ? (
                  <View style={{ position: 'relative', marginTop: 5, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0' }}>
                    <Image source={{ uri: imagePreview }} style={{ width: '100%', height: 180 }} resizeMode="cover" />
                    <TouchableOpacity 
                      onPress={() => { setImagePreview(undefined); setImageBase64(undefined); }} 
                      style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(15, 23, 42, 0.75)', borderRadius: 20, padding: 8 }}
                    >
                      <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>Remover ✕</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={handlePickImage} style={{ marginTop: 5, padding: 16, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', backgroundColor: '#F8FAFC', alignItems: 'center' }}>
                    <Text style={{ color: '#64748B', fontSize: 13, fontWeight: '600' }}>🖼️ Selecionar Imagem da Galeria</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <Text style={styles.label}>Frequência de Envio</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 15 }}>
              {(['Única', 'Diariamente', 'Semanalmente', 'Quinzenalmente', 'Mensalmente'] as RecurrenceType[]).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.recurrenceButton, recurrence === mode && styles.activeRecurrence]}
                  onPress={() => setRecurrence(mode)}
                >
                  <Text style={[styles.recurrenceButtonText, recurrence === mode && styles.activeRecurrenceText]}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Data e Hora de Envio</Text>
            <View style={styles.dateTimeContainer}>
              {Platform.OS === 'web' ? (
                <input
                  type="datetime-local"
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid #E2E8F0',
                    fontSize: '14px',
                    color: '#0F172A',
                    backgroundColor: '#F8FAFC',
                    outline: 'none',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}
                  value={date.toISOString().slice(0, 16)}
                  onChange={(e) => setDate(new Date(e.target.value))}
                />
              ) : (
                <>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={showDatepicker}>
                    <Text style={styles.dateTimeText}>📅 {dateString}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={showTimepicker}>
                    <Text style={styles.dateTimeText}>⏰ {timeString}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {showDatePicker && Platform.OS !== 'web' && (
              <DateTimePicker
                value={date}
                mode="date"
                display="default"
                onChange={onDateChange}
              />
            )}
            {showTimePicker && Platform.OS !== 'web' && (
              <DateTimePicker
                value={date}
                mode="time"
                display="default"
                onChange={onTimeChange}
              />
            )}

            <View style={styles.buttonContainer}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalCancelButton]} 
                onPress={onClose}
              >
                <Text style={styles.modalCancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalSaveButton]} 
                onPress={handleSave}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.modalSaveButtonText}>Salvar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalView: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
    marginVertical: 40,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 16,
    textAlign: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    width: '100%',
    marginBottom: 15,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  selectButtonsRow: {
    flexDirection: 'row',
    marginBottom: 8,
    width: '100%',
  },
  selectGroupButton: {
    backgroundColor: '#EEF2FF',
    borderColor: '#818CF8',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  selectGroupText: {
    fontSize: 12,
    color: '#4F46E5',
    fontWeight: '700',
  },
  selectContactButton: {
    backgroundColor: '#ECFDF5',
    borderColor: '#34D399',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  selectContactText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '700',
  },
  platformSelector: {
    flexDirection: 'row',
    marginBottom: 15,
    width: '100%',
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    padding: 4,
  },
  platformButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  activePlatform: {
    backgroundColor: '#FFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  platformButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  activePlatformText: {
    color: '#0F172A',
  },
  recurrenceButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    marginRight: 6,
    marginBottom: 8,
  },
  activeRecurrence: {
    backgroundColor: '#EEF2FF',
    borderColor: '#818CF8',
  },
  recurrenceButtonText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  activeRecurrenceText: {
    color: '#4F46E5',
  },
  dateTimeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
  },
  dateTimeButton: {
    flex: 0.48,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
  },
  dateTimeText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 10,
  },
  modalButton: {
    flex: 0.48,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelButton: {
    backgroundColor: '#F1F5F9',
  },
  modalCancelButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  modalSaveButton: {
    backgroundColor: '#25D366',
  },
  modalSaveButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFF',
  },
  aiAssistantCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    width: '100%',
    marginBottom: 15,
  },
  aiAssistantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiAssistantHeaderTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4F46E5',
  },
  aiAssistantHeaderToggle: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '700',
  },
  aiAssistantContent: {
    marginTop: 10,
  },
  aiAssistantInstructions: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 15,
    marginBottom: 8,
  },
  aiInputRow: {
    flexDirection: 'row',
    width: '100%',
  },
  aiTextInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    backgroundColor: '#FFF',
    color: '#0F172A',
  },
  aiSubmitBtn: {
    backgroundColor: '#4F46E5',
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    marginLeft: 6,
  },
  aiSubmitBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  aiExplanationBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  aiExplanationTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 2,
  },
  aiExplanationText: {
    fontSize: 11,
    color: '#1E40AF',
    lineHeight: 15,
  },
});
