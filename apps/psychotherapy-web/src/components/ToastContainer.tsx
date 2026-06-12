import React from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import type { ToastItem, ToastType } from '../context/ToastContext';
import './Toast.css';

interface ToastContainerProps {
  toasts: ToastItem[];
  removeToast: (id: string) => void;
}

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={18} className="toast-icon-svg" />,
  error: <XCircle size={18} className="toast-icon-svg" />,
  info: <Info size={18} className="toast-icon-svg" />,
};

export default function ToastContainer({ toasts, removeToast }: ToastContainerProps) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item toast-${toast.type} animate-slide-in`}>
          <div className="toast-content-wrapper">
            {icons[toast.type]}
            <span className="toast-message">{toast.message}</span>
          </div>
          <button
            type="button"
            className="toast-close-btn"
            onClick={() => removeToast(toast.id)}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
