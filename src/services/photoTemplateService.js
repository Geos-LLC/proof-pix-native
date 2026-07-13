// User-defined photo templates for Studio, persisted per-device in
// AsyncStorage. Presets are shipped in code (photoTemplates.js) and
// merged in-memory by listAll(); this service only owns the mutable
// user-created ones so a user rename/delete never touches presets.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PHOTO_TEMPLATE_PRESETS, isPresetTemplateId } from '../constants/photoTemplates';

const STORAGE_KEY = '@studio_photo_templates';

const genId = () => `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const readUser = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[photoTemplateService] readUser failed', e);
    return [];
  }
};

const writeUser = async (list) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[photoTemplateService] writeUser failed', e);
  }
};

// Presets always come first so the list has a stable header regardless
// of how many custom templates the user has created.
export const listAllTemplates = async () => {
  const user = await readUser();
  return [...PHOTO_TEMPLATE_PRESETS, ...user];
};

export const listUserTemplates = readUser;

export const getTemplateById = async (id) => {
  if (!id) return null;
  if (isPresetTemplateId(id)) {
    return PHOTO_TEMPLATE_PRESETS.find((t) => t.id === id) || null;
  }
  const user = await readUser();
  return user.find((t) => t.id === id) || null;
};

// Save a new template built from the current photo. Payload is the
// caller-provided { photoFields, overrides } snapshot.
export const saveUserTemplate = async ({ name, photoFields, overrides }) => {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Template name required');
  const list = await readUser();
  const record = {
    id: genId(),
    name: trimmed,
    isPreset: false,
    createdAt: Date.now(),
    photoFields: photoFields && Object.keys(photoFields).length ? photoFields : null,
    overrides: overrides && typeof overrides === 'object' ? overrides : {},
  };
  const next = [...list, record];
  await writeUser(next);
  return record;
};

export const deleteUserTemplate = async (id) => {
  if (!id || isPresetTemplateId(id)) return;
  const list = await readUser();
  const next = list.filter((t) => t.id !== id);
  await writeUser(next);
};

export const renameUserTemplate = async (id, nextName) => {
  const trimmed = (nextName || '').trim();
  if (!trimmed || !id || isPresetTemplateId(id)) return;
  const list = await readUser();
  const next = list.map((t) => (t.id === id ? { ...t, name: trimmed } : t));
  await writeUser(next);
};
