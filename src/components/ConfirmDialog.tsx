import { AlertTriangle, Info, ShieldAlert, X } from 'lucide-react';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;     // default: "Confirmar"
  cancelLabel?: string;      // default: "Cancelar"
  variant?: 'danger' | 'warning' | 'info'; // default: 'danger'
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (variant) {
      case 'danger':
        return <ShieldAlert className="confirm-icon icon-danger" size={28} />;
      case 'warning':
        return <AlertTriangle className="confirm-icon icon-warning" size={28} />;
      case 'info':
      default:
        return <Info className="confirm-icon icon-info" size={28} />;
    }
  };

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-content animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="confirm-close-btn" onClick={onCancel}>
          <X size={18} />
        </button>

        <div className="confirm-header">
          <div className={`confirm-icon-wrapper wrapper-${variant}`}>
            {getIcon()}
          </div>
          <div className="confirm-title-wrapper">
            <h3>{title}</h3>
            <p>{message}</p>
          </div>
        </div>

        <div className="confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn confirm-submit-btn btn-${variant}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
