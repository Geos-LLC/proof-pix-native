import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../constants/fonts';

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
  if (!currentRoute || HIDDEN_ON.has(currentRoute)) return null;
  const activeTab = resolveActiveTab(currentRoute);

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

  return (
    <View style={[styles.pill, { bottom: 4 + insets.bottom }]} pointerEvents="box-none">
      <TouchableOpacity
        style={[styles.item, activeTab === 'Home' && styles.itemActive]}
        onPress={() => go('Home')}
      >
        <Image source={require('../../assets/icons/home.png')} style={styles.icon} resizeMode="contain" />
        <Text style={[styles.text, activeTab === 'Home' && styles.textActive]}>Capture</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.item, activeTab === 'Projects' && styles.itemActive]}
        onPress={() => go('Projects')}
      >
        <Image source={require('../../assets/icons/projects.png')} style={styles.icon} resizeMode="contain" />
        <Text style={[styles.text, activeTab === 'Projects' && styles.textActive]}>Projects</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.item, activeTab === 'Studio' && styles.itemActive]}
        onPress={() => go('Studio')}
      >
        <Ionicons name="brush-outline" size={22} color="#1E1E1E" />
        <Text style={[styles.text, activeTab === 'Studio' && styles.textActive]}>Edit</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.item, activeTab === 'Settings' && styles.itemActive]}
        onPress={() => go('Settings')}
      >
        <Image source={require('../../assets/icons/settings.png')} style={styles.icon} resizeMode="contain" />
        <Text style={[styles.text, activeTab === 'Settings' && styles.textActive]}>Settings</Text>
      </TouchableOpacity>
    </View>
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
    backgroundColor: '#f4f4f4',
    borderRadius: 296,
    height: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 100,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 1,
    height: 50,
  },
  itemActive: {
    backgroundColor: '#E0E0E0',
    borderRadius: 100,
    marginHorizontal: -7,
  },
  icon: { width: 22, height: 22 },
  text: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '510',
    color: '#1E1E1E',
    marginTop: 1,
    textAlign: 'center',
    letterSpacing: -0.1,
    lineHeight: 12,
  },
  textActive: { fontWeight: '590' },
});
