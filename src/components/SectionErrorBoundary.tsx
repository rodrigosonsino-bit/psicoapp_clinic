import * as Sentry from '@sentry/react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  /** Nome curto da seção, só para o texto do aviso (ex: "Séries recorrentes vencendo"). */
  label: string;
  children: ReactNode;
}

/**
 * Isola uma seção do Dashboard (ou qualquer página com múltiplos cartões independentes)
 * do resto da árvore: um erro de render dentro dela vira um aviso inline discreto em vez
 * de derrubar a página inteira via o Error Boundary raiz (main.tsx).
 *
 * Achado real (2026-08-20): um RangeError de formatação de data dentro do cartão "Séries
 * recorrentes vencendo" propagou até o boundary raiz e quebrou o Dashboard inteiro — as
 * outras seções (receitas, sessões de hoje, gráfico) não tinham nenhum problema, mas
 * ficaram inacessíveis junto. Mesma limitação de exibição do ErrorFallback raiz: nunca
 * mostra error.message/stack (pode conter dado clínico/pessoal em componentStack de telas
 * que renderizam prontuário — LGPD art. 11).
 */
export function SectionErrorBoundary({ label, children }: Props) {
  return (
    <Sentry.ErrorBoundary
      fallback={
        <div
          className="card"
          style={{
            padding: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: 'var(--text-muted)',
          }}
        >
          <AlertTriangle size={18} color="var(--status-warning)" />
          <span className="text-small">
            Não foi possível carregar "{label}". Recarregue a página para tentar de novo.
          </span>
        </div>
      }
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
