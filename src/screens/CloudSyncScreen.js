import React, { useEffect, useState, useMemo } from 'react';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
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
  const { isAuthenticated, userInfo, accountType, individualSignIn, adminSignIn, signOut } = useAdmin();
  const { projects, createProject: ctxCreateProject, patchProject } = usePhotos();
  const { userPlan } = useSettings();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [dropboxUserInfo, setDropboxUserInfo] = useState(null);
  const [serviceFlowConnected, setServiceFlowConnected] = useState(false);
  const [serviceFlowWorkspace, setServiceFlowWorkspace] = useState(null);
  const [isWorkingServiceFlow, setIsWorkingServiceFlow] = useState(false);
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

  // Service Flow: connect via openAuthSessionAsync against the
  // SF web/PWA /integrations/proofpix/authorize page. The auth
  // session primitive intercepts the proofpix://connect redirect
  // and hands back the URL — we extract the token client-side and
  // pass it through the same adapter.connect() the deep-link
  // handler uses, so both surfaces converge on one redemption path.
  const SF_AUTHORIZE_URL = (process.env.EXPO_PUBLIC_SERVICEFLOW_AUTHORIZE_URL)
    || 'https://staging.service-flow.pro/integrations/proofpix/authorize?return_to=proofpix://connect';
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

    setIsWorkingServiceFlow(true);
    try {
      // openAuthSessionAsync opens the system in-app browser, watches
      // for a redirect to the deep-link URL, returns the captured URL
      // (or a dismissed/locked status). Cleaner than Linking +
      // listener for OAuth-style flows.
      const result = await WebBrowser.openAuthSessionAsync(SF_AUTHORIZE_URL, 'proofpix://connect');
      if (result?.type !== 'success' || !result.url) {
        // User dismissed, or no redirect captured. Silent — no
        // toast, since they explicitly closed the browser.
        return;
      }
      // Parse token from the redirect URL.
      const u = new URL(result.url);
      const token = u.searchParams.get('token');
      if (!token) {
        Alert.alert(
          t('common.error', { defaultValue: 'Error' }),
          t('cloudSync.sfNoToken', { defaultValue: 'Service Flow returned an unexpected response. Try again.' }),
        );
        return;
      }
      const redeem = await crmService.connect('serviceflow', { token });
      if (!redeem?.success) {
        Alert.alert(
          t('common.error', { defaultValue: 'Error' }),
          redeem?.error || t('cloudSync.sfFailed', { defaultValue: 'Could not finish connecting.' }),
        );
        return;
      }
      await refreshServiceFlow();
      // Fire an immediate sync so the user sees their SF jobs appear in
      // the Projects list right after connect, without waiting for the
      // next background→foreground transition (which is what otherwise
      // triggers ServiceFlowSyncTrigger). Best-effort — sync errors are
      // surfaced via console and don't break the UI connected state.
      try {
        const result = await syncServiceFlowJobs({ projects, createProject: ctxCreateProject, patchProject });
        console.warn('[ServiceFlow] post-connect sync', result);
      } catch (syncErr) {
        console.warn('[ServiceFlow] post-connect sync threw:', syncErr?.message);
      }
    } catch (e) {
      console.warn('[CloudSync] SF connect failed:', e?.message);
      Alert.alert(t('common.error', { defaultValue: 'Error' }), e?.message || 'Connection failed.');
    } finally {
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
          <Ionicons name="chevron-back" size={20} color="#1E1E1E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('cloudSync.title', { defaultValue: 'Cloud sync' })}</Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
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
            <View style={[styles.rowIc, googleConnected && styles.rowIcConnected]}>
              <Ionicons name="logo-google" size={19} color={googleConnected ? '#7A5B00' : '#1E1E1E'} />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>{t('cloudSync.googleDrive', { defaultValue: 'Google Drive' })}</Text>
              <Text style={[styles.rowSub, googleConnected && styles.rowSubSuccess]} numberOfLines={1}>
                {googleAccountLabel}
              </Text>
            </View>
            <View style={[styles.actionPill, googleConnected ? styles.actionPillGhost : styles.actionPillAccent]}>
              {isWorkingGoogle ? (
                <ActivityIndicator size="small" color="#1E1E1E" />
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
            <View style={[styles.rowIc, dropboxConnected && styles.rowIcConnected]}>
              <Ionicons name="cloud-outline" size={19} color={dropboxConnected ? '#7A5B00' : '#1E1E1E'} />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>{t('cloudSync.dropbox', { defaultValue: 'Dropbox' })}</Text>
              <Text style={[styles.rowSub, dropboxConnected && styles.rowSubSuccess]} numberOfLines={1}>
                {dropboxLabel}
              </Text>
            </View>
            <View style={[styles.actionPill, dropboxConnected ? styles.actionPillGhost : styles.actionPillAccent]}>
              {isWorkingDropbox ? (
                <ActivityIndicator size="small" color="#1E1E1E" />
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
            <View style={[styles.rowIc, serviceFlowConnected && styles.rowIcConnected]}>
              <Ionicons name="briefcase-outline" size={19} color={serviceFlowConnected ? '#7A5B00' : '#1E1E1E'} />
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
            <View style={[styles.actionPill, serviceFlowConnected && styles.actionPillDestructive]}>
              {isWorkingServiceFlow ? (
                <ActivityIndicator size="small" color="#1E1E1E" />
              ) : (
                <Text style={[styles.actionPillText, serviceFlowConnected && styles.actionPillTextDestructive]}>
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
              <View style={[styles.rowIc, styles.rowIcConnected]}>
                <Ionicons name="cloud-done-outline" size={19} color="#7A5B00" />
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
              <Ionicons name="cloud-upload-outline" size={19} color="#1E1E1E" />
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
  rowIcConnected: { backgroundColor: '#FFF4C2' },
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
  actionPillTextAccent: { color: theme.textPrimary },
  actionPillTextGhost: { color: theme.textPrimary },
});
