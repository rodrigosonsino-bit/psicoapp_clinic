import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet, Text, View, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, SafeAreaView, Platform, Linking, ScrollView, Image
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  getMessages, scheduleMessage, deleteMessage, updateMessage, ScheduledMessage, 
  BASE_URL, DEFAULT_BASE_URL, getSavedApiUrl, MessagePlatform, getWhatsappGroups, WhatsappGroup, getWhatsappContacts, 
  WhatsappContact, getGoogleAuthUrl, getGoogleCalendarStatus, disconnectGoogleCalendar, 
  syncGoogleCalendar, askAISecretary, GoogleCalendarStatus, GoogleCalendarItem, 
  listGoogleCalendars, selectGoogleCalendar, GoogleCalendarEvent, getGoogleCalendarEvents, 
  toggleEventAutoSend, getWeeklyReportCsvUrl, 
  setAuthToken, login, register, getMe, connectWhatsapp, 
  getWhatsappStatus, disconnectWhatsapp, getWhatsappQr, getWhatsappPairingCode, TenantProfile, WhatsappConnectionStatus,
  createCheckoutSession, previewPlan
} from './src/services/api';

import { useAISettings } from './src/hooks/useAISettings';
import { MessageItem } from './src/components/MessageItem';
import { CalendarPickerModal } from './src/components/CalendarPickerModal';
import { AISettingsModal } from './src/components/AISettingsModal';
import { WeeklyReportCard } from './src/components/WeeklyReportCard';
import { MessageSchedulerModal } from './src/components/MessageSchedulerModal';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { WhatsappProvider, useWhatsapp } from './src/context/WhatsappContext';
import { CalendarProvider, useCalendar } from './src/context/CalendarContext';
import { WhatsappConnectionCard } from './src/components/WhatsappConnectionCard';
import { CalendarIntegrationCard } from './src/components/CalendarIntegrationCard';
import { AISecretaryConsole } from './src/components/AISecretaryConsole';
import { colors, spacing, radius, fontSize } from './src/theme/tokens';


