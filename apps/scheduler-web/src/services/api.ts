import axios from 'axios';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_BASE_URL = 'https://whatsapp-scheduler-backend-production-14af.up.railway.app/api';

export const getSavedApiUrl = (): string => {
    // EXPO_PUBLIC_API_URL definido no .env sempre tem prioridade máxima.
    // Isso garante que em desenvolvimento local o backend local seja usado,
    // independente de qualquer URL salva anteriormente no localStorage.
    if (process.env.EXPO_PUBLIC_API_URL) {
        return process.env.EXPO_PUBLIC_API_URL;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const savedUrl = window.localStorage.getItem('custom_api_url');
        if (savedUrl) {
            // Se a URL salva no cache for localhost, mas o desenvolvedor não definiu localhost no .env,
            // limpa do cache e usa a URL padrão do Railway automaticamente.
            if (savedUrl.includes('localhost') || savedUrl.includes('127.0.0.1')) {
                window.localStorage.removeItem('custom_api_url');
                return DEFAULT_BASE_URL;
            }
            return savedUrl;
        }
        return DEFAULT_BASE_URL;
    }
    return DEFAULT_BASE_URL;
};

export const BASE_URL = getSavedApiUrl();

export const api = axios.create({
    baseURL: BASE_URL,
    timeout: 10000,
});

// Axios request interceptor to dynamically fetch the correct baseURL before every request
api.interceptors.request.use((config) => {
    config.baseURL = getSavedApiUrl();
    return config;
});

export type MessagePlatform = 'whatsapp' | 'telegram';
export type RecurrenceType = 'Única' | 'Diariamente' | 'Semanalmente' | 'Quinzenalmente' | 'Mensalmente';

export interface ScheduledMessage {
    id: string;
    content: string;
    recipientId: string;
    recipientName?: string | null;
    sendAt: string;
    status: 'pending' | 'sent' | 'failed';
    createdAt: string;
    platform: MessagePlatform;
    metadata?: { recurrence?: RecurrenceType; imageUrl?: string };
}

export const getSecureImageUrl = (pathOrUrl?: string): string | undefined => {
    if (!pathOrUrl) return undefined;
    if (pathOrUrl.startsWith('http')) return pathOrUrl; // Se já for absoluta
    
    let token = null;
    const authHeader = api.defaults.headers.common['Authorization'] as string;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.replace('Bearer ', '');
    }
    
    // Se não tiver token, tenta carregar normalmente (vai dar 401/403 no backend, mas é fallback esperado)
    if (!token) return `${getSavedApiUrl().replace(/\/api$/, '')}${pathOrUrl}`;
    
    return `${getSavedApiUrl().replace(/\/api$/, '')}${pathOrUrl}?token=${token}`;
};

export interface GetMessagesParams {
    page: number;
    limit: number;
    date?: string;
    startDate?: string;
    endDate?: string;
}

export const getMessages = async (
    page: number = 1, 
    limit: number = 20, 
    date?: string, 
    startDate?: string, 
    endDate?: string
) => {
    const params: GetMessagesParams = { page, limit };
    if (date) params.date = date;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    const response = await api.get<ScheduledMessage[]>('/messages', { params });
    return response.data;
};

export const scheduleMessage = async (content: string, recipientId: string, sendAt: string, platform: MessagePlatform = 'whatsapp', recurrence?: RecurrenceType, imageBase64?: string) => {
    const response = await api.post('/messages', {
        content,
        recipientId,
        sendAt, // expected in UTC ISO format
        platform,
        recurrence,
        imageBase64
    });
    return response.data;
};

export const deleteMessage = async (id: string) => {
    const response = await api.delete(`/messages/${id}`);
    return response.data;
};

export const updateMessage = async (
    id: string,
    fields: { content?: string; recipientId?: string; sendAt?: string; platform?: MessagePlatform; recurrence?: RecurrenceType; imageBase64?: string }
) => {
    const response = await api.patch(`/messages/${id}`, fields);
    return response.data;
};

export interface WhatsappGroup {
    id: string;
    name: string;
}

export const getWhatsappGroups = async () => {
    const response = await api.get<WhatsappGroup[]>('/whatsapp/groups');
    return response.data;
};

