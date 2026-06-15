import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuth } from './AuthContext';
import { 
  getGoogleCalendarStatus, disconnectGoogleCalendar, syncGoogleCalendar, 
  getGoogleAuthUrl, GoogleCalendarStatus 
} from '../services/api';

interface CalendarContextType {
  calendarStatus: GoogleCalendarStatus;
  calendarLoading: boolean;
  syncingCalendar: boolean;
  fetchCalendarStatus: () => Promise<void>;
  connectCalendar: (onSuccess: () => void) => Promise<void>;
  disconnectCalendar: () => Promise<void>;
  syncCalendar: (onSuccess: () => void) => Promise<void>;
  setCalendarStatus: React.Dispatch<React.SetStateAction<GoogleCalendarStatus>>;
}

const CalendarContext = createContext<CalendarContextType | undefined>(undefined);

export function CalendarProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  
  const [calendarStatus, setCalendarStatus] = useState<GoogleCalendarStatus>({ connected: false });
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [syncingCalendar, setSyncingCalendar] = useState(false);
  
  const calendarIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCalendarStatus = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const status = await getGoogleCalendarStatus();
      setCalendarStatus(status);
    } catch (error) {
      console.log('Erro ao obter status do Google Calendar:', error);
    } finally {
      setCalendarLoading(false);
    }
  }, [isAuthenticated]);

  // Clean interval on unmount
  useEffect(() => {
    return () => {
      if (calendarIntervalRef.current) {
        clearInterval(calendarIntervalRef.current);
      }
    };
  }, []);

  // Fetch status on authentication change
  useEffect(() => {
    if (isAuthenticated) {
      fetchCalendarStatus();
    } else {
      setCalendarStatus({ connected: false });
      setCalendarLoading(false);
      if (calendarIntervalRef.current) {
        clearInterval(calendarIntervalRef.current);
        calendarIntervalRef.current = null;
      }
    }
  }, [isAuthenticated, fetchCalendarStatus]);

  const connectCalendar = useCallback(async (onSuccess: () => void) => {
    try {
      if (Platform.OS === 'web') {
        const { url } = await getGoogleAuthUrl();
        window.open(url, '_blank');
        
        // Monitor connection changes safely
        let checks = 0;
        if (calendarIntervalRef.current) {
          clearInterval(calendarIntervalRef.current);
        }
        
        calendarIntervalRef.current = setInterval(async () => {
          checks++;
          try {
            const status = await getGoogleCalendarStatus();
            if (status.connected) {
              setCalendarStatus(status);
              Alert.alert('Sucesso', 'Google Calendar integrado com sucesso!');
              onSuccess();
              if (calendarIntervalRef.current) {
                clearInterval(calendarIntervalRef.current);
                calendarIntervalRef.current = null;
              }
            }
          } catch (e) {
            console.log('Error checking calendar status during handshake:', e);
          }
          if (checks > 12) {
            if (calendarIntervalRef.current) {
              clearInterval(calendarIntervalRef.current);
              calendarIntervalRef.current = null;
            }
          }
        }, 5000);
      } else {
        const redirectUri = Linking.createURL('google-callback');
        const { url } = await getGoogleAuthUrl(Platform.OS, redirectUri);
        
        const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
        
        if (result.type === 'success') {
          const status = await getGoogleCalendarStatus();
          if (status.connected) {
            setCalendarStatus(status);
            Alert.alert('Sucesso', 'Google Calendar integrado com sucesso!');
            onSuccess();
          } else {
            // Fallback check loop in case DB is slightly delayed
            let checks = 0;
            const checkInterval = setInterval(async () => {
              checks++;
              try {
                const retryStatus = await getGoogleCalendarStatus();
                if (retryStatus.connected) {
                  setCalendarStatus(retryStatus);
                  Alert.alert('Sucesso', 'Google Calendar integrado com sucesso!');
                  onSuccess();
                  clearInterval(checkInterval);
                }
              } catch (e) {
                console.log('Error checking status on redirect fallback:', e);
              }
              if (checks >= 5) {
                clearInterval(checkInterval);
              }
            }, 2000);
          }
        }
      }
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível iniciar conexão com Google Calendar.');
    }
  }, []);

  const disconnectCalendar = useCallback(async () => {
    const performDisconnect = async () => {
      try {
        await disconnectGoogleCalendar();
        setCalendarStatus({ connected: false });
        Alert.alert('Sucesso', 'Google Calendar desconectado.');
      } catch (error) {
        Alert.alert('Erro', 'Erro ao desconectar Google Calendar.');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Deseja realmente desconectar sua Agenda Google?')) {
        await performDisconnect();
      }
    } else {
      Alert.alert(
        'Confirmar Desconexão',
        'Deseja realmente desconectar sua Agenda Google?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Desconectar', style: 'destructive', onPress: performDisconnect }
        ]
      );
    }
  }, []);

  const syncCalendar = useCallback(async (onSuccess: () => void) => {
    setSyncingCalendar(true);
    try {
      await syncGoogleCalendar();
      Alert.alert('Sucesso', 'Agenda sincronizada! Seus lembretes foram agendados.');
      onSuccess();
    } catch (error) {
      Alert.alert('Erro', 'Falha ao sincronizar agenda.');
    } finally {
      setSyncingCalendar(false);
    }
  }, []);

  return (
    <CalendarContext.Provider
      value={{
        calendarStatus,
        calendarLoading,
        syncingCalendar,
        fetchCalendarStatus,
        connectCalendar,
        disconnectCalendar,
        syncCalendar,
        setCalendarStatus
      }}
    >
      {children}
    </CalendarContext.Provider>
  );
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  if (context === undefined) {
    throw new Error('useCalendar must be used within a CalendarProvider');
  }
  return context;
}
