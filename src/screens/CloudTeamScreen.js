import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { FONTS } from '../constants/fonts';
import dropboxAuthService from '../services/dropboxAuthService';

// CloudTeamScreen — design 35.
//
// Visual: light page, centered "Cloud & Team" header with back chevron;
// CONNECTED STORAGE eyebrow + PRO badge, then 3 rows (Google Drive,
// Dropbox, Background upload). TEAM eyebrow + BUSINESS badge, then a
// centered card with QR icon + "Invite your crew" + "Generate invite"
// dark CTA.
//
// Action wiring:
// - Google Drive / Dropbox Connect / Manage taps navigate back to
//   Settings with a `scrollToCloudSync: true` param so the existing
//   sign-in handlers in SettingsScreen run unchanged. (Re-implementing
//   the whole OAuth flow here would duplicate 200+ lines of admin
//   context plumbing; the existing path is the source of truth.)
// - Background upload: persists a local boolean to AsyncStorage
//   (`@cloud_team_bg_upload_pref`) — a future pass can promote this
//   into SettingsContext and wire it to the actual scheduler.
// - Generate invite: navigates back to Settings with
//   `{ scrollToCloudSync: true, openTeam: true }` so the existing
//   team invite flow runs.
const BG_UPLOAD_KEY = '@cloud_team_bg_upload_pref';

