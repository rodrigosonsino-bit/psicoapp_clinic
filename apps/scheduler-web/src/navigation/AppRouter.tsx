import React from 'react';
import { LoadingScreen } from '../screens/LoadingScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { BillingBlockedScreen } from '../screens/BillingBlockedScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { useBillingActions } from '../hooks/useBillingActions';
import { useAdminPreview } from '../hooks/useAdminPreview';

import { AppRouterProps } from './types';

export function AppRouter(props: AppRouterProps) {
  const { auth, authUI } = props;
  const { isAuthenticated, authLoading, tenant, realToken, setRealToken, setTenant, handleLogout } = auth;
  const { authMode, setAuthMode, authName, setAuthName, authEmail, setAuthEmail, authPassword, setAuthPassword, handleAuth, showServerSettings, setShowServerSettings, serverUrl, setServerUrl, saveServerUrl } = authUI;

  const { checkoutLoading, handleCheckout } = useBillingActions();
  const { handleEnterPreview, handleExitPreview } = useAdminPreview(realToken, setRealToken, setTenant);

  const onLogout = async () => {
    await handleLogout();
    setAuthEmail('');
    setAuthPassword('');
    setAuthName('');
  };

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return (
      <AuthScreen
        authMode={authMode}
        setAuthMode={setAuthMode}
        authName={authName}
        setAuthName={setAuthName}
        authEmail={authEmail}
        setAuthEmail={setAuthEmail}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        handleAuth={handleAuth}
        showServerSettings={showServerSettings}
        setShowServerSettings={setShowServerSettings}
        serverUrl={serverUrl}
        setServerUrl={setServerUrl}
        saveServerUrl={saveServerUrl}
      />
    );
  }

  if (isAuthenticated && tenant?.isTrialExpired) {
    return (
      <BillingBlockedScreen
        realToken={realToken}
        tenant={tenant}
        handleExitPreview={handleExitPreview}
        handleCheckout={handleCheckout}
        checkoutLoading={checkoutLoading}
        handleLogout={onLogout}
      />
    );
  }

  return (
    <DashboardScreen
      tenant={tenant}
      realToken={realToken}
      handleCheckout={handleCheckout}
      checkoutLoading={checkoutLoading}
      handleEnterPreview={handleEnterPreview}
      handleExitPreview={handleExitPreview}
      handleLogout={onLogout}
    />
  );
}



