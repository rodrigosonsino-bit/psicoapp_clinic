import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.tsx';
import { ToastProvider } from './context/ToastContext';
import { IncomingMessagePopupProvider } from './context/IncomingMessagePopupContext';
import { initSentry } from './utils/sentry';
import { ErrorFallback } from './components/ErrorFallback';
import './index.css';

initSentry();

createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
}).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <ToastProvider>
        <IncomingMessagePopupProvider>
          <App />
        </IncomingMessagePopupProvider>
      </ToastProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
