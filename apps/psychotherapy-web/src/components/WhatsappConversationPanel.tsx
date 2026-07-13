import React, { useState, useEffect, useCallback } from 'react';
import { MessageCircle, X, Minus, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';
import { fetchApi } from '../services/api';
import type { WhatsappMessageHistoryEntry, PaginatedResponse } from '../types/api';
import { useToast } from '../context/ToastContext';
import { SkeletonTable } from './Skeleton';

interface WhatsappConversationPanelProps {
  patientId: string;
  patientName: string;
  /** Se definido, recarrega as mensagens nesse intervalo (usado no popup, para pegar respostas
   * seguintes do paciente na mesma sessão de chat). Sem isso, carrega uma vez só. */
  pollIntervalMs?: number;
  /** Estilo compacto (altura limitada com scroll) — usado dentro do popup flutuante. */
  compact?: boolean;
  /** Altura máxima (px) da área de mensagens no modo compacto. Padrão: 260. */
  chatMaxHeight?: number;
  /** Se definido, mostra um botão de fechar no topo do painel. */
  onClose?: () => void;
  /** Se true, esconde o corpo (mensagens + form) mas mantém o componente montado — o polling de
   * novas mensagens continua rodando em segundo plano (ver achado do Codex: desmontar o painel ao
   * minimizar parava silenciosamente de detectar respostas do paciente). */
  minimized?: boolean;
  /** Se definido, mostra um botão de minimizar no topo do painel (só no popup flutuante). */
  onMinimize?: () => void;
  /** Se definido, mostra um botão de maximizar/restaurar no topo do painel (só no popup flutuante). */
  onMaximize?: () => void;
  /** Estado atual de maximização, usado só para escolher o ícone do botão de maximizar. */
  isMaximized?: boolean;
}

/**
 * Histórico de conversa WhatsApp (enviadas + recebidas) + resposta manual — sem nenhuma
 * automação. Reaproveitado tanto na aba "WhatsApp" da ficha do paciente quanto no popup global
 * de mensagem nova.
 */
export function WhatsappConversationPanel({ patientId, patientName, pollIntervalMs, compact, chatMaxHeight, onClose, minimized, onMinimize, onMaximize, isMaximized }: WhatsappConversationPanelProps) {
  const toast = useToast();
  const [messages, setMessages] = useState<WhatsappMessageHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  // Nº de mensagens já vistas da última vez que o painel esteve visível (não minimizado) — a
  // diferença pro total atual vira o badge de "não lidas" enquanto minimizado.
  const [lastSeenCount, setLastSeenCount] = useState(0);
  useEffect(() => {
    if (!minimized) setLastSeenCount(messages.length);
  }, [minimized, messages.length]);
  const unreadWhileMinimized = minimized ? Math.max(0, messages.length - lastSeenCount) : 0;

  const loadMessages = useCallback(async (silent = false) => {
    try {
      const res = await fetchApi<PaginatedResponse<WhatsappMessageHistoryEntry>>(
        `/api/psychotherapy/patients/${patientId}/whatsapp-messages?limit=100`
      );
      setMessages(res.data);
    } catch {
      if (!silent) toast.error('Erro ao carregar conversa do WhatsApp.');
    } finally {
      setLoading(false);
    }
  }, [patientId, toast]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  useEffect(() => {
    if (!pollIntervalMs) return;
    const interval = setInterval(() => loadMessages(true), pollIntervalMs);
    return () => clearInterval(interval);
  }, [pollIntervalMs, loadMessages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = replyText.trim();
    if (!text) return;
    try {
      setSending(true);
      await fetchApi(`/api/psychotherapy/patients/${patientId}/whatsapp-messages`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setReplyText('');
      toast.success('Mensagem enviada.');
      await loadMessages();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao enviar mensagem. A janela de 24h de resposta pode estar fechada.');
    } finally {
      setSending(false);
    }
  };

  const patientNameShort = patientName.split(' ')[0];

  // Mais recente primeiro na API; exibida cronologicamente (mais antiga em cima) como um chat.
  const chronological = [...messages].reverse();

  return (
    <div style={{ maxWidth: compact ? undefined : '640px', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {onClose && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong
            style={{ fontSize: '0.9375rem', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: minimized && onMinimize ? 'pointer' : undefined }}
            onClick={minimized ? onMinimize : undefined}
          >
            {patientName}
            {unreadWhileMinimized > 0 && (
              <span style={{
                background: 'var(--brand-primary)',
                color: 'white',
                borderRadius: '999px',
                fontSize: '0.7rem',
                lineHeight: 1,
                padding: '0.2rem 0.45rem',
              }}>
                {unreadWhileMinimized}
              </span>
            )}
          </strong>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {onMinimize && (
              <button type="button" className="btn-icon" title={minimized ? 'Restaurar' : 'Minimizar'} onClick={onMinimize}>
                {minimized ? <ChevronUp size={16} /> : <Minus size={16} />}
              </button>
            )}
            {onMaximize && (
              <button type="button" className="btn-icon" title={isMaximized ? 'Restaurar' : 'Maximizar'} onClick={onMaximize}>
                {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            )}
            <button type="button" className="btn-icon" title="Fechar" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {!minimized && (
        <>
          {!compact && (
            <p className="text-small" style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Histórico de mensagens enviadas e recebidas via WhatsApp. Responder aqui envia uma mensagem real ao paciente — só funciona dentro da janela de 24h desde a última mensagem dele.
            </p>
          )}

          <div style={compact ? { maxHeight: `${chatMaxHeight ?? 260}px`, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' } : { display: 'contents' }}>
            {loading ? (
              <SkeletonTable rows={4} cols={1} />
            ) : messages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: compact ? '1rem' : '2rem', color: 'var(--text-muted)' }}>
                <MessageCircle size={compact ? 20 : 28} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                <div>Nenhuma mensagem registrada com {patientNameShort} ainda.</div>
              </div>
            ) : (
              chronological.map(msg => (
                <div key={msg.id} style={{ display: 'flex', justifyContent: msg.direction === 'outbound' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '75%',
                    padding: '0.6rem 0.9rem',
                    borderRadius: 'var(--radius-md)',
                    background: msg.direction === 'outbound' ? 'var(--brand-primary)18' : 'var(--bg-panel)',
                    border: '1px solid var(--border-color)',
                  }}>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.5 }}>{msg.body}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem', textAlign: 'right' }}>
                      {msg.direction === 'outbound' ? 'Enviada' : 'Recebida'} · {new Date(msg.occurredAt).toLocaleString('pt-BR')}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
            <textarea
              className="form-control"
              rows={compact ? 1 : 2}
              placeholder={`Escreva uma resposta para ${patientNameShort}...`}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              disabled={sending}
              style={{ resize: 'vertical', flex: 1 }}
            />
            <button type="submit" className="btn btn-primary" disabled={sending || !replyText.trim()} style={{ alignSelf: 'flex-end' }}>
              {sending ? '...' : 'Enviar'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
