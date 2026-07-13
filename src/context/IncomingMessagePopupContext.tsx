import React, { useEffect, useState, useCallback } from 'react';
import { fetchApi } from '../services/api';
import { tokenStorage } from '../services/auth';
import { WhatsappConversationPanel } from '../components/WhatsappConversationPanel';

const POLL_INTERVAL_MS = 5000;
const CONVERSATION_POLL_INTERVAL_MS = 5000;

/**
 * Prefixos de rota PÚBLICA (sem login) — o provider é montado na raiz do app (envolve tudo,
 * inclusive essas rotas), mas nunca deve chamar a API autenticada nelas. Um token antigo/expirado
 * ainda presente no navegador do PACIENTE (ex: mesmo aparelho já usado pra acessar o painel antes)
 * faria o 401 do polling disparar o redirecionamento global de "sessão expirada" (fetchApi.ts) e
 * chutar o paciente pra tela de login no meio do fluxo público de confirmação de agendamento.
 */
const PUBLIC_ROUTE_PREFIXES = ['/auth', '/confirm/', '/book/', '/self-book/'];

function isOnPublicRoute(): boolean {
  return PUBLIC_ROUTE_PREFIXES.some(prefix => window.location.pathname.startsWith(prefix));
}

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
  minimized: boolean;
  maximized: boolean;
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
    if (isOnPublicRoute() || !tokenStorage.isAuthenticated()) return;
    try {
      const res = await fetchApi<{ data: UnseenConversation[] }>('/api/psychotherapy/whatsapp-messages/unseen');
      if (res.data.length === 0) return;
      setOpenConversations(prev => {
        const alreadyOpen = new Set(prev.map(c => c.patientId));
        const toAdd = res.data
          .filter(c => !alreadyOpen.has(c.patientId))
          .map(c => ({ patientId: c.patientId, patientName: c.patientName, minimized: false, maximized: false }));
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

  const toggleMinimize = useCallback((patientId: string) => {
    setOpenConversations(prev => prev.map(c =>
      c.patientId === patientId ? { ...c, minimized: !c.minimized, maximized: false } : c
    ));
  }, []);

  const toggleMaximize = useCallback((patientId: string) => {
    setOpenConversations(prev => prev.map(c =>
      c.patientId === patientId ? { ...c, maximized: !c.maximized, minimized: false } : c
    ));
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
                width: conv.maximized ? '480px' : '320px',
                padding: '0.75rem',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                transition: 'width 0.15s ease',
              }}
            >
              {/* Sempre montado, mesmo minimizado — o polling de novas mensagens (pollIntervalMs)
                  precisa continuar rodando em segundo plano; desmontar ao minimizar fazia respostas
                  do paciente passarem despercebidas até o usuário restaurar manualmente (achado de
                  auditoria via Codex CLI). Minimizado, o próprio painel esconde o corpo e mostra só
                  o cabeçalho + badge de não lidas. */}
              <WhatsappConversationPanel
                patientId={conv.patientId}
                patientName={conv.patientName}
                compact
                minimized={conv.minimized}
                chatMaxHeight={conv.maximized ? 480 : 260}
                pollIntervalMs={CONVERSATION_POLL_INTERVAL_MS}
                onClose={() => closeConversation(conv.patientId)}
                onMinimize={() => toggleMinimize(conv.patientId)}
                onMaximize={() => toggleMaximize(conv.patientId)}
                isMaximized={conv.maximized}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
