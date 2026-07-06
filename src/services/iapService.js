import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNIap from 'react-native-iap';
import {
  logSubscriptionStarted,
  logTrialStarted,
  logSubscriptionUpgraded,
} from '../utils/analytics';

// Persistent deduplication: prevent duplicate analytics for the same store
// transaction across cold starts. The previous in-memory `Set` reset every
// app launch, which let stale unfinished iOS transactions log analytics again.
const TX_LOG_KEY_PREFIX = 'proofpix_logged_iap_transaction:';

const _txLogKey = (purchase) => {
  if (!purchase) return null;
  if (Platform.OS === 'ios') {
    const id =
      purchase.originalTransactionIdentifierIOS ||
      purchase.originalTransactionId ||
      purchase.transactionId;
    return id ? `${TX_LOG_KEY_PREFIX}${id}` : null;
  }
  // Android: purchaseToken is the canonical per-purchase identifier.
  const id = purchase.purchaseToken || purchase.transactionId;
  return id ? `${TX_LOG_KEY_PREFIX}${id}` : null;
};

const _isTransactionLogged = async (key) => {
  if (!key) return false;
  try {
    const v = await AsyncStorage.getItem(key);
    return !!v;
  } catch {
    return false;
  }
};

const _markTransactionLogged = async (key, payload = {}) => {
  if (!key) return;
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ ts: Date.now(), ...payload })
    );
  } catch {
    // non-critical
  }
};

// Platform-specific product IDs
// iOS: product IDs include .monthly / .annual suffix (configured in App Store Connect)
// Android: monthly product IDs are the plan name; annual uses .annual suffix
const IOS_PRODUCTS = {
  PRO_MONTHLY: 'com.goscha01.proofpix.pro.monthly',
  PRO_ANNUAL: 'com.goscha01.proofpix.pro.annual',
  BUSINESS_MONTHLY: 'com.goscha01.proofpix.business.monthly',
  BUSINESS_ANNUAL: 'com.goscha01.proofpix.business.annual',
  ENTERPRISE_MONTHLY: 'com.goscha01.proofpix.enterprise.monthly',
  BUSINESS_SEAT: 'com.goscha01.proofpix.business.seat',
  ENTERPRISE_SEAT: 'com.goscha01.proofpix.enterprise.seat',
};

const ANDROID_PRODUCTS = {
  PRO_MONTHLY: 'com.goscha01.proofpix.pro',
  PRO_ANNUAL: 'com.goscha01.proofpix.pro.annual',
  BUSINESS_MONTHLY: 'com.goscha01.proofpix.business',
  BUSINESS_ANNUAL: 'com.goscha01.proofpix.business.annual',
  ENTERPRISE_MONTHLY: 'com.goscha01.proofpix.enterprise',
  BUSINESS_SEAT: 'com.goscha01.proofpix.business.seat',
  ENTERPRISE_SEAT: 'com.goscha01.proofpix.enterprise.seat',
};

// Export platform-appropriate product IDs
export const IAP_PRODUCTS = Platform.OS === 'android' ? ANDROID_PRODUCTS : IOS_PRODUCTS;

// All Android subscription SKUs for querying
const ALL_ANDROID_SKUS = Object.values(ANDROID_PRODUCTS);

let purchaseUpdateSubscription = null;
let purchaseErrorSubscription = null;
let connectionInitialized = false;

// Cache for Android subscription offer details (productId -> offerToken)
let androidOfferCache = {};

// Cache of product price/currency per productId, populated after fetchProducts
// so we can attach price context on subscription analytics. The price is the
// recurring/post-trial price, NOT the amount actually charged on a given
// transaction — so it must never be sent as `purchase` revenue from the client.
// { [productId]: { price: number, currency: string } }
let _productPriceCache = {};

// Cache of "does this product offer a free intro trial". Populated alongside
// the price cache and used to classify a confirmed transaction as trial vs
// paid without needing server-side receipt validation.
// { [productId]: boolean }
let _productHasTrialCache = {};

/**
 * Decide whether an introductory-offer descriptor represents a free trial.
 * Accepts the various shapes the iOS side has used across RNIap versions.
 */
const _isFreeIntroOffer = (intro) => {
  if (!intro) return false;
  const p = intro.price ?? intro.priceAmount ?? intro.priceAmountMicros;
  if (p === 0 || p === '0' || p === '0.00') return true;
  const mode = intro.paymentMode || intro.paymentModeIOS;
  if (mode === 'free_trial' || mode === 'FREE_TRIAL' || mode === 'freeTrial' || mode === 0) return true;
  if (intro.type === 'introductory' && (p === 0 || p === '0' || p === '0.00')) return true;
  return false;
};

/**
 * Inspect an RNIap product object for a free introductory offer.
 *
 * iOS: react-native-iap has shipped this metadata under at least four
 * different field shapes across major versions and has further split it
 * between StoreKit 1 and StoreKit 2 in v14. We probe every known shape so
 * a single library rename doesn't silently disable trial classification.
 * Returns 'unknown' (not false) when no shape matched, so `_classifyTransaction`
 * can lean trial on first-txn for expected-trial products instead of silently
 * misclassifying as paid.
 *
 * Android: any subscription offer phase with `priceAmountMicros: 0` that is
 * not the recurring phase (recurrenceMode !== 1).
 */
const _extractHasTrial = (product) => {
  if (!product) return false;
  try {
    if (Platform.OS === 'ios') {
      const candidates = [
        product.subscriptionInfoIOS?.introductoryOffer,
        product.subscriptionInfoIOS?.introductoryPrice,
        product.introductoryOfferIOS,
        product.introductoryPriceIOS,
        product.introductoryPrice,
        ...(Array.isArray(product.discountsIOS)
          ? product.discountsIOS.filter((d) => d?.type === 'introductory')
          : []),
        ...(Array.isArray(product.subscriptionInfoIOS?.promotionalOffers)
          ? product.subscriptionInfoIOS.promotionalOffers
          : []),
      ];
      for (const c of candidates) {
        if (_isFreeIntroOffer(c)) return true;
      }
      // Diagnostic: surface the actual product key set so a future RNIap
      // field rename is fixable in one iteration, not a build cycle each.
      if (__DEV__ || true) {
        try {
          console.warn('[iap-debug] no iOS intro-offer field matched', {
            productId: product?.id || product?.productId,
            productKeys: Object.keys(product || {}),
            subscriptionInfoIOSKeys: product?.subscriptionInfoIOS
              ? Object.keys(product.subscriptionInfoIOS)
              : null,
            hasIntroductoryPrice: 'introductoryPrice' in product,
            hasIntroductoryPriceIOS: 'introductoryPriceIOS' in product,
            hasDiscountsIOS: 'discountsIOS' in product,
          });
        } catch {}
      }
      // Distinguish "no trial offered" from "couldn't tell" so the
      // classifier can apply the first-txn fallback.
      return 'unknown';
    }
    const offers = product.subscriptionOfferDetailsAndroid || [];
    for (const offer of offers) {
      const phases = offer.pricingPhases?.pricingPhaseList || [];
      const free = phases.find((ph) => {
        const m = ph.priceAmountMicros;
        const isZero = m === 0 || m === '0' || m === '0.00';
        return isZero && ph.recurrenceMode !== 1;
      });
      if (free) return true;
    }
  } catch {}
  return false;
};

