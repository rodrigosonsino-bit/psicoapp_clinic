import React from 'react';
import { View, Text, Modal, ActivityIndicator } from 'react-native';

export function EditLoadingOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <Modal transparent visible={true} animationType="fade">
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ backgroundColor: '#FFF', padding: 24, borderRadius: 12, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 }}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={{ fontSize: 14, color: '#1E293B', marginTop: 12, fontWeight: '600' }}>
            Buscando detalhes do agendamento...
          </Text>
        </View>
      </View>
    </Modal>
  );
}
