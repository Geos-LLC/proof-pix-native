import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import { FEATURES } from '../constants/featurePermissions';
import { FONTS } from '../constants/fonts';
import proxyService from '../services/proxyService';
import { generateInviteToken } from '../utils/tokens';
import { generateInviteLink } from '../utils/inviteLinkGenerator';
import { logTeamInvitesCreated } from '../utils/analytics';

// TeamMembersScreen — dedicated route for team setup + member
// management. Split from the prior combined CloudTeamScreen so the
// cloud-storage flow lives separately in CloudSyncScreen.
//
// Three states the screen handles:
//   1. Plan doesn't include team (Starter / Pro) → upgrade pitch
//   2. Plan includes team but proxy session not yet initialized →
//      "Set up team" prompt that walks through admin sign-in
//   3. Team is set up → list current invites + show member count +
//      "Generate invite" CTA
export default function TeamMembersScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const {
    isAuthenticated,
    accountType,
    proxySessionId,
    teamName,
    teamInfo,
    inviteTokens,
    addInviteToken,
    adminSignIn,
  } = useAdmin();
  const { userPlan } = useSettings();
  const { canUse } = useFeaturePermissions();

  const [isWorkingSetup, setIsWorkingSetup] = useState(false);
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);

  // Gate: use the feature-permission system (trial-aware + tier-aware
  // via effectivePlan) instead of literal string compare on userPlan.
  // Also let through anyone who already has a working proxySessionId —
  // they've clearly already paid + set up team, so even if `userPlan`
  // is stored in some other casing/SKU shape we should NOT paywall
  // them. This was the bug that sent Business-with-team users to
  // PlanSelection when tapping Manage team.
  const hasTeamFeature = !!proxySessionId
    || canUse(FEATURES.TEAM_MANAGEMENT)
    || canUse(FEATURES.TEAM_COLLABORATION);
  const isBusinessOrEnterprise = hasTeamFeature;
  const isTeamReady = !!proxySessionId;
  const googleAdminConnected = isAuthenticated && accountType === 'google';

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!proxySessionId) return;
      try {
        const result = await proxyService.getTeamMembers(proxySessionId);
        if (!mounted) return;
        if (result?.teamMembers) setTeamMembers(result.teamMembers);
      } catch {}
    })();
    return () => { mounted = false; };
  }, [proxySessionId]);

  // Set-up path — for Business/Enterprise users who haven't initialized
  // their team yet. Team mode runs through the admin Google sign-in
  // (adminSignIn from AdminContext), which sets up the proxy session
  // and shared drive on completion.
  const handleSetupTeam = async () => {
    if (isWorkingSetup) return;
    if (!isBusinessOrEnterprise) {
      promptUpgrade();
      return;
    }
    setIsWorkingSetup(true);
    try {
      const result = await adminSignIn();
      if (!result?.success) {
        const errMsg = result?.error || 'Team setup failed';
        if (!/cancel/i.test(String(errMsg))) {
          Alert.alert(t('common.error', { defaultValue: 'Error' }), errMsg);
        }
      }
    } catch (e) {
      const errMsg = e?.message || '';
      if (errMsg && !/cancel/i.test(errMsg)) {
        Alert.alert(t('common.error', { defaultValue: 'Error' }), errMsg);
      }
    } finally {
      setIsWorkingSetup(false);
    }
  };

  const handleGenerateInvite = async () => {
    if (isGeneratingInvite) return;
    if (!isBusinessOrEnterprise) {
      promptUpgrade();
      return;
    }
    if (!proxySessionId) {
      Alert.alert(
        t('teamMembers.setupRequiredTitle', { defaultValue: 'Set up your team first' }),
        t('teamMembers.setupRequiredMessage', {
          defaultValue: "Tap Set up team above to connect your shared Google Drive before generating invites.",
        }),
      );
      return;
    }
    setIsGeneratingInvite(true);
    const newToken = generateInviteToken();
    try {
      await proxyService.addInviteToken(proxySessionId, newToken);
      await addInviteToken(newToken);
      try {
        logTeamInvitesCreated(1, {
          plan: userPlan,
          team_size_before: teamMembers?.length || 0,
          team_size_after: teamMembers?.length || 0,
        });
      } catch {}
      const link = generateInviteLink(newToken, proxySessionId);
      try {
        await Share.share({
          message: `Join ${teamName || 'ProofPix Team'} on ProofPix: ${link}`,
          url: link,
        });
      } catch {}
    } catch (e) {
      Alert.alert(t('common.error', { defaultValue: 'Error' }), e?.message || 'Failed to generate invite');
    } finally {
      setIsGeneratingInvite(false);
    }
  };

  const promptUpgrade = () => {
    Alert.alert(
      t('teamMembers.upgradeTitle', { defaultValue: 'Team requires Business' }),
      t('teamMembers.upgradeMessage', {
        defaultValue: 'Upgrade to Business or Enterprise to set up a team and invite members.',
      }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('teamMembers.upgradeCTA', { defaultValue: 'Upgrade' }),
          onPress: () => navigation.navigate('PlanSelection', { mode: 'upgrade' }),
        },
      ],
    );
  };

  const inviteCount = Array.isArray(inviteTokens) ? inviteTokens.length : 0;
  const memberCount = Array.isArray(teamMembers) ? teamMembers.length : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color="#1E1E1E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('teamMembers.title', { defaultValue: 'Team members' })}</Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.eyebrowRow}>
          <Text style={styles.eyebrow}>{t('teamMembers.team', { defaultValue: 'Team' })}</Text>
          <View style={styles.businessBadge}>
            <Text style={styles.businessBadgeText}>BUSINESS</Text>
          </View>
        </View>

        {!isBusinessOrEnterprise ? (
          // ---- Gate ----
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <Ionicons name="people-outline" size={26} color="#1E1E1E" />
            </View>
            <Text style={styles.heroTitle}>
              {t('teamMembers.gateTitle', { defaultValue: 'Team requires Business' })}
            </Text>
            <Text style={styles.heroSub}>
              {t('teamMembers.gateSub', {
                defaultValue: 'Upgrade to invite members into shared projects with a shared Google Drive folder.',
              })}
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => navigation.navigate('PlanSelection', { mode: 'upgrade' })}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryButtonText}>
                {t('teamMembers.upgradeCTA', { defaultValue: 'Upgrade to Business' })}
              </Text>
            </TouchableOpacity>
          </View>
        ) : !isTeamReady ? (
          // ---- Set up required ----
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <Ionicons name="rocket-outline" size={26} color="#1E1E1E" />
            </View>
            <Text style={styles.heroTitle}>
              {t('teamMembers.setupTitle', { defaultValue: 'Set up your team' })}
            </Text>
            <Text style={styles.heroSub}>
              {t('teamMembers.setupSub', {
                defaultValue:
                  'Connect your admin Google account so members capture into a shared Drive. We\'ll create a "ProofPix Team" folder you control.',
              })}
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleSetupTeam}
              disabled={isWorkingSetup}
              activeOpacity={0.85}
            >
              {isWorkingSetup ? (
                <ActivityIndicator size="small" color="#1E1E1E" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {googleAdminConnected
                    ? t('teamMembers.continueSetup', { defaultValue: 'Continue team setup' })
                    : t('teamMembers.setupCTA', { defaultValue: 'Set up team' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          // ---- Active team ----
          <>
            <View style={styles.statRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{memberCount}</Text>
                <Text style={styles.statLabel}>
                  {t('teamMembers.statMembers', { defaultValue: memberCount === 1 ? 'Member' : 'Members' })}
                </Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{inviteCount}</Text>
                <Text style={styles.statLabel}>
                  {t('teamMembers.statInvites', { defaultValue: inviteCount === 1 ? 'Active invite' : 'Active invites' })}
                </Text>
              </View>
            </View>

            <View style={styles.heroCard}>
              <View style={styles.heroIcon}>
                <Ionicons name="qr-code-outline" size={26} color="#1E1E1E" />
              </View>
              <Text style={styles.heroTitle}>
                {t('teamMembers.inviteTitle', { defaultValue: 'Invite your crew' })}
              </Text>
              <Text style={styles.heroSub}>
                {t('teamMembers.inviteSub', {
                  defaultValue: 'Generate a link to share. Members capture into your shared projects.',
                })}
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleGenerateInvite}
                disabled={isGeneratingInvite}
                activeOpacity={0.85}
              >
                {isGeneratingInvite ? (
                  <ActivityIndicator size="small" color="#1E1E1E" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {t('teamMembers.generateInvite', { defaultValue: 'Generate invite' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {memberCount > 0 ? (
              <>
                <Text style={[styles.eyebrow, { marginTop: 14 }]}>
                  {t('teamMembers.membersList', { defaultValue: 'Members' })}
                </Text>
                <View style={styles.rowGroup}>
                  {teamMembers.map((m, i) => (
                    <View key={m?.id || m?.userId || i} style={styles.row}>
                      <View style={styles.rowIc}>
                        <Ionicons name="person-outline" size={19} color="#1E1E1E" />
                      </View>
                      <View style={styles.rowMeta}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {m?.name || m?.userName || m?.email || `Member ${i + 1}`}
                        </Text>
                        {m?.email && m?.email !== m?.name ? (
                          <Text style={styles.rowSub} numberOfLines={1}>{m.email}</Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 17,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.2,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    marginBottom: 8,
    marginHorizontal: 22,
  },
  eyebrow: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#9A9A9A',
    textTransform: 'uppercase',
    marginHorizontal: 22,
    marginBottom: 8,
  },
  businessBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(30,30,30,0.1)',
  },
  businessBadgeText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 9.5,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: 0.5,
  },

  // Hero card for gate / setup / invite states.
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    marginHorizontal: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: -0.2,
    marginBottom: 6,
    textAlign: 'center',
  },
  heroSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '500',
    color: '#666666',
    letterSpacing: -0.1,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 6,
  },
  primaryButton: {
    alignSelf: 'stretch',
    backgroundColor: '#F2C31B',
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 4,
  },
  primaryButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },

  // Stat cards for active team.
  statRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 18,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  statValue: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 22,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: -0.4,
  },
  statLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
    color: '#9A9A9A',
    letterSpacing: -0.1,
    marginTop: 2,
  },

  // Members list rows.
  rowGroup: { marginHorizontal: 18, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
  },
  rowIc: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMeta: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
  rowSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    color: '#9A9A9A',
    letterSpacing: -0.1,
    marginTop: 1,
  },
});
