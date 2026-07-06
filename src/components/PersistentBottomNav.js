import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import { useTheme } from '../hooks/useTheme';
import { useUiOverlayVisible } from './uiOverlayState';

// Routes where the bottom nav stays invisible — only the auth /
// onboarding flow, where there's no app shell yet to navigate
// between. Every other screen (Camera, StudioDetail, all the
// customization screens, etc.) shows the nav so the user can always
// hop straight back to a main page from wherever they are.
const HIDDEN_ON = new Set([
  'AuthLoading',
  'FirstLoad',
  'WelcomeSetup',
  'UserInfoSetup',
  'PermissionsSetup',
  'PlanSelection',
  'GoogleSignUp',
  'JoinTeam',
  'Invite',
  'LabelLanguageSetup',
  'SectionLanguageSetup',
  // Camera (capture viewfinder) — the floating nav pill overlaps the
  // capture row + Done ring at the bottom of the live view, so it's
  // hidden here. Users return via the Done button or the back gesture.
  'Camera',
  // StudioDetail (the photo-edit view) renders its OWN bottom toolbar
  // (Layout / Labels / Branding / Markup / Export). The persistent nav
  // sat right on top of it, so the user couldn't see / tap the edit
  // tools. Hidden here. Users navigate out via the back chevron + Save
  // button in the StudioScreen top header.
  'StudioDetail',
  // Fullscreen photo viewer routes — they render EnlargedPhotoViewer
  // edge-to-edge with their OWN bottom action row (Overlays toggle +
  // Share + Edit pencil). The persistent nav was floating right on top
  // of that row, hiding the Edit button entirely and making the
  // photo's bottom area unreadable. Users navigate out via the X close
  // button in the viewer header.
  'PhotoSetPreview',
  'PhotoDetail',
  'Gallery',
  // SharePreview is also a fullscreen EnlargedPhotoViewer with its own
  // Share button on the bottom row — the persistent nav pill sat
  // right on top of it. Users navigate out via the X close button.
  'SharePreview',
]);

// Sub-routes that conceptually belong to the Projects tab (so the active
// pill highlights "Projects" when the user is deep inside this flow).
const PROJECTS_TAB_ROUTES = new Set([
  'Projects',
  'ProjectDetail',
  'PhotoSetPreview',
  'PhotoDetail',
  'SectionDetail',
  'Gallery',
]);

const resolveActiveTab = (routeName) => {
  if (!routeName) return null;
  if (PROJECTS_TAB_ROUTES.has(routeName)) return 'Projects';
  if (routeName === 'Home') return 'Home';
  if (routeName === 'Studio' || routeName === 'StudioDetail') return 'Studio';
  if (routeName === 'Settings') return 'Settings';
  return null;
};

export default function PersistentBottomNav({ currentRoute, navigationRef }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { t } = useTranslation();
  // Screens with their own inline fullscreen overlays (HomeScreen's
  // tapped/fullScreen photo viewer, etc.) report visibility through
  // uiOverlayState. The route is still 'Home' while the overlay is up,
  // so route-based HIDDEN_ON alone can't catch it — this context flag
  // does. Reference-counted in the provider so two simultaneous
  // overlays both have to close before the nav reappears.
  const overlayVisible = useUiOverlayVisible();
  if (overlayVisible) return null;
  if (!currentRoute || HIDDEN_ON.has(currentRoute)) return null;
  const activeTab = resolveActiveTab(currentRoute);
  const isDark = theme.mode === 'dark';

  const go = (tab) => {
    const navRef = navigationRef?.current;
    if (!navRef) return;

    // Always dispatch the reset — even when activeTab === tab. The
    // reset remounts the destination screen, which dismisses any
    // local overlays the screen was rendering on top of itself
    // (HomeScreen's tappedFullPhoto enlarged view, for example).
    // Previously this no-op'd when activeTab matched, leaving the
    // user stuck inside their own overlay with no way out via the
    // bottom nav.
    //
    // Going through dispatch + CommonActions is the canonical path
    // React Navigation uses internally; on some iOS native-stack
    // configurations a direct navRef.reset(...) silently no-ops.
    try {
      navRef.dispatch(
        CommonActions.reset({ index: 0, routes: [{ name: tab }] })
      );
    } catch (_) {
      try { navRef.navigate(tab); } catch (_) {}
    }
  };

  const inactiveTint = theme.textSecondary;
  const activeTint = isDark ? theme.accent : theme.textPrimary;

  return (
    <View
      style={[
        styles.pill,
        {
          bottom: 4 + insets.bottom,
          backgroundColor: theme.navBar,
          borderColor: theme.border,
          ...theme.shadowPop,
        },
      ]}
      pointerEvents="box-none"
    >
      <NavItem
        active={activeTab === 'Home'}
        onPress={() => go('Home')}
        iconSource={require('../../assets/icons/home.png')}
        label={t('nav.capture')}
        inactiveTint={inactiveTint}
        activeTint={activeTint}
        activeBg={theme.navActive}
        isDark={isDark}
      />
      <NavItem
        active={activeTab === 'Projects'}
        onPress={() => go('Projects')}
        iconSource={require('../../assets/icons/projects.png')}
        label={t('nav.projects')}
        inactiveTint={inactiveTint}
        activeTint={activeTint}
        activeBg={theme.navActive}
        isDark={isDark}
      />
      <NavItem
        active={activeTab === 'Studio'}
        onPress={() => go('Studio')}
        ionicon="brush-outline"
        label={t('nav.edit')}
        inactiveTint={inactiveTint}
        activeTint={activeTint}
        activeBg={theme.navActive}
        isDark={isDark}
      />
      <NavItem
        active={activeTab === 'Settings'}
        onPress={() => go('Settings')}
        iconSource={require('../../assets/icons/settings.png')}
        label={t('nav.settings')}
        inactiveTint={inactiveTint}
        activeTint={activeTint}
        activeBg={theme.navActive}
        isDark={isDark}
      />
    </View>
  );
}

function NavItem({ active, onPress, iconSource, ionicon, label, inactiveTint, activeTint, activeBg, isDark }) {
  const tint = active ? activeTint : inactiveTint;
  return (
    <TouchableOpacity
      style={[styles.item, active && { backgroundColor: activeBg }, active && styles.itemActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {iconSource ? (
        <Image
          source={iconSource}
          // Always pass an explicit tintColor. RN Image doesn't clear a
          // previous tintColor when the style prop drops it, so the last
          // dark-mode tint would linger (or fall back to iOS's system
          // blue tint) after switching back to light. Setting it every
          // render keeps the color in sync with the active theme.
          style={[
            styles.icon,
            { tintColor: tint },
            !active && { opacity: isDark ? 0.9 : 0.62 },
          ]}
          resizeMode="contain"
        />
      ) : (
        <Ionicons name={ionicon} size={22} color={tint} />
      )}
      <Text style={[styles.text, { color: tint }, active && styles.textActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    height: 54,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 100,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 1,
    height: 46,
    marginVertical: 4,
    marginHorizontal: 4,
    borderRadius: 999,
  },
  itemActive: {
    marginHorizontal: 4,
  },
  icon: { width: 22, height: 22 },
  text: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '510',
    marginTop: 1,
    textAlign: 'center',
    letterSpacing: -0.1,
    lineHeight: 12,
  },
  textActive: { fontWeight: '700' },
});
