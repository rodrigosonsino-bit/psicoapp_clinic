import React from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing, radius, fontSize } from '../theme/tokens';

export interface BillingBlockedScreenProps {
  realToken: string | null;
  tenant: any;
  handleExitPreview: () => void;
  handleCheckout: () => void;
  checkoutLoading: boolean;
  handleLogout: () => void;
}

export function BillingBlockedScreen({
  realToken,
  tenant,
  handleExitPreview,
  handleCheckout,
  checkoutLoading,
  handleLogout,
}: BillingBlockedScreenProps) {
  return (
    <SafeAreaView style={[styles.authContainer, { backgroundColor: '#0F172A' }]}>
      {(realToken || tenant?.isAdminPreview) && (
        <View style={{ backgroundColor: '#DC2626', paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 13 }}>🔧 MODO PREVIEW: TRIAL EXPIRADO</Text>
          <TouchableOpacity
            onPress={handleExitPreview}
            style={{ backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}
          >
            <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 12 }}>Voltar ao Real</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={[styles.authCard, { backgroundColor: '#1E293B', borderColor: '#334155', maxWidth: 460 }]}>
        <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: 15 }}>⏳</Text>
        <Text style={[styles.authTitle, { fontSize: 26, color: '#F1F5F9', marginBottom: 8, fontWeight: '900' }]}>
          Período de Testes Expirado
        </Text>
        
        <Text style={[styles.authSubtitle, { fontSize: 15, color: '#94A3B8', marginBottom: 24, lineHeight: 22 }]}>
          Olá, <Text style={{ fontWeight: '800', color: '#818CF8' }}>{tenant?.name}</Text>. Seus 30 dias de uso gratuito terminaram. Ative sua assinatura mensal para continuar automatizando seu atendimento.
        </Text>

        <View style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)', borderRadius: 12, padding: 18, marginBottom: 28, borderWidth: 1, borderColor: 'rgba(244, 63, 94, 0.2)' }}>
          <Text style={{ color: '#FDA4AF', fontSize: 13, lineHeight: 20, fontWeight: '600', marginBottom: 8, textAlign: 'center' }}>
            RECURSOS BLOQUEADOS:
          </Text>
          <Text style={{ color: '#E2E8F0', fontSize: 13, lineHeight: 18 }}>
            • Envios & Agendamentos de Mensagens{'\n'}
            • Conexão Multi-Sessão do WhatsApp{'\n'}
            • Sincronização Inteligente Google Calendar{'\n'}
            • Respostas Automáticas da Sarah (IA)
          </Text>
        </View>

        <TouchableOpacity 
          style={[styles.authButton, { backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 10, shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 }]} 
          onPress={() => handleCheckout()}
          disabled={checkoutLoading}
        >
          {checkoutLoading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 }}>
              💳 ATIVAR ASSINATURA MENSAL
            </Text>
          )}
        </TouchableOpacity>

        <Text style={{ color: '#64748B', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
          Faturamento seguro via Stripe • Cancele a qualquer momento
        </Text>

        <TouchableOpacity 
          style={{ marginTop: 24, alignSelf: 'center', paddingVertical: 8 }} 
          onPress={handleLogout}
        >
          <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' }}>
            🚪 Sair da Conta / Trocar Usuário
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  authContainer: {
    flex: 1,
    backgroundColor: colors.bgBase,
    justifyContent: 'center',
    alignItems: 'center',
  },
  authCard: {
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    width: '100%',
    marginHorizontal: spacing.md,
  },
  authTitle: {
    textAlign: 'center',
  },
  authSubtitle: {
    textAlign: 'center',
  },
  authButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
});
