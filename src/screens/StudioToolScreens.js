import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../constants/fonts';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';

// Common scaffold for each Studio sub-screen. Header with back arrow, title,
// Reset button on the right (no-op for now), body content via children, and
// an "Apply to: This Photo / This Room / Project" scope picker + Save bar.

const APPLY_SCOPES = [
  { key: 'photo', label: 'This Photo' },
  { key: 'room', label: 'This Room' },
  { key: 'project', label: 'Project' },
];

function ToolScaffold({ navigation, title, onReset, scope, setScope, onSave, children }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        <TouchableOpacity
          onPress={onReset}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.resetText, { color: theme.textSecondary }]}>Reset</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {children}

        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>APPLY TO</Text>
        <View style={styles.scopeRow}>
          {APPLY_SCOPES.map((s) => {
            const isActive = scope === s.key;
            return (
              <TouchableOpacity
                key={s.key}
                style={[
                  styles.scopeBtn,
                  {
                    backgroundColor: isActive ? theme.accent : theme.surface,
                    borderColor: isActive ? theme.accent : theme.border,
                  },
                ]}
                onPress={() => setScope(s.key)}
              >
                <Text
                  style={[
                    styles.scopeBtnText,
                    { color: isActive ? theme.accentText : theme.textPrimary },
                  ]}
                >
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View
        style={[
          styles.saveBar,
          { backgroundColor: theme.background, paddingBottom: 12 + insets.bottom + 50 + 16 },
        ]}
      >
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: theme.accent }]}
          onPress={onSave || (() => navigation.goBack())}
        >
          <Text style={[styles.saveBtnText, { color: theme.accentText }]}>Save</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ---- LAYOUT --------------------------------------------------------------

const LAYOUT_VIEW_MODES = [
  { key: 'overlay', label: 'Overlay' },
  { key: 'split', label: 'Split' },
  { key: 'side', label: 'Side by Side' },
];

const LAYOUT_FORMATS = [
  { key: 'original', label: 'Original' },
  { key: 'square', label: 'Square' },
  { key: 'story', label: 'Story (9:16)' },
  { key: 'wide', label: '16:9' },
];

export function StudioLayoutScreen({ route, navigation }) {
  const theme = useTheme();
  const [viewMode, setViewMode] = useState('split');
  const [format, setFormat] = useState('original');
  const [scope, setScope] = useState('photo');

  return (
    <ToolScaffold navigation={navigation} title="Layout" scope={scope} setScope={setScope}>
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>VIEW MODE</Text>
      <View style={styles.chipRow}>
        {LAYOUT_VIEW_MODES.map((m) => {
          const isActive = viewMode === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[
                styles.chip,
                {
                  backgroundColor: isActive ? theme.accent : theme.surface,
                  borderColor: isActive ? theme.accent : theme.border,
                },
              ]}
              onPress={() => setViewMode(m.key)}
            >
              <Text style={[styles.chipText, { color: isActive ? theme.accentText : theme.textPrimary }]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>FORMAT</Text>
      <View style={styles.chipRow}>
        {LAYOUT_FORMATS.map((f) => {
          const isActive = format === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.chip,
                {
                  backgroundColor: isActive ? theme.accent : theme.surface,
                  borderColor: isActive ? theme.accent : theme.border,
                },
              ]}
              onPress={() => setFormat(f.key)}
            >
              <Text style={[styles.chipText, { color: isActive ? theme.accentText : theme.textPrimary }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>ADJUST</Text>
      <View style={[styles.adjustHint, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="hand-left-outline" size={20} color={theme.textSecondary} />
        <Text style={[styles.adjustHintText, { color: theme.textSecondary }]}>
          Pinch to zoom · Drag to move · Rotate with two fingers
        </Text>
      </View>
    </ToolScaffold>
  );
}

// ---- LABELS --------------------------------------------------------------

const LABEL_POSITIONS = [
  { key: 'tl', icon: 'square-outline' },
  { key: 'tr', icon: 'square-outline' },
  { key: 'center', icon: 'tablet-portrait-outline' },
  { key: 'bl', icon: 'square-outline' },
  { key: 'br', icon: 'square-outline' },
];

export function StudioLabelsScreen({ route, navigation }) {
  const theme = useTheme();
  // The Show Labels switch is the same global setting Settings + the
  // Gallery toggle write to — local useState here would have been a
  // no-op that silently lied to the user. Reading from SettingsContext
  // wires this switch into the one source of truth.
  const { showLabels, toggleLabels } = useSettings();
  const [beforeLabel, setBeforeLabel] = useState('Start');
  const [progressLabel, setProgressLabel] = useState('Progress');
  const [afterLabel, setAfterLabel] = useState('Finished');
  const [position, setPosition] = useState('tr');
  const [scope, setScope] = useState('photo');

  return (
    <ToolScaffold navigation={navigation} title="Labels" scope={scope} setScope={setScope}>
      <View style={[styles.toggleRow, { backgroundColor: theme.surface }]}>
        <Text style={[styles.toggleLabel, { color: theme.textPrimary }]}>Show Labels</Text>
        <Switch
          value={!!showLabels}
          onValueChange={toggleLabels}
          trackColor={{ false: '#E0E0E0', true: theme.accent }}
          thumbColor="#FFFFFF"
        />
      </View>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>LABEL TEXT</Text>
      <View style={styles.labelInputsBlock}>
        <LabelInput theme={theme} label="Before" value={beforeLabel} onChange={setBeforeLabel} />
        <LabelInput theme={theme} label="Progress" value={progressLabel} onChange={setProgressLabel} />
        <LabelInput theme={theme} label="After" value={afterLabel} onChange={setAfterLabel} />
      </View>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>POSITION</Text>
      <View style={styles.positionRow}>
        {LABEL_POSITIONS.map((p) => {
          const isActive = position === p.key;
          return (
            <TouchableOpacity
              key={p.key}
              style={[
                styles.positionBtn,
                {
                  backgroundColor: isActive ? theme.accent : theme.surface,
                  borderColor: isActive ? theme.accent : theme.border,
                },
              ]}
              onPress={() => setPosition(p.key)}
            >
              <Ionicons
                name={p.icon}
                size={20}
                color={isActive ? theme.accentText : theme.textPrimary}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    </ToolScaffold>
  );
}

function LabelInput({ theme, label, value, onChange }) {
  return (
    <View style={[styles.labelInputRow, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.labelInputName, { color: theme.textSecondary }]}>{label}</Text>
      <View style={styles.labelInputBox}>
        <Text style={[styles.labelInputValue, { color: theme.textPrimary }]}>{value}</Text>
      </View>
    </View>
  );
}

// ---- NOTES ---------------------------------------------------------------

export function StudioNotesScreen({ route, navigation }) {
  const theme = useTheme();
  const [tab, setTab] = useState('notes');
  const [note, setNote] = useState('');
  const [noteType, setNoteType] = useState('report');
  const [scope, setScope] = useState('photo');

  return (
    <ToolScaffold navigation={navigation} title="Notes" scope={scope} setScope={setScope}>
      <View style={styles.notesTabsRow}>
        {[
          { key: 'notes', label: 'Notes', icon: 'document-text-outline' },
          { key: 'voice', label: 'Voice', icon: 'mic-outline' },
          { key: 'location', label: 'Location', icon: 'location-outline' },
        ].map((t) => {
          const isActive = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[
                styles.notesTab,
                {
                  backgroundColor: isActive ? theme.accent : theme.surface,
                  borderColor: isActive ? theme.accent : theme.border,
                },
              ]}
              onPress={() => setTab(t.key)}
            >
              <Ionicons
                name={t.icon}
                size={16}
                color={isActive ? theme.accentText : theme.textPrimary}
              />
              <Text style={[styles.notesTabText, { color: isActive ? theme.accentText : theme.textPrimary }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.notesBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.notesBoxPlaceholder, { color: theme.textMuted }]}>
          {tab === 'notes' && 'Add a note about this photo…'}
          {tab === 'voice' && 'Voice recorder coming next pass — tap to record once wired.'}
          {tab === 'location' && 'GPS location attachment coming next pass.'}
        </Text>
      </View>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>NOTE TYPE</Text>
      <View style={styles.chipRow}>
        {[
          { key: 'report', label: 'Report Note' },
          { key: 'private', label: 'Private Note' },
        ].map((nt) => {
          const isActive = noteType === nt.key;
          return (
            <TouchableOpacity
              key={nt.key}
              style={[
                styles.chip,
                {
                  backgroundColor: isActive ? theme.accent : theme.surface,
                  borderColor: isActive ? theme.accent : theme.border,
                },
              ]}
              onPress={() => setNoteType(nt.key)}
            >
              <Text style={[styles.chipText, { color: isActive ? theme.accentText : theme.textPrimary }]}>
                {nt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ToolScaffold>
  );
}

// ---- BRANDING ------------------------------------------------------------

export function StudioBrandingScreen({ route, navigation }) {
  const theme = useTheme();
  const [logo, setLogo] = useState(true);
  const [watermark, setWatermark] = useState(true);
  const [timestamp, setTimestamp] = useState(true);
  const [metadataBadge, setMetadataBadge] = useState(false);
  const [position, setPosition] = useState('br');
  const [scope, setScope] = useState('photo');

  return (
    <ToolScaffold navigation={navigation} title="Branding" scope={scope} setScope={setScope}>
      <BrandToggle theme={theme} label="Logo" value={logo} onChange={setLogo} hint="ProofPix" />
      <BrandToggle theme={theme} label="Watermark" value={watermark} onChange={setWatermark} hint="ProofPix" />
      <BrandToggle theme={theme} label="Timestamp" value={timestamp} onChange={setTimestamp} hint="Auto" />
      <BrandToggle theme={theme} label="Metadata Badge" value={metadataBadge} onChange={setMetadataBadge} hint="Off" />

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>POSITION</Text>
      <View style={styles.positionRow}>
        {LABEL_POSITIONS.map((p) => {
          const isActive = position === p.key;
          return (
            <TouchableOpacity
              key={p.key}
              style={[
                styles.positionBtn,
                {
                  backgroundColor: isActive ? theme.accent : theme.surface,
                  borderColor: isActive ? theme.accent : theme.border,
                },
              ]}
              onPress={() => setPosition(p.key)}
            >
              <Ionicons name={p.icon} size={20} color={isActive ? theme.accentText : theme.textPrimary} />
            </TouchableOpacity>
          );
        })}
      </View>
    </ToolScaffold>
  );
}

function BrandToggle({ theme, label, value, onChange, hint }) {
  return (
    <View style={[styles.toggleRow, { backgroundColor: theme.surface, marginTop: 8 }]}>
      <View>
        <Text style={[styles.toggleLabel, { color: theme.textPrimary }]}>{label}</Text>
        {hint ? <Text style={[styles.toggleHint, { color: theme.textMuted }]}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#E0E0E0', true: theme.accent }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

// ---- EXPORT --------------------------------------------------------------

export function StudioExportScreen({ route, navigation }) {
  const theme = useTheme();
  const [scope, setScope] = useState('photo');

  return (
    <ToolScaffold navigation={navigation} title="Export" scope={scope} setScope={setScope}>
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>EXPORT FORMAT</Text>
      <View style={[styles.notesBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.notesBoxPlaceholder, { color: theme.textMuted }]}>
          Export options coming next pass — choose format, resolution, and destination here.
        </Text>
      </View>
    </ToolScaffold>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 17,
    fontWeight: '700',
    marginHorizontal: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  resetText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  sectionLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  toggleLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
  },
  toggleHint: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    marginTop: 2,
  },
  scopeRow: { flexDirection: 'row', gap: 8 },
  scopeBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  scopeBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  saveBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  saveBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
  },
  adjustHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  adjustHintText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    flex: 1,
  },
  labelInputsBlock: {
    gap: 8,
  },
  labelInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  labelInputName: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
    width: 96,
  },
  labelInputBox: {
    flex: 1,
  },
  labelInputValue: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
  },
  positionRow: { flexDirection: 'row', gap: 8 },
  positionBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesTabsRow: { flexDirection: 'row', gap: 8 },
  notesTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  notesTabText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
  },
  notesBox: {
    minHeight: 120,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  notesBoxPlaceholder: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    lineHeight: 18,
  },
});
