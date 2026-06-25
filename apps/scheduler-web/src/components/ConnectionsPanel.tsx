import React from 'react';
import { View } from 'react-native';
import { WhatsappConnectionCard } from './WhatsappConnectionCard';
import { TelegramConnectionCard } from './TelegramConnectionCard';

export function ConnectionsPanel() {
  return (
    <View style={{ flexDirection: 'row', marginHorizontal: 16, gap: 12, alignItems: 'flex-start', marginBottom: 4 }}>
      <View style={{ flex: 1 }}>
        <WhatsappConnectionCard />
      </View>
      <View style={{ flex: 1 }}>
        <TelegramConnectionCard />
      </View>
    </View>
  );
}
