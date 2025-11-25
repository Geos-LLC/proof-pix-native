import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Share, Clipboard, ActivityIndicator, TextInput, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { generateInviteToken } from '../utils/tokens';
import proxyService from '../services/proxyService';
import { PROXY_SERVER_URL } from '../config/proxy';
import { COLORS } from '../constants/rooms';

/**
 * A component for admins to manage their team invites.
 */
export default function InviteManager({ navigation }) {
  const {
    proxySessionId,
    inviteTokens,
    getRemainingInvites,
    canAddMoreInvites,
    addInviteToken,
    removeInviteToken,
    joinTeam,
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
      Alert.alert('Cannot add more invites', 'You have reached your plan limit.');
      return;
    }

    if (!proxySessionId) {
      Alert.alert('Error', 'Proxy session not initialized. Please connect your team first.');
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
        'Invite Generated',
        `A new invite has been created. You can now share it with your team member.`
      );
    } catch (error) {
      console.error('[INVITE] Failed to generate invite token:', error);
      Alert.alert('Error', `Failed to generate invite token: ${error.message}`);
    }
  };

  const handleTestInvite = async (token) => {
    if (!proxySessionId) {
      Alert.alert('Error', 'Proxy session not initialized.');
      return;
    }

    // Show name input modal to simulate complete team setup
    setCurrentTestToken(token);
    setShowNameInput(true);
  };

  const handleTestJoinWithName = async () => {
    if (!testMemberName.trim()) {
      Alert.alert('Name Required', 'Please enter a name to test the team member setup.');
      return;
    }

    if (!currentTestToken || !proxySessionId) {
      Alert.alert('Error', 'Missing invite token or session ID.');
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
          'Team Mode Activated',
          `You have successfully joined the team as "${testMemberName.trim()}". You can switch back to admin mode from Settings to see the connected team member.`,
          [
            {
              text: 'OK',
              onPress: () => {
                // Refresh team members list if possible, then navigate to Home
                fetchTeamMembers().then(() => {
                  if (navigation) {
                    navigation.navigate('Home');
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
        Alert.alert('Error', result.error || 'Failed to join team.');
      }
    } catch (error) {
      console.error('[INVITE] Failed to test invite:', error);
      Alert.alert('Error', 'Failed to join team. Please try again.');
    }
  };

  const handleCopyToken = (token) => {
    // Copy token with sessionId for proxy server (proxy URL is in config)
    const inviteData = `${token}|${proxySessionId}`;
    Clipboard.setString(inviteData);
    Alert.alert('Copied!', 'Invite code copied to clipboard. Share this code with your team member.');
  };

  const handleShareInvite = async (token) => {
    try {
      // Create invite code with token and sessionId for proxy server
      const inviteData = `${token}|${proxySessionId}`;

      // Get App Store links from environment variables
      const iosAppStoreLink = process.env.EXPO_PUBLIC_IOS_APP_STORE_URL || 'https://apps.apple.com/app/proofpix';
      const androidPlayStoreLink = process.env.EXPO_PUBLIC_ANDROID_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.proofpix';

      // Share the instructions message first
      await Share.share({
        message: `Join my ProofPix team!\n\n📱 Download ProofPix:\niOS: ${iosAppStoreLink}\nAndroid: ${androidPlayStoreLink}\n\nAfter installing, open the app, go to "Join Team" and paste the invite code I'll send you next.`,
        title: 'ProofPix Team Invite'
      });

      // After first share completes, ask user if they want to share the code
      Alert.alert(
        'Share Invite Code?',
        'Now share the invite code as a separate message so your team member can easily copy it.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Share Code',
            onPress: async () => {
              await Share.share({
                message: inviteData,
                title: 'ProofPix Invite Code'
              });
            }
          }
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Could not share the invite.');
    }
  };

  const handleDeleteInvite = (token) => {
    Alert.alert(
      'Delete Invite',
      'This will permanently delete this unused invite code. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (proxySessionId) {
                await proxyService.removeInviteToken(proxySessionId, token);
                // console.log('[INVITE] Token removed from proxy server');
              }
              await removeInviteToken(token);
              await fetchTeamMembers();
              Alert.alert('Deleted', 'The invite code has been deleted successfully.');
            } catch (error) {
              console.error('[INVITE] Failed to delete invite token:', error);
              Alert.alert('Error', 'Failed to delete invite code. Please try again.');
            }
          }
        }
      ]
    );
  };

  const renderInviteItem = ({ item }) => (
    <View style={styles.inviteItem}>
      <View style={styles.tokenContainer}>
        <Text style={styles.tokenLabel}>Code:</Text>
        <Text style={styles.inviteToken} selectable>{item}</Text>
      </View>
      <View style={styles.buttonGroup}>
        <TouchableOpacity onPress={() => handleCopyToken(item)} style={styles.actionButton}>
          <Text style={styles.copyButton}>Copy</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleShareInvite(item)} style={styles.actionButton}>
          <Text style={styles.shareButton}>Share</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleTestInvite(item)} style={styles.actionButton}>
          <Text style={styles.testButton}>Test</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDeleteInvite(item)}
          style={[styles.actionButton, styles.deleteButtonContainer]}
        >
          <Text style={styles.deleteButton}>✕</Text>
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
        return 'Joined';
      case 'pending':
        return 'Pending';
      case 'declined':
        return 'Declined';
      default:
        return 'Unknown';
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
          <Text style={styles.memberName}>{item.name || 'Unknown'}</Text>
          <View style={styles.memberMeta}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {statusText}
              </Text>
            </View>
            {item.lastUploadAt && (
              <Text style={styles.memberDate}>
                Last upload: {new Date(item.lastUploadAt).toLocaleDateString()}
              </Text>
            )}
          </View>
          {/* Show invite token if available */}
          {memberToken && (
            <View style={styles.tokenContainer}>
              <Text style={styles.tokenLabel}>Invite Code:</Text>
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
                  'Revoke Invite',
                  'This will revoke the invite token for this team member. They will no longer be able to upload using this code.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Revoke',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          if (proxySessionId) {
                            await proxyService.removeInviteToken(proxySessionId, memberToken);
                            // console.log('[INVITE] Token removed from proxy server');
                          }
                          await removeInviteToken(memberToken);
                          await fetchTeamMembers();
                          Alert.alert('Invite Revoked', 'The invite has been revoked successfully.');
                        } catch (error) {
                          console.error('[INVITE] Failed to revoke invite token:', error);
                          Alert.alert('Error', 'Failed to revoke invite token. Please try again.');
                        }
                      }
                    }
                  ]
                );
              }} 
              style={[styles.actionButton, styles.revokeButtonContainer]}
            >
              <Text style={styles.revokeButton}>Revoke</Text>
            </TouchableOpacity>
          </View>
        )}
        {!hasActiveInvite && memberToken && (
          <Text style={styles.memberNote}>Invite revoked</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Team Invites</Text>
      {(() => {
        const unusedInvites = (inviteTokens || []).filter(token => {
          // Filter out tokens that are already used by team members
          const isUsedByMember = teamMembers.some(member => member.token === token);
          return !isUsedByMember;
        });
        return (
          <Text style={styles.subtitle}>
            You have {unusedInvites.length} unused invite{unusedInvites.length !== 1 ? 's' : ''} remaining.
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
        ListEmptyComponent={<Text>No active invites.</Text>}
        scrollEnabled={false}
      />

      {canAddMoreInvites() && (
        <TouchableOpacity style={styles.generateButton} onPress={handleGenerateInvite}>
          <Text style={styles.generateButtonText}>Generate New Invite</Text>
        </TouchableOpacity>
      )}

      {/* Team Members Section */}
      <View style={styles.teamMembersSection}>
        <Text style={styles.teamMembersTitle}>Team Members</Text>
        {loadingMembers ? (
          <ActivityIndicator size="small" color={COLORS.PRIMARY} style={{ marginVertical: 10 }} />
        ) : teamMembers.length > 0 ? (
          <FlatList
            data={teamMembers}
            renderItem={renderTeamMemberItem}
            keyExtractor={(item) => item.token}
            ListEmptyComponent={<Text style={styles.emptyText}>No team members yet.</Text>}
            scrollEnabled={false}
          />
        ) : (
          <Text style={styles.emptyText}>No team members yet. Share an invite to get started.</Text>
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
            <Text style={styles.modalTitle}>Test Team Member Setup</Text>
            <Text style={styles.modalSubtitle}>
              Enter a name to simulate the complete team member setup process.
            </Text>
            <TextInput
              style={styles.nameInput}
              placeholder="Enter team member name"
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
                <Text style={styles.modalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonJoin]}
                onPress={handleTestJoinWithName}
                disabled={!testMemberName.trim()}
              >
                <Text style={[styles.modalButtonTextJoin, !testMemberName.trim() && styles.modalButtonTextDisabled]}>
                  Join
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 15,
  },
  inviteItem: {
    flexDirection: 'column',
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  tokenContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tokenLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginRight: 8,
  },
  inviteToken: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: '#007bff',
    fontWeight: '600',
    flex: 1,
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
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
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dc3545',
  },
  deleteButton: {
    color: '#dc3545',
    fontSize: 18,
    fontWeight: 'bold',
  },
  deleteButtonContainer: {
    backgroundColor: '#fff',
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
    borderTopColor: '#ddd',
  },
  teamMembersTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  memberItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
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
    color: '#666',
  },
  memberNote: {
    fontSize: 12,
    color: '#dc3545',
    fontStyle: 'italic',
  },
  emptyText: {
    color: '#666',
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
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '80%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: '#f9f9f9',
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
    backgroundColor: '#f0f0f0',
  },
  modalButtonJoin: {
    backgroundColor: COLORS.PRIMARY,
  },
  modalButtonTextCancel: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextJoin: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextDisabled: {
    color: '#999',
  },
});
