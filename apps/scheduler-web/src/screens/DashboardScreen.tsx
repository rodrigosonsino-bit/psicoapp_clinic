import React from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, SafeAreaView, Platform, StyleSheet, TextInput, ScrollView, Modal, Switch } from 'react-native';
import { colors, spacing, radius, fontSize } from '../theme/tokens';
import { CalendarIntegrationCard } from '../components/CalendarIntegrationCard';
import { AISecretaryConsole } from '../components/AISecretaryConsole';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CalendarPickerModal } from '../components/CalendarPickerModal';
import { AISettingsModal } from '../components/AISettingsModal';
import { WeeklyReportCard } from '../components/WeeklyReportCard';
import { MessageSchedulerModal } from '../components/MessageSchedulerModal';
import { WhatsappConnectionCard } from '../components/WhatsappConnectionCard';
import { TelegramConnectionCard } from '../components/TelegramConnectionCard';
import { DashboardScreenProps } from '../navigation/types';
import { MessageItem } from '../components/MessageItem';
import { useAuth } from '../context/AuthContext';
import { useWhatsapp } from '../context/WhatsappContext';
import { useTelegram } from '../context/TelegramContext';
import { useCalendar } from '../context/CalendarContext';
import { useMessages } from '../hooks/useMessages';
import { useWhatsappData } from '../hooks/useWhatsappData';
import { useCalendarData } from '../hooks/useCalendarData';
import { useAISettings } from '../hooks/useAISettings';
import { useEffect } from 'react';
import { GroupsModal } from '../components/GroupsModal';
import { ContactsModal } from '../components/ContactsModal';
import { EditLoadingOverlay } from '../components/EditLoadingOverlay';
import { DashboardHeader } from '../components/DashboardHeader';
import { AdminPreviewBanner } from '../components/AdminPreviewBanner';
import { PlanStatusBanner } from '../components/PlanStatusBanner';
import { ConnectionsPanel } from '../components/ConnectionsPanel';
import { MessagesFilterPanel } from '../components/MessagesFilterPanel';

export function DashboardScreen(props: DashboardScreenProps) {
  const { tenant, realToken, handleCheckout, checkoutLoading, handleEnterPreview, handleExitPreview, handleLogout } = props;

  const whatsapp = useWhatsapp();
  const telegramData = useTelegram();
  const calendar = useCalendar();

  const messagesData = useMessages();
  const whatsappData = useWhatsappData();
  const calendarData = useCalendarData(calendar.setCalendarStatus);
  const aiSettingsHook = useAISettings(Boolean(tenant));

  
  const { messages, loading, loadMessages, handleFilterChange, selectedFilter, customDate, getLocalDateString, setShowFilterDatePicker, showFilterDatePicker, apiError, loadingMore, setModalVisible, modalVisible, handleCloseModal, editingMessage, isResending, recipientSelection, setRecipientSelection, editLoading, openEditModal, handleResend, handleDelete } = messagesData;
  const { openGroupsModal, openContactsModal, showGroupsModal, setShowGroupsModal, searchQuery, setSearchQuery, groupsLoading, filteredGroups, showContactsModal, setShowContactsModal, contactSearchQuery, setContactSearchQuery, contactsLoading, filteredContacts } = whatsappData;
  const { showCalendarPickerModal, setShowCalendarPickerModal, calendarList, calendarListLoading, handleSelectCalendar, handleOpenCalendarPicker } = calendarData;
  
  const isAuthenticated = true;
  const aiSettings = aiSettingsHook;

  // Local state that was mistakenly removed or passed as undefined props
  const [showAiSettingsModal, setShowAiSettingsModal] = React.useState(false);
  const [aiPrefillData, setAiPrefillData] = React.useState<any>(null);

  // Destructure needed values from contexts
  const { whatsappStatus: whatsappStatus } = whatsapp;
  const { calendarStatus } = calendar;
  const getWeeklyReportCsvUrl = () => `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}/api/whatsapp/weekly-report?format=csv`;

  const openNewModal = () => {
    setRecipientSelection('');
    setAiPrefillData(null);
    messagesData.openNewModal();
  };

  // TODO: (Dívida Técnica) Mover a lógica de polling (useEffect) para dentro do `useMessages` ou `useMessagePolling`
  useEffect(() => {
    loadMessages();
    const interval = setInterval(() => {
      loadMessages(true, undefined, undefined, true);
    }, 15000);
    return () => clearInterval(interval);
  }, [loadMessages]);

  const renderMessageItem = React.useCallback(({ item }: any) => {
    return (
      <MessageItem
        item={item}
        onEdit={openEditModal}
        onResend={handleResend}
        onDelete={handleDelete}
      />
    );
  }, [openEditModal, handleResend, handleDelete]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Admin Preview Banner */}
      <AdminPreviewBanner
        realToken={realToken}
        tenant={tenant}
        handleExitPreview={handleExitPreview}
      />

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
            <DashboardHeader tenant={tenant} handleLogout={handleLogout} />
            <PlanStatusBanner
              tenant={tenant}
              checkoutLoading={checkoutLoading}
              handleCheckout={handleCheckout}
              realToken={realToken}
              handleEnterPreview={handleEnterPreview}
            />
            <MessagesFilterPanel
              openNewModal={openNewModal}
              selectedFilter={selectedFilter}
              handleFilterChange={handleFilterChange}
              setShowFilterDatePicker={setShowFilterDatePicker}
              customDate={customDate}
              getLocalDateString={getLocalDateString}
            />
          </>
        }
        ListFooterComponent={
          <View>
            {loadingMore && <ActivityIndicator size="small" color="#25D366" style={{ marginVertical: 20 }} />}
            <ConnectionsPanel />
            <CalendarIntegrationCard
              onOpenCalendarPicker={handleOpenCalendarPicker}
              onRefreshMessages={() => loadMessages(true)}
            />
            <AISecretaryConsole
              aiSettings={aiSettingsHook}
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
        aiSettings={aiSettingsHook}
      />
      <CalendarPickerModal
        visible={showCalendarPickerModal}
        onClose={() => setShowCalendarPickerModal(false)}
        calendarList={calendarList}
        calendarListLoading={calendarListLoading}
        calendarStatus={calendarStatus}
        onSelectCalendar={handleSelectCalendar}
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

      {/* Modais Extraídos */}
      <GroupsModal
        visible={showGroupsModal}
        onClose={() => setShowGroupsModal(false)}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        groupsLoading={groupsLoading}
        filteredGroups={filteredGroups}
        onSelectGroup={(id) => {
          setRecipientSelection(id);
          setShowGroupsModal(false);
        }}
      />

      <ContactsModal
        visible={showContactsModal}
        onClose={() => setShowContactsModal(false)}
        searchQuery={contactSearchQuery}
        setSearchQuery={setContactSearchQuery}
        contactsLoading={contactsLoading}
        filteredContacts={filteredContacts}
        onSelectContact={(id) => {
          setRecipientSelection(id);
          setShowContactsModal(false);
        }}
      />

      <EditLoadingOverlay visible={editLoading} />
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











