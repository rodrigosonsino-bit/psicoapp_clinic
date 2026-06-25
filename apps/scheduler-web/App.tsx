import React from 'react';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { WhatsappProvider, useWhatsapp } from './src/context/WhatsappContext';
import { CalendarProvider, useCalendar } from './src/context/CalendarContext';
import { TelegramProvider, useTelegram } from './src/context/TelegramContext';
import { AppRouter } from './src/navigation/AppRouter';
import { useAuthUI } from './src/hooks/useAuthUI';

export function MainDashboard() {
  const auth = useAuth();
  const authUI = useAuthUI(auth.handleAuth);

  return (
    <AppRouter
      auth={auth}
      authUI={authUI}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WhatsappProvider>
        <TelegramProvider>
          <CalendarProvider>
            <MainDashboard />
          </CalendarProvider>
        </TelegramProvider>
      </WhatsappProvider>
    </AuthProvider>
  );
}

