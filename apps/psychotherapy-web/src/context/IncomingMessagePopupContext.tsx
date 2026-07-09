import React, { useEffect, useState, useCallback } from 'react';
import { fetchApi } from '../services/api';
import { tokenStorage } from '../services/auth';
import { WhatsappConversationPanel } from '../components/WhatsappConversationPanel';

const POLL_INTERVAL_MS = 5000;
const CONVERSATION_POLL_INTERVAL_MS = 5000;

interface UnseenConversation {
  patientId: string;
  patientName: string;
  phone: string | null;
  lastMessageBody: string;
  lastMessageAt: string;
}

interface OpenConversation {
  patientId: string;
  patientName: string;
}

/**
 * Popup global de mensagem recebida — aparece por cima de qualquer página quando um paciente
 * responde, e permite continuar a conversa até ser fechado. Sem automação: é só notificação +
 * atalho para a mesma resposta manual já disponível na ficha do paciente.
 *
 * Usa verificação periódica (polling), não WebSocket — decisão deliberada: o app não tem
 * infraestrutura de tempo real hoje, e para o volume de mensagens de um consultório pequeno um
 * atraso de poucos segundos é imperceptível.
 */
export function IncomingMessagePopupProvider({ children }: { children: React.ReactNode }) {
  const [openConversations, setOpenConversations] = useState<OpenConversation[]>([]);

  const pollUnseen = useCallback(async () => {
    if (!tokenStorage.isAuthenticated()) return;
    try {
      const res = await fetchApi<{ data: UnseenConversation[] }>('/api/psychotherapy/whatsapp-messages/unseen');
      if (res.data.length === 0) return;
      setOpenConversations(prev => {
        const alreadyOpen = new Set(prev.map(c => c.patientId));
        const toAdd = res.data
          .filter(c => !alreadyOpen.has(c.patientId))
          .map(c => ({ patientId: c.patientId, patientName: c.patientName }));
        return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
      });
    } catch {
      // Polling silencioso — mesmo padrão de ProfileSettings.tsx/Patients.tsx: erro de
      // background não deve gerar toast nem interromper o app.
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(pollUnseen, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pollUnseen]);

  const closeConversation = useCallback((patientId: string) => {
    setOpenConversations(prev => prev.filter(c => c.patientId !== patientId));
  }, []);

  return (
    <>
      {children}
      {openConversations.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: '1rem',
            right: '1rem',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            alignItems: 'flex-end',
          }}
        >
          {openConversations.map(conv => (
            <div
              key={conv.patientId}
              className="card"
              style={{
                width: '320px',
                padding: '0.75rem',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
              }}
            >
              <WhatsappConversationPanel
                patientId={conv.patientId}
                patientName={conv.patientName}
                compact
                pollIntervalMs={CONVERSATION_POLL_INTERVAL_MS}
                onClose={() => closeConversation(conv.patientId)}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
