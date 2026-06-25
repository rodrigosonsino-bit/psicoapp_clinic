import React from 'react';
import { View, Text, Modal, TextInput, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';

interface GroupsModalProps {
  visible: boolean;
  onClose: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  groupsLoading: boolean;
  filteredGroups: { id: string; name: string }[];
  onSelectGroup: (id: string) => void;
}

export function GroupsModal({
  visible,
  onClose,
  searchQuery,
  setSearchQuery,
  groupsLoading,
  filteredGroups,
  onSelectGroup,
}: GroupsModalProps) {
  if (!visible) return null;

  return (
    <Modal
      visible={true}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalView}>
          <Text style={styles.modalTitle}>Seus Grupos</Text>

          <TextInput
            style={styles.searchInput}
            placeholder="🔍 Buscar grupo por nome ou ID..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus={Platform.OS === 'web'}
          />

          {groupsLoading ? (
            <ActivityIndicator size="large" color="#25D366" style={{ marginVertical: 20 }} />
          ) : (
            <FlatList
              data={filteredGroups}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.groupItem}
                  onPress={() => onSelectGroup(item.id)}
                >
                  <Text style={styles.groupItemName}>{item.name}</Text>
                  <Text style={styles.groupItemId}>{item.id}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>Nenhum grupo encontrado.</Text>
              }
              style={{ maxHeight: 300 }}
            />
          )}

          <TouchableOpacity
            style={[styles.button, styles.cancelButton, { marginTop: 15, width: '100%' }]}
            onPress={onClose}
          >
            <Text style={styles.buttonText}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalView: {
    width: '90%',
    maxWidth: 400,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 16,
  },
  searchInput: {
    height: 44,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    marginBottom: 16,
  },
  groupItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    backgroundColor: '#1E293B',
  },
  groupItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  groupItemId: {
    fontSize: 12,
    color: '#94A3B8',
  },
  emptyText: {
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 15,
    marginTop: 20,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  cancelButton: {
    backgroundColor: '#334155',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
