import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius, fontSize } from '../theme/tokens';

interface DashboardHeaderProps {
  tenant: any;
  handleLogout: () => void;
}

export function DashboardHeader({ tenant, handleLogout }: DashboardHeaderProps) {
  return (
    <View style={styles.profileHeaderRow}>
      <View>
        <Text style={styles.profileWelcome}>Bem-vindo, <Text style={{ fontWeight: '700' }}>{tenant?.name}</Text>!</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          <View style={styles.planBadgeContainer}>
            <Text style={styles.planBadgeText}>Plano: {tenant?.plan?.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        onPress={handleLogout}
        style={styles.logoutButton}
      >
        <Text style={styles.logoutButtonText}>Sair</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  profileHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    marginTop: 16,
    marginHorizontal: 16,
  },
  profileWelcome: {
    fontSize: 22,
    color: '#1F2937',
  },
  planBadgeContainer: {
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  planBadgeText: {
    color: '#4338CA',
    fontSize: 12,
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  logoutButtonText: {
    color: '#4B5563',
    fontWeight: '600',
    fontSize: 13,
  },
});
