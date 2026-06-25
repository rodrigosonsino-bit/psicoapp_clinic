import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useAuth } from './AuthContext';
import { 
  getWhatsappStatus, getWhatsappQr, connectWhatsapp as apiConnectWhatsapp, 
  disconnectWhatsapp as apiDisconnectWhatsapp, getWhatsappPairingCode, 
  WhatsappConnectionStatus 
} from '../services/api';

interface WhatsappContextType {
  whatsappStatus: WhatsappConnectionStatus;
  whatsappQr: string | null;
  whatsappLoading: boolean;
  pairingCode: string | null;
  pairingLoading: boolean;
  setWhatsappStatus: React.Dispatch<React.SetStateAction<WhatsappConnectionStatus>>;
  setWhatsappQr: React.Dispatch<React.SetStateAction<string | null>>;
  fetchWhatsappStatus: () => Promise<void>;
  connectWhatsapp: () => Promise<void>;
  disconnectWhatsapp: () => Promise<void>;
  generatePairingCode: (phone: string) => Promise<void>;
}

const WhatsappContext = createContext<WhatsappContextType | undefined>(undefined);

export function WhatsappProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsappConnectionStatus>({ connected: false, status: 'disconnected', hasQr: false });
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchWhatsappStatus = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const status = await getWhatsappStatus();
      setWhatsappStatus(status);
      
      if (status.status === 'connecting' && status.hasQr) {
        const qrRes = await getWhatsappQr();
        setWhatsappQr(qrRes.qr);
      } else {
        setWhatsappQr(null);
      }
    } catch (err) {
      console.warn('Erro ao carregar status do WhatsApp via HTTP Polling:', err);
    }
  }, [isAuthenticated]);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;
    console.log('Starting HTTP fallback polling for WhatsApp status...');
    // Initial fetch
    fetchWhatsappStatus();
    pollingIntervalRef.current = setInterval(fetchWhatsappStatus, 5000);
  }, [fetchWhatsappStatus]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      console.log('Stopping HTTP fallback polling for WhatsApp status...');
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      startPolling();
    } else {
      stopPolling();
      setWhatsappStatus({ connected: false, status: 'disconnected', hasQr: false });
      setWhatsappQr(null);
      setPairingCode(null);
    }

    return () => {
      stopPolling();
    };
  }, [isAuthenticated, startPolling, stopPolling]);

  const connectWhatsapp = async () => {
    setWhatsappLoading(true);
    try {
      await apiConnectWhatsapp();
      // Polling will naturally pick up the new status
    } catch (err: any) {
      Alert.alert('Erro', err.response?.data?.error || 'Não foi possível iniciar conexão do WhatsApp.');
    } finally {
      setWhatsappLoading(false);
    }
  };

  const disconnectWhatsapp = async () => {
    setWhatsappLoading(true);
    try {
      await apiDisconnectWhatsapp();
      setWhatsappStatus({ connected: false, status: 'disconnected', hasQr: false });
      setWhatsappQr(null);
    } catch (err: any) {
      Alert.alert('Erro', err.response?.data?.error || 'Não foi possível desconectar o WhatsApp.');
    } finally {
      setWhatsappLoading(false);
    }
  };

  const generatePairingCode = async (phone: string) => {
    setPairingLoading(true);
    try {
      // Clean phone number: remove any non-digit chars
      const cleanPhone = phone.replace(/\D/g, '');
      const res = await getWhatsappPairingCode(cleanPhone);
      setPairingCode(res.code);
    } catch (err: any) {
      Alert.alert('Erro', err.response?.data?.error || 'Não foi possível gerar o código de pareamento.');
    } finally {
      setPairingLoading(false);
    }
  };

  return (
    <WhatsappContext.Provider value={{
      whatsappStatus, setWhatsappStatus,
      whatsappQr, setWhatsappQr,
      whatsappLoading,
      pairingCode,
      pairingLoading,
      fetchWhatsappStatus,
      connectWhatsapp,
      disconnectWhatsapp,
      generatePairingCode
    }}>
      {children}
    </WhatsappContext.Provider>
  );
}

export function useWhatsapp() {
  const context = useContext(WhatsappContext);
  if (context === undefined) {
    throw new Error('useWhatsapp must be used within a WhatsappProvider');
  }
  return context;
}