// Products that ship a free trial in App Store Connect / Play Console. Used as
// the fallback signal when iOS RNIap doesn't surface intro-offer metadata in
// any known shape — we lean trial for a first transaction rather than
// silently misclassifying as paid.
const _EXPECTED_TRIAL_PRODUCT_IDS = new Set([
  IOS_PRODUCTS.PRO_MONTHLY,
  IOS_PRODUCTS.PRO_ANNUAL,
  IOS_PRODUCTS.BUSINESS_MONTHLY,
  IOS_PRODUCTS.BUSINESS_ANNUAL,
  IOS_PRODUCTS.ENTERPRISE_MONTHLY,
  ANDROID_PRODUCTS.PRO_MONTHLY,
  ANDROID_PRODUCTS.PRO_ANNUAL,
  ANDROID_PRODUCTS.BUSINESS_MONTHLY,
  ANDROID_PRODUCTS.BUSINESS_ANNUAL,
  ANDROID_PRODUCTS.ENTERPRISE_MONTHLY,
]);

/**
 * Extract numeric price and currency code from an RNIap v14 product object.
 * Returns { price, currency } or null if the fields aren't available.
 */
const _extractPriceAndCurrency = (product) => {
  if (!product) return null;
  try {
    if (Platform.OS === 'ios') {
      const price = typeof product.price === 'number' ? product.price : parseFloat(product.price);
      const currency = product.currency || product.priceCurrencyCode || 'USD';
      if (!isFinite(price)) return null;
      return { price, currency };
    }
    // Android: read the recurring phase price (in micros). Works for both
    // monthly (P1M) and annual (P1Y) plans — recurrenceMode === 1 is the
    // canonical "this is the price we charge" phase per Play Billing docs.
    const offers = product.subscriptionOfferDetailsAndroid || [];
    for (const offer of offers) {
      const phases = offer.pricingPhases?.pricingPhaseList || [];
      const recurring = phases.find(p => p.recurrenceMode === 1);
      const phase = recurring || phases[phases.length - 1];
      if (phase?.priceAmountMicros != null) {
        const micros = typeof phase.priceAmountMicros === 'string'
          ? parseInt(phase.priceAmountMicros, 10)
          : phase.priceAmountMicros;
        const price = micros / 1_000_000;
        const currency = phase.priceCurrencyCode || 'USD';
        if (isFinite(price) && price > 0) return { price, currency };
      }
    }
  } catch {}
  return null;
};

/**
 * Cache price/currency and trial-availability for each product returned by
 * fetchProducts. Looks up id (v14) or productId (legacy) fields.
 */
const _cacheProductPrices = (products) => {
  for (const product of products || []) {
    const id = product?.id || product?.productId;
    if (!id) continue;
    const pc = _extractPriceAndCurrency(product);
    if (pc) _productPriceCache[id] = pc;
    _productHasTrialCache[id] = _extractHasTrial(product);
  }
};

/**
 * Decide whether a confirmed transaction represents a free-trial start or a
 * paid period, using the cached product trial-availability and the purchase
 * shape. Best-effort client-side classification — server-side receipt
 * validation will make this authoritative in a future pass.
 */
const _classifyTransaction = (purchase, productId) => {
  const isSeat = (productId || '').includes('seat');
  const cached = _productHasTrialCache[productId];
  const hasTrialOffer = cached === true;
  const trialUnknown = cached === 'unknown';
  const cacheKnowsProduct = Object.prototype.hasOwnProperty.call(
    _productHasTrialCache,
    productId
  );
  const expectsTrial = _EXPECTED_TRIAL_PRODUCT_IDS.has(productId);
  const original =
    purchase?.originalTransactionIdentifierIOS ||
    purchase?.originalTransactionId ||
    null;
  const transactionId = purchase?.transactionId || null;
  const isFirstTxn = !original || original === transactionId;

  let result;
  let classifierReason;
  if (isSeat) {
    result = 'paid'; // seat add-ons never have a trial offer
    classifierReason = 'seat';
  } else if (hasTrialOffer && Platform.OS === 'ios') {
    result = isFirstTxn ? 'trial' : 'paid';
    classifierReason = 'ios_known_trial';
  } else if (hasTrialOffer) {
    // Android: when a product offers a free phase, Google grants it on the
    // first qualifying purchase. Without server validation we can't tell a
    // first-time buyer from a returning one, so we conservatively treat any
    // first-acknowledgement of a trial-eligible product as a trial start.
    // Subsequent purchases (e.g. resubscribes) will be deduped by purchaseToken.
    result = 'trial';
    classifierReason = 'android_known_trial';
  } else if (
    Platform.OS === 'ios' &&
    trialUnknown &&
    isFirstTxn &&
    expectsTrial
  ) {
    // RNIap didn't surface intro-offer metadata in any known shape, but this
    // is a first-time transaction on a product configured with a trial in
    // App Store Connect — lean trial rather than silently misreporting paid.
    // Persistent dedup on originalTransactionIdentifierIOS still prevents
    // re-firing on renewals.
    result = 'trial';
    classifierReason = 'ios_unknown_first_txn_fallback';
  } else {
    result = 'paid';
    classifierReason = trialUnknown ? 'unknown_not_first_txn' : 'no_trial_offer';
  }

  console.log('[iap-debug] transaction classified', {
    result,
    classifierReason,
    productId,
    hasTrialOffer,
    trialUnknown,
    expectsTrial,
    cacheKnowsProduct,
    cachedProductIds: Object.keys(_productHasTrialCache),
    transactionId,
    originalTransactionId: original,
    isFirstTxn,
    isSeat,
    platform: Platform.OS,
  });

  return result;
};

/**
 * Fire the correct subscription analytics bundle for a confirmed store
 * transaction. Persistently deduped by transaction key — safe to call
 * multiple times across cold starts for the same purchase.
 *
 * Trial start  → `trial_started` + `subscription_started` (subscription_type:'trial')
 * Paid start   → `subscription_started` (subscription_type:'paid')
 *
 * NEVER fires the GA4 `purchase` event. Real revenue must come from server
 * receipt validation (see TODO at the top of analytics.js).
 *
 * @param {object} purchase   RNIap purchase object
 * @param {string} productId  product being purchased
 * @param {string} entryPoint 'paywall' | 'restore' | 'trial_expired' | 'settings'
 */
