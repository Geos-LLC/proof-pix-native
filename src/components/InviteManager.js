import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Share, Clipboard, ActivityIndicator, TextInput, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { generateInviteToken } from '../utils/tokens';
import proxyService from '../services/proxyService';
import { PROXY_SERVER_URL } from '../config/proxy';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { useTheme } from '../hooks/useTheme';
import { generateInviteLink, generateShareContent, generateInviteCode } from '../utils/inviteLinkGenerator';

/**
 * A component for admins to manage their team invites.
 */
export default function InviteManager({ navigation }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const {
    proxySessionId,
    inviteTokens,
    getRemainingInvites,
    canAddMoreInvites,
    addInviteToken,
    removeInviteToken,
    joinTeam,
    teamName,
  } = useAdmin();
  
  const { updateUserInfo, reloadSettings } = useSettings();

  const [teamMembers, setTeamMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [testMemberName, setTestMemberName] = useState('');
  const [currentTestToken, setCurrentTestToken] = useState(null);

  // Fetch team members
  const fetchTeamMembers = async () => {
    // console.log('[INVITE_MANAGER] fetchTeamMembers called, proxySessionId:', proxySessionId);
    if (proxySessionId) {
      setLoadingMembers(true);
      try {
        // console.log('[INVITE_MANAGER] Fetching team members from proxy...');
        const result = await proxyService.getTeamMembers(proxySessionId);
        // console.log('[INVITE_MANAGER] Team members result:', result);
        if (result.success && result.teamMembers) {
          // console.log('[INVITE_MANAGER] Setting team members:', result.teamMembers.length, 'members');
          setTeamMembers(result.teamMembers);
        } else {
          // console.log('[INVITE_MANAGER] No team members found or result not successful');
          setTeamMembers([]);
        }
      } catch (error) {
        console.error('[INVITE_MANAGER] Failed to fetch team members:', error);
        setTeamMembers([]);
      } finally {
        setLoadingMembers(false);
      }
    } else {
      // console.log('[INVITE_MANAGER] No proxySessionId, clearing team members');
      setTeamMembers([]);
    }
  };

  useEffect(() => {
    if (!proxySessionId) return;
    
    // Fetch team members when component mounts, session changes, or when switching back from team mode
    // No need for constant polling - team members are fetched when invites are generated/revoked
    fetchTeamMembers();
  }, [proxySessionId]);

  // Also fetch when component becomes visible again (e.g., when switching back from team member mode)
  useEffect(() => {
    // Fetch team members when navigation is focused (user returns to Settings screen)
    const unsubscribe = navigation?.addListener?.('focus', () => {
      if (proxySessionId) {
        fetchTeamMembers();
      }
    });

    return unsubscribe;
  }, [navigation, proxySessionId]);

  const handleGenerateInvite = async () => {
    if (!canAddMoreInvites()) {
      Alert.alert(t('inviteManager.limitReachedTitle'), t('inviteManager.limitReachedMessage'));
      return;
    }

    if (!proxySessionId) {
      Alert.alert(t('common.error'), t('inviteManager.sessionNotInitializedMessage'));
      return;
    }

    const newToken = generateInviteToken();

    try {
      // console.log('[INVITE] Generating invite token...', { proxySessionId, newToken });

      // Add token to proxy server
      await proxyService.addInviteToken(proxySessionId, newToken);
      // console.log('[INVITE] Token added to proxy server');

      // Save token locally
      await addInviteToken(newToken);
      // console.log('[INVITE] Invite token generated and saved successfully');

      // Refresh team members list
      await fetchTeamMembers();

      Alert.alert(
        t('inviteManager.generatedTitle'),
        t('inviteManager.generatedMessage')
      );
    } catch (error) {
      console.error('[INVITE] Failed to generate invite token:', error);
      Alert.alert(t('common.error'), t('inviteManager.generateErrorMessage', { error: error.message }));
    }
  };

  const handleTestInvite = async (token) => {
    if (!proxySessionId) {
      Alert.alert(t('common.error'), t('inviteManager.sessionNotInitializedMessage'));
      return;
    }

    // Show name input modal to simulate complete team setup
    setCurrentTestToken(token);
    setShowNameInput(true);
  };

  const handleTestJoinWithName = async () => {
    if (!testMemberName.trim()) {
      Alert.alert(t('inviteManager.nameRequiredTitle'), t('inviteManager.nameRequiredMessage'));
      return;
    }

    if (!currentTestToken || !proxySessionId) {
      Alert.alert(t('common.error'), t('inviteManager.missingTokenMessage'));
      setShowNameInput(false);
      return;
    }

    setShowNameInput(false);
    
    try {
      // Update settings with the test member name temporarily
      const settingsKey = 'app-settings';
      const storedSettings = await AsyncStorage.getItem(settingsKey);
      const settings = storedSettings ? JSON.parse(storedSettings) : {};
      const originalName = settings.userName || '';
      
      // Temporarily set the test member name
      await AsyncStorage.setItem(settingsKey, JSON.stringify({
        ...settings,
        userName: testMemberName.trim()
      }));

      // console.log('[INVITE] Testing invite by joining team:', { 
      //   token: currentTestToken, 
      //   proxySessionId,
      //   memberName: testMemberName.trim()
      // });

      const result = await joinTeam(currentTestToken, proxySessionId);
      
      if (result.success) {
        // Update SettingsContext with the team member name so it's displayed correctly
        await updateUserInfo(testMemberName.trim());
        // console.log('[INVITE] Updated SettingsContext with team member name:', testMemberName.trim());
        
        Alert.alert(
          t('inviteManager.teamModeActivatedTitle'),
          t('inviteManager.teamModeActivatedMessage', { name: testMemberName.trim() }),
          [
            {
              text: t('common.ok'),
              onPress: () => {
                // Refresh team members list if possible, then navigate to Home
                fetchTeamMembers().then(() => {
                  if (navigation) {
                    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                  }
                });
              }
            }
          ]
        );
        setTestMemberName('');
        setCurrentTestToken(null);
      } else {
        // Restore original name if join failed
        await AsyncStorage.setItem(settingsKey, JSON.stringify({
          ...settings,
          userName: originalName
        }));
        // Also restore in SettingsContext
        if (originalName) {
          await updateUserInfo(originalName);
        }
        Alert.alert(t('common.error'), result.error || t('inviteManager.joinFailedMessage'));
      }
    } catch (error) {
      console.error('[INVITE] Failed to test invite:', error);
      Alert.alert(t('common.error'), t('inviteManager.joinErrorMessage'));
    }
  };

  const handleCopyLink = (token) => {
    // Generate the smart invite link
    const inviteLink = generateInviteLink(token, proxySessionId);
    Clipboard.setString(inviteLink);
    Alert.alert(t('inviteManager.linkCopiedTitle'), t('inviteManager.linkCopiedMessage'));
  };

  const handleCopyCode = (token) => {
    // Copy just the invite code for manual entry
    const inviteCode = generateInviteCode(token, proxySessionId);
    Clipboard.setString(inviteCode);
    Alert.alert(t('inviteManager.codeCopiedTitle'), t('inviteManager.codeCopiedMessage'));
  };

  const handleShareInvite = async (token) => {
    try {
      // Generate the smart share content with invite link
      const shareContent = generateShareContent(token, proxySessionId, teamName);

      // Share the message with the invite link
      await Share.share({
        message: shareContent.message,
        title: shareContent.title
      });
    } catch (error) {
      if (error.message !== 'User did not share') {
        Alert.alert(t('common.error'), t('inviteManager.shareErrorMessage'));
      }
    }
  };

  const handleDeleteInvite = (token) => {
    Alert.alert(
      t('inviteManager.deleteInviteTitle'),
      t('inviteManager.deleteInviteMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              if (proxySessionId) {
                await proxyService.removeInviteToken(proxySessionId, token);
                // console.log('[INVITE] Token removed from proxy server');
              }
              await removeInviteToken(token);
              await fetchTeamMembers();
              Alert.alert(t('inviteManager.deletedTitle'), t('inviteManager.deletedMessage'));
            } catch (error) {
              console.error('[INVITE] Failed to delete invite token:', error);
              Alert.alert(t('common.error'), t('inviteManager.deleteErrorMessage'));
            }
          }
        }
      ]
    );
  };

  const renderInviteItem = ({ item }) => (
    <View style={styles.inviteItem}>
      <View style={styles.tokenContainer}>
        <Text style={styles.tokenLabel}>{t('inviteManager.inviteTokenLabel')}</Text>
        <Text style={styles.inviteToken} selectable>{item}</Text>
      </View>
      <View style={styles.buttonGroup}>
        <TouchableOpacity onPress={() => handleCopyLink(item)} style={styles.actionButton}>
          <Text style={styles.copyButton}>{t('inviteManager.copyLinkButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleShareInvite(item)} style={styles.actionButton}>
          <Text style={styles.shareButton}>{t('inviteManager.shareButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDeleteInvite(item)}
          style={[styles.actionButton, styles.deleteButtonContainer]}
        >
          <Text style={styles.deleteButton}>✕</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.secondaryButtonGroup}>
        <TouchableOpacity onPress={() => handleCopyCode(item)} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{t('inviteManager.copyCodeOnlyButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleTestInvite(item)} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{t('inviteManager.testButton')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const getStatusColor = (status) => {
    switch (status) {
      case 'joined':
        return '#28a745';
      case 'pending':
        return '#ffc107';
      case 'declined':
        return '#dc3545';
      default:
        return '#6c757d';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'joined':
        return t('inviteManager.statusJoined');
      case 'pending':
        return t('inviteManager.statusPending');
      case 'declined':
        return t('inviteManager.statusDeclined');
      default:
        return t('inviteManager.statusUnknown');
    }
  };

  const renderTeamMemberItem = ({ item }) => {
    // If member has a token, treat as joined (they've used the invite)
    // Otherwise, they might be pending
    const memberStatus = item.token ? 'joined' : (item.status || 'pending');
    const statusColor = getStatusColor(memberStatus);
    const statusText = getStatusText(memberStatus);
    
    // The team member item should have a token field from the proxy server
    // This is the invite token they used to join
    const memberToken = item.token;
    const hasActiveInvite = memberToken && inviteTokens?.includes(memberToken);
    
    return (
      <View style={styles.memberItem}>
        <View style={styles.memberInfo}>
          <Text style={styles.memberName}>{item.name || t('inviteManager.unknownMember')}</Text>
          <View style={styles.memberMeta}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {statusText}
              </Text>
            </View>
            {item.lastUploadAt && (
              <Text style={styles.memberDate}>
                {t('inviteManager.lastUpload', { date: new Date(item.lastUploadAt).toLocaleDateString() })}
              </Text>
            )}
          </View>
          {/* Show invite token if available */}
          {memberToken && (
            <View style={styles.tokenContainer}>
              <Text style={styles.tokenLabel}>{t('inviteManager.inviteCodeLabel')}</Text>
              <Text style={styles.inviteToken} selectable>{memberToken}</Text>
            </View>
          )}
        </View>
        {/* Show revoke button if member has an active invite token */}
        {memberToken && hasActiveInvite && (
          <View style={styles.buttonGroup}>
            <TouchableOpacity 
              onPress={async () => {
                Alert.alert(
                  t('inviteManager.revokeInviteTitle'),
                  t('inviteManager.revokeInviteMessage'),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('inviteManager.revokeButton'),
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          if (proxySessionId) {
                            await proxyService.removeInviteToken(proxySessionId, memberToken);
                            // console.log('[INVITE] Token removed from proxy server');
                          }
                          await removeInviteToken(memberToken);
                          await fetchTeamMembers();
                          Alert.alert(t('inviteManager.revokedTitle'), t('inviteManager.revokedMessage'));
                        } catch (error) {
                          console.error('[INVITE] Failed to revoke invite token:', error);
                          Alert.alert(t('common.error'), t('inviteManager.revokeErrorMessage'));
                        }
                      }
                    }
                  ]
                );
              }}
              style={[styles.actionButton, styles.revokeButtonContainer]}
            >
              <Text style={styles.revokeButton}>{t('inviteManager.revokeButton')}</Text>
            </TouchableOpacity>
          </View>
        )}
        {!hasActiveInvite && memberToken && (
          <Text style={styles.memberNote}>{t('inviteManager.inviteRevoked')}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('inviteManager.title')}</Text>
      {(() => {
        const unusedInvites = (inviteTokens || []).filter(token => {
          // Filter out tokens that are already used by team members
          const isUsedByMember = teamMembers.some(member => member.token === token);
          return !isUsedByMember;
        });
        return (
          <Text style={styles.subtitle}>
            {t('inviteManager.unusedInvitesMessage', { count: unusedInvites.length, plural: unusedInvites.length !== 1 ? 's' : '' })}
          </Text>
        );
      })()}

      <FlatList
        data={(inviteTokens || []).filter(token => {
          // Filter out tokens that are already used by team members
          // Only show invites that haven't been used yet
          const isUsedByMember = teamMembers.some(member => member.token === token);
          return !isUsedByMember;
        })}
        renderItem={renderInviteItem}
        keyExtractor={(item) => item}
        ListEmptyComponent={<Text>{t('inviteManager.noActiveInvites')}</Text>}
        scrollEnabled={false}
      />

      {canAddMoreInvites() && (
        <TouchableOpacity style={styles.generateButton} onPress={handleGenerateInvite}>
          <Text style={styles.generateButtonText}>{t('inviteManager.generateNewInviteButton')}</Text>
        </TouchableOpacity>
      )}

      {/* Team Members Section */}
      <View style={styles.teamMembersSection}>
        <Text style={styles.teamMembersTitle}>{t('inviteManager.teamMembersTitle')}</Text>
        {loadingMembers ? (
          <ActivityIndicator size="small" color={COLORS.PRIMARY} style={{ marginVertical: 10 }} />
        ) : teamMembers.length > 0 ? (
          <FlatList
            data={teamMembers}
            renderItem={renderTeamMemberItem}
            keyExtractor={(item) => item.token}
            ListEmptyComponent={<Text style={styles.emptyText}>{t('inviteManager.noTeamMembers')}</Text>}
            scrollEnabled={false}
          />
        ) : (
          <Text style={styles.emptyText}>{t('inviteManager.noTeamMembersShareInvite')}</Text>
        )}
      </View>

      {/* Name Input Modal for Testing */}
      <Modal
        visible={showNameInput}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowNameInput(false);
          setTestMemberName('');
          setCurrentTestToken(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('inviteManager.testTeamMemberTitle')}</Text>
            <Text style={styles.modalSubtitle}>
              {t('inviteManager.testTeamMemberSubtitle')}
            </Text>
            <TextInput
              style={styles.nameInput}
              placeholder={t('inviteManager.memberNamePlaceholder')}
              placeholderTextColor={COLORS.GRAY}
              value={testMemberName}
              onChangeText={setTestMemberName}
              autoFocus={true}
              onSubmitEditing={handleTestJoinWithName}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setShowNameInput(false);
                  setTestMemberName('');
                  setCurrentTestToken(null);
                }}
              >
                <Text style={styles.modalButtonTextCancel}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonJoin]}
                onPress={handleTestJoinWithName}
                disabled={!testMemberName.trim()}
              >
                <Text style={[styles.modalButtonTextJoin, !testMemberName.trim() && styles.modalButtonTextDisabled]}>
                  {t('inviteManager.joinButton')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: {
    marginTop: 20,
    padding: 15,
    backgroundColor: theme.surface,
    borderRadius: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
    color: theme.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 15,
  },
  inviteItem: {
    flexDirection: 'column',
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 10,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  tokenContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tokenLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
    marginRight: 8,
  },
  inviteToken: {
    fontSize: 13,
    fontFamily: FONTS.ALEXANDRIA,
    color: '#007bff',
    fontWeight: '600',
    flex: 1,
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 8,
  },
  secondaryButtonGroup: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  secondaryButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: theme.surface,
    alignItems: 'center',
  },
  copyButton: {
    color: '#28a745',
    fontSize: 13,
    fontWeight: '600',
  },
  shareButton: {
    color: '#007bff',
    fontSize: 13,
    fontWeight: '600',
  },
  testButton: {
    color: '#28a745',
    fontSize: 13,
    fontWeight: '600',
  },
  revokeButton: {
    color: '#dc3545',
    fontSize: 13,
    fontWeight: '600',
  },
  revokeButtonContainer: {
    backgroundColor: theme.surfaceElevated,
    borderWidth: 1,
    borderColor: '#dc3545',
  },
  deleteButton: {
    color: '#dc3545',
    fontSize: 18,
    fontWeight: 'bold',
  },
  deleteButtonContainer: {
    backgroundColor: theme.surfaceElevated,
    borderWidth: 1,
    borderColor: '#dc3545',
    paddingHorizontal: 8,
    maxWidth: 40,
  },
  generateButton: {
    backgroundColor: '#007bff',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 15,
  },
  generateButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  teamMembersSection: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  teamMembersTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: theme.textPrimary,
  },
  memberItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 10,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.textPrimary,
    marginBottom: 8,
  },
  memberMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  memberDate: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  memberNote: {
    fontSize: 12,
    color: '#dc3545',
    fontStyle: 'italic',
  },
  emptyText: {
    color: theme.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: theme.surfaceElevated,
    borderRadius: 12,
    padding: 20,
    width: '80%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    color: theme.textPrimary,
  },
  modalSubtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 16,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: theme.surface,
    color: theme.textPrimary,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: theme.surface,
  },
  modalButtonJoin: {
    backgroundColor: COLORS.PRIMARY,
  },
  modalButtonTextCancel: {
    color: theme.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextJoin: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextDisabled: {
    color: theme.textMuted,
  },
});
