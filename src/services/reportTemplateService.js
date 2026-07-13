// Report templates — persisted per-device in AsyncStorage. Captures a
// report's layoutType + resolved options as a named preset the user can
// reapply to any other report. No shipped presets (user Q2 confirmed
// "only pictures presets for now"); custom-only for reports.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@report_templates';

const genId = () => `rtpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const readAll = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[reportTemplateService] readAll failed', e);
    return [];
  }
};

const writeAll = async (list) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[reportTemplateService] writeAll failed', e);
  }
};

export const listReportTemplates = readAll;

export const getReportTemplateById = async (id) => {
  if (!id) return null;
  const list = await readAll();
  return list.find((t) => t.id === id) || null;
};

export const saveReportTemplate = async ({ name, layoutType, options }) => {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Template name required');
  if (!layoutType) throw new Error('layoutType required');
  const list = await readAll();
  const record = {
    id: genId(),
    name: trimmed,
    createdAt: Date.now(),
    layoutType,
    options: options && typeof options === 'object' ? { ...options } : {},
  };
  const next = [...list, record];
  await writeAll(next);
  return record;
};

export const deleteReportTemplate = async (id) => {
  if (!id) return;
  const list = await readAll();
  const next = list.filter((t) => t.id !== id);
  await writeAll(next);
};

export const renameReportTemplate = async (id, nextName) => {
  const trimmed = (nextName || '').trim();
  if (!trimmed || !id) return;
  const list = await readAll();
  const next = list.map((t) => (t.id === id ? { ...t, name: trimmed } : t));
  await writeAll(next);
};
