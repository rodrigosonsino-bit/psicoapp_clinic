import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthToken, login, register, getMe, TenantProfile } from '../services/api';

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
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          savedToken = window.localStorage.getItem('jwt_token');
          savedRealToken = window.localStorage.getItem('jwt_token_real');
        } else {
          savedToken = await AsyncStorage.getItem('jwt_token');
          savedRealToken = await AsyncStorage.getItem('jwt_token_real');
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

      // Persist token
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.localStorage.setItem('jwt_token', res.token);
      } else {
        await AsyncStorage.setItem('jwt_token', res.token);
      }

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
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.localStorage.setItem('jwt_token_real', newToken);
        } else {
          await AsyncStorage.setItem('jwt_token_real', newToken);
        }
      } else {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.localStorage.removeItem('jwt_token_real');
        } else {
          await AsyncStorage.removeItem('jwt_token_real');
        }
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
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.localStorage.removeItem('jwt_token');
        window.localStorage.removeItem('jwt_token_real');
      } else {
        await AsyncStorage.removeItem('jwt_token');
        await AsyncStorage.removeItem('jwt_token_real');
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
