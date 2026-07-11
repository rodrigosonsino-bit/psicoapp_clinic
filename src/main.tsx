import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ToastProvider } from './context/ToastContext';
import { IncomingMessagePopupProvider } from './context/IncomingMessagePopupContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <IncomingMessagePopupProvider>
        <App />
      </IncomingMessagePopupProvider>
    </ToastProvider>
  </React.StrictMode>,
);
