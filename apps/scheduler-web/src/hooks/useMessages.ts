import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform, Alert } from 'react-native';
import { ScheduledMessage, getMessages, BASE_URL, deleteMessage, scheduleMessage } from '../services/api';

export function useMessages() {
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
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

  const [modalVisible, setModalVisible] = useState(false);

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

  // Polling automático e carregamento inicial unificados no hook
  useEffect(() => {
    loadMessages();
    const interval = setInterval(() => {
      loadMessages(true, undefined, undefined, true);
    }, 15000);
    return () => clearInterval(interval);
  }, [loadMessages]);

  return {
    messages,
    setMessages,
    loading,
    setLoading,
    apiError,
    setApiError,
    selectedFilter,
    setSelectedFilter,
    customDate,
    setCustomDate,
    showFilterDatePicker,
    setShowFilterDatePicker,
    pageRef,
    loadingMoreRef,
    hasMoreRef,
    loadingMore,
    setLoadingMore,
    editingMessage,
    setEditingMessage,
    isResending,
    setIsResending,
    recipientSelection,
    setRecipientSelection,
    editLoading,
    setEditLoading,
    modalVisible,
    setModalVisible,
    getLocalDateString,
    loadMessages,
    handleFilterChange,
    handleDelete,
    openNewModal,
    handleResend,
    openEditModal,
    handleCloseModal
  };
}
