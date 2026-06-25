import { useAuthUI } from '../hooks/useAuthUI';
import { ScheduledMessage } from '../services/api';

export interface AppRouterProps {
  auth: any;
  authUI: ReturnType<typeof useAuthUI>;
}

export interface DashboardScreenProps {
  tenant: any;
  realToken: string | null;
  handleCheckout: (planId?: string) => Promise<void>;
  checkoutLoading: boolean;
  handleEnterPreview: (plan: string, status: string, trialExpired: boolean) => Promise<void>;
  handleExitPreview: () => Promise<void>;
  handleLogout: () => Promise<void>;
}
