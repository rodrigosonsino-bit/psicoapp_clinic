import { useState, useMemo } from 'react';
import { Alert } from 'react-native';
import { getWhatsappGroups, WhatsappGroup, getWhatsappContacts, WhatsappContact } from '../services/api';

export function useWhatsappData() {
  const [groups, setGroups] = useState<WhatsappGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [contacts, setContacts] = useState<WhatsappContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState('');

  const fetchGroups = async () => {
    setGroupsLoading(true);
    try {
      const data = await getWhatsappGroups();
      setGroups(data);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível carregar os grupos do WhatsApp. O Backend pode estar desconectado.');
    } finally {
      setGroupsLoading(false);
    }
  };

  const openGroupsModal = () => {
    setSearchQuery('');
    setShowGroupsModal(true);
    if (groups.length === 0) {
      fetchGroups();
    }
  };

  const filteredGroups = useMemo(() => groups.filter(g => 
    g.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    g.id.includes(searchQuery)
  ), [groups, searchQuery]);

  const fetchContacts = async () => {
    setContactsLoading(true);
    try {
      const data = await getWhatsappContacts();
      setContacts(data);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível carregar os contatos do WhatsApp.');
    } finally {
      setContactsLoading(false);
    }
  };

  const openContactsModal = () => {
    setContactSearchQuery('');
    setShowContactsModal(true);
    if (contacts.length === 0) {
      fetchContacts();
    }
  };

  const filteredContacts = useMemo(() => contacts.filter(c => 
    c.name.toLowerCase().includes(contactSearchQuery.toLowerCase()) || 
    c.id.includes(contactSearchQuery)
  ), [contacts, contactSearchQuery]);

  return {
    groups,
    setGroups,
    groupsLoading,
    setGroupsLoading,
    showGroupsModal,
    setShowGroupsModal,
    searchQuery,
    setSearchQuery,
    contacts,
    setContacts,
    contactsLoading,
    setContactsLoading,
    showContactsModal,
    setShowContactsModal,
    contactSearchQuery,
    setContactSearchQuery,
    fetchGroups,
    openGroupsModal,
    filteredGroups,
    fetchContacts,
    openContactsModal,
    filteredContacts
  };
}
