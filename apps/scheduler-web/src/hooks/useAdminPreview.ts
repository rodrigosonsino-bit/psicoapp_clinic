import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { previewPlan, getMe, setAuthToken } from '../services/api';

export function useAdminPreview(
  realToken: string | null,
  setRealToken: (token: string | null) => void,
  setTenant: (tenant: any) => void
) {
  const handleEnterPreview = async (plan: string, status: string, trialExpired: boolean) => {
    try {
      let currentToken: string | null = null;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        currentToken = window.localStorage.getItem('jwt_token');
      } else {
        currentToken = await AsyncStorage.getItem('jwt_token');
      }
      if (currentToken && !realToken) {
        setRealToken(currentToken);
      }
      const { token } = await previewPlan(plan, status, trialExpired);
      await setAuthToken(token);
      const profile = await getMe();
      setTenant(profile);
    } catch (err: any) {
      Alert.alert('Erro', 'Não foi possível ativar modo de preview.');
    }
  };

  const handleExitPreview = async () => {
    if (realToken) {
      try {
        await setAuthToken(realToken);
        const profile = await getMe();
        setTenant(profile);
        setRealToken(null);
      } catch (err) {
        Alert.alert('Erro', 'Falha ao restaurar o modo real.');
      }
    }
  };

  return { handleEnterPreview, handleExitPreview };
}
