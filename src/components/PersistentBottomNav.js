import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../constants/fonts';
import { useTheme } from '../hooks/useTheme';

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
  if (!currentRoute || HIDDEN_ON.has(currentRoute)) return null;
  const activeTab = resolveActiveTab(currentRoute);
  const isDark = theme.mode === 'dark';

  const go = (tab) => {
    if (activeTab === tab) return;
    // Every tab lands on its corresponding main page (Home / Projects
    // / Studio grid / Settings) regardless of how deep the user is in
    // the current stack. reset() blows away the nested route history
    // so back-button behavior matches the user's mental model — "I
    // tapped Settings, now Back closes the app" rather than "Back
    // takes me 8 screens deep into where I was before."
    navigationRef.current?.reset({ index: 0, routes: [{ name: tab }] });
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
        label="Capture"
        inactiveTint={inactiveTint}
        activeTint={activeTint}
        activeBg={theme.navActive}
        isDark={isDark}
      />
      <NavItem
        active={activeTab === 'Projects'}
        onPress={() => go('Projects')}
        iconSource={require('../../assets/icons/projects.png')}
        label="Projects"
        inactiveTint={inactiveTint}
        activeTint={activeTint}
        activeBg={theme.navActive}
        isDark={isDark}
      />
      <NavItem
        active={activeTab === 'Studio'}
        onPress={() => go('Studio')}
        ionicon="brush-outline"
        label="Edit"
        inactiveTint={inactiveTint}
        activeTint={activeTint}
        activeBg={theme.navActive}
        isDark={isDark}
      />
      <NavItem
        active={activeTab === 'Settings'}
        onPress={() => go('Settings')}
        iconSource={require('../../assets/icons/settings.png')}
        label="Settings"
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
          style={[
            styles.icon,
            // PNG icons are dark-on-light. In dark mode we tint them by
            // hiding the underlying alpha-mask via a colored overlay.
            isDark && { tintColor: tint, opacity: active ? 1 : 0.9 },
            !isDark && !active && { opacity: 0.62 },
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
