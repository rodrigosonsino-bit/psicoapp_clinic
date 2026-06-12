import { AlertCircle, RefreshCw } from 'lucide-react';
import './ErrorState.css';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export default function ErrorState({
  title = 'Algo deu errado',
  message = 'Não foi possível carregar os dados. Verifique sua conexão ou tente novamente mais tarde.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="error-state-container animate-fade-in">
      <div className="error-state-icon-wrapper">
        <AlertCircle size={40} className="error-state-icon" />
      </div>
      <h3 className="error-state-title">{title}</h3>
      <p className="error-state-message">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary mt-4" onClick={onRetry}>
          <RefreshCw size={16} /> Tentar novamente
        </button>
      )}
    </div>
  );
}
