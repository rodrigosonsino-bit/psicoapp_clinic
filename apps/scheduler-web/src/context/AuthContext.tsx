import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthToken, login, register, getMe, TenantProfile } from '../services/api';

// No app desktop (Electron), preferimos o armazenamento criptografado via safeStorage
// (exposto pelo preload.js como window.desktopAPI) em vez de localStorage puro — mesma
// origem que já persiste entre reaberturas do app, mas com o token protegido no disco
// pelas credenciais do usuário do Windows/macOS em vez de texto plano.
const desktopAPI = (): { storeToken: (k: string, v: string) => Promise<boolean>; getToken: (k: string) => Promise<string | null>; deleteToken: (k: string) => Promise<boolean> } | null => {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && (window as any).desktopAPI?.isDesktop) {
    return (window as any).desktopAPI;
  }
  return null;
};

async function persistToken(key: string, value: string): Promise<void> {
  const api = desktopAPI();
  if (api) {
    await api.storeToken(key, value);
    return;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.localStorage.setItem(key, value);
  } else {
    await AsyncStorage.setItem(key, value);
  }
}

async function readToken(key: string): Promise<string | null> {
  const api = desktopAPI();
  if (api) {
    return api.getToken(key);
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.localStorage.getItem(key);
  }
  return AsyncStorage.getItem(key);
}

async function clearToken(key: string): Promise<void> {
  const api = desktopAPI();
  if (api) {
    await api.deleteToken(key);
    return;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.localStorage.removeItem(key);
  } else {
    await AsyncStorage.removeItem(key);
  }
}

interface AuthContextType {
  isAuthenticated: boolean;
  tenant: TenantProfile | null;
  token: string | null;
  authLoading: boolean;
  handleAuth: (mode: 'login' | 'register', email: string, password: string, name?: string) => Promise<void>;
  handleLogout: () => Promise<void>;
  setTenant: React.Dispatch<React.SetStateAction<TenantProfile | null>>;
  setRealToken: (token: string | null) => void;
  realToken: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tenant, setTenant] = useState<TenantProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [realToken, setRealTokenState] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Initialize and load token
  useEffect(() => {
    const bootstrapAsync = async () => {
      let savedToken: string | null = null;
      let savedRealToken: string | null = null;
      try {
        savedToken = await readToken('jwt_token');
        savedRealToken = await readToken('jwt_token_real');

        // Migração única: sessões desktop salvas antes da criptografia via safeStorage
        // ficaram em localStorage puro. Se o armazenamento seguro não tiver nada ainda,
        // aproveita o token velho (evita deslogar todo mundo na primeira abertura pós-update)
        // e já move ele pro armazenamento seguro.
        if (!savedToken && desktopAPI() && Platform.OS === 'web' && typeof window !== 'undefined') {
          const legacyToken = window.localStorage.getItem('jwt_token');
          if (legacyToken) {
            savedToken = legacyToken;
            await persistToken('jwt_token', legacyToken);
            window.localStorage.removeItem('jwt_token');
          }
          const legacyRealToken = window.localStorage.getItem('jwt_token_real');
          if (legacyRealToken) {
            savedRealToken = legacyRealToken;
            await persistToken('jwt_token_real', legacyRealToken);
            window.localStorage.removeItem('jwt_token_real');
          }
        }

        if (savedToken) {
          await setAuthToken(savedToken);
          setToken(savedToken);
          const profile = await getMe();
          setTenant(profile);
          setIsAuthenticated(true);
        }
        if (savedRealToken) {
          setRealTokenState(savedRealToken);
        }
      } catch (e) {
        console.warn('Failed to load jwt token from storage:', e);
      } finally {
        setAuthLoading(false);
      }
    };

    bootstrapAsync();
  }, []);

  const handleAuth = useCallback(async (mode: 'login' | 'register', email: string, password: string, name?: string) => {
    if (!email || !password || (mode === 'register' && !name)) {
      Alert.alert('Erro', 'Por favor, preencha todos os campos.');
      return;
    }

    try {
      const res = mode === 'login'
        ? await login(email, password)
        : await register(name!, email, password);

      await setAuthToken(res.token);
      setToken(res.token);
      await persistToken('jwt_token', res.token);

      const profile = await getMe();
      setTenant(profile);
      setIsAuthenticated(true);
    } catch (err: any) {
      Alert.alert('Erro na Autenticação', err.response?.data?.error || 'Verifique seus dados e tente novamente.');
      throw err;
    }
  }, []);

  const setRealToken = useCallback(async (newToken: string | null) => {
    setRealTokenState(newToken);
    try {
      if (newToken) {
        await persistToken('jwt_token_real', newToken);
      } else {
        await clearToken('jwt_token_real');
      }
    } catch (e) {
      console.warn('Failed to persist jwt_token_real:', e);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await setAuthToken(null);
    setToken(null);
    setIsAuthenticated(false);
    setTenant(null);
    setRealTokenState(null);

    try {
      await clearToken('jwt_token');
      await clearToken('jwt_token_real');
      // Também limpa eventual resíduo em localStorage puro (pré-migração).
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.localStorage.removeItem('jwt_token');
        window.localStorage.removeItem('jwt_token_real');
      }
    } catch (e) {
      console.warn('Failed to clear tokens from storage on logout:', e);
    }
  }, [setRealToken]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        tenant,
        token,
        authLoading,
        handleAuth,
        handleLogout,
        setTenant,
        setRealToken,
        realToken
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