const _logPurchaseAnalytics = async (purchase, productId, entryPoint = 'paywall') => {
  const txKey = _txLogKey(purchase);
  const alreadyLogged = await _isTransactionLogged(txKey);
  console.log('[iap-debug] transaction dedup check', {
    transactionId: purchase?.transactionId,
    purchaseToken: purchase?.purchaseToken,
    dedupKey: txKey,
    alreadyLogged,
  });
  if (alreadyLogged) {
    console.log('[iap-debug] analytics SKIPPED — transaction already logged in a prior session', { dedupKey: txKey });
    return;
  }

  const plan = productIdToPlan(productId);
  const isSeat = (productId || '').includes('seat');
  const platform = Platform.OS;
  const provider = platform === 'ios' ? 'apple' : 'google';
  const priceInfo = _productPriceCache[productId] || null;
  const txId = purchase?.transactionId || purchase?.purchaseToken || null;
  const originalTxId =
    purchase?.originalTransactionIdentifierIOS ||
    purchase?.originalTransactionId ||
    null;

  const kind = _classifyTransaction(purchase, productId);
  const subscriptionType = kind === 'trial' ? 'trial' : 'paid';

  const baseParams = {
    plan_id: plan,
    product_id: productId,
    platform,
    provider,
    entry_point: entryPoint,
    subscription_type: subscriptionType,
    transaction_id: txId,
    original_transaction_id: originalTxId,
    is_seat: isSeat,
    price: priceInfo?.price ?? null,
    currency: priceInfo?.currency ?? null,
    analytics_source: 'purchase_success',
  };

  // Detect post-trial conversion: if the device previously fired trial_expired
  // for the same originalTransactionId family, this paid subscription is the
  // user's conversion event. Annotate subscription_started so GA4 can build
  // funnels of "trial → same plan" vs "trial → switched plan".
  let wasTrial = false;
  let fromPlan = null;
  let switched = false;
  if (kind === 'paid') {
    try {
      const expiredRaw = await AsyncStorage.getItem('@last_trial_expired_state');
      if (expiredRaw) {
        const exp = JSON.parse(expiredRaw);
        if (exp?.original_transaction_id && exp.original_transaction_id === originalTxId) {
          wasTrial = true;
          fromPlan = exp.plan_id || null;
          switched = !!fromPlan && fromPlan !== plan;
        }
      }
    } catch {}
  }

  try {
    if (kind === 'trial') {
      console.log('[analytics-debug] firing trial_started', {
        plan_id: baseParams.plan_id,
        product_id: baseParams.product_id,
        platform: baseParams.platform,
        provider: baseParams.provider,
        subscription_type: 'trial',
        transaction_id: baseParams.transaction_id,
      });
      await logTrialStarted(baseParams);
      // Persist the trial state so SettingsContext can detect a real
      // active→inactive transition on a future cold start and fire a real
      // trial_expired event with plan context.
      try {
        await AsyncStorage.setItem('@last_trial_state', JSON.stringify({
          plan_id: plan,
          product_id: productId,
          original_transaction_id: originalTxId,
          transaction_id: txId,
          started_at: Date.now(),
        }));
      } catch {}
      // Soft trial: once the store-backed trial starts, the soft trial is
      // permanently consumed for this device. Prevents users who only
      // partially used the soft trial from getting both.
      try {
        const { markSoftTrialUsed } = await import('./softTrialService');
        await markSoftTrialUsed();
      } catch {}
    } else {
      console.log('[analytics-debug] NOT firing trial_started (paid path)', {
        plan_id: baseParams.plan_id,
        product_id: baseParams.product_id,
        kind,
      });
    }
    console.log('[analytics-debug] firing subscription_started', {
      plan_id: baseParams.plan_id,
      product_id: baseParams.product_id,
      subscription_type: baseParams.subscription_type,
      transaction_id: baseParams.transaction_id,
      was_trial: wasTrial,
      from_plan: fromPlan,
      switched,
    });
    await logSubscriptionStarted({
      ...baseParams,
      was_trial: wasTrial,
      from_plan: fromPlan,
      switched,
    });
    // Conversion has been recorded — clear the expired-state marker so the
    // next legitimate trial_expired won't double-attribute.
    if (wasTrial) {
      try { await AsyncStorage.removeItem('@last_trial_expired_state'); } catch {}
    }
  } catch (e) {
    console.warn('[IAP] analytics log failed:', e?.message);
  }

  await _markTransactionLogged(txKey, {
    productId,
    plan,
    kind,
    entryPoint,
  });
};

/**
 * Fire upgrade analytics when an existing subscriber switches tiers (Android
 * proration upgrade). Persistently deduped — the new transactionId/token from
 * the upgrade call is the dedup key.
 */
const _logUpgradeAnalytics = async (purchase, productId, fromPlan, entryPoint = 'upgrade') => {
  const txKey = _txLogKey(purchase);
  if (await _isTransactionLogged(txKey)) return;

  const plan = productIdToPlan(productId);
  const platform = Platform.OS;
  const provider = platform === 'ios' ? 'apple' : 'google';
  const priceInfo = _productPriceCache[productId] || null;
  const txId = purchase?.transactionId || purchase?.purchaseToken || null;
  const originalTxId =
    purchase?.originalTransactionIdentifierIOS ||
    purchase?.originalTransactionId ||
    null;

  try {
    await logSubscriptionUpgraded({
      from_plan: fromPlan || null,
      to_plan: plan,
      plan_id: plan,
      product_id: productId,
      platform,
      provider,
      entry_point: entryPoint,
      subscription_type: 'paid',
      transaction_id: txId,
      original_transaction_id: originalTxId,
      price: priceInfo?.price ?? null,
      currency: priceInfo?.currency ?? null,
      analytics_source: 'upgrade',
    });
  } catch (e) {
    console.warn('[IAP] upgrade analytics log failed:', e?.message);
  }

  await _markTransactionLogged(txKey, {
    productId,
    plan,
    kind: 'upgrade',
    fromPlan,
    entryPoint,
  });
};

/**
 * Initialize IAP on iOS/Android.
 * Safe to call multiple times.
 */
export const initIAPIfNeeded = async () => {
  console.log('[IAP] initIAPIfNeeded called - connectionInitialized:', connectionInitialized, 'Platform:', Platform.OS);

  if (connectionInitialized) {
    console.log('[IAP] Already initialized, skipping');
    return;
  }

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.log('[IAP] Platform not supported:', Platform.OS);
    return;
  }

  try {
    console.log('[IAP] Calling RNIap.initConnection()...');
    await RNIap.initConnection();
    connectionInitialized = true;
    console.log('[IAP] Connection initialized successfully');
  } catch (e) {
    console.error('[IAP] Failed to init connection:', e);
    console.error('[IAP] Error details:', JSON.stringify({ message: e?.message, code: e?.code, name: e?.name, stack: e?.stack?.slice(0, 400), debugMessage: e?.debugMessage, responseCode: e?.responseCode }, null, 2));
  }
};

const cleanupListeners = () => {
  try {
    purchaseUpdateSubscription?.remove();
  } catch {}
  try {
    purchaseErrorSubscription?.remove();
  } catch {}
  purchaseUpdateSubscription = null;
  purchaseErrorSubscription = null;
};

/**
 * For Android: fetch subscription details and extract the monthly offer token.
 * Google Play Billing v5+ requires an offerToken to launch subscription purchases.
 * Uses react-native-iap v14 API: fetchProducts({skus, type: 'subs'})
 */
const getAndroidOfferToken = async (productId) => {
  // Check cache first
  if (androidOfferCache[productId]) {
    console.log('[IAP] Using cached offer token for:', productId);
    return androidOfferCache[productId];
  }

  console.log('[IAP] Fetching Android subscription details for:', productId);
  // v14 API: use fetchProducts with type 'subs' instead of getSubscriptions
  const subscriptions = await RNIap.fetchProducts({ skus: [productId], type: 'subs' });
  console.log('[IAP] Got', subscriptions?.length || 0, 'subscription(s)');
  _cacheProductPrices(subscriptions);

  if (!subscriptions || subscriptions.length === 0) {
    throw new Error('PRODUCT_NOT_FOUND');
  }

  const product = subscriptions[0];
  // v14 API: field is subscriptionOfferDetailsAndroid (not subscriptionOfferDetails)
  const offers = product.subscriptionOfferDetailsAndroid;

  if (!offers || offers.length === 0) {
    console.error('[IAP] No subscription offer details for:', productId);
    throw new Error('NO_OFFER_DETAILS');
  }

  // Select the base plan offer. For monthly SKUs Play returns a P1M recurring
  // phase; for annual SKUs it's P1Y. Match on recurrenceMode === 1 instead of
  // the billing period so a single code path covers both cadences.
  let selectedOffer = null;
  for (const offer of offers) {
    const phases = offer.pricingPhases?.pricingPhaseList || [];
    const hasRecurring = phases.some(phase => phase.recurrenceMode === 1);
    if (hasRecurring) {
      selectedOffer = offer;
      break;
    }
  }

  // Fallback: use first offer if no recurring found
  if (!selectedOffer) {
    console.warn('[IAP] No recurring offer found, using first offer');
    selectedOffer = offers[0];
  }

  const offerToken = selectedOffer.offerToken;
  const formattedPrice = selectedOffer.pricingPhases?.pricingPhaseList?.[
    selectedOffer.pricingPhases.pricingPhaseList.length - 1
  ]?.formattedPrice || '';

  console.log('[IAP] Selected offer token for', productId);
  console.log('[IAP] Price:', formattedPrice);

  // Cache the result
  androidOfferCache[productId] = { offerToken, formattedPrice, product };

  return { offerToken, formattedPrice, product };
};