export interface WhatsappContact {
    id: string;
    name: string;
}

export const getWhatsappContacts = async () => {
    const response = await api.get<WhatsappContact[]>('/whatsapp/contacts');
    return response.data;
};

// Google Calendar Integration API Calls
export interface GoogleCalendarStatus {
    connected: boolean;
    email?: string;
    isEnabled?: boolean;
    calendarId?: string;
    calendarName?: string;
}

export interface GoogleCalendarItem {
    id: string;
    summary: string;
    description?: string;
    primary?: boolean;
    backgroundColor?: string;
}

export const getGoogleAuthUrl = async (platform?: string, redirectUri?: string) => {
    const response = await api.get<{ url: string }>('/google/auth-url', {
        params: { platform, redirect_uri: redirectUri }
    });
    return response.data;
};

export const getGoogleCalendarStatus = async () => {
    const response = await api.get<GoogleCalendarStatus>('/google/status');
    return response.data;
};

export const listGoogleCalendars = async () => {
    const response = await api.get<{ calendars: GoogleCalendarItem[] }>('/google/calendars');
    return response.data.calendars;
};

export const selectGoogleCalendar = async (calendarId: string, calendarName: string) => {
    const response = await api.post('/google/select-calendar', { calendarId, calendarName });
    return response.data;
};

export const disconnectGoogleCalendar = async () => {
    const response = await api.post('/google/disconnect');
    return response.data;
};

export const syncGoogleCalendar = async () => {
    const response = await api.post('/google/sync');
    return response.data;
};

// Google Calendar Events API
export interface GoogleCalendarEvent {
    id: string;
    summary: string;
    description: string;
    start: string;
    end: string;
    attendees: string[];
    autoSend: boolean;
}

export const getGoogleCalendarEvents = async () => {
    const response = await api.get<{ events: GoogleCalendarEvent[] }>('/google/events');
    return response.data.events;
};

export const toggleEventAutoSend = async (eventId: string, autoSend: boolean, eventSummary?: string, eventStart?: string) => {
    const response = await api.post('/google/events/toggle', { eventId, autoSend, eventSummary, eventStart });
    return response.data;
};

// AI Secretary API Calls
export interface AISecretaryResponse {
    action: 'schedule' | 'rewrite' | 'chat';
    data: {
        recipientId?: string;
        content?: string;
        sendAt?: string;
        platform?: MessagePlatform;
    };
    explanation: string;
}

export const askAISecretary = async (prompt: string, currentContent?: string) => {
    const response = await api.post<AISecretaryResponse>('/ai/secretary', { prompt, currentContent });
    return response.data;
};

export type OfficeHours = Record<string, string[]>;

export interface AISettings {
    enabled: boolean;
    instructions: string;
    officeHours: OfficeHours;
    receiveWeeklyReport?: boolean;
    weeklyReportDay?: string;
    weeklyReportTime?: string;
}

export const getAISettings = async (): Promise<AISettings> => {
    const response = await api.get<AISettings>('/ai/settings');
    return response.data;
};

export const saveAISettings = async (
    enabled: boolean, 
    instructions: string, 
    officeHours: OfficeHours, 
    receiveWeeklyReport?: boolean,
    weeklyReportDay?: string,
    weeklyReportTime?: string
): Promise<void> => {
    await api.post('/ai/settings', { enabled, instructions, officeHours, receiveWeeklyReport, weeklyReportDay, weeklyReportTime });
};

export interface WeeklyReportStats {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    successRate: number;
    dailyStats: { day: string; date: string; count: number }[];
    platformStats: { platform: string; count: number }[];
    sentMessagesList: {
        id: string;
        content: string;
        recipientId: string;
        sendAt: string;
        status: string;
        platform: string;
    }[];
}

export const getWeeklyReport = async (recipientId?: string): Promise<WeeklyReportStats> => {
    const params = recipientId ? { recipientId } : undefined;
    const response = await api.get<WeeklyReportStats>('/messages/report/weekly', { params });
    return response.data;
};

