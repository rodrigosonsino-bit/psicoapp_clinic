import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useTelegram } from '../context/TelegramContext';

export function TelegramConnectionCard() {
  const { telegramStatus } = useTelegram();
  const { connected, botUsername } = telegramStatus;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>✈️ Conexão do Telegram (Bot)</Text>
        <View style={[styles.badge, connected ? styles.badgeConnected : styles.badgeDisconnected]}>
          <Text style={[styles.badgeText, connected ? styles.badgeTextConnected : styles.badgeTextDisconnected]}>
            {connected ? 'ATIVO' : 'INATIVO'}
          </Text>
        </View>
      </View>

      {connected ? (
        <View>
          <Text style={styles.description}>
            Bot{' '}
            <Text style={styles.botName}>@{botUsername}</Text>
            {' '}está ativo e pronto para enviar mensagens agendadas.
          </Text>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Como enviar para um grupo ou contato:</Text>
            <Text style={styles.infoStep}>
              {'1. Adicione '}
              <Text style={styles.infoStepHighlight}>@{botUsername}</Text>
              {' ao grupo ou inicie uma conversa'}
            </Text>
            <Text style={styles.infoStep}>2. Qualquer mensagem enviada ao bot registra o Chat ID automaticamente</Text>
            <Text style={styles.infoStep}>3. No agendamento, selecione "Telegram" e informe o Chat ID (ex: -1001234567890)</Text>
          </View>
        </View>
      ) : (
        <View>
          <Text style={styles.description}>
            O bot do Telegram não está configurado. Adicione a variável{' '}
            <Text style={styles.code}>TELEGRAM_BOT_TOKEN</Text>
            {' '}no servidor para ativar.
          </Text>
          <TouchableOpacity
            style={styles.helpButton}
            onPress={() => Linking.openURL('https://t.me/BotFather')}
          >
            <Text style={styles.helpButtonText}>🤖 Criar bot no BotFather →</Text>
          </TouchableOpacity>
        </View>
      )}
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
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeConnected: {
    backgroundColor: '#DCFCE7',
  },
  badgeDisconnected: {
    backgroundColor: '#F1F5F9',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  badgeTextConnected: {
    color: '#15803D',
  },
  badgeTextDisconnected: {
    color: '#64748B',
  },
  description: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 19,
    marginBottom: 14,
  },
  botName: {
    fontWeight: '700',
    color: '#0F172A',
  },
  infoBox: {
    backgroundColor: '#F0F9FF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    padding: 12,
  },
  infoTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0369A1',
    marginBottom: 6,
  },
  infoStep: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 2,
  },
  infoStepHighlight: {
    fontWeight: '700',
    color: '#0369A1',
  },
  code: {
    fontFamily: 'monospace',
    color: '#4F46E5',
    fontWeight: '600',
  },
  helpButton: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  helpButtonText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '700',
  },
});