/**
 * Purchase a single product and resolve when the transaction is completed.
 * Handles both iOS and Android subscription flows.
 * Uses react-native-iap v14 unified requestPurchase API.
 * Throws 'user-cancelled' on user cancellation.
 */
export const purchaseProduct = async (productId, entryPoint = 'paywall') => {
  console.log('[IAP] purchaseProduct called for:', productId, 'entryPoint:', entryPoint);
  console.log('[IAP] Platform:', Platform.OS);

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.error('[IAP] Platform not supported:', Platform.OS);
    throw new Error('IAP_NOT_SUPPORTED');
  }

  console.log('[IAP] Initializing IAP connection...');
  await initIAPIfNeeded();

  // iOS: clear stale transactions before attempting purchase to prevent failures
  if (Platform.OS === 'ios') {
    try {
      await RNIap.clearTransactionIOS();
    } catch (e) {
      console.warn('[IAP] iOS: Could not clear transaction queue:', e?.message);
    }
  }

  return new Promise(async (resolve, reject) => {
    let finished = false;
    let purchaseTimeout = null;

    const finish = (fn) => {
      if (finished) {
        console.log('[IAP] finish() called but already finished, ignoring');
        return;
      }
      console.log('[IAP] Finishing transaction...');
      finished = true;
      if (purchaseTimeout) {
        clearTimeout(purchaseTimeout);
        purchaseTimeout = null;
      }
      cleanupListeners();
      fn();
    };

    console.log('[IAP] Setting up purchaseUpdatedListener...');
    purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(async (purchase) => {
      // v14 PurchaseAndroid fields: productId, purchaseState, purchaseToken, isAutoRenewing, isAcknowledgedAndroid
      // v14 PurchaseIOS fields: productId, transactionId, etc.
      const purchasedId = purchase?.productId || '';

      console.log('[iap-debug] transaction received', {
        transactionId: purchase?.transactionId,
        originalTransactionId:
          purchase?.originalTransactionIdentifierIOS ||
          purchase?.originalTransactionId ||
          null,
        purchaseToken: purchase?.purchaseToken || null,
        productId: purchasedId,
        expectedProductId: productId,
        platform: Platform.OS,
        purchaseState: purchase?.purchaseState,
        isAcknowledgedAndroid: purchase?.isAcknowledgedAndroid,
      });

      console.log('[IAP] purchaseUpdatedListener triggered');
      console.log('[IAP] Purchased ID:', purchasedId, 'Expected:', productId);
      console.log('[IAP] Platform:', Platform.OS);

      if (Platform.OS === 'ios') {
        console.log('[IAP] Has transactionId:', !!purchase?.transactionId);
      } else {
        // v14: purchaseState (not purchaseStateAndroid)
        console.log('[IAP] Purchase state:', purchase?.purchaseState);
        console.log('[IAP] Has purchase token:', !!purchase?.purchaseToken);
        console.log('[IAP] Auto-renewing:', purchase?.isAutoRenewing);
      }

      // Validate purchase matches expected product
      // On Android v14, also check purchase.ids array
      const ids = purchase?.ids || [];
      const matchesExpected = purchasedId === productId || ids.includes(productId);

      if (!matchesExpected) {
        console.log('[IAP] Purchase validation failed - wrong product or missing product ID');
        return;
      }

      // === Android: Validate purchase state ===
      if (Platform.OS === 'android') {
        // v14: purchaseState (string): 'purchased', 'pending', 'unspecified'
        const state = purchase?.purchaseState;
        if (state === 'pending' || state === 2) {
          console.log('[IAP] Android purchase is PENDING - waiting for completion');
          return;
        }

        // Acknowledge the purchase (required by Google Play within 3 days)
        console.log('[IAP] Android purchase validated, acknowledging...');
        finish(async () => {
          try {
            await RNIap.finishTransaction({ purchase, isConsumable: false });
            console.log('[IAP] Android transaction finished (acknowledged)');
          } catch (finishErr) {
            console.error('[IAP] Failed to acknowledge Android purchase:', finishErr);
            // Still resolve - user paid, don't block them
          }
          // Fire analytics after confirmed purchase — not on button click or checkout
          _logPurchaseAnalytics(purchase, productId, entryPoint);
          console.log('[IAP] Resolving with purchase');
          resolve(purchase);
        });
        return;
      }

      // === iOS: Validate ===
      console.log('[IAP] Purchase validated successfully');
      finish(async () => {
        try {
          console.log('[IAP] Calling finishTransaction...');
          await RNIap.finishTransaction({ purchase, isConsumable: false });
          console.log('[IAP] Transaction finished');
        } catch (finishErr) {
          console.error('[IAP] Failed to finish transaction:', finishErr);
        }
        // Fire analytics after confirmed purchase — not on button click or checkout
        _logPurchaseAnalytics(purchase, productId, entryPoint);
        console.log('[IAP] Resolving with purchase');
        resolve(purchase);
      });
    });

    console.log('[IAP] Setting up purchaseErrorListener...');
    purchaseErrorSubscription = RNIap.purchaseErrorListener((error) => {
      const errorCode = error?.code || '';
      const errorMsg = error?.message || '';

      // Check if user cancelled - handle silently
      if (errorCode === 'E_USER_CANCELLED' || errorCode === 'user-cancelled' || errorMsg.includes('cancelled') || errorMsg.includes('canceled')) {
        console.log('[IAP] User cancelled purchase');
        finish(() => reject(new Error('user-cancelled')));
        return;
      }

      // Check if item already owned - this is expected behavior
      if (errorCode === 'already-owned' || errorMsg.includes('already owned') || errorCode === 'E_ALREADY_OWNED') {
        console.log('[IAP] Item already owned - subscription exists');
        finish(() => reject(new Error('already-owned')));
        return;
      }

      // iOS: "Cannot connect to iTunes Store" or payment queue errors are often transient
      // Delay briefly before rejecting to allow any pending purchaseUpdated events to fire first
      if (Platform.OS === 'ios' && (errorMsg.includes('Cannot connect') || errorMsg.includes('Payment Not Allowed') || errorCode === 'E_UNKNOWN')) {
        console.warn('[IAP] iOS transient error, waiting for possible purchase update...', errorCode, errorMsg);
        setTimeout(() => {
          if (!finished) {
            finish(() => reject(new Error(errorCode || 'IAP_ERROR')));
          }
        }, 3000);
        return;
      }

      // Log other errors
      console.error('[IAP] purchaseErrorListener triggered');
      console.error('[IAP] Error code:', errorCode);
      console.error('[IAP] Error message:', errorMsg);

      finish(() => {
        console.error('[IAP] Purchase error:', errorCode || 'IAP_ERROR');
        reject(new Error(errorCode || 'IAP_ERROR'));
      });
    });

    try {
      if (Platform.OS === 'android') {
        // === Android subscription purchase flow ===
        console.log('[IAP] Android: Getting offer token for:', productId);
        const { offerToken } = await getAndroidOfferToken(productId);

        // v14 API: use requestPurchase with type 'subs' and android-specific params
        console.log('[IAP] Android: Requesting subscription purchase...');
        await RNIap.requestPurchase({
          type: 'subs',
          request: {
            android: {
              skus: [productId],
              subscriptionOffers: [{ sku: productId, offerToken }],
            },
          },
        });
        console.log('[IAP] Android: Subscription request sent, waiting for response...');
      } else {
        // === iOS purchase flow ===
        // Retry fetchProducts up to 3 times — App Store sometimes needs a moment
        // after initConnection before products are available
        let products = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          console.log('[IAP] Fetching products for:', [productId], '(attempt', attempt + ')');
          products = await RNIap.fetchProducts({
            skus: [productId],
            type: 'subs'
          });
          console.log('[IAP] Products fetched:', products?.length || 0);
          if (products && products.length > 0) {
            _cacheProductPrices(products);
            break;
          }
          if (attempt < 3) {
            console.log('[IAP] No products yet, retrying in 1.5s...');
            await new Promise(r => setTimeout(r, 1500));
          }
        }

        if (!products || products.length === 0) {
          console.error('[IAP] No products found for:', productId, 'after 3 attempts');
          throw new Error('PRODUCT_NOT_FOUND');
        }

        console.log('[IAP] Requesting purchase...');
        await RNIap.requestPurchase({
          type: 'subs',
          request: {
            ios: { sku: productId },
          },
        });
        console.log('[IAP] Purchase request sent, waiting for response...');
      }

      // Set a generous timeout - Google Play payment dialogs can take a while
      purchaseTimeout = setTimeout(() => {
        if (!finished) {
          console.warn('[IAP] Purchase request timed out after 120 seconds');
          finish(() => reject(new Error('PURCHASE_TIMEOUT')));
        }
      }, 120000);
    } catch (err) {
      console.error('[IAP] Error during purchase flow:', err);
      console.error('[IAP] Error details:', JSON.stringify({ message: err?.message, code: err?.code, name: err?.name, stack: err?.stack?.slice(0, 400), debugMessage: err?.debugMessage, responseCode: err?.responseCode }, null, 2));
      finish(() => reject(err));
    }
  });
};

