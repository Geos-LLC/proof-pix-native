import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
  Linking,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { FONTS } from '../constants/fonts';
import * as WebBrowser from 'expo-web-browser';
import dropboxAuthService from '../services/dropboxAuthService';
import iCloudService from '../services/iCloudService';
import crmService from '../services/crm';
import { syncServiceFlowJobs } from '../services/crm/serviceFlowSync';
import { usePhotos } from '../context/PhotoContext';
import { useTheme } from '../hooks/useTheme';

// CloudSyncScreen — dedicated route for cloud storage connections.
// Split out of the prior combined CloudTeamScreen so the team flow
// lives in its own screen (TeamMembersScreen).
//
// Layout:
//   • CONNECTED STORAGE eyebrow + PRO badge
//   • Google Drive row — connect / disconnect via AdminContext
//   • Dropbox row — connect / disconnect via dropboxAuthService
//   • iCloud Drive row (iOS only) — OS-managed; tap opens iOS
//     Settings → Apple ID → iCloud Drive so the user can confirm
//     it's enabled
//   • Background upload toggle (preference persisted to AsyncStorage)
const BG_UPLOAD_KEY = '@cloud_team_bg_upload_pref';

export default function CloudSyncScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, userInfo, accountType, individualSignIn, adminSignIn, signOut, userMode, teamInfo } = useAdmin();
  const isTeamMember = userMode === 'team_member';
  const { projects, createProject: ctxCreateProject, patchProject } = usePhotos();
  const { userPlan } = useSettings();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [dropboxUserInfo, setDropboxUserInfo] = useState(null);
  const [serviceFlowConnected, setServiceFlowConnected] = useState(false);
  const [serviceFlowWorkspace, setServiceFlowWorkspace] = useState(null);
  const [isWorkingServiceFlow, setIsWorkingServiceFlow] = useState(false);

  // Paste-in connect-code flow. The SF backend's PR 4 authorize URL
  // path isn't reliably live on staging (returns INVALID_TOKEN mid-
  // flow), so the primary supported connect UX is the code exchange
  // documented in docs/SERVICE_FLOW_INTEGRATION.md §3:
  //   1. Admin generates a code in SF web (Integrations → ProofPix)
  //   2. Pastes it here
  //   3. Adapter POSTs to /connect/code/redeem → refresh token
  const [sfCodeModalVisible, setSfCodeModalVisible] = useState(false);
  const [sfCodeInput, setSfCodeInput] = useState('');
  const [sfCodeSubmitting, setSfCodeSubmitting] = useState(false);
  const [sfCodeError, setSfCodeError] = useState(null);
  const [bgUploadEnabled, setBgUploadEnabled] = useState(true);
  const [isWorkingGoogle, setIsWorkingGoogle] = useState(false);
  const [isWorkingDropbox, setIsWorkingDropbox] = useState(false);

  const iCloudAvailable = Platform.OS === 'ios' && iCloudService?.isAvailable?.();

  useEffect(() => {
    (async () => {
      try {
        const pref = await AsyncStorage.getItem(BG_UPLOAD_KEY);
        if (pref !== null) setBgUploadEnabled(pref === 'true');
      } catch {}
      await refreshDropbox();
      await refreshServiceFlow();
    })();
  }, []);

  // Re-read SF + Dropbox state every time the screen regains focus.
  // The QR-code / deep-link connect path lands on CRMRedeemScreen, and
  // the user pops back here with navigation.goBack — without this the
  // "Connected" pill wouldn't update until a full screen remount.
  useFocusEffect(
    useCallback(() => {
      refreshServiceFlow();
      refreshDropbox();
    }, [])
  );

  // Read SF connection state from local Keychain (no network call —
  // serviceFlowAdapter persists workspace metadata at connect time
  // so the UI can render without round-tripping to the server).
  const refreshServiceFlow = async () => {
    try {
      const adapter = await crmService.getActiveAdapter();
      if (adapter && typeof adapter.getStoredWorkspace === 'function') {
        const stored = await adapter.getStoredWorkspace();
        if (stored?.workspaceId) {
          setServiceFlowConnected(true);
          setServiceFlowWorkspace(stored);
          return;
        }
      }
      setServiceFlowConnected(false);
      setServiceFlowWorkspace(null);
    } catch {
      setServiceFlowConnected(false);
      setServiceFlowWorkspace(null);
    }
  };

  const refreshDropbox = async () => {
    try {
      const connected = dropboxAuthService.isAuthenticated();
      setDropboxConnected(connected);
      if (connected) {
        try {
          const info = await dropboxAuthService.getUserInfo?.();
          if (info) setDropboxUserInfo(info);
        } catch {}
      } else {
        setDropboxUserInfo(null);
      }
    } catch {}
  };

  const toggleBgUpload = async (next) => {
    setBgUploadEnabled(next);
    try { await AsyncStorage.setItem(BG_UPLOAD_KEY, String(next)); } catch {}
  };

  const isBusinessOrEnterprise = userPlan === 'business' || userPlan === 'enterprise';
  const isPro = userPlan === 'pro' || isBusinessOrEnterprise;

  const handleGoogleDrive = async () => {
    if (isWorkingGoogle) return;
    if (googleConnected) {
      Alert.alert(
        t('cloudSync.disconnectGoogleTitle', { defaultValue: 'Disconnect Google Drive?' }),
        t('cloudSync.disconnectGoogleMessage', {
          defaultValue: 'Photos already uploaded stay in your Drive. New captures stop syncing until you reconnect.',
        }),
        [
          { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
          {
            text: t('cloudSync.disconnect', { defaultValue: 'Disconnect' }),
            style: 'destructive',
            onPress: async () => {
              setIsWorkingGoogle(true);
              try { await signOut(); }
              catch (e) { Alert.alert(t('common.error', { defaultValue: 'Error' }), e?.message || 'Sign-out failed'); }
              finally { setIsWorkingGoogle(false); }
            },
          },
        ],
      );
      return;
    }
    setIsWorkingGoogle(true);
    try {
      const fn = isBusinessOrEnterprise ? adminSignIn : individualSignIn;
      const result = await fn();
      if (!result?.success) {
        const errMsg = result?.error || 'Sign-in failed';
        if (!/cancel/i.test(String(errMsg))) {
          Alert.alert(t('common.error', { defaultValue: 'Error' }), errMsg);
        }
      }
    } catch (e) {
      if (!/cancel/i.test(String(e?.message || ''))) {
        Alert.alert(t('common.error', { defaultValue: 'Error' }), e?.message || 'Sign-in failed');
      }
    } finally {
      setIsWorkingGoogle(false);
    }
  };

  const handleDropbox = async () => {
    if (isWorkingDropbox) return;
    if (dropboxConnected) {
      Alert.alert(
        t('cloudSync.disconnectDropboxTitle', { defaultValue: 'Disconnect Dropbox?' }),
        t('cloudSync.disconnectDropboxMessage', {
          defaultValue: 'Photos already uploaded stay in your Dropbox. New captures stop syncing until you reconnect.',
        }),
        [
          { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
          {
            text: t('cloudSync.disconnect', { defaultValue: 'Disconnect' }),
            style: 'destructive',
            onPress: async () => {
              setIsWorkingDropbox(true);
              try {
                await dropboxAuthService.signOut();
                await refreshDropbox();
              } catch (e) {
                Alert.alert(t('common.error', { defaultValue: 'Error' }), e?.message || 'Sign-out failed');
              } finally {
                setIsWorkingDropbox(false);
              }
            },
          },
        ],
      );
      return;
    }
    setIsWorkingDropbox(true);
    try {
      const result = await dropboxAuthService.signIn();
      if (result?.success === false) {
        const errMsg = result?.error || '';
        if (errMsg && !/cancel/i.test(errMsg)) {
          Alert.alert(t('common.error', { defaultValue: 'Error' }), errMsg);
        }
      }
      await refreshDropbox();
    } catch (e) {
      const errMsg = e?.message || '';
      if (errMsg && !/cancel/i.test(errMsg)) {
        Alert.alert(t('common.error', { defaultValue: 'Error' }), errMsg);
      }
    } finally {
      setIsWorkingDropbox(false);
    }
  };

  // iCloud is OS-managed — there's no per-app connect/disconnect for
  // Documents-directory sync. Tapping the row opens iOS Settings →
  // [your name] → iCloud so the user can confirm iCloud Drive is on
  // for ProofPix. On Android the row is hidden.
  const handleICloud = () => {
    Alert.alert(
      t('cloudSync.iCloudTitle', { defaultValue: 'iCloud Drive' }),
      t('cloudSync.iCloudMessage', {
        defaultValue:
          'ProofPix saves uploads to your iCloud Drive automatically when iCloud Drive is enabled in your device settings.\n\nFind your photos in: Files app → iCloud Drive → ProofPix → ProofPix-Uploads',
      }),
      [
        { text: t('common.ok', { defaultValue: 'OK' }), style: 'cancel' },
        {
          text: t('cloudSync.openICloudSettings', { defaultValue: 'Open iCloud settings' }),
          onPress: () => { Linking.openURL('App-prefs:CASTLE').catch(() => Linking.openSettings().catch(() => {})); },
        },
      ],
    );
  };

  // Service Flow authorize URL — prod frontend by default (SF unified
  // deploys on `main`). Env-overridable for QA against staging or a
  // Vercel preview. Same-device flow: SF page mints token, launches
  // proofpix://connect?token=… which openAuthSessionAsync intercepts.
  const SF_AUTHORIZE_URL = (process.env.EXPO_PUBLIC_SERVICEFLOW_AUTHORIZE_URL)
    || 'https://service-flow.pro/integrations/proofpix/authorize?return_to=proofpix://connect';

  // Fires the /authorize web flow inside an in-app browser. Primary
  // path for phone-only users who don't have a desktop to scan a QR
  // from. On success, SF's page attempts proofpix://connect?token=…
  // which openAuthSessionAsync catches, and we redeem the token
  // client-side via the same adapter path CRMRedeemScreen uses.
  const runServiceFlowSignInWeb = async () => {
    setIsWorkingServiceFlow(true);
    try {
      const result = await WebBrowser.openAuthSessionAsync(SF_AUTHORIZE_URL, 'proofpix://connect');
      if (result?.type !== 'success' || !result.url) {
        // User dismissed, or browser closed without a redirect. Fall
        // through to offer the paste-in modal so they still have a way
        // to complete the connection.
        return { completed: false, reason: 'dismissed' };
      }
      // Parse token from the returned URL.
      let token = null;
      try {
        const u = new URL(result.url);
        token = u.searchParams.get('token');
      } catch {}
      if (!token) {
        return { completed: false, reason: 'no_token' };
      }
      const redeem = await crmService.connect('serviceflow', { token });
      if (!redeem?.success) {
        return { completed: false, reason: 'redeem_failed', error: redeem?.error };
      }
      await refreshServiceFlow();
      // Kick an immediate SF sync so admin's Projects list populates.
      try {
        const syncResult = await syncServiceFlowJobs({ projects, createProject: ctxCreateProject, patchProject });
        console.warn('[ServiceFlow] post-signin sync', syncResult);
      } catch (syncErr) {
        console.warn('[ServiceFlow] post-signin sync threw:', syncErr?.message);
      }
      return { completed: true };
    } catch (e) {
      console.warn('[CloudSync] SF web sign-in threw:', e?.message);
      return { completed: false, reason: 'exception', error: e?.message };
    } finally {
      setIsWorkingServiceFlow(false);
    }
  };

  const handleServiceFlow = async () => {
    if (isWorkingServiceFlow) return;
    if (serviceFlowConnected) {
      Alert.alert(
        t('cloudSync.disconnectSFTitle', { defaultValue: 'Disconnect Service Flow?' }),
        t('cloudSync.disconnectSFMessage', {
          defaultValue:
            "New photos in linked projects will stop syncing to Service Flow. Photos already uploaded stay on the job.",
        }),
        [
          { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
          {
            text: t('cloudSync.disconnect', { defaultValue: 'Disconnect' }),
            style: 'destructive',
            onPress: async () => {
              setIsWorkingServiceFlow(true);
              try { await crmService.disconnect(); }
              catch (e) { console.warn('[CloudSync] SF disconnect failed:', e?.message); }
              finally {
                await refreshServiceFlow();
                setIsWorkingServiceFlow(false);
              }
            },
          },
        ],
      );
      return;
    }

    // Not connected → try the web sign-in flow first (best UX for
    // phone-only users). On dismiss / no-token / redeem failure, fall
    // back to the paste-in modal so users can still complete the
    // connection with a code from SF admin panel.
    const outcome = await runServiceFlowSignInWeb();
    if (outcome.completed) return;

    if (outcome.reason === 'redeem_failed' && outcome.error) {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        String(outcome.error),
      );
      return;
    }

    setSfCodeInput('');
    setSfCodeError(null);
    setSfCodeModalVisible(true);
  };

  // Two accepted formats — SF's /connect/redeem endpoint discriminates
  // by shape server-side:
  //   1. Paste-in code — 16 chars Crockford base32 (no I L O U),
  //      hyphenated for humans as XXXX-XXXX-XXXX-XXXX. Generated by
  //      "Generate ProofPix code" in SF web.
  //   2. Pairing token — longer base64url (usually 20-64 chars), minted
  //      by SF's /authorize page. Case-sensitive.
  // The desktop-authorize flow expects to hand off the token via a
  // proofpix:// launch, but on desktop the launch fails (scheme not
  // registered) and the token is left dangling in the URL / console.
  // Accepting it here as a fallback keeps admins unblocked while SF
  // finishes their desktop→QR rewrite.
  const detectSfInputKind = (raw) => {
    if (!raw) return { kind: 'empty', cleaned: '' };
    const trimmed = raw.trim();
    const noSpace = trimmed.replace(/\s+/g, '');
    const bare = noSpace.replace(/-/g, '');
    // 16-char Crockford base32 → paste-in code (case-insensitive).
    if (/^[A-Z0-9]{16}$/i.test(bare) && bare.length === 16) {
      const up = bare.toUpperCase();
      return {
        kind: 'code',
        cleaned: up,
        wire: up.replace(/(.{4})/g, '$1-').replace(/-$/, ''),
      };
    }
    // ≥20 chars, base64url shape (alphanum plus - _), no whitespace →
    // treat as a pairing token. Preserve case; the SF backend does
    // an exact match on the token value.
    if (/^[A-Za-z0-9_-]{20,}$/.test(noSpace)) {
      return { kind: 'token', cleaned: noSpace, wire: noSpace };
    }
    return { kind: 'unknown', cleaned: noSpace };
  };

  const formatSfCodeForDisplay = (bare) => {
    // Render as XXXX-XXXX-XXXX-XXXX while the user types (code path).
    const s = bare.slice(0, 16);
    return s.replace(/(.{4})/g, '$1-').replace(/-$/, '');
  };

  const handleSubmitSfCode = async () => {
    if (sfCodeSubmitting) return;
    const parsed = detectSfInputKind(sfCodeInput);
    if (parsed.kind === 'empty' || parsed.kind === 'unknown') {
      setSfCodeError(
        t('cloudSync.sfCodeFormat', {
          defaultValue: 'Paste the 16-character code from SF (e.g. AJEF-VVCT-P6Y3-PP9Z) or the token from the SF /authorize URL.',
        }),
      );
      return;
    }
    setSfCodeError(null);
    setSfCodeSubmitting(true);
    setIsWorkingServiceFlow(true);
    try {
      const redeem = await crmService.connect('serviceflow', { code: parsed.wire });
      if (!redeem?.success) {
        setSfCodeError(
          redeem?.error ||
            t('cloudSync.sfCodeInvalid', {
              defaultValue: 'That code did not work. Codes expire after 10 minutes and can only be used once — get a fresh one from Service Flow → Integrations → ProofPix.',
            }),
        );
        return;
      }
      setSfCodeModalVisible(false);
      await refreshServiceFlow();
      // Fire an immediate sync so the user sees their SF jobs in
      // Projects right after connect. Best-effort — sync errors are
      // logged but don't break the connected state.
      try {
        const result = await syncServiceFlowJobs({ projects, createProject: ctxCreateProject, patchProject });
        console.warn('[ServiceFlow] post-connect sync', result);
      } catch (syncErr) {
        console.warn('[ServiceFlow] post-connect sync threw:', syncErr?.message);
      }
    } catch (e) {
      console.warn('[CloudSync] SF code connect failed:', e?.message);
      setSfCodeError(e?.message || t('cloudSync.sfCodeGeneric', { defaultValue: 'Connection failed. Please try again.' }));
    } finally {
      setSfCodeSubmitting(false);
      setIsWorkingServiceFlow(false);
    }
  };
  const sfLabel = serviceFlowConnected
    ? (serviceFlowWorkspace?.workspaceName || t('cloudSync.connected', { defaultValue: 'Connected' }))
    : t('cloudSync.notConnected', { defaultValue: 'Not connected' });

  const googleConnected = isAuthenticated && accountType === 'google';
  const googleAccountLabel = googleConnected
    ? (userInfo?.email || userInfo?.name || t('cloudSync.connected', { defaultValue: 'Connected' }))
    : t('cloudSync.notConnected', { defaultValue: 'Not connected' });
  const dropboxLabel = dropboxConnected
    ? (dropboxUserInfo?.email || dropboxUserInfo?.name || t('cloudSync.connected', { defaultValue: 'Connected' }))
    : t('cloudSync.notConnected', { defaultValue: 'Not connected' });

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
        <Text style={styles.headerTitle}>{t('cloudSync.title', { defaultValue: 'Cloud sync' })}</Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {isTeamMember ? (
          // Team members don't manage their own storage — every capture
          // uploads through the admin's proxy session. Personal
          // Google/Dropbox/iCloud/SF rows would be confusing at best
          // (they look connectable but do nothing for team uploads) and
          // actively wrong at worst (a lingering personal Dropbox login
          // shows "Connected" here even though team uploads bypass it).
          <View style={styles.teamMemberNoticeCard}>
            <View style={styles.teamMemberNoticeIcon}>
              <Ionicons name="cloud-done-outline" size={22} color={theme.textPrimary} />
            </View>
            <Text style={styles.teamMemberNoticeTitle}>
              {t('cloudSync.teamMemberTitle', { defaultValue: 'Storage managed by your team' })}
            </Text>
            <Text style={styles.teamMemberNoticeBody}>
              {t('cloudSync.teamMemberBody', {
                admin: teamInfo?.adminName || teamInfo?.adminEmail || 'your admin',
                defaultValue: `Every photo you capture uploads straight to your team's storage. No personal cloud setup needed.`,
              })}
            </Text>
          </View>
        ) : (
        <>
        <View style={styles.eyebrowRow}>
          <Text style={styles.eyebrow}>
            {t('cloudSync.connectedStorage', { defaultValue: 'Connected storage' })}
          </Text>
          <View style={styles.proBadge}>
            <Text style={styles.proBadgeText}>PRO</Text>
          </View>
        </View>

        <View style={styles.rowGroup}>
          {/* Google Drive */}
          <TouchableOpacity
            style={styles.row}
            onPress={handleGoogleDrive}
            activeOpacity={0.85}
            disabled={!isPro}
          >
            <View style={styles.rowIc}>
              <Ionicons name="logo-google" size={19} color={theme.textPrimary} />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>{t('cloudSync.googleDrive', { defaultValue: 'Google Drive' })}</Text>
              <Text style={[styles.rowSub, googleConnected && styles.rowSubSuccess]} numberOfLines={1}>
                {googleAccountLabel}
              </Text>
            </View>
            <View style={[styles.actionPill, googleConnected ? styles.actionPillGhost : styles.actionPillAccent]}>
              {isWorkingGoogle ? (
                <ActivityIndicator size="small" color={googleConnected ? theme.textPrimary : theme.accentText} />
              ) : (
                <Text style={[styles.actionPillText, googleConnected ? styles.actionPillTextGhost : styles.actionPillTextAccent]}>
                  {googleConnected
                    ? t('cloudSync.disconnect', { defaultValue: 'Disconnect' })
                    : t('cloudSync.connect', { defaultValue: 'Connect' })}
                </Text>
              )}
            </View>
          </TouchableOpacity>

          {/* Dropbox */}
          <TouchableOpacity
            style={styles.row}
            onPress={handleDropbox}
            activeOpacity={0.85}
            disabled={!isPro}
          >
            <View style={styles.rowIc}>
              <Ionicons name="cloud-outline" size={19} color={theme.textPrimary} />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>{t('cloudSync.dropbox', { defaultValue: 'Dropbox' })}</Text>
              <Text style={[styles.rowSub, dropboxConnected && styles.rowSubSuccess]} numberOfLines={1}>
                {dropboxLabel}
              </Text>
            </View>
            <View style={[styles.actionPill, dropboxConnected ? styles.actionPillGhost : styles.actionPillAccent]}>
              {isWorkingDropbox ? (
                <ActivityIndicator size="small" color={dropboxConnected ? theme.textPrimary : theme.accentText} />
              ) : (
                <Text style={[styles.actionPillText, dropboxConnected ? styles.actionPillTextGhost : styles.actionPillTextAccent]}>
                  {dropboxConnected
                    ? t('cloudSync.disconnect', { defaultValue: 'Disconnect' })
                    : t('cloudSync.connect', { defaultValue: 'Connect' })}
                </Text>
              )}
            </View>
          </TouchableOpacity>

          {/* Service Flow — CRM integration. Connect via the SF web/PWA
              /integrations/proofpix/authorize page (works on any
              device — laptop opens it in a browser, phone deep-links
              back into ProofPix when SF redirects to proofpix://). */}
          <TouchableOpacity
            style={styles.row}
            onPress={handleServiceFlow}
            disabled={isWorkingServiceFlow}
            activeOpacity={0.85}
          >
            <View style={styles.rowIc}>
              <Ionicons name="briefcase-outline" size={19} color={theme.textPrimary} />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>
                {t('cloudSync.serviceFlow', { defaultValue: 'Service Flow' })}
              </Text>
              <Text
                style={[styles.rowSub, serviceFlowConnected && styles.rowSubSuccess]}
                numberOfLines={1}
              >
                {sfLabel}
              </Text>
            </View>
            <View style={[styles.actionPill, serviceFlowConnected ? styles.actionPillGhost : styles.actionPillAccent]}>
              {isWorkingServiceFlow ? (
                <ActivityIndicator size="small" color={serviceFlowConnected ? theme.textPrimary : theme.accentText} />
              ) : (
                <Text style={[styles.actionPillText, serviceFlowConnected ? styles.actionPillTextGhost : styles.actionPillTextAccent]}>
                  {serviceFlowConnected
                    ? t('cloudSync.disconnect', { defaultValue: 'Disconnect' })
                    : t('cloudSync.connect', { defaultValue: 'Connect' })}
                </Text>
              )}
            </View>
          </TouchableOpacity>

          {/* iCloud Drive — iOS only. Always reads as available; tap
              shows an info alert + opens iOS Settings → iCloud. */}
          {iCloudAvailable ? (
            <TouchableOpacity style={styles.row} onPress={handleICloud} activeOpacity={0.85}>
              <View style={styles.rowIc}>
                <Ionicons name="cloud-done-outline" size={19} color={theme.textPrimary} />
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle}>{t('cloudSync.iCloudDrive', { defaultValue: 'iCloud Drive' })}</Text>
                <Text style={[styles.rowSub, styles.rowSubSuccess]} numberOfLines={1}>
                  {t('cloudSync.iCloudAuto', { defaultValue: 'Auto-syncs via your Apple ID' })}
                </Text>
              </View>
              <View style={[styles.actionPill, styles.actionPillGhost]}>
                <Text style={[styles.actionPillText, styles.actionPillTextGhost]}>
                  {t('cloudSync.info', { defaultValue: 'Info' })}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          {/* Background upload toggle */}
          <View style={styles.row}>
            <View style={styles.rowIc}>
              <Ionicons name="cloud-upload-outline" size={19} color={theme.textPrimary} />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>
                {t('cloudSync.backgroundUpload', { defaultValue: 'Background upload' })}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {t('cloudSync.backgroundUploadSub', { defaultValue: 'Auto-sync new photos' })}
              </Text>
            </View>
            <Switch
              value={bgUploadEnabled}
              onValueChange={toggleBgUpload}
              trackColor={{ false: '#E0E0E0', true: '#F2C31B' }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>
        </>
        )}
      </ScrollView>

      {/* Service Flow paste-in connect-code modal. Documented flow
          in docs/SERVICE_FLOW_INTEGRATION.md §3 — user generates a
          code in SF web (Integrations → ProofPix), pastes it here,
          adapter POSTs to /connect/code/redeem, and the resulting
          refresh token gets stored locally + pushed to the proxy so
          team members can list SF jobs and have uploads fanned out. */}
      <Modal
        visible={sfCodeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !sfCodeSubmitting && setSfCodeModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => !sfCodeSubmitting && setSfCodeModalVisible(false)}>
          <View style={sfCodeStyles.overlay}>
            <TouchableWithoutFeedback>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ width: '100%' }}
              >
                <View style={[sfCodeStyles.sheet, { backgroundColor: theme.surface }]}>
                  <View style={sfCodeStyles.grabberWrap}>
                    <View style={[sfCodeStyles.grabber, { backgroundColor: theme.borderStrong }]} />
                  </View>
                  <View style={sfCodeStyles.header}>
                    <Text style={[sfCodeStyles.title, { color: theme.textPrimary }]}>
                      {t('cloudSync.sfConnectTitle', { defaultValue: 'Connect Service Flow' })}
                    </Text>
                    <TouchableOpacity
                      onPress={() => !sfCodeSubmitting && setSfCodeModalVisible(false)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <Ionicons name="close" size={22} color={theme.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <Text style={[sfCodeStyles.body, { color: theme.textSecondary }]}>
                    {t('cloudSync.sfConnectInstructions', {
                      defaultValue: 'Paste a connect code or pairing token. If you have Service Flow available in a browser, you can also sign in directly instead.',
                    })}
                  </Text>

                  <TouchableOpacity
                    style={[sfCodeStyles.submitButton, { backgroundColor: theme.surfaceElevated, marginTop: 0, marginBottom: 14, height: 44, flexDirection: 'row' }]}
                    onPress={async () => {
                      setSfCodeModalVisible(false);
                      const outcome = await runServiceFlowSignInWeb();
                      if (!outcome.completed) {
                        // Web dismissed / failed — reopen the paste-in modal
                        setSfCodeInput('');
                        setSfCodeError(outcome.reason === 'redeem_failed' ? String(outcome.error || 'Sign-in failed') : null);
                        setSfCodeModalVisible(true);
                      }
                    }}
                    disabled={sfCodeSubmitting || isWorkingServiceFlow}
                  >
                    <Ionicons name="globe-outline" size={18} color={theme.textPrimary} style={{ marginRight: 8 }} />
                    <Text style={[sfCodeStyles.submitButtonText, { color: theme.textPrimary, fontSize: 15 }]}>
                      {t('cloudSync.sfSignInWeb', { defaultValue: 'Sign in to Service Flow' })}
                    </Text>
                  </TouchableOpacity>

                  <Text style={{ color: theme.textMuted, fontSize: 11, fontFamily: FONTS.ALEXANDRIA, textAlign: 'center', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {t('cloudSync.sfOr', { defaultValue: 'or paste a code' })}
                  </Text>

                  <TextInput
                    style={[
                      sfCodeStyles.input,
                      {
                        backgroundColor: theme.surfaceElevated,
                        color: theme.textPrimary,
                        borderColor: sfCodeError ? '#E24A4A' : theme.border,
                      },
                    ]}
                    placeholder="AJEF-VVCT-P6Y3-PP9Z or paste token"
                    placeholderTextColor={theme.textMuted}
                    value={sfCodeInput}
                    onChangeText={(txt) => {
                      // Auto-format ONLY if the input smells like a
                      // 16-char paste-in code. Longer inputs are
                      // pairing tokens — leave them alone (they're
                      // case-sensitive and shouldn't be hyphenated).
                      const stripped = txt.replace(/\s+/g, '').replace(/-/g, '');
                      if (stripped.length <= 16 && /^[A-Za-z0-9]*$/.test(stripped)) {
                        setSfCodeInput(formatSfCodeForDisplay(stripped.toUpperCase()));
                      } else {
                        setSfCodeInput(txt.replace(/\s+/g, ''));
                      }
                      if (sfCodeError) setSfCodeError(null);
                    }}
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={128}
                    editable={!sfCodeSubmitting}
                    returnKeyType="go"
                    onSubmitEditing={handleSubmitSfCode}
                  />

                  {sfCodeError ? (
                    <Text style={sfCodeStyles.errorText}>{sfCodeError}</Text>
                  ) : null}

                  <TouchableOpacity
                    style={[
                      sfCodeStyles.submitButton,
                      { backgroundColor: theme.accent },
                      sfCodeSubmitting && { opacity: 0.7 },
                    ]}
                    onPress={handleSubmitSfCode}
                    disabled={sfCodeSubmitting}
                  >
                    {sfCodeSubmitting ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <Text style={sfCodeStyles.submitButtonText}>
                        {t('cloudSync.sfConnectButton', { defaultValue: 'Connect' })}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <Text style={[sfCodeStyles.helper, { color: theme.textMuted }]}>
                    {t('cloudSync.sfConnectHelper', {
                      defaultValue: 'Codes expire after 10 minutes and can only be used once.',
                    })}
                  </Text>
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}

const sfCodeStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 34,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  grabberWrap: { alignItems: 'center', paddingBottom: 6 },
  grabber: { width: 40, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 12,
  },
  title: { fontSize: 18, fontFamily: FONTS.ALEXANDRIA, fontWeight: '700' },
  body: { fontSize: 14, fontFamily: FONTS.ALEXANDRIA, lineHeight: 20, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    fontFamily: FONTS.ALEXANDRIA,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  errorText: {
    color: '#E24A4A',
    fontSize: 13,
    fontFamily: FONTS.ALEXANDRIA,
    marginBottom: 6,
  },
  submitButton: {
    marginTop: 10,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    color: '#000',
    fontSize: 16,
    fontFamily: FONTS.ALEXANDRIA,
    fontWeight: '600',
  },
  helper: {
    marginTop: 12,
    fontSize: 12,
    fontFamily: FONTS.ALEXANDRIA,
    textAlign: 'center',
  },
});

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.surfaceElevated },
  teamMemberNoticeCard: {
    marginHorizontal: 22,
    marginTop: 24,
    padding: 20,
    borderRadius: 16,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
  },
  teamMemberNoticeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  teamMemberNoticeTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  teamMemberNoticeBody: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '500',
    color: theme.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
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
  },
  proBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#FFF4C2',
  },
  proBadgeText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 9.5,
    fontWeight: '800',
    color: '#7A5B00',
    letterSpacing: 0.5,
  },
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
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
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
  rowSubSuccess: { color: '#34C759' },
  actionPill: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillAccent: { backgroundColor: '#F2C31B' },
  actionPillGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: theme.borderStrong,
  },
  actionPillText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  actionPillTextAccent: { color: theme.accentText },
  actionPillTextGhost: { color: theme.textPrimary },
});
