import { useState } from 'react';
import { Platform, Alert } from 'react-native';
import { getSavedApiUrl, DEFAULT_BASE_URL } from '../services/api';

export function useAuthUI(contextHandleAuth: (mode: 'login' | 'register', email: string, pass: string, name: string) => Promise<void>) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverUrl, setServerUrl] = useState(getSavedApiUrl());

  const handleAuth = async () => {
    await contextHandleAuth(authMode, authEmail, authPassword, authName);
  };

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
      window.location.reload();
    } else {
      Alert.alert('Erro', 'A alteração dinâmica de servidor só é suportada na versão Web e Desktop.');
    }
  };

  return {
    authMode,
    setAuthMode,
    authName,
    setAuthName,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    showServerSettings,
    setShowServerSettings,
    serverUrl,
    setServerUrl,
    handleAuth,
    saveServerUrl
  };
}