/**
 * Purchase or upgrade a subscription.
 * On Android, if user has an active main plan, this will trigger an upgrade flow
 * with immediate proration. Uses v14 requestPurchase with replacementModeAndroid.
 */
export const purchaseOrUpgrade = async (targetProductId, entryPoint = 'paywall') => {
  console.log('[IAP] purchaseOrUpgrade called for:', targetProductId, 'entryPoint:', entryPoint);

  try {
    return await _purchaseOrUpgradeInner(targetProductId, entryPoint);
  } catch (err) {
    // If subscription is already owned (common on iOS upgrades), treat as success
    if (err?.message === 'already-owned') {
      console.log('[IAP] Subscription already owned — treating as successful purchase');
      return { productId: targetProductId, alreadyOwned: true };
    }
    throw err;
  }
};

const _purchaseOrUpgradeInner = async (targetProductId, entryPoint = 'paywall') => {

  if (Platform.OS === 'android') {
    // Check for existing active main plan subscription
    const currentPurchases = await getAvailablePurchases();
    const mainPlanIds = [
      ANDROID_PRODUCTS.PRO_MONTHLY,
      ANDROID_PRODUCTS.PRO_ANNUAL,
      ANDROID_PRODUCTS.BUSINESS_MONTHLY,
      ANDROID_PRODUCTS.BUSINESS_ANNUAL,
      ANDROID_PRODUCTS.ENTERPRISE_MONTHLY,
    ];

    const existingMainPlan = currentPurchases?.find(p => {
      const pid = p.productId || '';
      const ids = p.ids || [];
      return mainPlanIds.some(id => pid === id || ids.includes(id));
    });

    if (existingMainPlan && existingMainPlan.purchaseToken) {
      console.log('[IAP] Existing main plan found, upgrading...');
      console.log('[IAP] Old purchase token present, old product:', existingMainPlan.productId);

      await initIAPIfNeeded();
      const { offerToken } = await getAndroidOfferToken(targetProductId);

      return new Promise(async (resolve, reject) => {
        let finished = false;
        let purchaseTimeout = null;

        const finish = (fn) => {
          if (finished) return;
          finished = true;
          if (purchaseTimeout) clearTimeout(purchaseTimeout);
          cleanupListeners();
          fn();
        };

        purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(async (purchase) => {
          const purchasedId = purchase?.productId || '';
          const ids = purchase?.ids || [];

          console.log('[iap-debug] transaction received (upgrade flow)', {
            transactionId: purchase?.transactionId,
            originalTransactionId:
              purchase?.originalTransactionIdentifierIOS ||
              purchase?.originalTransactionId ||
              null,
            purchaseToken: purchase?.purchaseToken || null,
            productId: purchasedId,
            expectedProductId: targetProductId,
            platform: Platform.OS,
          });

          if (purchasedId === targetProductId || ids.includes(targetProductId)) {
            finish(async () => {
              try {
                await RNIap.finishTransaction({ purchase, isConsumable: false });
              } catch (e) {
                console.error('[IAP] Failed to acknowledge upgrade:', e);
              }
              // Fire upgrade analytics after confirmed upgrade — not on button click or checkout
              _logUpgradeAnalytics(
                purchase,
                targetProductId,
                productIdToPlan(existingMainPlan.productId),
                entryPoint === 'paywall' ? 'upgrade' : entryPoint
              );
              resolve(purchase);
            });
          }
        });

        purchaseErrorSubscription = RNIap.purchaseErrorListener((error) => {
          const errorCode = error?.code || '';
          const errorMsg = error?.message || '';
          if (errorCode === 'E_USER_CANCELLED' || errorCode === 'user-cancelled' || errorMsg.includes('cancel')) {
            finish(() => reject(new Error('user-cancelled')));
          } else {
            finish(() => reject(new Error(errorCode || 'IAP_ERROR')));
          }
        });

        try {
          // v14 API: use requestPurchase with type 'subs' and upgrade params
          await RNIap.requestPurchase({
            type: 'subs',
            request: {
              android: {
                skus: [targetProductId],
                subscriptionOffers: [{ sku: targetProductId, offerToken }],
                purchaseTokenAndroid: existingMainPlan.purchaseToken,
                replacementModeAndroid: 1, // IMMEDIATE_WITH_TIME_PRORATION
              },
            },
          });

          purchaseTimeout = setTimeout(() => {
            if (!finished) finish(() => reject(new Error('PURCHASE_TIMEOUT')));
          }, 120000);
        } catch (err) {
          finish(() => reject(err));
        }
      });
    }
  }

  // iOS: clear any pending/stale transactions before purchasing
  // This prevents "purchase failed" errors when upgrading between tiers
  if (Platform.OS === 'ios') {
    try {
      console.log('[IAP] iOS: Clearing pending transactions before purchase...');
      await RNIap.clearTransactionIOS();
      console.log('[IAP] iOS: Pending transactions cleared');
    } catch (clearErr) {
      console.warn('[IAP] iOS: Could not clear pending transactions:', clearErr?.message);
      // Continue with purchase even if clear fails
    }

    // Also finish any unfinished purchases
    try {
      const pending = await RNIap.getAvailablePurchases();
      if (pending && pending.length > 0) {
        console.log('[IAP] iOS: Finishing', pending.length, 'unfinished purchase(s)...');
        for (const purchase of pending) {
          try {
            await RNIap.finishTransaction({ purchase, isConsumable: false });
          } catch (e) {
            console.warn('[IAP] iOS: Could not finish pending purchase:', e?.message);
          }
        }
      }
    } catch (e) {
      console.warn('[IAP] iOS: Could not check pending purchases:', e?.message);
    }
  }

  // No existing plan or iOS - do normal purchase
  return purchaseProduct(targetProductId, entryPoint);
};

