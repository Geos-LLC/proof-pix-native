import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect, Line, G } from 'react-native-svg';

import { LAYOUTS } from '../reports';
import { useTheme } from '../hooks/useTheme';

// Small inline SVGs — one per layout — so the picker doesn't need a
// new asset file per style. Each thumbnail is a 60×42 sketch of the
// layout's visual rhythm; the user reads them in a second.
const Thumbnail = ({ id, color, accent }) => {
  const w = 60, h = 42;
  switch (id) {
    case 'room-by-room':
      return (
        <Svg width={w} height={h}>
          <Rect x={4}  y={6}  width={24} height={14} fill={color} />
          <Rect x={32} y={6}  width={24} height={14} fill={accent} />
          <Rect x={4}  y={24} width={24} height={14} fill={color} />
          <Rect x={32} y={24} width={24} height={14} fill={accent} />
        </Svg>
      );
    case 'before-after':
      return (
        <Svg width={w} height={h}>
          <Rect x={4}  y={6}  width={24} height={30} fill={color} />
          <Rect x={32} y={6}  width={24} height={30} fill={accent} />
          <Line x1={30} y1={3} x2={30} y2={39} stroke={accent} strokeWidth={1} strokeDasharray="2,2" />
        </Svg>
      );
    case 'timeline':
      return (
        <Svg width={w} height={h}>
          <Line x1={10} y1={4} x2={10} y2={38} stroke={accent} strokeWidth={1.5} />
          <Rect x={16} y={4}  width={40} height={9} fill={color} />
          <Rect x={16} y={16} width={40} height={9} fill={color} />
          <Rect x={16} y={28} width={40} height={9} fill={accent} />
        </Svg>
      );
    case 'gallery':
      return (
        <Svg width={w} height={h}>
          <G>
            <Rect x={4}  y={6}  width={16} height={11} fill={color} />
            <Rect x={22} y={6}  width={16} height={11} fill={color} />
            <Rect x={40} y={6}  width={16} height={11} fill={color} />
            <Rect x={4}  y={19} width={16} height={11} fill={color} />
            <Rect x={22} y={19} width={16} height={11} fill={color} />
            <Rect x={40} y={19} width={16} height={11} fill={color} />
            <Rect x={4}  y={32} width={16} height={6}  fill={color} />
            <Rect x={22} y={32} width={16} height={6}  fill={color} />
            <Rect x={40} y={32} width={16} height={6}  fill={color} />
          </G>
        </Svg>
      );
    case 'executive-summary':
      return (
        <Svg width={w} height={h}>
          <Rect x={4}  y={4}  width={52} height={14} fill={accent} />
          <Rect x={4}  y={20} width={16} height={6}  fill={color} />
          <Rect x={22} y={20} width={16} height={6}  fill={color} />
          <Rect x={40} y={20} width={16} height={6}  fill={color} />
          <Rect x={4}  y={28} width={24} height={10} fill={color} />
          <Rect x={32} y={28} width={24} height={10} fill={color} />
        </Svg>
      );
    case 'documentation':
      return (
        <Svg width={w} height={h}>
          <Rect x={4}  y={6}  width={18} height={14} fill={color} />
          <Rect x={26} y={6}  width={30} height={3} fill={accent} />
          <Rect x={26} y={11} width={26} height={3} fill={accent} />
          <Rect x={26} y={16} width={22} height={3} fill={accent} />
          <Rect x={4}  y={24} width={18} height={14} fill={color} />
          <Rect x={26} y={24} width={30} height={3} fill={accent} />
          <Rect x={26} y={29} width={26} height={3} fill={accent} />
          <Rect x={26} y={34} width={22} height={3} fill={accent} />
        </Svg>
      );
    default:
      return null;
  }
};

export default function ReportStyleScreen({ route, navigation }) {
  const theme = useTheme();
  const initial = route?.params?.current || LAYOUTS[0].id;
  const [selectedId, setSelectedId] = useState(initial);

  const items = useMemo(
    () => LAYOUTS.map((l) => ({ id: l.id, name: l.name, description: l.description })),
    [],
  );

  // Hand the selection back to the editor via a callback param.
  // The route-param round-trip we used before was unreliable —
  // navigate(...merge:true...) sometimes pushed a new editor instance
  // instead of merging onto the existing one, and the new instance's
  // state would seed from the saved layout rather than the pick.
  // A callback runs synchronously in the editor's own closure so the
  // state setter lands on the right component instance.
  const apply = (id) => {
    const cb = route?.params?.onSelect;
    console.warn('[Report] ReportStyleScreen.apply', { id, hasCallback: typeof cb === 'function' });
    if (typeof cb === 'function') cb(id);
    navigation.goBack();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Report Style</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {items.map((it) => {
          const active = it.id === selectedId;
          return (
            <TouchableOpacity
              key={it.id}
              activeOpacity={0.85}
              onPress={() => {
                setSelectedId(it.id);
                apply(it.id);
              }}
              style={[
                styles.card,
                {
                  backgroundColor: theme.surface,
                  borderColor: active ? theme.accent : theme.border,
                  borderWidth: active ? 2 : 1,
                },
              ]}
            >
              <View style={[styles.thumb, { backgroundColor: theme.background }]}>
                <Thumbnail
                  id={it.id}
                  color={theme.textMuted || '#C4C4C4'}
                  accent={theme.accent}
                />
              </View>
              <View style={styles.body}>
                <View style={styles.titleRow}>
                  <Text style={[styles.name, { color: theme.textPrimary }]}>{it.name}</Text>
                  {active && (
                    <Ionicons name="checkmark-circle" size={20} color={theme.accent} />
                  )}
                </View>
                <Text style={[styles.description, { color: theme.textSecondary }]}>
                  {it.description}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  thumb: {
    width: 76, height: 56,
    borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: { fontSize: 16, fontWeight: '600' },
  description: { fontSize: 12, marginTop: 4 },
});
