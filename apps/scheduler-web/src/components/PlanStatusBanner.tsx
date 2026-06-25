import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, radius, spacing, fontSize } from '../theme/tokens';

interface PlanStatusBannerProps {
  tenant: any;
  checkoutLoading: boolean;
  handleCheckout: () => void;
  realToken: string | null;
  handleEnterPreview: (plan: string, status: string, expired: boolean) => void;
}

export function PlanStatusBanner({ tenant, checkoutLoading, handleCheckout, realToken, handleEnterPreview }: PlanStatusBannerProps) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: -16, marginBottom: 20, marginHorizontal: 16, flexWrap: 'wrap' }}>
        {tenant?.status === 'trial' && tenant?.trialDaysRemaining !== undefined && (
          <View style={[styles.planBadgeContainer, { backgroundColor: '#FEF3C7', marginRight: 8 }]}>
            <Text style={[styles.planBadgeText, { color: '#D97706' }]}>
              🔥 {tenant.trialDaysRemaining} {tenant.trialDaysRemaining === 1 ? 'dia restante' : 'dias restantes'}
            </Text>
          </View>
        )}
        {tenant?.plan !== 'business' && (
          <TouchableOpacity
            style={[
              styles.planBadgeContainer,
              {
                backgroundColor: '#10B981',
                borderColor: '#059669',
                flexDirection: 'row',
                alignItems: 'center'
              }
            ]}
            onPress={handleCheckout}
            disabled={checkoutLoading}
          >
            {checkoutLoading ? (
              <ActivityIndicator size="small" color="#FFF" style={{ marginRight: 4 }} />
            ) : (
              <Text style={[styles.planBadgeText, { color: '#FFF' }]}>
                ⭐ Assinar / Upgrade
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Admin preview controls */}
      {tenant?.is_admin && !realToken && !tenant?.isAdminPreview && (
        <View style={{ flexDirection: 'row', marginBottom: 20, marginHorizontal: 16, flexWrap: 'wrap', gap: 6 }}>
          <TouchableOpacity
            style={[styles.planBadgeContainer, { backgroundColor: '#FEF3C7', borderColor: '#D97706' }]}
            onPress={() => handleEnterPreview('business', 'trial', false)}
          >
            <Text style={[styles.planBadgeText, { color: '#92400E' }]}>🧪 Simular Trial Ativo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.planBadgeContainer, { backgroundColor: '#FEE2E2', borderColor: '#DC2626' }]}
            onPress={() => handleEnterPreview('business', 'trial', true)}
          >
            <Text style={[styles.planBadgeText, { color: '#991B1B' }]}>💀 Simular Trial Expirado</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  planBadgeContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  planBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
