import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { IAP_PRODUCTS, getSubscriptionPrices } from '../services/iapService';

// Module-level cache — fetched once per app session, shared across all screens
let _cache = null;
let _fetchPromise = null;

const PLAN_KEY_MAP = {
  [IAP_PRODUCTS.PRO_MONTHLY]: 'pro',
  [IAP_PRODUCTS.BUSINESS_MONTHLY]: 'business',
  [IAP_PRODUCTS.ENTERPRISE_MONTHLY]: 'enterprise',
  [IAP_PRODUCTS.BUSINESS_SEAT]: 'businessSeat',
  [IAP_PRODUCTS.ENTERPRISE_SEAT]: 'enterpriseSeat',
};

const PLATFORM_CANCEL_TEXT = Platform.OS === 'android'
  ? 'Cancel anytime in Google Play > Subscriptions'
  : 'Cancel anytime in Settings > Subscriptions';

/**
 * Shared hook for localized subscription prices and trial metadata.
 * Fetches from store once, caches in memory for the app session.
 *
 * Returns:
 *   loading    — true while fetching
 *   error      — true if fetch failed
 *   prices     — { pro, business, enterprise, businessSeat, enterpriseSeat } localized strings
 *   trialInfo  — { pro: { hasTrial, trialDays }, business: {...}, enterprise: {...} }
 *   platformCancelText — cancel instructions for current platform
 */
export default function useSubscriptionPrices() {
  const [loading, setLoading] = useState(!_cache);
  const [error, setError] = useState(false);
  const [data, setData] = useState(_cache);

  useEffect(() => {
    if (_cache) {
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

        _cache = { prices, trialInfo };

        if (!cancelled) {
          setData(_cache);
          setLoading(false);
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
    platformCancelText: PLATFORM_CANCEL_TEXT,
  };
}
