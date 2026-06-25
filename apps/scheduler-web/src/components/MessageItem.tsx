import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { ScheduledMessage, getSecureImageUrl } from '../services/api';

const statusTextDict = {
  pending: 'Pendente',
  sent: 'Enviado',
  failed: 'Falhou'
};

interface MessageItemProps {
  item: ScheduledMessage;
  onEdit: (item: ScheduledMessage) => void;
  onResend: (item: ScheduledMessage) => void;
  onDelete: (id: string) => void;
}

export const MessageItem = memo(({ item, onEdit, onResend, onDelete }: MessageItemProps) => {
  const localDateObj = new Date(item.sendAt);
  const dateFormatted = localDateObj.toLocaleDateString();
  const timeFormatted = localDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerLeft}>
          <Text style={styles.platformIcon}>{item.platform === 'telegram' ? '🔹' : '💬'}</Text>
          <Text style={styles.cardRecipient}>
            Para: {item.recipientName ?? item.recipientId}
          </Text>
          <View style={[
            styles.inlineBadge, 
            item.status === 'sent' ? styles.badgeSent :
            item.status === 'failed' ? styles.badgeFailed : styles.badgePending
          ]}>
            <Text style={[
              styles.statusText,
              item.status === 'sent' ? styles.badgeTextSent :
              item.status === 'failed' ? styles.badgeTextFailed : styles.badgeTextPending
            ]}>{statusTextDict[item.status]}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {(item.status === 'pending' || item.status === 'sent') && (
            <TouchableOpacity onPress={() => onEdit(item)} style={styles.editButtonCompact}>
              <Text style={styles.editButtonTextCompact}>Editar</Text>
            </TouchableOpacity>
          )}
          {item.status === 'sent' && (
            <TouchableOpacity onPress={() => onResend(item)} style={[styles.editButtonCompact, { backgroundColor: '#EEF2FF', borderColor: '#4F46E5', marginLeft: 6 }]}>
              <Text style={[styles.editButtonTextCompact, { color: '#4F46E5' }]}>🔁 Reenviar</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => onDelete(item.id)} style={styles.deleteButtonCompact}>
            <Text style={styles.deleteButtonTextCompact}>Excluir</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.cardContent}>{item.content}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.cardDate}>📅 Agendado para {dateFormatted} às {timeFormatted}</Text>
        {item.metadata?.recurrence && (
          <Text style={{ fontSize: 12, color: '#4F46E5', fontWeight: 'bold', marginTop: 4 }}>
            🔁 {item.metadata.recurrence}
          </Text>
        )}
        {item.metadata?.imageUrl && (
          <Text 
            style={{ fontSize: 12, color: '#10B981', fontWeight: 'bold', marginTop: 4 }}
            onPress={() => {
                const url = getSecureImageUrl(item.metadata?.imageUrl);
                if (url) Linking.openURL(url);
            }}
          >
            🖼️ Ver Anexo
          </Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  platformIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  cardRecipient: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginRight: 8,
  },
  inlineBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeSent: {
    backgroundColor: '#DCFCE7',
  },
  badgeFailed: {
    backgroundColor: '#FEE2E2',
  },
  badgePending: {
    backgroundColor: '#FEF3C7',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextSent: {
    color: '#15803D',
  },
  badgeTextFailed: {
    color: '#B91C1C',
  },
  badgeTextPending: {
    color: '#B45309',
  },
  editButtonCompact: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#F8FAFC',
  },
  editButtonTextCompact: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  deleteButtonCompact: {
    marginLeft: 6,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FEF2F2',
  },
  deleteButtonTextCompact: {
    fontSize: 11,
    color: '#DC2626',
    fontWeight: '600',
  },
  cardContent: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 10,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  cardDate: {
    fontSize: 12,
    color: '#64748B',
  },
});
