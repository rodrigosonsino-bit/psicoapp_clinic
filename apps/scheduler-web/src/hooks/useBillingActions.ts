import { useState } from 'react';
import { Platform, Linking, Alert } from 'react-native';
import { createCheckoutSession } from '../services/api';

export function useBillingActions() {
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleCheckout = async (planId?: string) => {
    const finalPlanId = typeof planId === 'string' ? planId : 'business';
    setCheckoutLoading(true);
    try {
      const { url } = await createCheckoutSession(finalPlanId);
      if (Platform.OS === 'web') {
        window.location.href = url;
      } else {
        Linking.openURL(url);
      }
    } catch (err: any) {
      Alert.alert('Erro', err.response?.data?.error || 'Não foi possível iniciar a sessão de pagamento.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  return { checkoutLoading, handleCheckout };
}
