import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const PROXY_SERVER_URL = process.env.EXPO_PUBLIC_PROXY_URL || 'https://steadfast-blessing-production.up.railway.app';

// Shared secret for the 5 admin referral-link management endpoints. Baked in
// at bundle time via EAS env var; the proxy's requireAdminSecret middleware
// checks it against PROOFPIX_ADMIN_SECRET on Railway. Stops drive-by curl
// attacks on the mint/list/edit/deactivate endpoints. NOT used for
// /api/referrals/redeem — that stays public so end users can redeem codes.
const ADMIN_SECRET = process.env.EXPO_PUBLIC_PROOFPIX_ADMIN_SECRET;

const adminHeaders = (extra = {}) => ({
  ...(ADMIN_SECRET ? { 'X-ProofPix-Admin-Secret': ADMIN_SECRET } : {}),
  ...extra,
});

const STORAGE_KEYS = {
  PENDING_ADMIN_REFERRAL: '@pending_admin_referral_code',
  ADMIN_REFERRAL_REDEEMED: '@admin_referral_redeemed',
};

// Code generation — uppercase alphanumeric, no ambiguous chars (O/0/I/1).
// Uses expo-crypto's CSPRNG; Math.random's V8 xorshift128+ state is
// recoverable from a handful of adjacent outputs, so an attacker who
// observed a few operator-issued codes could predict the next one and
// redeem +bonusTrialDays before the operator did.
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const generateCode = (length = 7) => {
  const bytes = Crypto.getRandomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CHARSET[bytes[i] % CHARSET.length];
  }
  return result;
};

export const getReferralLinkUrl = (code) =>
  `https://steadfast-blessing-production.up.railway.app/referral/${code}`;

// ─── Admin CRUD ───

export const fetchAdminReferralLinks = async () => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/admin/referral-links`, {
      headers: adminHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('[AdminReferral] Failed to fetch links:', error?.message);
    return [];
  }
};

export const createAdminReferralLink = async (payload) => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/admin/referral-links`, {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        code: payload.code?.toUpperCase() || generateCode(),
        label: payload.label || null,
        channel: payload.channel || null,
        source: payload.source || null,
        campaign: payload.campaign || null,
        placement: payload.placement || null,
        notes: payload.notes || null,
        bonusTrialDays: parseInt(payload.bonusDays, 10) || 7,
        maxUses: payload.maxUses ? parseInt(payload.maxUses, 10) : null,
        expiresAt: payload.expiresAt || null,
        isActive: true,
      }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('[AdminReferral] Failed to create link:', error?.message);
    throw error;
  }
};

export const updateAdminReferralLink = async (id, payload) => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/admin/referral-links/${id}`, {
      method: 'PATCH',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('[AdminReferral] Failed to update link:', error?.message);
    throw error;
  }
};

export const deactivateAdminReferralLink = async (id) => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/admin/referral-links/${id}/deactivate`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('[AdminReferral] Failed to deactivate link:', error?.message);
    throw error;
  }
};

export const activateAdminReferralLink = async (id) => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/admin/referral-links/${id}/activate`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('[AdminReferral] Failed to activate link:', error?.message);
    throw error;
  }
};

// ─── Public Redemption ───

export const redeemAdminReferralCode = async (code, userId) => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/referrals/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.toUpperCase(), userId }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('[AdminReferral] Failed to redeem code:', error?.message);
    return null;
  }
};

// ─── Local Storage for Pending Redemption ───

export const saveAdminReferralCodeLocally = async (code) => {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEYS.PENDING_ADMIN_REFERRAL,
      JSON.stringify({ code: code.toUpperCase(), savedAt: new Date().toISOString() })
    );
    console.log('[AdminReferral] Saved pending code:', code);
  } catch (error) {
    console.error('[AdminReferral] Failed to save pending code:', error?.message);
  }
};

export const getAndClearPendingAdminReferralCode = async () => {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_ADMIN_REFERRAL);
    if (!data) return null;
    await AsyncStorage.removeItem(STORAGE_KEYS.PENDING_ADMIN_REFERRAL);
    const parsed = JSON.parse(data);
    return parsed.code || null;
  } catch (error) {
    console.error('[AdminReferral] Failed to get pending code:', error?.message);
    return null;
  }
};

export const hasRedeemedAdminReferral = async () => {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEYS.ADMIN_REFERRAL_REDEEMED);
    return val === 'true';
  } catch {
    return false;
  }
};

export const markAdminReferralRedeemed = async () => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.ADMIN_REFERRAL_REDEEMED, 'true');
  } catch {
    // non-critical
  }
};
