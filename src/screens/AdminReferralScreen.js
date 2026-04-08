import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import * as Clipboard from 'expo-clipboard';
import Modal from 'react-native-modal';
import { logReferralEvent } from '../utils/analytics';
import {
  fetchAdminReferralLinks,
  createAdminReferralLink,
  updateAdminReferralLink,
  deactivateAdminReferralLink,
  activateAdminReferralLink,
  generateCode,
  getReferralLinkUrl,
} from '../services/adminReferralService';

const EMPTY_FORM = {
  label: '',
  code: '',
  bonusDays: '15',
  maxUses: '',
  channel: '',
  source: '',
  campaign: '',
  placement: '',
  notes: '',
  expiresAt: '',
};

export default function AdminReferralScreen({ navigation }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formState, setFormState] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [editingLink, setEditingLink] = useState(null);
  const [editForm, setEditForm] = useState({});

  const loadLinks = useCallback(async () => {
    try {
      const data = await fetchAdminReferralLinks();
      setLinks(Array.isArray(data) ? data : (data?.links || []));
    } catch (error) {
      console.error('[AdminReferral] Load error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadLinks();
  };

  const handleGenerateCode = () => {
    setFormState(prev => ({ ...prev, code: generateCode() }));
  };

  const handleCreate = async () => {
    if (submitting) return;
    const code = formState.code.trim().toUpperCase() || generateCode();
    setSubmitting(true);
    try {
      const result = await createAdminReferralLink({ ...formState, code });
      logReferralEvent('admin_link_created', { code, channel: formState.channel, source: formState.source, campaign: formState.campaign });
      setLinks(prev => [result, ...prev]);
      setFormState({ ...EMPTY_FORM });
      setShowCreateForm(false);

      const url = getReferralLinkUrl(result.code || code);
      Alert.alert('Link Created', url, [
        { text: 'Copy', onPress: () => Clipboard.setStringAsync(url) },
        { text: 'OK' },
      ]);
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to create link');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async (code) => {
    const url = getReferralLinkUrl(code);
    await Clipboard.setStringAsync(url);
    Alert.alert('Copied', url);
  };

  const handleToggleActive = async (link) => {
    const wasActive = link.isActive;
    // Optimistic update
    setLinks(prev => prev.map(l => l.id === link.id ? { ...l, isActive: !wasActive } : l));
    try {
      if (wasActive) {
        await deactivateAdminReferralLink(link.id);
        logReferralEvent('admin_link_deactivated', { code: link.code });
      } else {
        await activateAdminReferralLink(link.id);
        logReferralEvent('admin_link_activated', { code: link.code });
      }
    } catch (error) {
      // Revert
      setLinks(prev => prev.map(l => l.id === link.id ? { ...l, isActive: wasActive } : l));
      Alert.alert('Error', error.message || 'Failed to update link');
    }
  };

  const handleEditSave = async () => {
    if (!editingLink) return;
    try {
      const result = await updateAdminReferralLink(editingLink.id, {
        label: editForm.label || null,
        channel: editForm.channel || null,
        source: editForm.source || null,
        campaign: editForm.campaign || null,
        placement: editForm.placement || null,
        notes: editForm.notes || null,
        maxUses: editForm.maxUses ? parseInt(editForm.maxUses, 10) : null,
        bonusTrialDays: parseInt(editForm.bonusDays, 10) || 15,
        expiresAt: editForm.expiresAt || null,
      });
      setLinks(prev => prev.map(l => l.id === editingLink.id ? { ...l, ...result } : l));
      setEditingLink(null);
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to update');
    }
  };

  const openEdit = (link) => {
    setEditForm({
      label: link.label || '',
      channel: link.channel || '',
      source: link.source || '',
      campaign: link.campaign || '',
      placement: link.placement || '',
      notes: link.notes || '',
      maxUses: link.maxUses ? String(link.maxUses) : '',
      bonusDays: String(link.bonusTrialDays || 15),
      expiresAt: link.expiresAt || '',
    });
    setEditingLink(link);
  };

  const renderField = (label, key, stateObj, setStateObj, options = {}) => (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, options.multiline && styles.fieldInputMultiline]}
        value={stateObj[key]}
        onChangeText={(val) => setStateObj(prev => ({ ...prev, [key]: val }))}
        placeholder={options.placeholder || ''}
        placeholderTextColor="#999"
        keyboardType={options.keyboardType || 'default'}
        multiline={options.multiline}
        autoCapitalize={options.autoCapitalize || 'none'}
      />
    </View>
  );

  const renderLinkCard = (link) => {
    const isExpired = link.expiresAt && new Date(link.expiresAt) < new Date();
    const isMaxed = link.maxUses && link.usedCount >= link.maxUses;

    return (
      <View key={link.id} style={[styles.card, !link.isActive && styles.cardInactive]}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardCode}>{link.code}</Text>
          <View style={styles.badgeRow}>
            {link.isActive && !isExpired && !isMaxed ? (
              <View style={[styles.badge, styles.badgeActive]}>
                <Text style={styles.badgeText}>Active</Text>
              </View>
            ) : (
              <View style={[styles.badge, styles.badgeInactive]}>
                <Text style={styles.badgeText}>
                  {isExpired ? 'Expired' : isMaxed ? 'Maxed' : 'Inactive'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {link.label ? <Text style={styles.cardLabel}>{link.label}</Text> : null}

        <View style={styles.cardMeta}>
          {link.channel ? (
            <Text style={styles.metaText}>Channel: {link.channel}</Text>
          ) : null}
          {link.source ? (
            <Text style={styles.metaText}>Source: {link.source}</Text>
          ) : null}
          {link.campaign ? (
            <Text style={styles.metaText}>Campaign: {link.campaign}</Text>
          ) : null}
          <Text style={styles.metaText}>
            Bonus: {link.bonusTrialDays || 15} days
          </Text>
          <Text style={styles.metaText}>
            Uses: {link.usedCount || 0}{link.maxUses ? ` / ${link.maxUses}` : ''}
          </Text>
          {link.lastUsedAt ? (
            <Text style={styles.metaText}>
              Last used: {new Date(link.lastUsedAt).toLocaleDateString()}
            </Text>
          ) : null}
          {link.expiresAt ? (
            <Text style={styles.metaText}>
              Expires: {new Date(link.expiresAt).toLocaleDateString()}
            </Text>
          ) : null}
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnCopy]}
            onPress={() => handleCopyLink(link.code)}
          >
            <Ionicons name="copy-outline" size={16} color="#fff" />
            <Text style={styles.actionBtnText}>Copy Link</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnEdit]}
            onPress={() => openEdit(link)}
          >
            <Ionicons name="pencil-outline" size={16} color="#fff" />
            <Text style={styles.actionBtnText}>Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, link.isActive ? styles.actionBtnDeactivate : styles.actionBtnActivate]}
            onPress={() => handleToggleActive(link)}
          >
            <Ionicons
              name={link.isActive ? 'close-circle-outline' : 'checkmark-circle-outline'}
              size={16}
              color="#fff"
            />
            <Text style={styles.actionBtnText}>
              {link.isActive ? 'Deactivate' : 'Activate'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Referral Links</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowCreateForm(!showCreateForm)}
        >
          <Ionicons name={showCreateForm ? 'close' : 'add'} size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Create Form */}
        {showCreateForm && (
          <View style={styles.createForm}>
            <Text style={styles.formTitle}>Create Referral Link</Text>
            {renderField('Label', 'label', formState, setFormState, { placeholder: 'e.g. Instagram DM campaign' })}

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Public Code</Text>
              <View style={styles.codeInputRow}>
                <TextInput
                  style={[styles.fieldInput, { flex: 1 }]}
                  value={formState.code}
                  onChangeText={(val) => setFormState(prev => ({ ...prev, code: val.toUpperCase() }))}
                  placeholder="Auto-generated if empty"
                  placeholderTextColor="#999"
                  autoCapitalize="characters"
                />
                <TouchableOpacity style={styles.generateBtn} onPress={handleGenerateCode}>
                  <Ionicons name="refresh" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            {renderField('Bonus Trial Days', 'bonusDays', formState, setFormState, { keyboardType: 'numeric', placeholder: '15' })}
            {renderField('Max Uses', 'maxUses', formState, setFormState, { keyboardType: 'numeric', placeholder: 'Unlimited' })}
            {renderField('Channel', 'channel', formState, setFormState, { placeholder: 'e.g. instagram, email, sms' })}
            {renderField('Source', 'source', formState, setFormState, { placeholder: 'e.g. cold outreach, warm lead' })}
            {renderField('Campaign', 'campaign', formState, setFormState, { placeholder: 'e.g. launch_april, cleaners_test_1' })}
            {renderField('Placement', 'placement', formState, setFormState, { placeholder: 'e.g. bio, story, dm (optional)' })}
            {renderField('Notes', 'notes', formState, setFormState, { placeholder: 'Internal notes...', multiline: true })}
            {renderField('Expires At', 'expiresAt', formState, setFormState, { placeholder: 'YYYY-MM-DD (optional)' })}

            <TouchableOpacity
              style={[styles.createBtn, submitting && styles.createBtnDisabled]}
              onPress={handleCreate}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.createBtnText}>Create Link</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Links List */}
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.PRIMARY} style={{ marginTop: 40 }} />
        ) : links.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="link-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No referral links yet</Text>
            <Text style={styles.emptySubtext}>Tap + to create one</Text>
          </View>
        ) : (
          links.map(renderLinkCard)
        )}
      </ScrollView>

      {/* Edit Modal */}
      <Modal
        isVisible={!!editingLink}
        onBackdropPress={() => setEditingLink(null)}
        onSwipeComplete={() => setEditingLink(null)}
        swipeDirection="down"
        style={styles.modal}
      >
        <View style={styles.modalContent}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Edit Link</Text>
          {editingLink && (
            <Text style={styles.modalCode}>{editingLink.code}</Text>
          )}
          <ScrollView style={{ maxHeight: 400 }}>
            {renderField('Label', 'label', editForm, setEditForm)}
            {renderField('Channel', 'channel', editForm, setEditForm)}
            {renderField('Source', 'source', editForm, setEditForm)}
            {renderField('Campaign', 'campaign', editForm, setEditForm)}
            {renderField('Placement', 'placement', editForm, setEditForm)}
            {renderField('Notes', 'notes', editForm, setEditForm, { multiline: true })}
            {renderField('Bonus Days', 'bonusDays', editForm, setEditForm, { keyboardType: 'numeric' })}
            {renderField('Max Uses', 'maxUses', editForm, setEditForm, { keyboardType: 'numeric', placeholder: 'Unlimited' })}
            {renderField('Expires At', 'expiresAt', editForm, setEditForm, { placeholder: 'YYYY-MM-DD' })}
          </ScrollView>
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnEdit, { flex: 1 }]}
              onPress={handleEditSave}
            >
              <Text style={styles.actionBtnText}>Save Changes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnDeactivate, { flex: 1 }]}
              onPress={() => setEditingLink(null)}
            >
              <Text style={styles.actionBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 40 : 10,
    paddingBottom: 12,
    backgroundColor: '#000',
  },
  backBtn: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    fontFamily: FONTS.ALEXANDRIA,
  },
  addBtn: {
    padding: 8,
  },
  scrollView: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // Create Form
  createForm: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
    fontFamily: FONTS.ALEXANDRIA,
    marginBottom: 12,
  },
  fieldRow: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
    fontFamily: FONTS.ALEXANDRIA,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.TEXT,
    backgroundColor: '#fafafa',
    fontFamily: FONTS.ALEXANDRIA,
  },
  fieldInputMultiline: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  codeInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  generateBtn: {
    backgroundColor: COLORS.TEXT,
    borderRadius: 8,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtn: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  createBtnDisabled: {
    opacity: 0.5,
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    fontFamily: FONTS.ALEXANDRIA,
  },

  // Link Cards
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3 },
      android: { elevation: 1 },
    }),
  },
  cardInactive: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardCode: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.TEXT,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeActive: {
    backgroundColor: '#4CAF50',
  },
  badgeInactive: {
    backgroundColor: COLORS.GRAY,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
    marginBottom: 6,
    fontFamily: FONTS.ALEXANDRIA,
  },
  cardMeta: {
    marginBottom: 10,
  },
  metaText: {
    fontSize: 12,
    color: '#888',
    marginBottom: 2,
    fontFamily: FONTS.ALEXANDRIA,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 6,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  actionBtnCopy: {
    backgroundColor: COLORS.PRIMARY,
  },
  actionBtnEdit: {
    backgroundColor: '#2196F3',
  },
  actionBtnDeactivate: {
    backgroundColor: '#E53935',
  },
  actionBtnActivate: {
    backgroundColor: '#4CAF50',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    marginTop: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#999',
    marginTop: 12,
    fontFamily: FONTS.ALEXANDRIA,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 4,
    fontFamily: FONTS.ALEXANDRIA,
  },

  // Edit Modal
  modal: {
    justifyContent: 'flex-end',
    margin: 0,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
    fontFamily: FONTS.ALEXANDRIA,
    marginBottom: 4,
  },
  modalCode: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.PRIMARY,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
});
