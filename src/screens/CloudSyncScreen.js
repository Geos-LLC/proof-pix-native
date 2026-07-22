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

    // Not connected → open the paste-in code sheet. The former
    // openAuthSessionAsync flow is disabled until SF backend PR 4
    // ships their /authorize state-token fix; that path stayed on
    // proofpix://connect via the deep-link handler in CRMRedeemScreen
    // so it will start working again as soon as SF re-enables the
    // authorize endpoint without changes on our side.
    setSfCodeInput('');
    setSfCodeError(null);
    setSfCodeModalVisible(true);
  };

  // Normalise pasted codes. SF's spec: 16 Crockford base32 chars
  // (excluding I L O U) grouped as XXXX-XXXX-XXXX-XXXX. Accept with
  // or without dashes, strip whitespace, uppercase.
  const normaliseSfCode = (raw) => {
    if (!raw) return '';
    const cleaned = raw.replace(/\s+/g, '').toUpperCase();
    // Strip dashes for validation; add them back for the wire format.
    const bare = cleaned.replace(/-/g, '');
    return bare;
  };

  const formatSfCodeForDisplay = (bare) => {
    // Render as XXXX-XXXX-XXXX-XXXX while the user types.
    const s = bare.slice(0, 16);
    return s.replace(/(.{4})/g, '$1-').replace(/-$/, '');
  };

  const handleSubmitSfCode = async () => {
    if (sfCodeSubmitting) return;
    const bare = normaliseSfCode(sfCodeInput);
    if (bare.length !== 16) {
      setSfCodeError(
        t('cloudSync.sfCodeFormat', {
          defaultValue: 'Code should be 16 characters (e.g. AJEF-VVCT-P6Y3-PP9Z).',
        }),
      );
      return;
    }
    const wireCode = formatSfCodeForDisplay(bare); // hyphenated form for the SF API
    setSfCodeError(null);
    setSfCodeSubmitting(true);
    setIsWorkingServiceFlow(true);
    try {
      const redeem = await crmService.connect('serviceflow', { code: wireCode });
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
                      defaultValue: 'In Service Flow, open Integrations → ProofPix and tap Generate connect code. Paste the 16-character code below.',
                    })}
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
                    placeholder="AJEF-VVCT-P6Y3-PP9Z"
                    placeholderTextColor={theme.textMuted}
                    value={sfCodeInput}
                    onChangeText={(txt) => {
                      // Auto-format as XXXX-XXXX-XXXX-XXXX while typing.
                      const bare = normaliseSfCode(txt);
                      setSfCodeInput(formatSfCodeForDisplay(bare));
                      if (sfCodeError) setSfCodeError(null);
                    }}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={19}
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