/**
 * Clear all pending transactions from the queue.
 * Works on both iOS and Android.
 */
export const clearPendingTransactions = async () => {
  console.log('[IAP] Starting clear of all transactions...');

  try {
    await initIAPIfNeeded();

    // Step 1: Platform-specific queue clear
    if (Platform.OS === 'ios') {
      try {
        console.log('[IAP] Step 1: Clearing iOS transaction queue...');
        await RNIap.clearTransactionIOS();
        console.log('[IAP] iOS transaction queue cleared');
      } catch (err) {
        console.warn('[IAP] Could not clear transaction queue:', err?.message);
      }
    }

    // Step 2: Get and finish ALL available purchases
    console.log('[IAP] Step 2: Getting available purchases...');
    const purchases = await RNIap.getAvailablePurchases();
    console.log('[IAP] Found', purchases?.length || 0, 'available purchase(s)');

    if (purchases && purchases.length > 0) {
      console.log('[IAP] Pending purchases to clear:');
      purchases.forEach((purchase, index) => {
        console.log(`[IAP]   ${index + 1}. ${purchase.productId || 'unknown'}`);
        console.log(`[IAP]      Transaction ID: ${purchase.transactionId || 'missing'}`);
      });
    }

    let successCount = 0;
    let failCount = 0;

    for (const purchase of purchases || []) {
      try {
        const pid = purchase.productId || 'unknown';
        console.log('[IAP] Attempting to finish:', pid);

        await RNIap.finishTransaction({ purchase, isConsumable: false });
        console.log('[IAP] Successfully finished:', pid);
        successCount++;
      } catch (err) {
        console.log('[IAP] Could not finish purchase (likely old/corrupted transaction)');
        failCount++;
      }
    }

    if (purchases && purchases.length > 0) {
      console.log(`[IAP] Clear results: ${successCount} succeeded, ${failCount} failed out of ${purchases.length} total`);
    }

    // Step 3: Try to restore and clear any subscriptions
    try {
      console.log('[IAP] Step 3: Attempting to restore and clear subscriptions...');
      const restored = await RNIap.restorePurchases();
      console.log('[IAP] Found', restored?.length || 0, 'restored purchase(s) to clear');
    } catch (err) {
      const errorMessage = err?.message || '';
      if (errorMessage.includes('Request Canceled') || errorMessage.includes('USER_CANCELLED')) {
        console.log('[IAP] User canceled verification during clear - partial clear completed');
      } else {
        console.warn('[IAP] Could not restore for clearing:', err?.message);
      }
    }

    // Clear offer cache on Android
    if (Platform.OS === 'android') {
      androidOfferCache = {};
    }

    console.log('[IAP] Clear process completed!');
    return true;
  } catch (error) {
    console.error('[IAP] Failed to clear transactions:', error);
    return false;
  }
};

/**
 * Check for active subscriptions without showing UI.
 * Returns the active subscription info if found, or null if none.
 * Works on both iOS and Android.
 */
export const checkActiveSubscription = async () => {
  console.log('[IAP] Checking for active subscriptions...');

  try {
    await initIAPIfNeeded();
    const purchases = await RNIap.getAvailablePurchases();

    if (!purchases || purchases.length === 0) {
      console.log('[IAP] No active subscriptions found');
      return null;
    }

    // v14: purchases returned by getAvailablePurchases are active
    // Android: purchaseState field, iOS: check transactionId exists
    const activeSubscription = purchases.find(purchase => {
      if (Platform.OS === 'ios') {
        return !!purchase.transactionId;
      } else {
        // If returned by getAvailablePurchases, it's active
        return true;
      }
    });

    if (activeSubscription) {
      console.log('[IAP] Active subscription found:', activeSubscription.productId);
      return activeSubscription;
    } else {
      console.log('[IAP] No active (non-expired) subscriptions found');
      return null;
    }
  } catch (error) {
    console.warn('[IAP] Error checking subscriptions:', error);
    return null;
  }
};

/**
 * Get available purchases (completed transactions that haven't been finalized yet).
 * Works on both iOS and Android.
 */
export const getAvailablePurchases = async () => {
  console.log('[IAP] getAvailablePurchases called');

  try {
    await initIAPIfNeeded();
    const availablePurchases = await RNIap.getAvailablePurchases();
    console.log('[IAP] Found', availablePurchases?.length || 0, 'available purchase(s)');

    if (availablePurchases && availablePurchases.length > 0) {
      availablePurchases.forEach((purchase, index) => {
        console.log(`[IAP] Available Purchase ${index + 1}:`, {
          productId: purchase.productId,
          transactionId: purchase.transactionId,
          ...(Platform.OS === 'android' ? {
            purchaseState: purchase.purchaseState,
            isAutoRenewing: purchase.isAutoRenewing,
          } : {}),
        });
      });
    }

    return availablePurchases;
  } catch (error) {
    console.error('[IAP] Failed to get available purchases:', error);
    return [];
  }
};

/**
 * Check if user has an active IAP subscription.
 * Returns true if there's an active, non-expired subscription.
 * Works on both iOS and Android.
 */
export const hasActiveIAPSubscription = async () => {
  console.log('[IAP] Checking for active IAP subscription...');

  try {
    await initIAPIfNeeded();

    const availablePurchases = await RNIap.getAvailablePurchases();
    console.log('[IAP] Available purchases:', availablePurchases?.length || 0);

    if (!availablePurchases || availablePurchases.length === 0) {
      console.log('[IAP] No available purchases found');
      return false;
    }

    // If getAvailablePurchases returns any purchases, user has active subscriptions
    for (const purchase of availablePurchases) {
      const pid = purchase.productId;
      console.log('[IAP] Found active subscription:', pid);
      return true;
    }

    console.log('[IAP] No active subscriptions found');
    return false;
  } catch (error) {
    console.error('[IAP] Failed to check active subscription:', error);
    return false;
  }
};

/**
 * Compute entitlements from active purchases.
 * Returns: { plan, seats, activeProductIds, lastRefreshedAt }
 *
 * Plan precedence: enterprise > business > pro > free
 * Seat rules:
 *   - business.seat counts only if main plan is business
 *   - enterprise.seat counts only if main plan is enterprise
 *
 * Note: Client-only verification is weaker than server-side.
 * Consider adding server verification via Google Play Developer API / App Store Server API later.
 */
