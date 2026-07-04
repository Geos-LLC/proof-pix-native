import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { IAP_PRODUCTS, getSubscriptionPrices } from '../services/iapService';

// Module-level cache — fetched once per app session, shared across all screens
let _cache = null;
let _fetchPromise = null;

const PLAN_KEY_MAP = {
  [IAP_PRODUCTS.PRO_MONTHLY]: 'pro',
  [IAP_PRODUCTS.PRO_ANNUAL]: 'proAnnual',
  [IAP_PRODUCTS.BUSINESS_MONTHLY]: 'business',
  [IAP_PRODUCTS.BUSINESS_ANNUAL]: 'businessAnnual',
  [IAP_PRODUCTS.ENTERPRISE_MONTHLY]: 'enterprise',
  [IAP_PRODUCTS.BUSINESS_SEAT]: 'businessSeat',
  [IAP_PRODUCTS.ENTERPRISE_SEAT]: 'enterpriseSeat',
};

const PLATFORM_CANCEL_TEXT = Platform.OS === 'android'
  ? 'Cancel anytime in Google Play > Subscriptions'
  : 'Cancel anytime in Settings > Subscriptions';

/**
 * Parse a store-formatted price string (e.g. "US$134.99", "€14,99", "¥1,500")
 * back to a Number. Returns null if we can't recover a numeric amount — the
 * caller falls back to hiding the derived "per month" / "save X%" copy rather
 * than showing bogus math.
 */
const _parsePriceToNumber = (formatted) => {
  if (!formatted || typeof formatted !== 'string') return null;
  // Strip everything but digits, dot, comma, and minus. Some locales use comma
  // as the decimal separator; we normalize by keeping the LAST separator as
  // the decimal marker.
  const cleaned = formatted.replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized;
  if (lastComma > lastDot) {
    // Comma is decimal — drop dots (thousands), swap comma to dot
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Dot is decimal (or no separators) — drop commas (thousands)
    normalized = cleaned.replace(/,/g, '');
  }
  const n = parseFloat(normalized);
  return isFinite(n) ? n : null;
};

/**
 * Derive per-tier savings + per-month equivalent from raw store price strings.
 * Falls back to nulls (not zeros) when a store didn't return one of the SKUs
 * — the UI hides the badge in that case rather than misleading the user.
 */
const _buildAnnualSummary = (monthlyPrice, annualPrice) => {
  const monthly = _parsePriceToNumber(monthlyPrice);
  const annual = _parsePriceToNumber(annualPrice);
  if (!monthly || !annual || monthly <= 0 || annual <= 0) {
    return { perMonthDisplay: null, savingsPct: null, perMonthValue: null, monthlyValue: monthly, annualValue: annual };
  }
  const perMonthValue = annual / 12;
  const monthlyTotalPerYear = monthly * 12;
  const savingsPct = Math.round((1 - annual / monthlyTotalPerYear) * 100);
  // Best-effort per-month display — reuse the formatted annual string's
  // currency prefix/suffix by pattern-substituting the number portion. If the
  // pattern doesn't match cleanly we fall back to "$X.XX/mo" style.
  const numericMatch = annualPrice.match(/[\d.,]+/);
  let perMonthDisplay = null;
  if (numericMatch) {
    const rounded = perMonthValue.toFixed(2);
    perMonthDisplay = annualPrice.replace(numericMatch[0], rounded);
  }
  return { perMonthDisplay, savingsPct, perMonthValue, monthlyValue: monthly, annualValue: annual };
};

/**
 * Shared hook for localized subscription prices and trial metadata.
 * Fetches from store once, caches in memory for the app session.
 *
 * Returns:
 *   loading    — true while fetching
 *   error      — true if fetch failed
 *   prices     — { pro, proAnnual, business, businessAnnual, enterprise, businessSeat, enterpriseSeat } localized strings
 *   trialInfo  — { pro: { hasTrial, trialDays }, proAnnual: {...}, ... }
 *   annualSummary — { pro: { perMonthDisplay, savingsPct, ... }, business: {...} }
 *   platformCancelText — cancel instructions for current platform
 */
export default function useSubscriptionPrices() {
  const [loading, setLoading] = useState(!_cache);
  const [error, setError] = useState(false);
  const [data, setData] = useState(_cache);

  useEffect(() => {
    if (_cache && Object.values(_cache.prices || {}).some((v) => !!v)) {
      setData(_cache);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchPrices = async () => {
      try {
        // Deduplicate concurrent fetches
        if (!_fetchPromise) {
          _fetchPromise = getSubscriptionPrices();
        }
        const result = await _fetchPromise;
        _fetchPromise = null;

        const { prices: rawPrices, trialOffers } = result;

        // Map product IDs to plan keys
        const prices = {};
        const trialInfo = {};
        for (const [productId, planKey] of Object.entries(PLAN_KEY_MAP)) {
          prices[planKey] = rawPrices[productId] || null;
          trialInfo[planKey] = trialOffers[productId] || { hasTrial: false, trialDays: 0 };
        }

        const annualSummary = {
          pro: _buildAnnualSummary(prices.pro, prices.proAnnual),
          business: _buildAnnualSummary(prices.business, prices.businessAnnual),
        };

        const hasPrices = Object.values(prices).some((v) => !!v);
        if (hasPrices) {
          _cache = { prices, trialInfo, annualSummary };
        }

        if (!cancelled) {
          setData({ prices, trialInfo, annualSummary });
          setLoading(false);
          if (!hasPrices) setError(true);
        }
      } catch (err) {
        _fetchPromise = null;
        console.error('[useSubscriptionPrices] Fetch failed:', err);
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    };

    fetchPrices();
    return () => { cancelled = true; };
  }, []);

  return {
    loading,
    error,
    prices: data?.prices || {},
    trialInfo: data?.trialInfo || {},
    annualSummary: data?.annualSummary || {},
    platformCancelText: PLATFORM_CANCEL_TEXT,
  };
}
