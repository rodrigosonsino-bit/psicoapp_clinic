import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput, Image, StyleSheet, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useWhatsapp } from '../context/WhatsappContext';

export function WhatsappConnectionCard() {
  const {
    whatsappStatus,
    whatsappQr,
    whatsappLoading,
    pairingCode,
    pairingLoading,
    usePairingCode,
    pairingPhone,
    setUsePairingCode,
    setPairingPhone,
    connectWhatsapp,
    disconnectWhatsapp,
    generatePairingCode
  } = useWhatsapp();

  const handleCopyCode = async () => {
    if (pairingCode) {
      await Clipboard.setStringAsync(pairingCode);
      Alert.alert('Sucesso', 'Código de pareamento copiado para a área de transferência!');
    }
  };

  return (
    <View style={styles.calendarCard}>
      <View style={styles.calendarCardHeader}>
        <Text style={styles.calendarCardTitle}>📱 Conexão do WhatsApp (Baileys)</Text>
        <View style={[
          styles.connectedBadge,
          whatsappStatus.status === 'connected' ? styles.waBadgeConnected :
          whatsappStatus.status === 'connecting' ? styles.waBadgeConnecting : styles.waBadgeDisconnected
        ]}>
          <Text style={[
            styles.connectedBadgeText,
            whatsappStatus.status === 'connected' ? { color: '#15803D' } :
            whatsappStatus.status === 'connecting' ? { color: '#B45309' } : { color: '#64748B' }
          ]}>
            {whatsappStatus.status === 'connected' ? 'CONECTADO' :
             whatsappStatus.status === 'connecting' ? 'CONECTANDO' : 'DESCONECTADO'}
          </Text>
        </View>
      </View>

      {whatsappLoading ? (
        <ActivityIndicator size="small" color="#10B981" style={{ marginVertical: 15 }} />
      ) : whatsappStatus.status === 'disconnected' ? (
        <View>
          <Text style={styles.calendarCardDescription}>
            Conecte seu número de WhatsApp para ativar o robô Sarah, gerenciar contatos dinamicamente e enviar mensagens agendadas.
          </Text>
          <TouchableOpacity style={[styles.calendarConnectButton, { backgroundColor: '#10B981' }]} onPress={connectWhatsapp}>
            <Text style={styles.calendarConnectButtonText}>🔌 Conectar WhatsApp</Text>
          </TouchableOpacity>
        </View>
      ) : whatsappStatus.status === 'connecting' ? (
        <View style={{ alignItems: 'center', paddingVertical: 10 }}>
          {/* Método de Conexão Switcher */}
          <View style={styles.connectionMethodSwitcher}>
            <TouchableOpacity 
              style={[styles.connectionMethodBtn, !usePairingCode && styles.connectionMethodBtnActive]}
              onPress={() => setUsePairingCode(false)}
            >
              <Text style={styles.connectionMethodBtnText}>📷 QR Code</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.connectionMethodBtn, usePairingCode && styles.connectionMethodBtnActive]}
              onPress={() => setUsePairingCode(true)}
            >
              <Text style={styles.connectionMethodBtnText}>🔑 Código de Pareamento</Text>
            </TouchableOpacity>
          </View>

          {!usePairingCode ? (
            <View style={{ alignItems: 'center', width: '100%' }}>
              <Text style={[styles.calendarCardDescription, { textAlign: 'center', marginBottom: 12 }]}>
                Escaneie o QR Code abaixo com o seu WhatsApp (Configurações &gt; Aparelhos Conectados):
              </Text>
              
              {whatsappQr ? (
                <View style={styles.qrCodeBox}>
                  <Image source={{ uri: whatsappQr }} style={styles.qrCodeImage} />
                </View>
              ) : (
                <View style={[styles.qrCodeBox, { justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator size="large" color="#10B981" />
                  <Text style={{ fontSize: 12, color: '#666', marginTop: 8 }}>Gerando QR Code...</Text>
                </View>
              )}
              
              <Text style={{ fontSize: 13, color: '#64748B', fontStyle: 'italic', marginTop: 12, textAlign: 'center' }}>
                🔄 Atualiza automaticamente. Aguardando leitura...
              </Text>
            </View>
          ) : (
            <View style={{ width: '100%' }}>
              {!pairingCode ? (
                <View>
                  <Text style={[styles.calendarCardDescription, { marginBottom: 12 }]}>
                    Digite o número do seu celular (com DDI e DDD, apenas números) para gerar o código de emparelhamento:
                  </Text>
                  
                  <TextInput
                    style={[styles.authInput, { marginBottom: 12, color: '#000000' }]}
                    placeholder="Ex: 5518996994225"
                    placeholderTextColor="#666"
                    keyboardType="phone-pad"
                    value={pairingPhone}
                    onChangeText={setPairingPhone}
                  />
                  
                  {pairingLoading ? (
                    <ActivityIndicator size="small" color="#10B981" style={{ marginVertical: 12 }} />
                  ) : (
                    <TouchableOpacity 
                      style={[styles.calendarConnectButton, { backgroundColor: '#22b8cf', marginBottom: 10 }]} 
                      onPress={() => generatePairingCode(pairingPhone)}
                    >
                      <Text style={styles.calendarConnectButtonText}>🔑 Solicitar Código de Pareamento</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                  <Text style={[styles.calendarCardDescription, { textAlign: 'center', marginBottom: 12 }]}>
                    Insira este código nas configurações de Aparelhos Conectados do seu WhatsApp:
                  </Text>
                  
                  <TouchableOpacity 
                    style={[styles.pairingCodeBox, { alignItems: 'center' }]} 
                    onPress={handleCopyCode}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.pairingCodeText}>
                      {pairingCode}
                    </Text>
                    <Text style={{ color: '#94A3B8', fontSize: 11, fontWeight: 'bold', marginTop: 6, letterSpacing: 0.5 }}>
                      📋 Tocar para copiar código
                    </Text>
                  </TouchableOpacity>
                  
                  <View style={styles.instructionsBox}>
                    <Text style={styles.instructionsHeader}>👉 Como conectar no celular:</Text>
                    <Text style={styles.instructionStep}>1. Abra o WhatsApp &gt; Configurações &gt; Aparelhos Conectados</Text>
                    <Text style={styles.instructionStep}>2. Toque em "Conectar um Aparelho"</Text>
                    <Text style={styles.instructionStep}>3. Abaixo da câmera, toque em "Conectar com número de telefone em vez disso"</Text>
                    <Text style={styles.instructionStep}>4. Digite o código de 8 dígitos exibido acima!</Text>
                  </View>

                  <TouchableOpacity 
                    style={{ paddingVertical: 6, alignSelf: 'center' }} 
                    onPress={() => generatePairingCode('')} // passing empty triggers clear / re-generation interface
                  >
                    <Text style={{ color: '#22b8cf', textDecorationLine: 'underline', fontSize: 12 }}>🔄 Gerar para outro número</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          
          <TouchableOpacity 
            style={[styles.calendarActionButton, styles.calendarDisconnectButton, { marginTop: 16, width: '100%' }]} 
            onPress={disconnectWhatsapp}
          >
            <Text style={styles.calendarActionButtonText}>Cancelar Conexão</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <Text style={styles.calendarCardDescription}>
            Seu dispositivo está vinculado e pronto! O sistema está enviando mensagens agendadas autonomamente e a Sarah está respondendo seus contatos.
          </Text>
          <TouchableOpacity 
            style={[styles.calendarActionButton, styles.calendarDisconnectButton, { width: '100%', marginTop: 10 }]} 
            onPress={disconnectWhatsapp}
          >
            <Text style={styles.calendarActionButtonText}>❌ Desconectar WhatsApp</Text>
          </TouchableOpacity>
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
    backgroundColor: '#F1F5F9',
  },
  connectedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  waBadgeConnected: {
    backgroundColor: '#DCFCE7',
  },
  waBadgeConnecting: {
    backgroundColor: '#FEF3C7',
  },
  waBadgeDisconnected: {
    backgroundColor: '#F1F5F9',
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
  calendarActionButton: {
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
  connectionMethodSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 4,
    marginBottom: 15,
    width: '100%',
  },
  connectionMethodBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  connectionMethodBtnActive: {
    backgroundColor: '#10B981',
  },
  connectionMethodBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  qrCodeBox: {
    width: 200,
    height: 200,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFF',
    overflow: 'hidden',
  },
  qrCodeImage: {
    width: '100%',
    height: '100%',
  },
  authInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#0F172A',
  },
  pairingCodeBox: {
    backgroundColor: '#1E293B',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 15,
  },
  pairingCodeText: {
    color: '#22b8cf',
    fontSize: 28,
    fontWeight: 'bold',
    letterSpacing: 4,
  },
  instructionsBox: {
    width: '100%',
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#22b8cf',
    marginBottom: 10,
  },
  instructionsHeader: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  instructionStep: {
    color: '#64748B',
    fontSize: 12,
    marginBottom: 2,
  },
});