export const computeEntitlements = (purchases) => {
  const allProductIds = Platform.OS === 'android' ? ANDROID_PRODUCTS : IOS_PRODUCTS;

  const activeProductIds = (purchases || []).map(p => p.productId).filter(Boolean);

  // Determine main plan (highest tier wins). Annual and monthly SKUs of the
  // same tier grant the same entitlement — a user on the annual Pro SKU still
  // maps to `plan: 'pro'`. Billing cadence lives on the product ID, not the
  // plan enum.
  let plan = 'free';
  if (activeProductIds.includes(allProductIds.ENTERPRISE_MONTHLY)) {
    plan = 'enterprise';
  } else if (
    activeProductIds.includes(allProductIds.BUSINESS_MONTHLY) ||
    activeProductIds.includes(allProductIds.BUSINESS_ANNUAL)
  ) {
    plan = 'business';
  } else if (
    activeProductIds.includes(allProductIds.PRO_MONTHLY) ||
    activeProductIds.includes(allProductIds.PRO_ANNUAL)
  ) {
    plan = 'pro';
  }

  // Count seats based on plan
  let seats = 0;
  if (plan === 'business') {
    seats = activeProductIds.filter(id => id === allProductIds.BUSINESS_SEAT).length;
  } else if (plan === 'enterprise') {
    seats = activeProductIds.filter(id => id === allProductIds.ENTERPRISE_SEAT).length;
  }

  return {
    plan,
    seats,
    activeProductIds,
    lastRefreshedAt: Date.now(),
  };
};

/**
 * Map a product ID to a plan name.
 * Works for both iOS and Android product IDs.
 */
export const productIdToPlan = (productId) => {
  if (!productId) return 'starter';

  // Check both iOS and Android product ID patterns
  if (productId.includes('enterprise') && !productId.includes('seat')) return 'enterprise';
  if (productId.includes('business') && !productId.includes('seat')) return 'business';
  if (productId.includes('pro')) return 'pro';

  return 'starter';
};

/**
 * Map a product ID to a billing period: 'annual' | 'monthly' | 'seat' | 'unknown'.
 * Annual SKUs carry the `.annual` suffix by convention. Seat add-ons are ranked
 * separately so analytics doesn't get miscoded as monthly.
 */
export const productIdToBillingPeriod = (productId) => {
  if (!productId) return 'unknown';
  if (productId.includes('.seat')) return 'seat';
  if (productId.includes('.annual')) return 'annual';
  return 'monthly';
};

/**
 * Comprehensive IAP diagnostic function.
 * Works on both iOS and Android. Uses v14 API.
 */
export const diagnoseIAPState = async () => {
  console.log('='.repeat(60));
  console.log('[IAP DIAGNOSTICS] Starting comprehensive IAP state check...');
  console.log('='.repeat(60));

  try {
    console.log('[DIAG] Platform:', Platform.OS);
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      console.warn('[DIAG] IAP not supported on this platform');
      return { supported: false };
    }

    console.log('[DIAG] Connection initialized:', connectionInitialized);
    await initIAPIfNeeded();
    console.log('[DIAG] Connection initialized successfully');

    // Check available purchases
    console.log('[DIAG] Checking available purchases...');
    const availablePurchases = await RNIap.getAvailablePurchases();
    console.log('[DIAG] Available purchases:', availablePurchases?.length || 0);

    // Check restored purchases
    console.log('[DIAG] Checking restored purchases...');
    const restoredPurchases = await RNIap.restorePurchases();
    console.log('[DIAG] Restored purchases:', restoredPurchases?.length || 0);

    // Log detailed purchase info
    if (restoredPurchases && restoredPurchases.length > 0) {
      console.log('[DIAG] Purchase details:');
      restoredPurchases.forEach((purchase, index) => {
        console.log(`[DIAG]   ${index + 1}. ${purchase.productId}`);
        console.log(`[DIAG]      Transaction ID: ${purchase.transactionId}`);
        if (Platform.OS === 'android') {
          console.log(`[DIAG]      Purchase State: ${purchase.purchaseState}`);
          console.log(`[DIAG]      Auto-Renewing: ${purchase.isAutoRenewing}`);
          console.log(`[DIAG]      Has Token: ${!!purchase.purchaseToken}`);
        }
      });
    }

    // Compute entitlements
    const entitlements = computeEntitlements(restoredPurchases || []);
    console.log('[DIAG] Computed entitlements:', JSON.stringify(entitlements));

    // Android: also check subscription product details
    if (Platform.OS === 'android') {
      try {
        console.log('[DIAG] Querying Android subscription products...');
        const subs = await RNIap.fetchProducts({ skus: ALL_ANDROID_SKUS, type: 'subs' });
        console.log('[DIAG] Found', subs?.length || 0, 'subscription product(s)');
        subs?.forEach((sub, i) => {
          const offers = sub.subscriptionOfferDetailsAndroid || [];
          const price = offers[0]?.pricingPhases?.pricingPhaseList?.[0]?.formattedPrice || 'N/A';
          console.log(`[DIAG]   ${i + 1}. ${sub.id} - ${price} (${offers.length} offer(s))`);
        });
      } catch (e) {
        console.warn('[DIAG] Could not query Android subscriptions:', e?.message);
      }
    }

    console.log('='.repeat(60));
    console.log('[IAP DIAGNOSTICS] Diagnostic check complete');
    console.log('='.repeat(60));

    return {
      supported: true,
      connectionInitialized,
      availablePurchasesCount: availablePurchases?.length || 0,
      restoredPurchasesCount: restoredPurchases?.length || 0,
      availablePurchases,
      restoredPurchases,
      entitlements,
    };
  } catch (error) {
    console.error('[DIAG] Diagnostic check failed:', error);
    console.log('='.repeat(60));
    return { supported: true, error: error.message };
  }
};

/**
 * Restore purchases for the user.
 * Required by Apple for apps with auto-renewable subscriptions.
 * Also works on Android to re-check active subscriptions.
 */
