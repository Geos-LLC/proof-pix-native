import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import crmService from '../services/crm';
import { syncServiceFlowJobs } from '../services/crm/serviceFlowSync';
import { usePhotos } from '../context/PhotoContext';
import { useTheme } from '../hooks/useTheme';

/**
 * CRMRedeemScreen — landing for the `proofpix://connect?token=...&workspace=...`
 * deep link. Fired in two cases:
 *
 *  1. **OAuth-style flow** — user tapped "Connect Service Flow" in
 *     ProofPix Settings → opens SF web /integrations/proofpix/authorize
 *     via expo-web-browser → SF mints token → redirects here.
 *     `expo-web-browser.openAuthSessionAsync` catches the redirect
 *     before this screen mounts (so this code path rarely fires
 *     for that case — see CloudSyncScreen).
 *
 *  2. **External deep-link** — user tapped a `proofpix://connect?token=…`
 *     URL from somewhere outside an in-app browser (text message,
 *     other app, scanned QR), or returned from a system browser
 *     that didn't run inside openAuthSessionAsync. This screen
 *     handles it.
 *
 * Behaviour: pulls `token` from route.params, calls
 * `crmService.connect('serviceflow', { token })`, shows a result
 * card, lets the user dismiss back to wherever they came from.
 */
export default function CRMRedeemScreen({ route, navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const params = route?.params || {};
  // Deep-link query params land here (token, workspace, …). Provider
  // defaults to serviceflow since that's the only CRM today, but the
  // route is provider-agnostic for future adapters.
  const provider = params.provider || 'serviceflow';
  const token = params.token;
  const workspaceFromUrl = params.workspace || null;

  // PhotoContext handles for the immediate post-connect sync so SF
  // jobs materialise into the Projects list without waiting for the
  // ServiceFlowSyncTrigger's next foreground pass (which requires the
  // user to background + reopen the app).
  const { projects, createProject: ctxCreateProject, patchProject } = usePhotos();

  const [state, setState] = useState('redeeming'); // redeeming | success | error
  const [errorMessage, setErrorMessage] = useState(null);
  const [workspace, setWorkspace] = useState(null);

  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMessage(t('crmRedeem.missingToken', { defaultValue: 'No connection token in the link.' }));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await crmService.connect(provider, { token });
        if (cancelled) return;
        if (result?.success) {
          setWorkspace(result.connection || null);
          setState('success');
          // Fire an immediate sync so the admin's Projects list
          // populates with SF jobs right away — mirrors the same
          // post-connect behaviour in CloudSyncScreen's paste-in
          // path. Best-effort; sync errors are logged only.
          try {
            const syncResult = await syncServiceFlowJobs({ projects, createProject: ctxCreateProject, patchProject });
            console.warn('[ServiceFlow] post-connect sync (deep link)', syncResult);
          } catch (syncErr) {
            console.warn('[ServiceFlow] post-connect sync threw:', syncErr?.message);
          }
        } else {
          setErrorMessage(result?.error || t('crmRedeem.failedGeneric', { defaultValue: 'Could not connect.' }));
          setState('error');
        }
      } catch (e) {
        if (cancelled) return;
        setErrorMessage(e?.message || t('crmRedeem.failedGeneric', { defaultValue: 'Could not connect.' }));
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token, provider]);

  const handleDone = () => {
    // Try to pop back to Settings if it's in the stack; else go to
    // root and let the user navigate naturally. Tabs-based root
    // means goBack from a freshly-opened deep-link could be a no-op,
    // so reset to the Settings tab as the fallback.
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Settings' }] });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerSpacer} />

      <View style={styles.card}>
        {state === 'redeeming' && (
          <>
            <View style={styles.iconWrap}>
              <ActivityIndicator size="large" color="#1E1E1E" />
            </View>
            <Text style={styles.title}>
              {t('crmRedeem.connectingTitle', { defaultValue: 'Connecting to Service Flow…' })}
            </Text>
            <Text style={styles.body}>
              {t('crmRedeem.connectingBody', { defaultValue: 'Setting up the link between this device and your Service Flow workspace.' })}
            </Text>
          </>
        )}

        {state === 'success' && (
          <>
            <View style={[styles.iconWrap, styles.iconWrapSuccess]}>
              <Ionicons name="checkmark-circle" size={40} color="#1B7F3A" />
            </View>
            <Text style={styles.title}>
              {t('crmRedeem.successTitle', { defaultValue: 'Connected' })}
            </Text>
            <Text style={styles.body}>
              {workspace?.workspaceName
                ? t('crmRedeem.successWorkspace', {
                    workspace: workspace.workspaceName,
                    defaultValue: `Linked to ${workspace.workspaceName}. New projects will sync with Service Flow.`,
                  })
                : t('crmRedeem.successBody', {
                    defaultValue: 'Your Service Flow workspace is linked. New projects will sync.',
                  })}
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleDone} activeOpacity={0.85}>
              <Text style={styles.primaryButtonText}>
                {t('common.done', { defaultValue: 'Done' })}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'error' && (
          <>
            <View style={[styles.iconWrap, styles.iconWrapError]}>
              <Ionicons name="close-circle" size={40} color="#C0392B" />
            </View>
            <Text style={styles.title}>
              {t('crmRedeem.errorTitle', { defaultValue: 'Couldn’t connect' })}
            </Text>
            <Text style={styles.body}>{errorMessage}</Text>
            <Text style={styles.helper}>
              {t('crmRedeem.errorHint', {
                defaultValue: 'The link may have expired (one-time, 60-second window). Try connecting again from Service Flow.',
              })}
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleDone} activeOpacity={0.85}>
              <Text style={styles.primaryButtonText}>
                {t('common.close', { defaultValue: 'Close' })}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.surfaceElevated },
  headerSpacer: { height: 24 },
  card: {
    marginHorizontal: 22,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 2,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  iconWrapSuccess: { backgroundColor: '#E6F4EC' },
  iconWrapError: { backgroundColor: '#FDECEA' },
  title: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 19,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 6,
  },
  body: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '500',
    color: '#444',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 14,
  },
  helper: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    color: theme.textMuted,
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 14,
  },
  primaryButton: {
    backgroundColor: '#F2C31B',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 999,
  },
  primaryButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
});
