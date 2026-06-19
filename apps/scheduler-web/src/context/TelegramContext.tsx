import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { getTelegramStatus, TelegramStatus } from '../services/api';

interface TelegramContextType {
    telegramStatus: TelegramStatus;
    fetchTelegramStatus: () => Promise<void>;
}

const TelegramContext = createContext<TelegramContextType | undefined>(undefined);

export function TelegramProvider({ children }: { children: React.ReactNode }) {
    const { isAuthenticated } = useAuth();
    const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>({
        connected: false,
        botUsername: null,
    });

    const fetchTelegramStatus = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            const status = await getTelegramStatus();
            setTelegramStatus(status);
        } catch (err) {
            console.warn('Erro ao carregar status do Telegram:', err);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated) {
            setTelegramStatus({ connected: false, botUsername: null });
            return;
        }
        fetchTelegramStatus();
        const interval = setInterval(fetchTelegramStatus, 30000);
        return () => clearInterval(interval);
    }, [isAuthenticated, fetchTelegramStatus]);

    return (
        <TelegramContext.Provider value={{ telegramStatus, fetchTelegramStatus }}>
            {children}
        </TelegramContext.Provider>
    );
}

export function useTelegram() {
    const context = useContext(TelegramContext);
    if (context === undefined) {
        throw new Error('useTelegram must be used within a TelegramProvider');
    }
    return context;
}