export const restorePurchases = async () => {
  console.log('[IAP] restorePurchases called');
  console.log('[IAP] Platform:', Platform.OS);

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.error('[IAP] Platform not supported:', Platform.OS);
    throw new Error('IAP_NOT_SUPPORTED');
  }

  console.log('[IAP] Initializing IAP connection...');
  await initIAPIfNeeded();

  try {
    // iOS: getAvailablePurchases reads Transaction.currentEntitlements from the
    // local StoreKit 2 cache — no network. Legacy StoreKit 1 receipts and
    // entitlements bought under an older build often aren't in that cache on
    // fresh install / after Apple-ID switch / long dormancy. RNIap.restorePurchases()
    // internally runs AppStore.sync() first, forcing Apple to hand the receipt
    // down. Do that here, then read entitlements. Android's Play Billing already
    // rehydrates on getAvailablePurchases, so RNIap.restorePurchases() is a no-op
    // pass-through there (still safe to call).
    console.log('[IAP] Forcing App Store sync via RNIap.restorePurchases()...');
    try {
      await RNIap.restorePurchases();
      console.log('[IAP] Sync complete');
    } catch (syncErr) {
      const msg = syncErr?.message || '';
      if (msg.includes('Request Canceled') || msg.includes('USER_CANCELLED') || msg.includes('canceled')) {
        throw syncErr; // user cancelled the Apple-ID password prompt
      }
      console.warn('[IAP] AppStore.sync() failed, falling back to cached entitlements:', msg);
    }

    console.log('[IAP] Calling RNIap.getAvailablePurchases()...');
    const purchases = await RNIap.getAvailablePurchases();
    console.log('[IAP] Restore successful, found', purchases?.length || 0, 'purchase(s)');

    if (purchases && purchases.length > 0) {
      purchases.forEach((purchase, index) => {
        console.log(`[IAP] Purchase ${index + 1}:`, {
          productId: purchase.productId,
          transactionId: purchase.transactionId,
          ...(Platform.OS === 'android' ? {
            purchaseState: purchase.purchaseState,
            isAutoRenewing: purchase.isAutoRenewing,
          } : {}),
        });

        // On Android, acknowledge any unacknowledged purchases during restore
        if (Platform.OS === 'android' && !purchase.isAcknowledgedAndroid) {
          console.log('[IAP] Acknowledging unacknowledged Android purchase:', purchase.productId);
          RNIap.finishTransaction({ purchase, isConsumable: false }).catch(e => {
            console.warn('[IAP] Could not acknowledge during restore:', e?.message);
          });
        }
      });
    } else {
      console.log('[IAP] No purchases to restore. This could mean:');
      console.log('[IAP]   1. No purchases have been made');
      if (Platform.OS === 'ios') {
        console.log('[IAP]   2. Sandbox test account not properly signed in');
        console.log('[IAP]   3. Purchases not finalized after completion');
        console.log('[IAP]   4. Need to wait a moment for App Store to sync');
      } else {
        console.log('[IAP]   2. Google account not signed in or not a license tester');
        console.log('[IAP]   3. Subscriptions have been cancelled and expired');
      }
    }

    return purchases;
  } catch (error) {
    console.error('[IAP] Restore failed:', error);
    console.error('[IAP] Error details:', JSON.stringify({ message: error?.message, code: error?.code, name: error?.name, stack: error?.stack?.slice(0, 400), debugMessage: error?.debugMessage, responseCode: error?.responseCode }, null, 2));
    throw error;
  }
};

/**
 * Open the platform's subscription management screen.
 */
export const openManageSubscriptions = () => {
  if (Platform.OS === 'android') {
    Linking.openURL('https://play.google.com/store/account/subscriptions');
  } else {
    Linking.openURL('https://apps.apple.com/account/subscriptions');
  }
};

/**
 * Parse ISO 8601 duration string to number of days.
 * Handles: P3D, P7D, P15D, P1W, P2W, P1M, P3M, P6M, P1Y
 */
const isoDurationToDays = (iso) => {
  if (!iso) return null;
  const match = iso.match(/^P(\d+)([DWMY])$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case 'D': return num;
    case 'W': return num * 7;
    case 'M': return num * 30;
    case 'Y': return num * 365;
    default: return null;
  }
};

/**
 * Get localized prices and trial offer metadata for all subscription plans.
 * Returns { prices: { productId: formattedPrice }, trialOffers: { productId: { hasTrial, trialDays } } }
 * Uses v14 fetchProducts API.
 */
export const getSubscriptionPrices = async () => {
  console.log('[IAP] Fetching subscription prices...');

  try {
    await initIAPIfNeeded();

    const allSkus = Object.values(IAP_PRODUCTS);

    // v14: use fetchProducts with type 'subs' for both platforms
    const products = await RNIap.fetchProducts({ skus: allSkus, type: 'subs' });
    _cacheProductPrices(products);
    console.error('[IAP] fetchProducts returned:', JSON.stringify({
      requestedSkus: allSkus,
      returnedCount: products?.length || 0,
      returnedIds: (products || []).map((p) => p?.id || p?.productId),
      platform: Platform.OS,
    }));
    const prices = {};
    const trialOffers = {};

    for (const product of products || []) {
      if (Platform.OS === 'android') {
        // Android: extract price and trial info from subscriptionOfferDetailsAndroid.
        // Match on recurrenceMode === 1 so monthly (P1M) and annual (P1Y) SKUs
        // resolve through the same code path.
        const offers = product.subscriptionOfferDetailsAndroid || [];
        for (const offer of offers) {
          const phases = offer.pricingPhases?.pricingPhaseList || [];
          const recurringPhase = phases.find(p => p.recurrenceMode === 1);
          if (recurringPhase) {
            prices[product.id] = recurringPhase.formattedPrice;

            // Check for free trial phase (priceAmountMicros === 0 or "0")
            const freePhase = phases.find(p =>
              (p.priceAmountMicros === 0 || p.priceAmountMicros === '0' || p.priceAmountMicros === '0.00') &&
              p.recurrenceMode !== 1
            );
            if (freePhase) {
              trialOffers[product.id] = {
                hasTrial: true,
                trialDays: isoDurationToDays(freePhase.billingPeriod) || 15,
              };
            }
            break;
          }
        }
        // Fallback to first phase price
        if (!prices[product.id] && offers[0]?.pricingPhases?.pricingPhaseList?.[0]) {
          prices[product.id] = offers[0].pricingPhases.pricingPhaseList[0].formattedPrice;
        }
      } else {
        // iOS: use displayPrice for price, then probe every known intro-offer
        // shape from RNIap (v14 split StoreKit 1 / StoreKit 2 + iOS-suffix
        // rename means the trial descriptor can live in any of these slots).
        prices[product.id] = product.displayPrice || '';

        const introCandidates = [
          product.subscriptionInfoIOS?.introductoryOffer,
          product.subscriptionInfoIOS?.introductoryPrice,
          product.introductoryOfferIOS,
          product.introductoryPriceIOS,
          product.introductoryPrice,
          ...(Array.isArray(product.discountsIOS)
            ? product.discountsIOS.filter((d) => d?.type === 'introductory')
            : []),
          ...(Array.isArray(product.subscriptionInfoIOS?.promotionalOffers)
            ? product.subscriptionInfoIOS.promotionalOffers
            : []),
        ];
        for (const intro of introCandidates) {
          if (!intro) continue;
          if (!_isFreeIntroOffer(intro)) continue;
          const period =
            intro.subscriptionPeriod ||
            intro.subscriptionPeriodIOS ||
            intro.period ||
            intro.billingPeriod;
          const periodDays = isoDurationToDays(period);
          const numPeriods = parseInt(
            intro.numberOfPeriods ?? intro.numberOfPeriodsIOS ?? '1',
            10
          ) || 1;
          trialOffers[product.id] = {
            hasTrial: true,
            trialDays: periodDays ? periodDays * numPeriods : 15,
          };
          break;
        }
      }

      // iOS unknown-shape fallback: probe didn't surface an intro offer in
      // any known field shape, but the product is configured with a trial in
      // App Store Connect. Default hasTrial:true so plan_selected.is_trial,
      // the paywall UI, and the post-purchase classifier agree (the classifier
      // already uses `ios_unknown_first_txn_fallback` for the same case).
      // Apple's StoreKit dialog at checkout is the authoritative source for
      // whether THIS specific user actually receives the trial.
      if (
        Platform.OS === 'ios' &&
        !trialOffers[product.id] &&
        _EXPECTED_TRIAL_PRODUCT_IDS.has(product.id) &&
        _productHasTrialCache[product.id] === 'unknown'
      ) {
        trialOffers[product.id] = { hasTrial: true, trialDays: 7 };
      }

      // Default: no trial detected
      if (!trialOffers[product.id]) {
        trialOffers[product.id] = { hasTrial: false, trialDays: 0 };
      }
    }

    console.log('[IAP] Prices:', prices);
    console.log('[IAP] Trial offers:', trialOffers);
    return { prices, trialOffers };
  } catch (error) {
    console.error('[IAP] Failed to fetch prices:', error);
    return { prices: {}, trialOffers: {} };
  }
};
