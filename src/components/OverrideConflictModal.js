// Confirmation modal shown when the user changes a GLOBAL label /
// watermark / logo / timestamp setting but some photos carry their own
// per-photo override for the same field(s). Surfaces the conflict so
// the user can pick which photos to bring along to the new default and
// which to leave on their custom value.
//
// Caller passes:
//   - photos: array of photo objects (id, uri, room, name, etc.) that
//     currently override the field(s) being changed
//   - title / description: human-facing copy
//   - onApply(photoIdsToOverwrite): user picked Apply. Clear overrides
//     on the listed ids, then proceed with the global write.
//   - onCancel(): user backed out; the global write SHOULD NOT happen.
//   - onSkipAll(): user kept all overrides — apply the global write
//     without touching any photo's overrides.

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity, Image, ScrollView, StyleSheet, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';

export default function OverrideConflictModal({
  visible,
  photos = [],
  title,
  description,
  onApply,
  onCancel,
  onSkipAll,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const titleText = title || t('overrideConflict.title');
  const descriptionText = description || t('overrideConflict.description');
  // Map of photo.id → boolean; true = will be overwritten on Apply.
  const [checked, setChecked] = useState({});

  // Reset selection every time the modal opens — default to ALL
  // photos checked so "Apply" matches the user's expectation that a
  // global change should propagate to every photo.
  useEffect(() => {
    if (!visible) return;
    const next = {};
    for (const p of photos) next[p.id] = true;
    setChecked(next);
  }, [visible, photos]);

  const total = photos.length;
  const selectedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked],
  );

  const toggle = (id) => setChecked((m) => ({ ...m, [id]: !m[id] }));

  const handleApply = () => {
    const ids = Object.entries(checked).filter(([, v]) => v).map(([k]) => k);
    onApply?.(ids);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.scrim} onPress={onCancel}>
        <Pressable
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={(e) => e.stopPropagation?.()}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.textPrimary }]}>{titleText}</Text>
            <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.desc, { color: theme.textSecondary }]}>{descriptionText}</Text>

          <View style={styles.selectionRow}>
            <Text style={[styles.selectionText, { color: theme.textSecondary }]}>
              {t('overrideConflict.selectionCount', { count: selectedCount, total })}
            </Text>
            <View style={styles.bulkRow}>
              <TouchableOpacity
                onPress={() => {
                  const next = {};
                  for (const p of photos) next[p.id] = true;
                  setChecked(next);
                }}
              >
                <Text style={[styles.bulkLink, { color: theme.accent }]}>{t('common.all')}</Text>
              </TouchableOpacity>
              <Text style={[styles.bulkSep, { color: theme.textMuted }]}>·</Text>
              <TouchableOpacity onPress={() => setChecked({})}>
                <Text style={[styles.bulkLink, { color: theme.accent }]}>{t('overrideConflict.none')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 8 }}>
            {photos.map((p) => {
              const isChecked = !!checked[p.id];
              const subtitle = [p.room, p.mode].filter(Boolean).join(' · ');
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.row, { borderBottomColor: theme.border }]}
                  onPress={() => toggle(p.id)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.checkbox,
                    {
                      borderColor: isChecked ? theme.accent : theme.border,
                      backgroundColor: isChecked ? theme.accent : 'transparent',
                    },
                  ]}>
                    {isChecked ? (
                      <Ionicons name="checkmark" size={14} color={theme.accentText} />
                    ) : null}
                  </View>
                  {p.uri ? (
                    <Image source={{ uri: p.uri }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: theme.surfaceElevated }]} />
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.photoName, { color: theme.textPrimary }]} numberOfLines={1}>
                      {p.name || t('overrideConflict.photoFallbackName', { id: String(p.id).slice(0, 6) })}
                    </Text>
                    {subtitle ? (
                      <Text style={[styles.photoSub, { color: theme.textSecondary }]} numberOfLines={1}>
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.btn, { borderColor: theme.border }]}
              onPress={onCancel}
            >
              <Text style={[styles.btnText, { color: theme.textPrimary }]}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { borderColor: theme.border }]}
              onPress={onSkipAll}
            >
              <Text style={[styles.btnText, { color: theme.textPrimary }]}>{t('overrideConflict.keepAllCustom')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, { backgroundColor: theme.accent }]}
              onPress={handleApply}
            >
              <Text style={[styles.btnText, { color: theme.accentText, fontWeight: '700' }]}>
                {selectedCount > 0
                  ? t('overrideConflict.applyButtonWithCount', { count: selectedCount })
                  : t('overrideConflict.applyButton')}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 16,
  },
  card: {
    width: '100%', maxWidth: 480, maxHeight: '80%',
    borderRadius: 14, borderWidth: 1, padding: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '700', flex: 1, marginRight: 12 },
  desc: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  selectionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12, marginBottom: 8,
  },
  selectionText: { fontSize: 12, fontWeight: '600' },
  bulkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulkLink: { fontSize: 12, fontWeight: '700' },
  bulkSep: { fontSize: 12 },
  list: { flexGrow: 0, maxHeight: 320 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  thumb: { width: 38, height: 38, borderRadius: 6, backgroundColor: '#eee' },
  photoName: { fontSize: 14, fontWeight: '600' },
  photoSub: { fontSize: 11, marginTop: 2 },
  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
    marginTop: 12,
  },
  btn: {
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1,
  },
  btnPrimary: { borderColor: 'transparent' },
  btnText: { fontSize: 13 },
});
