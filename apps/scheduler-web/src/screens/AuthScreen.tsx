import React from 'react';
import { View, Text, TouchableOpacity, TextInput, SafeAreaView, Platform, StyleSheet } from 'react-native';
import { colors, spacing, radius, fontSize } from '../theme/tokens';
import { DEFAULT_BASE_URL } from '../services/api';

export interface AuthScreenProps {
  authMode: 'login' | 'register';
  setAuthMode: (mode: 'login' | 'register') => void;
  authName: string;
  setAuthName: (val: string) => void;
  authEmail: string;
  setAuthEmail: (val: string) => void;
  authPassword: string;
  setAuthPassword: (val: string) => void;
  handleAuth: () => void;
  showServerSettings: boolean;
  setShowServerSettings: (val: boolean) => void;
  serverUrl: string;
  setServerUrl: (val: string) => void;
  saveServerUrl: (url: string) => void;
}

export function AuthScreen({
  authMode,
  setAuthMode,
  authName,
  setAuthName,
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  handleAuth,
  showServerSettings,
  setShowServerSettings,
  serverUrl,
  setServerUrl,
  saveServerUrl,
}: AuthScreenProps) {
  const isWeb = Platform.OS === 'web';

  return (
    <SafeAreaView style={styles.authContainer}>
      <View style={[styles.authShell, isWeb && styles.authShellWeb]}>

        {/* Left panel — branding (web only) */}
        {isWeb && (
          <View style={styles.authBrandPanel}>
            <View style={styles.authBrandPill}>
              <View style={styles.authBrandPillDot} />
              <Text style={styles.authBrandPillText}>WhatsApp Scheduler</Text>
            </View>
            <Text style={styles.authBrandHeadline}>
              Seu atendimento{'\n'}no piloto automático
            </Text>
            <Text style={styles.authBrandDesc}>
              Agende mensagens, integre sua agenda Google e deixe a Sarah, sua secretária de IA, responder pelo WhatsApp enquanto você foca no que importa.
            </Text>
            <View style={styles.authFeatureList}>
              {[
                'Agendamento por voz ou texto',
                'Sincronização com Google Agenda',
                'Secretária IA autônoma (Sarah)',
                'Relatórios semanais de desempenho',
              ].map((f) => (
                <View key={f} style={styles.authFeatureItem}>
                  <View style={styles.authFeatureDot} />
                  <Text style={styles.authFeatureText}>{f}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Right panel — form */}
        <View style={[styles.authFormPanel, isWeb && styles.authFormPanelWeb]}>
          {!isWeb && (
            <Text style={styles.authLogoText}>Co-Piloto Sarah</Text>
          )}
          <Text style={styles.authFormTitle}>
            {authMode === 'login' ? 'Entrar na conta' : 'Criar conta grátis'}
          </Text>
          <Text style={styles.authFormSubtitle}>
            {authMode === 'login'
              ? 'Bem-vindo de volta. Acesse seu painel.'
              : 'Comece em poucos segundos, sem cartão.'}
          </Text>

          {authMode === 'register' && (
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Seu Nome</Text>
              <TextInput
                style={styles.authInput}
                placeholder="Ex: Rodrigo"
                placeholderTextColor={colors.textMuted}
                value={authName}
                onChangeText={setAuthName}
              />
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>E-mail</Text>
            <TextInput
              style={styles.authInput}
              placeholder="seuemail@exemplo.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              value={authEmail}
              onChangeText={setAuthEmail}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Senha</Text>
            <TextInput
              style={styles.authInput}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={authPassword}
              onChangeText={setAuthPassword}
            />
          </View>

          <TouchableOpacity style={styles.authButton} onPress={handleAuth}>
            <Text style={styles.authButtonText}>
              {authMode === 'login' ? 'Entrar →' : 'Criar conta →'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.authSwitchLink}
            onPress={() => {
              setAuthEmail('');
              setAuthPassword('');
              setAuthName('');
              setAuthMode(authMode === 'login' ? 'register' : 'login');
            }}
          >
            <Text style={styles.authSwitchText}>
              {authMode === 'login'
                ? 'Não tem conta? '
                : 'Já tem uma conta? '}
              <Text style={styles.authSwitchTextHighlight}>
                {authMode === 'login' ? 'Cadastre-se' : 'Faça login'}
              </Text>
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.authServerToggle}
            onPress={() => setShowServerSettings(!showServerSettings)}
          >
            <Text style={styles.authServerToggleText}>
              {showServerSettings ? 'Ocultar configurações de rede' : '⚙ Configurar servidor (avançado)'}
            </Text>
          </TouchableOpacity>

          {showServerSettings && (
            <View style={styles.authServerPanel}>
              <Text style={styles.inputLabel}>Endereço da API do Backend</Text>
              <View style={styles.authServerRow}>
                <TextInput
                  style={[styles.authInput, { flex: 1, marginRight: spacing.sm }]}
                  placeholder="https://sua-api.up.railway.app/api"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  value={serverUrl}
                  onChangeText={setServerUrl}
                />
                <TouchableOpacity
                  style={styles.authServerSaveBtn}
                  onPress={() => saveServerUrl(serverUrl)}
                >
                  <Text style={styles.authServerSaveBtnText}>Salvar</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.authServerHint}>Padrão: {DEFAULT_BASE_URL}</Text>
            </View>
          )}
        </View>

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
  authShell: {
    width: '100%',
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  authShellWeb: {
    flexDirection: 'row',
    maxWidth: 880,
    alignSelf: 'center',
    padding: 0,
    minHeight: 520,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  authBrandPanel: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  authBrandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.borderPrimary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  authBrandPillDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  authBrandPillText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  authBrandHeadline: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 36,
    marginBottom: spacing.md,
  },
  authBrandDesc: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  authFeatureList: {
    gap: spacing.sm,
  },
  authFeatureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  authFeatureDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  authFeatureText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  authFormPanel: {
    width: '100%',
    maxWidth: 400,
    padding: spacing.lg,
  },
  authFormPanelWeb: {
    backgroundColor: colors.bgBase,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  authLogoText: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.primary,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  authFormTitle: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  authFormSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  authInput: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  authButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  authButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.base,
    fontWeight: '800',
  },
  authSwitchLink: {
    marginTop: spacing.base,
    alignItems: 'center',
  },
  authSwitchText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  authSwitchTextHighlight: {
    color: colors.primary,
    fontWeight: '700',
  },
  authServerToggle: {
    marginTop: spacing.lg,
    alignSelf: 'center',
  },
  authServerToggleText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textDecorationLine: 'underline',
  },
  authServerPanel: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderMuted,
    paddingTop: spacing.md,
  },
  authServerRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  authServerSaveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    justifyContent: 'center',
  },
  authServerSaveBtnText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.sm,
  },
  authServerHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.xs,
  },
});
