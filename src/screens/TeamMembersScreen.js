import React, { useEffect, useState, useMemo } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import { FEATURES } from '../constants/featurePermissions';
import { FONTS } from '../constants/fonts';
import proxyService from '../services/proxyService';
import googleDriveService from '../services/googleDriveService';
import googleAuthService from '../services/googleAuthService';
import { generateInviteToken } from '../utils/tokens';
import { generateInviteLink, generateShareContent } from '../utils/inviteLinkGenerator';
import { logTeamInvitesCreated } from '../utils/analytics';
import { useTheme } from '../hooks/useTheme';

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
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const {
    isAuthenticated,
    accountType,
    proxySessionId,
    teamName,
    teamInfo,
    inviteTokens,
    addInviteToken,
    removeInviteToken,
    adminSignIn,
    initializeProxySession,
    saveFolderId,
    updateTeamName,
    userInfo: adminUserInfo,
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

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState(null);

  const fetchMembers = async (opts = {}) => {
    if (!proxySessionId) return;
    if (opts.userInitiated) setIsRefreshing(true);
    try {
      const result = await proxyService.getTeamMembers(proxySessionId);
      console.log('[TeamMembers] getTeamMembers result:', JSON.stringify({
        success: result?.success,
        count: result?.teamMembers?.length || 0,
        teamMembers: result?.teamMembers,
      }));
      if (result?.teamMembers) setTeamMembers(result.teamMembers);
      setLastFetchAt(Date.now());
    } catch (e) {
      console.warn('[TeamMembers] fetchMembers failed:', e?.message);
      if (opts.userInitiated) {
        Alert.alert(
          t('common.error', { defaultValue: 'Error' }),
          e?.message || 'Could not refresh from server',
        );
      }
    } finally {
      if (opts.userInitiated) setIsRefreshing(false);
    }
  };

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

  // Revoke a member or pending invite — removes the invite token on
  // the proxy AND from local state. Same flow as the old Settings
  // Manage Team modal: hit removeTeamMember (which may not exist on
  // the proxy yet, so swallow that error) and always hit
  // removeInviteToken which is the authoritative wipe.
  const handleRevoke = async (token) => {
    if (!token) return;
    Alert.alert(
      t('teamMembers.revokeTitle', { defaultValue: 'Revoke access?' }),
      t('teamMembers.revokeMessage', {
        defaultValue: 'This removes the team member and revokes their access. They will not be able to upload using this code.',
      }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('teamMembers.revoke', { defaultValue: 'Revoke' }),
          style: 'destructive',
          onPress: async () => {
            try {
              if (proxySessionId) {
                try { await proxyService.removeTeamMember(proxySessionId, token); } catch {}
                try { await proxyService.removeInviteToken(proxySessionId, token); } catch {}
              }
              try { await removeInviteToken(token); } catch {}
              await fetchMembers();
            } catch (e) {
              Alert.alert(
                t('common.error', { defaultValue: 'Error' }),
                e?.message || 'Failed to revoke access',
              );
            }
          },
        },
      ],
    );
  };

  // Re-share a previously generated invite — same rich message
  // (greeting + manual code + store links) as the Generate flow.
  const handleReshare = async (token) => {
    if (!token || !proxySessionId) return;
    try {
      const shareContent = generateShareContent(token, proxySessionId, teamName);
      await Share.share({
        title: shareContent.title,
        message: shareContent.message,
        url: shareContent.inviteLink,
      });
    } catch {}
  };

  // Set-up path — three-step flow ported from SettingsScreen.handleSetupTeam:
  //   1. Admin Google sign-in (adminSignIn from AdminContext)
  //   2. Find or create the "ProofPix-Uploads" Drive folder
  //   3. Initialize the proxy session — THIS is the step that sets
  //      proxySessionId, which is the gate for the "Active team" view.
  //      Earlier versions only did step 1 and then waited forever for
  //      proxySessionId to appear, which is why the screen looped back
  //      to "Set up your team" after the Google consent sheet closed.
  const handleSetupTeam = async () => {
    if (isWorkingSetup) return;
    if (!hasTeamFeature) {
      promptUpgrade();
      return;
    }
    setIsWorkingSetup(true);
    try {
      // Step 1 — admin Google sign-in (only if not already signed in
      // as admin). Reuses the existing session when present so the
      // user doesn't have to re-consent on every retry.
      if (!(isAuthenticated && accountType === 'google')) {
        const signInResult = await adminSignIn();
        if (!signInResult?.success) {
          const errMsg = signInResult?.error || 'Team setup failed';
          if (!/cancel/i.test(String(errMsg))) {
            Alert.alert(t('common.error', { defaultValue: 'Error' }), errMsg);
          }
          return;
        }
      }

      // Step 2 — find/create the shared Drive folder.
      let folderId = null;
      try {
        folderId = await googleDriveService.findOrCreateProofPixFolder();
      } catch (e) {
        console.error('[SETUP] Drive folder create failed:', e?.message || String(e));
        Alert.alert(
          t('common.error', { defaultValue: 'Error' }),
          e?.message || 'Could not create the shared Drive folder.',
        );
        return;
      }
      if (!folderId) {
        console.error('[SETUP] Drive folder create returned null folderId');
        Alert.alert(
          t('common.error', { defaultValue: 'Error' }),
          'Could not create the shared Drive folder.',
        );
        return;
      }
      try { await saveFolderId(folderId); } catch {}

      // Step 3 — initialize the proxy session. This sets
      // proxySessionId via AdminContext, which causes the screen to
      // re-render into the "Active team" surface on the next tick.
      let sessionResult = await initializeProxySession(folderId, 'google');

      // Two failure modes that mean "the stored serverAuthCode is no
      // good — re-prompt for a fresh one":
      //  1. AUTH_CODE_UNAVAILABLE — refreshServerAuthCode's silent
      //     sign-in returned nothing AND nothing was cached. Proxy
      //     was never called.
      //  2. "authorization code has expired" / "already been used" —
      //     the stored code was sent to the proxy and rejected with
      //     400. This is what the user was hitting.
      // Both need: clear the stale code, force INTERACTIVE adminSignIn
      // (which mints a fresh serverAuthCode), then retry the proxy
      // init.
      const needsFreshAuth = (() => {
        const err = String(sessionResult?.error || '');
        return err === 'AUTH_CODE_UNAVAILABLE'
          || /authorization code has expired/i.test(err)
          || /already been used/i.test(err);
      })();
      if (needsFreshAuth) {
        try { await googleAuthService.clearServerAuthCode(); } catch {}
        const reSign = await adminSignIn();
        if (!reSign?.success) {
          const errMsg = reSign?.error || 'Could not refresh Google authorization';
          if (!/cancel/i.test(String(errMsg))) {
            Alert.alert(t('common.error', { defaultValue: 'Error' }), errMsg);
          }
          return;
        }
        sessionResult = await initializeProxySession(folderId, 'google');
      }

      if (!sessionResult || !sessionResult.sessionId) {
        if (sessionResult?.skippable) {
          Alert.alert(
            'Setup Incomplete',
            'Team setup requires a valid Google connection. Please ensure you are signed in to Google Drive.',
          );
          return;
        }
        throw new Error(sessionResult?.error || 'Failed to initialize proxy session');
      }

      // Step 4 — seed a default team name if there isn't one yet.
      const defaultName = adminUserInfo?.name || '';
      if (!teamName && defaultName) {
        try { await updateTeamName(defaultName); } catch {}
        try { await AsyncStorage.setItem('@team_name', defaultName); } catch {}
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
      // Use the shared util that includes greeting + manual invite
      // code + iOS/Android download links, matching the older
      // SettingsScreen invite share UX. A bare link alone meant
      // recipients without the deep-link working had no fallback.
      const shareContent = generateShareContent(newToken, proxySessionId, teamName);
      try {
        await Share.share({
          title: shareContent.title,
          message: shareContent.message,
          url: shareContent.inviteLink,
        });
      } catch {}
      // Refresh the proxy list so the new invite shows up in the
      // members section below without a full app restart.
      await fetchMembers();
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
          <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
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
              <Ionicons name="people-outline" size={26} color={theme.textPrimary} />
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
              <Ionicons name="rocket-outline" size={26} color={theme.textPrimary} />
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
                <Ionicons name="qr-code-outline" size={26} color={theme.textPrimary} />
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

            {/* Members & invites — merged list of:
                  - proxy.getTeamMembers (server's view, capped to
                    invites within the 7-day TTL window — older
                    invites are auto-purged server-side)
                  - local inviteTokens (AsyncStorage, may survive
                    longer than 7d but is wiped on iOS reinstall)
                Dedupe by token. */}
            {(() => {
              const proxyItems = (teamMembers || []).map(m => ({
                token: m?.token || null,
                name: m?.name || m?.userName || null,
                email: m?.email || null,
                hasJoined: !!(m?.name || m?.userName || m?.email),
              }));
              const proxyTokens = new Set(proxyItems.map(p => p.token).filter(Boolean));
              const localOnly = (inviteTokens || [])
                .filter(tok => tok && !proxyTokens.has(tok))
                .map(tok => ({ token: tok, name: null, email: null, hasJoined: false }));
              const all = [...proxyItems, ...localOnly];
              return (
                <>
                  <View style={[styles.eyebrowRow, { marginTop: 14, paddingHorizontal: 0 }]}>
                    <Text style={styles.eyebrow}>
                      {t('teamMembers.membersList', { defaultValue: 'Members & invites' })}
                    </Text>
                    <TouchableOpacity
                      onPress={() => fetchMembers({ userInitiated: true })}
                      disabled={isRefreshing}
                      hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                      style={styles.refreshLink}
                    >
                      {isRefreshing ? (
                        <ActivityIndicator size="small" color="#7A5B00" />
                      ) : (
                        <>
                          <Ionicons name="refresh" size={13} color="#7A5B00" />
                          <Text style={styles.refreshLinkText}>
                            {t('teamMembers.refresh', { defaultValue: 'Refresh' })}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>

                  {all.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Ionicons name="information-circle-outline" size={20} color="#7A5B00" />
                      <Text style={styles.emptyText}>
                        {t('teamMembers.emptyHint', {
                          defaultValue:
                            'No invites or members yet. Older invites may have expired — the server keeps invites for 7 days, then auto-purges them. If you reinstalled the app, local copies were wiped too. Generate a new invite to add a member.',
                        })}
                      </Text>
                    </View>
                  ) : null}
                  {all.length > 0 ? (
                  <View style={styles.rowGroup}>
                    {all.map((m, i) => (
                      <View key={`${m.token || 'no-token'}-${i}`} style={styles.row}>
                        <View style={styles.rowIc}>
                          <Ionicons
                            name={m.hasJoined ? 'person-outline' : 'mail-outline'}
                            size={19}
                            color={theme.textPrimary}
                          />
                        </View>
                        <View style={styles.rowMeta}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {m.name || t('teamMembers.pendingInvite', { defaultValue: 'Pending invite' })}
                          </Text>
                          {m.email && m.email !== m.name ? (
                            <Text style={styles.rowSub} numberOfLines={1}>{m.email}</Text>
                          ) : null}
                          {m.token ? (
                            <Text style={styles.inviteCodeText} numberOfLines={1} selectable>
                              {t('teamMembers.codeLabel', { defaultValue: 'Code:' })} {m.token}
                            </Text>
                          ) : null}
                          <View style={styles.rowActions}>
                            {m.token ? (
                              <>
                                <TouchableOpacity
                                  onPress={() => handleReshare(m.token)}
                                  style={styles.rowActionLink}
                                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 8 }}
                                >
                                  <Ionicons name="share-outline" size={13} color="#7A5B00" />
                                  <Text style={styles.rowActionLinkText}>
                                    {t('teamMembers.share', { defaultValue: 'Share' })}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => handleRevoke(m.token)}
                                  style={styles.rowActionLink}
                                  hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                                >
                                  <Ionicons name="close-circle-outline" size={13} color="#C0392B" />
                                  <Text style={[styles.rowActionLinkText, { color: '#C0392B' }]}>
                                    {t('teamMembers.revoke', { defaultValue: 'Revoke' })}
                                  </Text>
                                </TouchableOpacity>
                              </>
                            ) : null}
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                  ) : null}
                </>
              );
            })()}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.surfaceElevated },
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
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 17,
    fontWeight: '700',
    color: theme.textPrimary,
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
    color: theme.textMuted,
    textTransform: 'uppercase',
    marginHorizontal: 22,
    marginBottom: 8,
  },
  businessBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: theme.surface,
  },
  businessBadgeText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 9.5,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: 0.5,
  },

  // Hero card for gate / setup / invite states.
  heroCard: {
    backgroundColor: theme.surfaceElevated,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
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
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.2,
    marginBottom: 6,
    textAlign: 'center',
  },
  heroSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '500',
    color: theme.textSecondary,
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
    color: theme.textPrimary,
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
    backgroundColor: theme.surfaceElevated,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
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
    color: theme.textPrimary,
    letterSpacing: -0.4,
  },
  statLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
    color: theme.textMuted,
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
    backgroundColor: theme.surfaceElevated,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  rowIc: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMeta: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  rowSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    color: theme.textMuted,
    letterSpacing: -0.1,
    marginTop: 1,
  },
  // Per-row invite-code badge so the user can read + select the code
  // even for pending invites. Selectable so iOS long-press → Copy works.
  inviteCodeText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11.5,
    fontWeight: '600',
    color: theme.textPrimary,
    backgroundColor: theme.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  rowActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  rowActionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  rowActionLinkText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
    color: '#7A5B00',
    letterSpacing: -0.1,
  },
  // Refresh action next to the "Members & invites" eyebrow — pulls
  // a fresh list from the proxy. Tiny accent-coloured link.
  refreshLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  refreshLinkText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
    color: '#7A5B00',
    letterSpacing: -0.1,
  },
  // Soft accent card shown when the list is empty — explains
  // proxy 7-day TTL + reinstall-wipe so the user knows why old
  // invites might not be visible.
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 18,
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#FFF4C2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F2C31B',
  },
  emptyText: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12.5,
    fontWeight: '500',
    color: '#7A5B00',
    lineHeight: 17,
    letterSpacing: -0.1,
  },
});
