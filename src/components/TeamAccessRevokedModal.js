import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAdmin } from '../context/AdminContext';
import { FONTS } from '../constants/fonts';
import { useTheme } from '../hooks/useTheme';

/**
 * TeamAccessRevokedModal — full-screen blocking modal shown on
 * cold-start / foreground when the proxy tells us this team-member
 * token is no longer valid (403 from the /join revalidation ping).
 *
 * Mounted at App.js root INSIDE AdminProvider so `teamRevokedInfo`
 * is reachable and the modal appears over every screen. Same
 * placement pattern as TrialNotificationModal.
 *
 * Two actions:
 *   - "Contact admin" — mailto: with admin's email (best-effort,
 *     no-op if we don't have their address on file).
 *   - "Continue on my own" — calls acknowledgeTeamRevoked which
 *     wipes SF-synced projects, drops team_member mode, reloads.
 */
export default function TeamAccessRevokedModal() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { teamRevokedInfo, acknowledgeTeamRevoked } = useAdmin();

  if (!teamRevokedInfo) return null;

  const adminName = teamRevokedInfo.adminName;
  const adminEmail = teamRevokedInfo.adminEmail;
  const teamName = teamRevokedInfo.teamName;

  const handleContactAdmin = async () => {
    if (!adminEmail) {
      Alert.alert(
        t('teamRevoked.noContactTitle', { defaultValue: 'No contact info' }),
        t('teamRevoked.noContactBody', {
          defaultValue: 'We don\'t have your admin\'s email on file. Please reach out to them directly.',
        }),
      );
      return;
    }
    const subject = encodeURIComponent(
      t('teamRevoked.mailSubject', {
        defaultValue: 'ProofPix team access',
      }),
    );
    const body = encodeURIComponent(
      t('teamRevoked.mailBody', {
        defaultValue: 'Hi, my ProofPix team access was revoked. Could you re-invite me?',
      }),
    );
    const url = `mailto:${adminEmail}?subject=${subject}&body=${body}`;
    try {
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('teamRevoked.mailFailed', {
          defaultValue: 'Could not open the email app. Please contact your admin directly.',
        }),
      );
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => { /* non-dismissable — must pick an action */ }}
    >
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed-outline" size={30} color="#C0392B" />
          </View>
          <Text style={styles.title}>
            {t('teamRevoked.title', { defaultValue: 'Team access revoked' })}
          </Text>
          <Text style={styles.body}>
            {teamName
              ? t('teamRevoked.bodyWithTeam', {
                  team: teamName,
                  defaultValue: `Your admin has removed you from ${teamName}. Projects synced from the team will be cleared. You can contact your admin to be re-invited, or continue on your own with a 7-day free trial.`,
                })
              : t('teamRevoked.body', {
                  defaultValue: 'Your admin has removed you from the team. Projects synced from the team will be cleared. You can contact your admin to be re-invited, or continue on your own with a 7-day free trial.',
                })}
          </Text>

          {adminName || adminEmail ? (
            <View style={styles.adminBox}>
              <Text style={styles.adminLabel}>
                {t('teamRevoked.adminLabel', { defaultValue: 'Your admin' })}
              </Text>
              {adminName ? <Text style={styles.adminName}>{adminName}</Text> : null}
              {adminEmail ? <Text style={styles.adminEmail} selectable>{adminEmail}</Text> : null}
            </View>
          ) : null}

          {adminEmail ? (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleContactAdmin}
              activeOpacity={0.85}
            >
              <Ionicons name="mail-outline" size={17} color={theme.textPrimary} />
              <Text style={styles.secondaryButtonText}>
                {t('teamRevoked.contactAdmin', { defaultValue: 'Contact admin' })}
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={acknowledgeTeamRevoked}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>
              {t('teamRevoked.continueOnMyOwn', { defaultValue: 'Start 7-day trial' })}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#FDECEA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 20,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '500',
    color: theme.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18,
  },
  adminBox: {
    width: '100%',
    padding: 14,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    marginBottom: 18,
    alignItems: 'center',
  },
  adminLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: theme.textMuted,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  adminName: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 2,
  },
  adminEmail: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '500',
    color: theme.textPrimary,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 10,
  },
  secondaryButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#F2C31B',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15.5,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
});
