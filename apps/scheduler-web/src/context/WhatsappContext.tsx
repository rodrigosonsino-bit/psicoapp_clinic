import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useAuth } from './AuthContext';
import { 
  getWhatsappStatus, getWhatsappQr, connectWhatsapp as apiConnectWhatsapp, 
  disconnectWhatsapp as apiDisconnectWhatsapp, getWhatsappPairingCode, 
  WhatsappConnectionStatus 
} from '../services/api';
import { SocketClient } from '../services/socket';

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
  const { isAuthenticated, token } = useAuth();
  
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsappConnectionStatus>({ connected: false, status: 'disconnected', hasQr: false });
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketClientRef = useRef<SocketClient | null>(null);

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

  // Set up WebSocket connection or fallback to polling
  useEffect(() => {
    if (isAuthenticated && token) {
      // Setup WS connection
      console.log('Setting up WebSocket connection...');
      const client = new SocketClient(token, {
        onStatusChanged: (status) => {
          console.log('WS WhatsApp status updated:', status);
          setWhatsappStatus(status);
          if (status.status !== 'connecting' || !status.hasQr) {
            setWhatsappQr(null);
          }
        },
        onQrReceived: (qr) => {
          console.log('WS WhatsApp QR code received');
          setWhatsappQr(qr);
        },
        onConnected: () => {
          console.log('WS WhatsApp client authenticated and listening');
          // If WS is successfully connected, stop fallback polling
          stopPolling();
        },
        onDisconnected: () => {
          console.warn('WS WhatsApp client disconnected. Falling back to HTTP polling.');
          startPolling();
        }
      });

      socketClientRef.current = client;
      client.connect();
    } else {
      // Clear WS client and polling if not authenticated
      if (socketClientRef.current) {
        socketClientRef.current.disconnect();
        socketClientRef.current = null;
      }
      stopPolling();
      // Reset state
      setWhatsappStatus({ connected: false, status: 'disconnected', hasQr: false });
      setWhatsappQr(null);
      setPairingCode(null);
    }

    return () => {
      if (socketClientRef.current) {
        socketClientRef.current.disconnect();
        socketClientRef.current = null;
      }
      stopPolling();
    };
  }, [isAuthenticated, token, startPolling, stopPolling]);

  const connectWhatsapp = useCallback(async () => {
    setWhatsappLoading(true);
    try {
      const res = await apiConnectWhatsapp();
      if (res.success) {
        await fetchWhatsappStatus();
      }
      Alert.alert('Sucesso', res.message);
    } catch (err: any) {
      Alert.alert('Erro', err.response?.data?.error || 'Falha ao inicializar conexão.');
    } finally {
      setWhatsappLoading(false);
    }
  }, [fetchWhatsappStatus]);

  const disconnectWhatsapp = useCallback(async () => {
    setWhatsappLoading(true);
    try {
      const res = await apiDisconnectWhatsapp();
      if (res.success) {
        setWhatsappStatus({ connected: false, status: 'disconnected', hasQr: false });
        setWhatsappQr(null);
        setPairingCode(null);
      }
      Alert.alert('Sucesso', res.message);
    } catch (err: any) {
      Alert.alert('Erro', err.response?.data?.error || 'Falha ao desconectar.');
    } finally {
      setWhatsappLoading(false);
    }
  }, []);

  const generatePairingCode = useCallback(async (phone: string) => {
    if (!phone.trim()) {
      Alert.alert('Atenção', 'Digite o número de telefone com DDI e DDD (Ex: 5518999999999)');
      return;
    }
    
    // Safety check for connecting/connected state
    if (whatsappStatus.connected) {
      Alert.alert('Aviso', 'WhatsApp já está conectado.');
      return;
    }

    setPairingLoading(true);
    try {
      // Safety step: initiate connection first if socket not active
      if (whatsappStatus.status === 'disconnected') {
        await apiConnectWhatsapp();
      }
      const res = await getWhatsappPairingCode(phone);
      if (res.success) {
        setPairingCode(res.code);
        Alert.alert('Código Gerado', `Use o código: ${res.code} para conectar o aparelho.`);
      }
    } catch (err: any) {
      Alert.alert('Erro', err.response?.data?.error || 'Falha ao gerar código de pareamento.');
    } finally {
      setPairingLoading(false);
    }
  }, [whatsappStatus]);

  return (
    <WhatsappContext.Provider
      value={{
        whatsappStatus,
        whatsappQr,
        whatsappLoading,
        pairingCode,
        pairingLoading,
        setWhatsappStatus,
        setWhatsappQr,
        fetchWhatsappStatus,
        connectWhatsapp,
        disconnectWhatsapp,
        generatePairingCode
      }}
    >
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
