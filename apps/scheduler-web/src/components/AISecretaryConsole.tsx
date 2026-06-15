import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert, StyleSheet } from 'react-native';
import { askAISecretary } from '../services/api';

interface AISecretaryConsoleProps {
  aiSettings: { enabled: boolean; toggleEnabled: () => Promise<void> };
  onOpenSettings: () => void;
  onPrefillRequest: (data: any) => void;
}

export function AISecretaryConsole({ aiSettings, onOpenSettings, onPrefillRequest }: AISecretaryConsoleProps) {

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  
  const [isListeningVoice, setIsListeningVoice] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);

  const recognitionRef = useRef<any>(null);

  // Audio Output (SpeechSynthesis)
  const handleSpeakText = useCallback((text: string) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      
      const speak = () => {
        const voices = window.speechSynthesis.getVoices();
        const ptBRVoices = voices.filter(v => v.lang.startsWith('pt-BR') || v.lang.replace('_', '-').startsWith('pt-BR'));
        
        if (ptBRVoices.length > 0) {
          const premiumVoice = ptBRVoices.find(v => 
            v.name.toLowerCase().includes('natural') || 
            v.name.toLowerCase().includes('neural') ||
            v.name.toLowerCase().includes('google') ||
            v.name.toLowerCase().includes('edge')
          ) || ptBRVoices.find(v => v.name.toLowerCase().includes('microsoft'))
            || ptBRVoices[0];
            
          utterance.voice = premiumVoice;
        }
        
        utterance.rate = 1.03;
        utterance.pitch = 1.02;
        utterance.volume = 1.0;
        
        window.speechSynthesis.speak(utterance);
      };

      if (window.speechSynthesis.getVoices().length > 0) {
        speak();
      } else {
        const tempHandler = () => {
          speak();
          if ('speechSynthesis' in window) {
            window.speechSynthesis.onvoiceschanged = null;
          }
        };
        window.speechSynthesis.onvoiceschanged = tempHandler;
      }
    }
  }, []);

  // Audio Input (SpeechRecognition)
  const handleToggleVoiceInput = useCallback(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      Alert.alert('Erro', 'Reconhecimento de voz não suportado neste navegador. Use o Chrome ou Edge.');
      return;
    }

    if (isListeningVoice) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.log('Error stopping recognition:', e);
        }
      }
      setIsListeningVoice(false);
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
      }

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = 'pt-BR';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListeningVoice(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setAiPrompt(prev => prev + (prev ? ' ' : '') + transcript);
      };

      recognition.onerror = (err: any) => {
        console.log('Speech recognition error:', err);
        setIsListeningVoice(false);
      };

      recognition.onend = () => {
        setIsListeningVoice(false);
        recognitionRef.current = null;
      };

      recognition.start();
    } catch (e) {
      console.log('Speech recognition start failed:', e);
      setIsListeningVoice(false);
      recognitionRef.current = null;
    }
  }, [isListeningVoice]);

  const handleAskSecretary = useCallback(async () => {
    if (!aiPrompt.trim()) {
      Alert.alert('Atenção', 'Digite ou fale um comando para a secretária!');
      return;
    }
    setAiLoading(true);
    setAiExplanation(null);
    try {
      const response = await askAISecretary(aiPrompt, undefined);
      setAiExplanation(response.explanation);
      
      if (voiceOutputEnabled) {
        handleSpeakText(response.explanation);
      }

      if (response.action === 'schedule' || response.action === 'rewrite') {
        onPrefillRequest({
          recipientId: response.data?.recipientId || '',
          content: response.data?.content || '',
          sendAt: response.data?.sendAt || new Date().toISOString(),
          platform: response.data?.platform || 'whatsapp'
        });
      }
      
      setAiPrompt('');
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível processar o comando com a IA.');
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, voiceOutputEnabled, handleSpeakText, onPrefillRequest]);

  // Cleanup synthesis on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return (
    <View style={styles.calendarCard}>
      <View style={styles.calendarCardHeader}>
        <Text style={styles.calendarCardTitle}>🤖 Central da Secretária de IA</Text>
        {aiSettings.enabled && (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>AUTO-RESPOSTA</Text>
          </View>
        )}
      </View>

      <Text style={styles.calendarCardDescription}>
        Habilite a assistente virtual autônoma que responde contatos pelo WhatsApp e converse por voz/texto com o co-piloto da IA.
      </Text>

      <View style={styles.aiControlsGrid}>
        {/* Toggle Auto Reply */}
        <TouchableOpacity 
          style={[styles.aiSettingBtn, aiSettings.enabled ? styles.aiSettingBtnOn : styles.aiSettingBtnOff]} 
          onPress={aiSettings.toggleEnabled}
        >
          <Text style={styles.aiSettingBtnText}>
            {aiSettings.enabled ? '🤖 Auto-Resposta: LIGADO' : '🤖 Auto-Resposta: DESLIGADO'}
          </Text>
        </TouchableOpacity>

        {/* Toggle Audio Out */}
        <TouchableOpacity 
          style={[styles.aiSettingBtn, voiceOutputEnabled ? styles.aiSettingBtnVoiceOn : styles.aiSettingBtnOff]} 
          onPress={() => {
            const newVal = !voiceOutputEnabled;
            setVoiceOutputEnabled(newVal);
            if (newVal) {
              handleSpeakText('Voz da secretária ativada.');
            } else {
              if (typeof window !== 'undefined') window.speechSynthesis.cancel();
            }
          }}
        >
          <Text style={styles.aiSettingBtnText}>
            {voiceOutputEnabled ? '🔊 Auto-Falar: LIGADO' : '🔇 Auto-Falar: DESLIGADO'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.calendarActionsRow}>
        <TouchableOpacity 
          style={styles.settingsButton} 
          onPress={onOpenSettings}
        >
          <Text style={styles.settingsButtonText}>⚙️ Regras & Personalidade da IA</Text>
        </TouchableOpacity>
      </View>

      {/* Interactive Speech / Audio Console */}
      <View style={styles.voiceConsole}>
        <TextInput
          style={styles.voiceConsoleInput}
          placeholder="Fale ou digite para conversar com a Secretária..."
          placeholderTextColor="#94A3B8"
          value={aiPrompt}
          onChangeText={setAiPrompt}
          onSubmitEditing={handleAskSecretary}
        />
        <TouchableOpacity 
          style={[styles.micButton, isListeningVoice && styles.micButtonListening]} 
          onPress={handleToggleVoiceInput}
        >
          <Text style={styles.micButtonText}>{isListeningVoice ? '🔴' : '🎤'}</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.voiceSendButton} 
          onPress={handleAskSecretary}
          disabled={aiLoading}
        >
          {aiLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.voiceSendButtonText}>Ir</Text>
          )}
        </TouchableOpacity>
      </View>

      {aiExplanation && (
        <View style={styles.aiConsoleResponse}>
          <View style={styles.responseHeaderRow}>
            <Text style={styles.aiConsoleResponseHeader}>Resposta da Secretária:</Text>
            <TouchableOpacity onPress={() => handleSpeakText(aiExplanation)}>
              <Text style={{ fontSize: 13, color: '#4F46E5', fontWeight: 'bold' }}>🗣️ Ouvir Resposta</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.responseScroll} nestedScrollEnabled={true}>
            <Text style={styles.aiConsoleResponseText}>{aiExplanation}</Text>
          </ScrollView>
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
  activeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#EEF2FF',
    borderColor: '#818CF8',
    borderWidth: 1,
  },
  activeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4F46E5',
  },
  calendarCardDescription: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 16,
  },
  aiControlsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  aiSettingBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  aiSettingBtnOn: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  aiSettingBtnVoiceOn: {
    backgroundColor: '#EEF2FF',
    borderColor: '#A5B4FC',
  },
  aiSettingBtnOff: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  aiSettingBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  calendarActionsRow: {
    marginBottom: 16,
  },
  settingsButton: {
    backgroundColor: '#0288D1',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  settingsButtonText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  voiceConsole: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 6,
    gap: 6,
  },
  voiceConsoleInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonListening: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  micButtonText: {
    fontSize: 18,
  },
  voiceSendButton: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceSendButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
  },
  aiConsoleResponse: {
    marginTop: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  responseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  aiConsoleResponseHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  responseScroll: {
    maxHeight: 120,
  },
  aiConsoleResponseText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
  },
});
