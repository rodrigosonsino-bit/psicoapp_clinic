import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface AdminPreviewBannerProps {
  realToken: string | null;
  tenant: any;
  handleExitPreview: () => void;
}

export function AdminPreviewBanner({ realToken, tenant, handleExitPreview }: AdminPreviewBannerProps) {
  if (!realToken && !tenant?.isAdminPreview) return null;

  return (
    <View style={{ backgroundColor: '#DC2626', paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 13 }}>
        🔧 MODO PREVIEW: {tenant?.status === 'trial' ? 'TRIAL ATIVO' : tenant?.plan?.toUpperCase()}
      </Text>
      <TouchableOpacity
        onPress={handleExitPreview}
        style={{ backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}
      >
        <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 12 }}>Voltar ao Real</Text>
      </TouchableOpacity>
    </View>
  );
}