export function MainDashboard() {
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { isAuthenticated, tenant, realToken, authLoading, handleAuth: contextHandleAuth, handleLogout: contextHandleLogout, setTenant, setRealToken } = useAuth();
  const { whatsappStatus } = useWhatsapp();
  const { calendarStatus, setCalendarStatus } = useCalendar();

  const handleLogout = async () => {
    await contextHandleLogout();
    setAuthEmail('');
    setAuthPassword('');
    setAuthName('');
  };

  // Local UI-only Auth/Server state
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverUrl, setServerUrl] = useState(getSavedApiUrl());

  const handleAuth = async () => {
    await contextHandleAuth(authMode, authEmail, authPassword, authName);
  };

  const [modalVisible, setModalVisible] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Filtros de Data
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'today' | 'tomorrow' | '2days' | '3days' | 'custom'>('all');
  const [customDate, setCustomDate] = useState<string>('');
  const [showFilterDatePicker, setShowFilterDatePicker] = useState(false);

  // Pagination State (using refs to avoid useCallback dependency issues)
  const pageRef = useRef(1);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [recipientSelection, setRecipientSelection] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  // Groups state
  const [groups, setGroups] = useState<WhatsappGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Contacts state
  const [contacts, setContacts] = useState<WhatsappContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState('');

  const fetchGroups = async () => {
    setGroupsLoading(true);
    try {
      const data = await getWhatsappGroups();
      setGroups(data);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível carregar os grupos do WhatsApp. O Backend pode estar desconectado.');
    } finally {
      setGroupsLoading(false);
    }
  };

  const openGroupsModal = () => {
    setSearchQuery('');
    setShowGroupsModal(true);
    if (groups.length === 0) {
      fetchGroups();
    }
  };

  const filteredGroups = useMemo(() => groups.filter(g => 
    g.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    g.id.includes(searchQuery)
  ), [groups, searchQuery]);

  const fetchContacts = async () => {
    setContactsLoading(true);
    try {
      const data = await getWhatsappContacts();
      setContacts(data);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível carregar os contatos do WhatsApp.');
    } finally {
      setContactsLoading(false);
    }
  };

  const openContactsModal = () => {
    setContactSearchQuery('');
    setShowContactsModal(true);
    if (contacts.length === 0) {
      fetchContacts();
    }
  };

  const filteredContacts = useMemo(() => contacts.filter(c => 
    c.name.toLowerCase().includes(contactSearchQuery.toLowerCase()) || 
    c.id.includes(contactSearchQuery)
  ), [contacts, contactSearchQuery]);

  const getLocalDateString = (offsetDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const loadMessages = useCallback(async (
    isInitial = true,
    filterType?: 'all' | 'today' | 'tomorrow' | '2days' | '3days' | 'custom',
    cDate?: string,
    silent = false
  ) => {
    if (isInitial) {
      if (!silent) setLoading(true);
      setApiError(null);
      pageRef.current = 1;
      hasMoreRef.current = true;
    } else {
      if (loadingMoreRef.current || !hasMoreRef.current) return;
      loadingMoreRef.current = true;
      if (!silent) setLoadingMore(true);
    }

    const activeFilter = filterType !== undefined ? filterType : selectedFilter;
    const activeCustomDate = cDate !== undefined ? cDate : customDate;

    let dateParam: string | undefined;
    let startDateParam: string | undefined;
    let endDateParam: string | undefined;

    if (activeFilter === 'today') {
      dateParam = getLocalDateString(0);
    } else if (activeFilter === 'tomorrow') {
      dateParam = getLocalDateString(1);
    } else if (activeFilter === '2days') {
      dateParam = getLocalDateString(2);
    } else if (activeFilter === '3days') {
      dateParam = getLocalDateString(3);
    } else if (activeFilter === 'custom' && activeCustomDate) {
      dateParam = activeCustomDate;
    }

    try {
      const currentPage = isInitial ? 1 : pageRef.current + 1;
      const data = await getMessages(currentPage, 20, dateParam, startDateParam, endDateParam);

      if (data.length < 20) {
        hasMoreRef.current = false;
      }

      setMessages(prev => isInitial ? data : [...prev, ...data]);
      if (!isInitial) pageRef.current = currentPage;
    } catch (error: any) {
      console.log('Error fetching messages:', error?.message);
      console.log('Request URL base:', BASE_URL);
      const errorMsg = error?.message || 'Erro desconhecido';
      setApiError(errorMsg);
      if (isInitial) {
        setMessages([]);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [selectedFilter, customDate]);

  const handleFilterChange = (
    filterType: 'all' | 'today' | 'tomorrow' | '2days' | '3days' | 'custom',
    cDate?: string
  ) => {
    setSelectedFilter(filterType);
    if (cDate !== undefined) {
      setCustomDate(cDate);
    }
    loadMessages(true, filterType, cDate !== undefined ? cDate : customDate);
  };

  const handleDelete = useCallback(async (id: string) => {
    const performDelete = async () => {
      try {
        await deleteMessage(id);
        loadMessages(true); // Recarrega sempre do inicio apos deletar
      } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Não foi possível excluir a mensagem.';
        Alert.alert('Erro', errorMessage);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Deseja realmente excluir este agendamento?')) {
        performDelete();
      }
    } else {
      Alert.alert(
        'Confirmar Exclusão',
        'Deseja realmente excluir este agendamento?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Excluir', style: 'destructive', onPress: performDelete }
        ]
      );
    }
  }, [loadMessages]);

  const openNewModal = useCallback(() => {
    setEditingMessage(null);
    setIsResending(false);
    setModalVisible(true);
  }, []);

  const handleResend = useCallback(async (item: ScheduledMessage) => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Reenviar agora para ${item.recipientId}?\n\n"${item.content.slice(0, 80)}${item.content.length > 80 ? '…' : ''}"`)
      : true;
    if (!confirmed) return;

    const sendAt = new Date();
    sendAt.setSeconds(sendAt.getSeconds() + 10);

    try {
      await scheduleMessage(item.content, item.recipientId, sendAt.toISOString(), item.platform || 'whatsapp', 'Única');
      Alert.alert('Sucesso', 'Mensagem reenviada com sucesso!');
      loadMessages(true);
    } catch (error: any) {
      Alert.alert('Erro', error?.response?.data?.error || 'Não foi possível reenviar a mensagem.');
    }
  }, [loadMessages]);

  const openEditModal = useCallback(async (item: ScheduledMessage) => {
    let targetItem = item;
    if (item.status === 'sent' && item.metadata?.recurrence && item.metadata.recurrence !== 'Única') {
      let futurePending = messages.find(m => m.status === 'pending' && m.recipientId === item.recipientId && m.metadata?.recurrence === item.metadata?.recurrence);
      if (!futurePending) {
        setEditLoading(true);
        try {
          // Busca no backend a lista mais recente de agendamentos para tentar encontrar o correspondente pendente
          const allMsgs = await getMessages(1, 100);
          futurePending = allMsgs.find(m => m.status === 'pending' && m.recipientId === item.recipientId && m.metadata?.recurrence === item.metadata?.recurrence);
        } catch (e) {
          console.log('Erro ao buscar mensagem pendente correspondente no backend:', e);
        } finally {
          setEditLoading(false);
        }
      }
      if (futurePending) {
        targetItem = futurePending;
      } else {
        Alert.alert(
          'Aviso',
          'Não foi possível localizar o próximo envio pendente desta série recorrente. A edição será aplicada à mensagem original.'
        );
      }
    }

    setEditingMessage(targetItem);
    setIsResending(false);
    setModalVisible(true);
  }, [messages]);

  const handleCloseModal = useCallback(() => {
    setModalVisible(false);
    setEditingMessage(null);
    setIsResending(false);
  }, []);

  // Google Calendar Integration States & Methods
  const [calendarList, setCalendarList] = useState<GoogleCalendarItem[]>([]);
  const [showCalendarPickerModal, setShowCalendarPickerModal] = useState(false);
  const [calendarListLoading, setCalendarListLoading] = useState(false);



  const handleOpenCalendarPicker = async () => {
    setCalendarListLoading(true);
    setShowCalendarPickerModal(true);
    try {
      const calendars = await listGoogleCalendars();
      setCalendarList(calendars);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível carregar as agendas da sua conta Google.');
      setShowCalendarPickerModal(false);
    } finally {
      setCalendarListLoading(false);
    }
  };

  const handleSelectCalendar = async (cal: GoogleCalendarItem) => {
    try {
      await selectGoogleCalendar(cal.id, cal.summary);
      setCalendarStatus(prev => ({ ...prev, calendarId: cal.id, calendarName: cal.summary }));
      setShowCalendarPickerModal(false);
      Alert.alert('Sucesso', `Agenda "${cal.summary}" selecionada com sucesso!`);
      fetchCalendarEvents(); // Reload events for the new calendar
    } catch (error) {
      Alert.alert('Erro', 'Falha ao selecionar a agenda.');
    }
  };

  // Calendar Events State
  const [calendarEvents, setCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventsPanel, setShowEventsPanel] = useState(false);

  const fetchCalendarEvents = async () => {
    setEventsLoading(true);
    try {
      const events = await getGoogleCalendarEvents();
      setCalendarEvents(events);
    } catch (error) {
      console.log('Erro ao buscar eventos:', error);
    } finally {
      setEventsLoading(false);
    }
  };

  const handleToggleAutoSend = async (event: GoogleCalendarEvent) => {
    const newVal = !event.autoSend;
    // Otimistic update
    setCalendarEvents(prev => prev.map(e => e.id === event.id ? { ...e, autoSend: newVal } : e));
    try {
      await toggleEventAutoSend(event.id, newVal, event.summary, event.start);
    } catch (error) {
      // Reverter
      setCalendarEvents(prev => prev.map(e => e.id === event.id ? { ...e, autoSend: !newVal } : e));
      Alert.alert('Erro', 'Falha ao alterar preferência.');
    }
  };

  const formatEventDateTime = (isoString: string) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  // Autonomous AI Secretary Hook
  const aiSettings = useAISettings(isAuthenticated);
  const [showAiSettingsModal, setShowAiSettingsModal] = useState(false);
  const [aiPrefillData, setAiPrefillData] = useState<any>(null);



  const saveServerUrl = (url: string) => {
    const cleanedUrl = url.trim().replace(/\/+$/, '');
    setServerUrl(cleanedUrl);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (cleanedUrl === DEFAULT_BASE_URL || !cleanedUrl) {
        window.localStorage.removeItem('custom_api_url');
      } else {
        window.localStorage.setItem('custom_api_url', cleanedUrl);
      }
      Alert.alert('Sucesso', 'Endereço do servidor atualizado! A aplicação se conectará a este endereço.');
    } else {
      Alert.alert('Erro', 'A alteração dinâmica de servidor só é suportada na versão Web e Desktop.');
    }
  };

  const handleEnterPreview = async (plan: string, status: string, trialExpired: boolean) => {
    try {
      let currentToken: string | null = null;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        currentToken = window.localStorage.getItem('jwt_token');
      } else {
        currentToken = await AsyncStorage.getItem('jwt_token');
      }
      if (currentToken && !realToken) {
        setRealToken(currentToken);
      }
      const { token } = await previewPlan(plan, status, trialExpired);
      await setAuthToken(token);
      const profile = await getMe();
      setTenant(profile);
    } catch (err: any) {
      Alert.alert('Erro', 'Não foi possível ativar modo de preview.');
    }
  };

  const handleExitPreview = async () => {
    let tokenToRestore = realToken;
    if (!tokenToRestore) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        tokenToRestore = window.localStorage.getItem('jwt_token_real');
      } else {
        tokenToRestore = await AsyncStorage.getItem('jwt_token_real');
      }
    }
    if (!tokenToRestore) return;
    await setAuthToken(tokenToRestore);
    setRealToken(null);
    try {
      const profile = await getMe();
      setTenant(profile);
    } catch {
      handleLogout();
    }
  };

  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleCheckout = async (planId?: string) => {
    // Se o planId não for fornecido ou se for o objeto de evento do React Native, usa 'business' por padrão
    const finalPlanId = typeof planId === 'string' ? planId : 'business';
    setCheckoutLoading(true);
    try {
      const { url } = await createCheckoutSession(finalPlanId);
      if (Platform.OS === 'web') {
        window.location.href = url;
      } else {
        Linking.openURL(url);
      }
    } catch (err: any) {
      Alert.alert('Erro', err.response?.data?.error || 'Não foi possível iniciar a sessão de pagamento.');
    } finally {
      setCheckoutLoading(false);
    }
  };



  useEffect(() => {
    if (isAuthenticated) {
      loadMessages();
    }
  }, [isAuthenticated, loadMessages]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAuthenticated) {
      interval = setInterval(() => {
        loadMessages(true, undefined, undefined, true);
      }, 15000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAuthenticated, loadMessages]);

  const renderMessageItem = useCallback(({ item }: { item: ScheduledMessage }) => (
    <MessageItem
      item={item}
      onEdit={openEditModal}
      onResend={handleResend}
      onDelete={handleDelete}
    />
  ), [openEditModal, handleResend, handleDelete]);

  if (authLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={styles.loadingText}>Carregando painel SaaS...</Text>
      </View>
    );
  }

  if (!isAuthenticated) {
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

  if (isAuthenticated && tenant?.isTrialExpired) {
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

  return (
    <SafeAreaView style={styles.container}>
      {/* Admin Preview Banner */}
      {(realToken || tenant?.isAdminPreview) && (
        <View style={{ backgroundColor: '#DC2626', paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 13 }}>
            🔧 MODO PREVIEW: {tenant?.status === 'trial' ? 'TRIAL ATIVO' : tenant?.plan?.toUpperCase()}
          </Text>
          <TouchableOpacity
            onPress={handleExitPreview}
            style={{ backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}
          >
            <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 12 }}>Voltar ao Real</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        data={loading ? [] : messages}
        keyExtractor={item => item.id}
        renderItem={renderMessageItem}
        contentContainerStyle={[styles.listContainer, { paddingBottom: 60 }]}
        onRefresh={() => loadMessages(true)}
        refreshing={false}
        onEndReached={() => loadMessages(false)}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <>

        {/* Profile Header Row */}
        <View style={styles.profileHeaderRow}>

          <View>
            <Text style={styles.profileWelcome}>Bem-vindo, <Text style={{ fontWeight: '700' }}>{tenant?.name}</Text>!</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
              <View style={styles.planBadgeContainer}>
                <Text style={styles.planBadgeText}>Plano: {tenant?.plan?.toUpperCase()}</Text>
              </View>
              {tenant?.status === 'trial' && tenant?.trialDaysRemaining !== undefined && (
                <View style={[styles.planBadgeContainer, { backgroundColor: '#FEF3C7', marginLeft: 8 }]}>
                  <Text style={[styles.planBadgeText, { color: '#D97706' }]}>
                    🔥 {tenant.trialDaysRemaining} {tenant.trialDaysRemaining === 1 ? 'dia restante' : 'dias restantes'}
                  </Text>
                </View>
              )}
              {tenant?.plan !== 'business' && (
                <TouchableOpacity
                  style={[
                    styles.planBadgeContainer,
                    {
                      backgroundColor: '#10B981',
                      borderColor: '#059669',
                      marginLeft: 8,
                      flexDirection: 'row',
                      alignItems: 'center'
                    }
                  ]}
                  onPress={() => handleCheckout()}
                  disabled={checkoutLoading}
                >
                  {checkoutLoading ? (
                    <ActivityIndicator size="small" color="#FFF" style={{ marginRight: 4 }} />
                  ) : (
                    <Text style={[styles.planBadgeText, { color: '#FFF' }]}>
                      💳 Assinar Plano BUSINESS
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
            {/* Admin preview controls — visível apenas para admins fora do modo preview */}
            {tenant?.is_admin && !realToken && !tenant?.isAdminPreview && (
              <View style={{ flexDirection: 'row', marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                <TouchableOpacity
                  style={[styles.planBadgeContainer, { backgroundColor: '#FEF3C7', borderColor: '#D97706' }]}
                  onPress={() => handleEnterPreview('business', 'trial', false)}
                >
                  <Text style={[styles.planBadgeText, { color: '#92400E' }]}>🧪 Simular Trial Ativo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.planBadgeContainer, { backgroundColor: '#FEE2E2', borderColor: '#DC2626' }]}
                  onPress={() => handleEnterPreview('business', 'trial', true)}
                >
                  <Text style={[styles.planBadgeText, { color: '#991B1B' }]}>💀 Simular Trial Expirado</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutButtonText}>🚪 Sair</Text>
          </TouchableOpacity>
        </View>

      {/* Filtros de Data */}
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

      {showFilterDatePicker && Platform.OS !== 'web' && (
        <DateTimePicker
          value={customDate ? new Date(customDate + 'T12:00:00') : new Date()}
          mode="date"
          display="default"
          onChange={(event, selectedDate) => {
            setShowFilterDatePicker(false);
            if (selectedDate) {
              const year = selectedDate.getFullYear();
              const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
              const day = String(selectedDate.getDate()).padStart(2, '0');
              handleFilterChange('custom', `${year}-${month}-${day}`);
            }
          }}
        />
      )}

      {/* Modais (sempre renderizados, invisíveis quando fechados) */}
      <AISettingsModal
        visible={showAiSettingsModal}
        onClose={() => setShowAiSettingsModal(false)}
        aiSettings={aiSettings}
      />
      <CalendarPickerModal
        visible={showCalendarPickerModal}
        onClose={() => setShowCalendarPickerModal(false)}
        calendarList={calendarList}
        calendarListLoading={calendarListLoading}
        calendarStatus={calendarStatus}
        onSelectCalendar={handleSelectCalendar}
      />

      {apiError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>⚠️ Sem conexão com o servidor</Text>
          <Text style={styles.errorBannerSubtext}>{apiError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadMessages(true)}>
            <Text style={styles.retryButtonText}>Tentar Novamente</Text>
          </TouchableOpacity>
        </View>
      )}
      {loading && (
        <ActivityIndicator size="large" color="#25D366" style={{ marginVertical: 30 }} />
      )}
          </>
        }
        ListFooterComponent={
          <View>
            {loadingMore && <ActivityIndicator size="small" color="#25D366" style={{ marginVertical: 20 }} />}

            {/* Cards de configuração — abaixo das mensagens */}
            <WhatsappConnectionCard />

            <CalendarIntegrationCard
              onOpenCalendarPicker={handleOpenCalendarPicker}
              onRefreshMessages={() => loadMessages(true)}
            />

            <AISecretaryConsole
              aiSettings={aiSettings}
              onOpenSettings={() => setShowAiSettingsModal(true)}
              onPrefillRequest={(data) => {
                setAiPrefillData(data);
                setModalVisible(true);
              }}
            />

            <WeeklyReportCard
              isAuthenticated={isAuthenticated}
              getWeeklyReportCsvUrl={getWeeklyReportCsvUrl}
            />
          </View>
        }
        ListEmptyComponent={
          !loading && !apiError ? <Text style={styles.emptyText}>Nenhuma mensagem agendada no momento.</Text> : null
        }
      />

      {/* Botão flutuante — apenas mobile */}
      {Platform.OS !== 'web' && <TouchableOpacity
        style={styles.fab}
        onPress={openNewModal}
      >
        <Text style={styles.fabIcon}>+</Text>
        <Text style={styles.fabText}>Novo Agendamento</Text>
      </TouchableOpacity>}

      {/* Modal / Formulário */}
      <MessageSchedulerModal
        visible={modalVisible}
        onClose={handleCloseModal}
        editingMessage={editingMessage}
        isResending={isResending}
        whatsappStatus={whatsappStatus}
        onSaveSuccess={() => loadMessages(true)}
        recipientSelection={recipientSelection}
        onOpenGroups={openGroupsModal}
        onOpenContacts={openContactsModal}
        clearRecipientSelection={() => setRecipientSelection('')}
        prefillData={aiPrefillData}
        onClearPrefill={() => setAiPrefillData(null)}
      />

      {/* Modal de Grupos */}
      {showGroupsModal && (
        <Modal
          visible={true}
          transparent
          animationType="slide"
          onRequestClose={() => setShowGroupsModal(false)}
        >
        <View style={styles.modalOverlay}>
          <View style={styles.modalView}>
            <Text style={styles.modalTitle}>Seus Grupos</Text>

            <TextInput
              style={styles.searchInput}
              placeholder="🔍 Buscar grupo por nome ou ID..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus={Platform.OS === 'web'}
            />

            {groupsLoading ? (
              <ActivityIndicator size="large" color="#25D366" style={{ marginVertical: 20 }} />
            ) : (
              <FlatList
                data={filteredGroups}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.groupItem}
                    onPress={() => {
                      setRecipientSelection(item.id);
                      setShowGroupsModal(false);
                    }}
                  >
                    <Text style={styles.groupItemName}>{item.name}</Text>
                    <Text style={styles.groupItemId}>{item.id}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>Nenhum grupo encontrado.</Text>
                }
                style={{ maxHeight: 300 }}
              />
            )}

            <TouchableOpacity
              style={[styles.button, styles.cancelButton, { marginTop: 15, width: '100%' }]}
              onPress={() => setShowGroupsModal(false)}
            >
              <Text style={styles.buttonText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    )}

      {/* Modal de Contatos */}
      {showContactsModal && (
        <Modal
          visible={true}
          transparent
          animationType="slide"
          onRequestClose={() => setShowContactsModal(false)}
        >
        <View style={styles.modalOverlay}>
          <View style={styles.modalView}>
            <Text style={styles.modalTitle}>Seus Contatos</Text>

            <TextInput
              style={styles.searchInput}
              placeholder="🔍 Buscar contato..."
              value={contactSearchQuery}
              onChangeText={setContactSearchQuery}
              autoFocus={Platform.OS === 'web'}
            />

            {contactsLoading ? (
              <ActivityIndicator size="large" color="#25D366" style={{ marginVertical: 20 }} />
            ) : (
              <FlatList
                data={filteredContacts}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.groupItem}
                    onPress={() => {
                      setRecipientSelection(item.id.replace('@s.whatsapp.net', ''));
                      setShowContactsModal(false);
                    }}
                  >
                    <Text style={styles.groupItemName}>{item.name}</Text>
                    <Text style={styles.groupItemId}>{item.id.replace('@s.whatsapp.net', '')}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>Nenhum contato encontrado.</Text>
                }
                style={{ maxHeight: 300 }}
              />
            )}

            <TouchableOpacity
              style={[styles.button, styles.cancelButton, { marginTop: 15, width: '100%' }]}
              onPress={() => setShowContactsModal(false)}
            >
              <Text style={styles.buttonText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    )}
      {editLoading && (
        <Modal transparent visible={true} animationType="fade">
          <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: '#FFF', padding: 24, borderRadius: 12, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 }}>
              <ActivityIndicator size="large" color="#4F46E5" />
              <Text style={{ fontSize: 14, color: '#1E293B', marginTop: 12, fontWeight: '600' }}>
                Buscando detalhes do agendamento...
              </Text>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ── Auth Screen ──────────────────────────────────────────────
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

  // Brand panel (left, web only)
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

  // Form panel (right)
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
  
  // Perfil e Header
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.base,
    marginTop: spacing.base,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  profileWelcome: {
    fontSize: fontSize.base,
    color: colors.textPrimary,
  },
  planBadgeContainer: {
    backgroundColor: colors.aiMuted,
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.aiBorder,
  },
  planBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.ai,
  },
  logoutButton: {
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  logoutButtonText: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },

  // QR Code Box
  qrCodeBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: 15,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    shadowColor: colors.bgBase,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    width: 230,
    height: 230,
    marginTop: 10,
  },
  qrCodeImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },

  // Badges da Multi-sessão
  waBadgeConnected: {
    backgroundColor: colors.successMuted,
    borderColor: colors.successBorder,
    borderWidth: 1,
  },
  waBadgeConnecting: {
    backgroundColor: colors.warningMuted,
    borderColor: colors.warningBorder,
    borderWidth: 1,
  },
  waBadgeDisconnected: {
    backgroundColor: colors.bgRaised,
    borderColor: colors.borderDefault,
    borderWidth: 1,
  },
  
  // Loading screen
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.bgBase,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    marginTop: spacing.md,
    fontWeight: '500',
  },

  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingTop: Platform.OS === 'android' ? 25 : 0,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 40,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
    letterSpacing: -0.6,
  },
  headerSubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 30,
    paddingHorizontal: spacing.lg,
    lineHeight: 22,
  },
  loader: {
    marginTop: 50,
  },
  errorBanner: {
    backgroundColor: colors.dangerMuted,
    marginHorizontal: spacing.base,
    marginBottom: spacing.base,
    padding: 18,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    alignItems: 'center',
  },
  errorBannerText: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.danger,
    marginBottom: spacing.xs,
  },
  errorBannerSubtext: {
    fontSize: fontSize.sm,
    color: colors.danger,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
  },
  retryButtonText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: fontSize.md,
  },
  listContainer: {
    paddingBottom: 80,
  },
  card: {
    backgroundColor: colors.bgSurface,
    padding: spacing.base,
    borderRadius: radius.xl,
    marginHorizontal: spacing.base,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    shadowColor: colors.bgBase,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 2,
  },
  cardContent: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    marginBottom: 14,
    lineHeight: 22,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineBadge: {
    marginLeft: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  badgeSent: {
    backgroundColor: colors.successMuted,
    borderColor: colors.successBorder,
  },
  badgeTextSent: {
    color: colors.primary,
  },
  badgeFailed: {
    backgroundColor: colors.dangerMuted,
    borderColor: colors.dangerBorder,
  },
  badgeTextFailed: {
    color: colors.danger,
  },
  badgePending: {
    backgroundColor: colors.warningMuted,
    borderColor: colors.warningBorder,
  },
  badgeTextPending: {
    color: colors.warning,
  },
  editButtonCompact: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.sm,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    marginRight: spacing.sm,
  },
  editButtonTextCompact: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  deleteButtonCompact: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerMuted,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  deleteButtonTextCompact: {
    fontSize: fontSize.sm,
    color: colors.danger,
    fontWeight: '600',
  },
  cardRecipient: {
    fontSize: fontSize.md,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  platformIcon: {
    marginRight: spacing.sm - 2,
    fontSize: fontSize.md,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: 10,
    marginTop: spacing.xs,
  },
  cardDate: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  platformSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  platformButton: {
    flex: 0.48,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    backgroundColor: colors.bgRaised,
  },
  activePlatform: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  platformButtonText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  activePlatformText: {
    color: colors.textInverse,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  emptyText: {
    textAlign: 'center',
    color: '#64748B',
    marginTop: 40,
    fontSize: 15,
  },
  fab: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    right: 24,
    bottom: 30,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.base,
    paddingVertical: 14,
    borderRadius: radius.full,
    elevation: 8,
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
  },
  fabIcon: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textInverse,
    marginRight: spacing.sm - 2,
  },
  fabText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.textInverse,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.base,
    zIndex: 9999,
  },
  modalView: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 550,
    shadowColor: colors.bgBase,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  modalTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginBottom: spacing.base,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgRaised,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 15,
    fontSize: fontSize.base,
    color: colors.textPrimary,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: 15,
    fontSize: fontSize.base,
    color: colors.textPrimary,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  datePickerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.base,
  },
  dateButton: {
    backgroundColor: colors.bgRaised,
    padding: 14,
    borderRadius: radius.md,
    flex: 0.48,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  dateButtonText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: fontSize.md,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.base,
  },
  button: {
    padding: 14,
    borderRadius: radius.md,
    flex: 0.48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  submitButton: {
    backgroundColor: colors.primary,
  },
  buttonText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: fontSize.base,
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  selectGroupButton: {
    backgroundColor: colors.bgRaised,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    flex: 0.48,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  selectGroupText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  selectContactButton: {
    backgroundColor: colors.bgRaised,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    flex: 0.48,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  selectContactText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  groupItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  groupItemName: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  groupItemId: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  calendarCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginHorizontal: spacing.base,
    marginTop: 10,
    marginBottom: spacing.base,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    shadowColor: colors.bgBase,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 2,
  },
  calendarCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  calendarCardTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  connectedBadge: {
    backgroundColor: colors.successMuted,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  connectedBadgeText: {
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  calendarCardDescription: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.base,
  },
  calendarConnectButton: {
    backgroundColor: colors.primary,
    padding: 14,
    borderRadius: radius.md,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  calendarConnectButtonText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.md,
  },
  calendarActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 15,
  },
  calendarActionButton: {
    flex: 0.48,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  calendarActionButtonText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.md,
  },
  calendarDisconnectButton: {
    backgroundColor: colors.danger,
    shadowColor: colors.danger,
  },
  aiControlsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 15,
    gap: 12,
  },
  aiSettingBtn: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  aiSettingBtnOn: {
    backgroundColor: colors.aiMuted,
    borderColor: colors.aiBorder,
  },
  aiSettingBtnVoiceOn: {
    backgroundColor: colors.successMuted,
    borderColor: colors.successBorder,
  },
  aiSettingBtnOff: {
    backgroundColor: colors.bgRaised,
    borderColor: colors.borderDefault,
  },
  aiSettingBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  voiceConsole: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    marginTop: 15,
    marginBottom: 15,
  },
  voiceConsoleInput: {
    flex: 1,
    fontSize: fontSize.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm - 2,
    color: colors.textPrimary,
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.sm - 2,
  },
  micButtonListening: {
    backgroundColor: colors.dangerMuted,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  micButtonText: {
    fontSize: fontSize.base,
  },
  voiceSendButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  voiceSendButtonText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.md,
  },
  aiConsoleResponse: {
    backgroundColor: colors.successMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    padding: spacing.base,
    marginTop: 10,
  },
  aiConsoleResponseHeader: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiConsoleResponseText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  aiInstructionsInput: {
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    textAlignVertical: 'top',
    marginTop: 10,
    minHeight: 120,
  },
  calendarSelectorButton: {
    backgroundColor: colors.bgRaised,
    borderRadius: radius.md,
    padding: 14,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  calendarSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  calendarSelectorLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  calendarSelectorValue: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  calendarSelectorArrow: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  calPickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.base,
    zIndex: 9999,
  },
  calPickerContainer: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 500,
    maxHeight: '80%',
    shadowColor: colors.bgBase,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  calPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm - 2,
  },
  calPickerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  calPickerCloseBtn: {
    fontSize: 22,
    color: colors.textMuted,
    padding: spacing.xs,
  },
  calPickerSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: 14,
    lineHeight: 18,
  },
  calPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    marginBottom: spacing.sm,
    backgroundColor: colors.bgRaised,
  },
  calPickerItemSelected: {
    borderColor: colors.borderPrimary,
    backgroundColor: colors.primaryMuted,
    borderWidth: 2,
  },
  calPickerDot: {
    width: 14,
    height: 14,
    borderRadius: radius.full,
    marginRight: spacing.md,
  },
  calPickerItemName: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  calPickerItemNameSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  calPickerItemDesc: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
  calPickerCheck: {
    fontSize: 20,
    color: colors.primary,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
  evtPanelToggle: {
    marginTop: spacing.base,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    alignItems: 'center',
  },
  evtPanelToggleText: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: fontSize.md,
  },
  evtPanel: {
    marginTop: 10,
  },
  evtEmptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: fontSize.sm,
    paddingVertical: 14,
  },
  evtItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgRaised,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  evtItemTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  evtItemTime: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: 3,
  },
  evtToggle: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    marginLeft: 10,
    minWidth: 70,
    alignItems: 'center',
  },
  evtToggleOn: {
    backgroundColor: colors.primary,
  },
  evtToggleOff: {
    backgroundColor: colors.bgBase,
  },
  evtToggleText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: fontSize.sm,
  },
  evtScrollContainer: {
    maxHeight: 250,
  },
  sectionSubtitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    letterSpacing: -0.2,
  },
  gridInstruction: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 16,
  },
  gridDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: colors.bgRaised,
    borderRadius: radius.md,
    padding: spacing.sm - 2,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  gridDayHeader: {
    width: 45,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: colors.borderDefault,
    paddingRight: spacing.sm - 2,
  },
  gridDayLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  gridHoursScroll: {
    flex: 1,
    paddingLeft: spacing.sm - 2,
  },
  gridHourBtn: {
    paddingHorizontal: 10,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgBase,
    marginRight: spacing.sm - 2,
    minWidth: 55,
    alignItems: 'center',
  },
  gridHourBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  gridHourText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  gridHourTextActive: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  aiAssistantCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.aiBorder,
    marginBottom: spacing.base,
    overflow: 'hidden',
  },
  aiAssistantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.aiMuted,
  },
  aiAssistantHeaderTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ai,
  },
  aiAssistantHeaderToggle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.ai,
  },
  aiAssistantContent: {
    padding: spacing.md,
  },
  aiAssistantHelpText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: 10,
    lineHeight: 16,
  },
  aiInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiTextInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: fontSize.md,
    backgroundColor: colors.bgRaised,
    marginRight: spacing.sm,
    color: colors.textPrimary,
  },
  filterCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    padding: spacing.base,
    marginHorizontal: spacing.base,
    marginTop: 10,
    marginBottom: spacing.base,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    shadowColor: colors.bgBase,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 2,
  },
  filterCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  filterTitle: {
    fontSize: fontSize.base + 1,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  filterNewBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterNewBtnText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.sm,
  },
  filterButtonsRow: {
    flexDirection: 'row',
  },
  filterBtn: {
    paddingHorizontal: spacing.base,
    paddingVertical: 10,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 90,
  },
  filterBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterBtnTextActive: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  customDateWebContainer: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: 10,
  },
  customDateWebLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
  },
  // Estilos de Relatório
  reportCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginHorizontal: spacing.base,
    marginTop: 10,
    marginBottom: spacing.base,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    shadowColor: colors.bgBase,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 2,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  reportTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing.base,
    gap: 10,
  },
  kpiCardBase: {
    flex: 1,
    minWidth: '45%',
    padding: spacing.base,
    borderRadius: radius.lg,
    justifyContent: 'center',
    shadowColor: colors.bgBase,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 1,
  },
  kpiTitle: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.75)',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: '#ffffff',
  },
  chartContainer: {
    marginTop: 10,
    marginBottom: spacing.base,
    backgroundColor: colors.bgRaised,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  chartTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  barChartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 140,
    paddingTop: 15,
    paddingBottom: 5,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  barWrapper: {
    width: '60%',
    maxWidth: 24,
    backgroundColor: colors.borderDefault,
    borderRadius: radius.sm,
    height: '100%',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  barFill: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    width: '100%',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  barTooltip: {
    position: 'absolute',
    top: -24,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.sm - 2,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: 'center',
    zIndex: 10,
  },
  barTooltipText: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '700',
  },
  barLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  reportActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.base,
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  csvButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    flex: 1,
    minWidth: 160,
  },
  csvButtonText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.md,
  },
  reportSwitchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgRaised,
    borderRadius: radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    flex: 1,
    minWidth: 200,
  },
  reportSwitchLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  reportSwitchSub: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  switchBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  switchBtnOn: {
    backgroundColor: colors.successMuted,
    borderColor: colors.successBorder,
  },
  switchBtnOff: {
    backgroundColor: colors.bgBase,
    borderColor: colors.borderDefault,
  },
  switchBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  reportSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    paddingBottom: spacing.md,
  },
  reportSearchInput: {
    flex: 1,
    height: 38,
    backgroundColor: colors.bgRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  reportSearchBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reportSearchBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  reportSearchClearBtn: {
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.md,
    height: 38,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reportSearchClearBtnText: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  reportMessagesContainer: {
    marginTop: 18,
    marginBottom: spacing.base,
    backgroundColor: colors.bgRaised,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  reportMessagesTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
    letterSpacing: -0.2,
  },
  reportMessagesList: {
    maxHeight: 240,
  },
  reportMessageItem: {
    backgroundColor: colors.bgBase,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  reportMessageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm - 2,
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  reportMessageRecipient: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    flex: 1,
    minWidth: 120,
  },
  reportMessageBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
  },
  platformBadge: {
    paddingHorizontal: spacing.sm - 2,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  platformBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  platformWhatsapp: {
    backgroundColor: colors.successMuted,
  },
  platformTelegram: {
    backgroundColor: 'rgba(14, 165, 233, 0.12)',
  },
  statusBadge: {
    paddingHorizontal: spacing.sm - 2,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusSent: {
    backgroundColor: colors.successMuted,
  },
  statusFailed: {
    backgroundColor: colors.dangerMuted,
  },
  statusPending: {
    backgroundColor: colors.warningMuted,
  },
  reportMessageContent: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.sm - 2,
  },
  reportMessageDate: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: '500',
  },
  reportNoMessagesText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  imagePickerButton: {
    backgroundColor: colors.aiMuted,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.aiBorder,
    alignItems: 'center',
    width: '100%',
  },
  imagePickerButtonText: {
    color: colors.ai,
    fontWeight: '600',
    fontSize: fontSize.md,
  },
  removeImageButton: {
    position: 'absolute',
    top: -10,
    right: -10,
    backgroundColor: colors.danger,
    width: 24,
    height: 24,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default function App() {
  return (
    <AuthProvider>
      <WhatsappProvider>
        <CalendarProvider>
          <MainDashboard />
        </CalendarProvider>
      </WhatsappProvider>
    </AuthProvider>
  );
}