export const getWeeklyReportCsvUrl = (recipientId?: string): string => {
    const baseUrl = `${getSavedApiUrl()}/messages/report/weekly?export=csv`;
    return recipientId ? `${baseUrl}&recipientId=${encodeURIComponent(recipientId)}` : baseUrl;
};

// --- AUTHENTICATION & MULTI-TENANCY SaaS ENDPOINTS ---

export interface TenantProfile {
    id: string;
    name: string;
    email: string;
    plan: string;
    status: string;
    maxMessagesPerMonth: number;
    whatsappConnected: boolean;
    trialDaysRemaining?: number;
    isTrialExpired?: boolean;
    is_admin?: boolean;
    isAdminPreview?: boolean;
    trialExpired?: boolean;
}

export const setAuthToken = async (token: string | null) => {
    if (token) {
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
            window.localStorage.setItem('jwt_token', token);
        } else {
            try {
                await AsyncStorage.setItem('jwt_token', token);
            } catch (e) {
                console.error('AsyncStorage error:', e);
            }
        }
    } else {
        delete api.defaults.headers.common['Authorization'];
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
            window.localStorage.removeItem('jwt_token');
        } else {
            try {
                await AsyncStorage.removeItem('jwt_token');
            } catch (e) {
                console.error('AsyncStorage error:', e);
            }
        }
    }
};

export const login = async (email: string, password: string): Promise<{ token: string }> => {
    const response = await api.post<{ token: string }>('/auth/login', { email, password });
    return response.data;
};

export const register = async (name: string, email: string, password: string): Promise<{ token: string }> => {
    const response = await api.post<{ token: string }>('/auth/register', { name, email, password });
    return response.data;
};

export const getMe = async (): Promise<TenantProfile> => {
    const response = await api.get<TenantProfile>('/auth/me');
    return response.data;
};

export const previewPlan = async (plan: string, status: string, trialExpired: boolean): Promise<{ token: string }> => {
    const response = await api.post<{ token: string }>('/auth/admin/preview-plan', { plan, status, trialExpired });
    return response.data;
};

// --- BILLING & MERCADO PAGO ENDPOINTS ---

export const createCheckoutSession = async (planId?: string): Promise<{ url: string }> => {
    const response = await api.post<{ url: string }>('/billing/checkout', { planId });
    return response.data;
};

export const cancelSubscription = async (): Promise<{ success: boolean }> => {
    const response = await api.post<{ success: boolean }>('/billing/cancel');
    return response.data;
};

export const getSubscription = async (): Promise<any> => {
    const response = await api.get<any>('/billing/subscription');
    return response.data;
};

// --- MULTI-SESSION WHATSAPP CONNECTION ENDPOINTS ---

export interface WhatsappConnectionStatus {
    connected: boolean;
    status: 'connected' | 'connecting' | 'disconnected';
    hasQr: boolean;
}

export const connectWhatsapp = async (): Promise<{ success: boolean; message: string; connected: boolean }> => {
    const response = await api.post<{ success: boolean; message: string; connected: boolean }>('/whatsapp/connect');
    return response.data;
};

export const getWhatsappStatus = async (): Promise<WhatsappConnectionStatus> => {
    const response = await api.get<WhatsappConnectionStatus>('/whatsapp/status');
    return response.data;
};

export const disconnectWhatsapp = async (): Promise<{ success: boolean; message: string }> => {
    const response = await api.post<{ success: boolean; message: string }>('/whatsapp/disconnect');
    return response.data;
};

export const getWhatsappQr = async (): Promise<{ qr: string }> => {
    const response = await api.get<{ qr: string }>('/whatsapp/qr');
    return response.data;
};

export const getWhatsappPairingCode = async (phoneNumber: string): Promise<{ success: boolean; code: string }> => {
    const response = await api.post<{ success: boolean; code: string }>('/whatsapp/pairing-code', { phoneNumber });
    return response.data;
};

// --- TELEGRAM BOT STATUS ---

export interface TelegramStatus {
    connected: boolean;
    botUsername: string | null;
}

export const getTelegramStatus = async (): Promise<TelegramStatus> => {
    const response = await api.get<TelegramStatus>('/telegram/status');
    return response.data;
};