export default function CloudTeamScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, userInfo, accountType } = useAdmin();
  const { userPlan } = useSettings();

  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [bgUploadEnabled, setBgUploadEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const pref = await AsyncStorage.getItem(BG_UPLOAD_KEY);
        if (pref !== null) setBgUploadEnabled(pref === 'true');
      } catch {}
      try {
        setDropboxConnected(dropboxAuthService.isAuthenticated());
      } catch {}
    })();
  }, []);

  const toggleBgUpload = async (next) => {
    setBgUploadEnabled(next);
    try { await AsyncStorage.setItem(BG_UPLOAD_KEY, String(next)); } catch {}
  };

  const handleGoogleDrive = () => {
    // Route back to the Settings cloud-sync section — the existing
    // sign-in / sign-out / Manage UI lives there.
    navigation.navigate('Settings', { scrollToCloudSync: true });
  };

  const handleDropbox = () => {
    navigation.navigate('Settings', { scrollToCloudSync: true });
  };

  const handleGenerateInvite = () => {
    navigation.navigate('Settings', { scrollToCloudSync: true, openTeam: true });
  };

  const isPro = userPlan === 'pro' || userPlan === 'business' || userPlan === 'enterprise';
  const isBusiness = userPlan === 'business' || userPlan === 'enterprise';

  const googleConnected = isAuthenticated && accountType === 'google';
  const googleAccountLabel = googleConnected
    ? (userInfo?.email || userInfo?.name || t('cloudTeam.connected', { defaultValue: 'Connected' }))
    : t('cloudTeam.notConnected', { defaultValue: 'Not connected' });

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
        <Text style={styles.headerTitle}>
          {t('cloudTeam.title', { defaultValue: 'Cloud & Team' })}
        </Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {/* CONNECTED STORAGE eyebrow + PRO badge */}
        <View style={styles.eyebrowRow}>
          <Text style={styles.eyebrow}>
            {t('cloudTeam.connectedStorage', { defaultValue: 'Connected storage' })}
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
              <Text style={styles.rowTitle}>
                {t('cloudTeam.googleDrive', { defaultValue: 'Google Drive' })}
              </Text>
              <Text
                style={[styles.rowSub, googleConnected && styles.rowSubSuccess]}
                numberOfLines={1}
              >
                {googleAccountLabel}
              </Text>
            </View>
            <View style={[styles.actionPill, googleConnected ? styles.actionPillGhost : styles.actionPillAccent]}>
              <Text style={[styles.actionPillText, googleConnected ? styles.actionPillTextGhost : styles.actionPillTextAccent]}>
                {googleConnected
                  ? t('cloudTeam.manage', { defaultValue: 'Manage' })
                  : t('cloudTeam.connect', { defaultValue: 'Connect' })}
              </Text>
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
              <Text style={styles.rowTitle}>
                {t('cloudTeam.dropbox', { defaultValue: 'Dropbox' })}
              </Text>
              <Text
                style={[styles.rowSub, dropboxConnected && styles.rowSubSuccess]}
                numberOfLines={1}
              >
                {dropboxConnected
                  ? t('cloudTeam.connected', { defaultValue: 'Connected' })
                  : t('cloudTeam.notConnected', { defaultValue: 'Not connected' })}
              </Text>
            </View>
            <View style={[styles.actionPill, dropboxConnected ? styles.actionPillGhost : styles.actionPillAccent]}>
              <Text style={[styles.actionPillText, dropboxConnected ? styles.actionPillTextGhost : styles.actionPillTextAccent]}>
                {dropboxConnected
                  ? t('cloudTeam.manage', { defaultValue: 'Manage' })
                  : t('cloudTeam.connect', { defaultValue: 'Connect' })}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Background upload toggle */}
          <View style={styles.row}>
            <View style={styles.rowIc}>
              <Ionicons name="cloud-upload-outline" size={19} color="#1E1E1E" />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>
                {t('cloudTeam.backgroundUpload', { defaultValue: 'Background upload' })}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {t('cloudTeam.backgroundUploadSub', { defaultValue: 'Auto-sync new photos' })}
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

        {/* TEAM eyebrow + BUSINESS badge */}
        <View style={[styles.eyebrowRow, { marginTop: 18 }]}>
          <Text style={styles.eyebrow}>
            {t('cloudTeam.team', { defaultValue: 'Team' })}
          </Text>
          <View style={styles.businessBadge}>
            <Text style={styles.businessBadgeText}>BUSINESS</Text>
          </View>
        </View>

        <View style={styles.teamCard}>
          <View style={styles.teamCardIcon}>
            <Ionicons name="qr-code-outline" size={26} color="#1E1E1E" />
          </View>
          <Text style={styles.teamCardTitle}>
            {t('cloudTeam.inviteYourCrew', { defaultValue: 'Invite your crew' })}
          </Text>
          <Text style={styles.teamCardSub}>
            {t('cloudTeam.inviteYourCrewSub', {
              defaultValue: 'Share a link or QR code. Members capture into shared projects.',
            })}
          </Text>
          <TouchableOpacity
            style={[styles.darkButton, !isBusiness && styles.darkButtonDisabled]}
            onPress={handleGenerateInvite}
            disabled={!isBusiness}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text style={styles.darkButtonText}>
              {t('cloudTeam.generateInvite', { defaultValue: 'Generate invite' })}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  // Header
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

  // Eyebrow + badge
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

  // Row group
  rowGroup: {
    marginHorizontal: 18,
    gap: 8,
  },
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
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIcConnected: {
    backgroundColor: '#FFF4C2',
  },
  rowMeta: {
    flex: 1,
    minWidth: 0,
  },
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
  rowSubSuccess: {
    color: '#34C759',
  },

  // Action pill (Connect / Manage)
  actionPill: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillAccent: {
    backgroundColor: '#F2C31B',
  },
  actionPillGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#D0D0D0',
  },
  actionPillText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  actionPillTextAccent: {
    color: '#1E1E1E',
  },
  actionPillTextGhost: {
    color: '#1E1E1E',
  },

  // Team card
  teamCard: {
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
  teamCardIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  teamCardTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
    marginBottom: 4,
    textAlign: 'center',
  },
  teamCardSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12.5,
    fontWeight: '500',
    color: '#666666',
    letterSpacing: -0.1,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 8,
  },
  darkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1E1E1E',
    height: 42,
    paddingHorizontal: 20,
    borderRadius: 13,
    alignSelf: 'stretch',
  },
  darkButtonDisabled: {
    opacity: 0.5,
  },
  darkButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
});
