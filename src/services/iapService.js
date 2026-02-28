import { Platform, Linking } from 'react-native';
import * as RNIap from 'react-native-iap';

// Platform-specific product IDs
// iOS: product IDs include .monthly suffix (configured in App Store Connect)
// Android: product IDs without .monthly suffix, base plan "monthly" is separate (configured in Google Play Console)
const IOS_PRODUCTS = {
  PRO_MONTHLY: 'com.goscha01.proofpix.pro.monthly',
  BUSINESS_MONTHLY: 'com.goscha01.proofpix.business.monthly',
  ENTERPRISE_MONTHLY: 'com.goscha01.proofpix.enterprise.monthly',
  BUSINESS_SEAT: 'com.goscha01.proofpix.business.seat',
  ENTERPRISE_SEAT: 'com.goscha01.proofpix.enterprise.seat',
};

const ANDROID_PRODUCTS = {
  PRO_MONTHLY: 'com.goscha01.proofpix.pro',
  BUSINESS_MONTHLY: 'com.goscha01.proofpix.business',
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
    console.error('[IAP] Error details:', JSON.stringify(e, null, 2));
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

  // Select the monthly base plan offer
  // Look for an offer whose pricingPhases include a recurring monthly phase (P1M)
  let selectedOffer = null;
  for (const offer of offers) {
    const phases = offer.pricingPhases?.pricingPhaseList || [];
    const hasMonthlyRecurring = phases.some(
      phase => phase.billingPeriod === 'P1M' && phase.recurrenceMode === 1
    );
    if (hasMonthlyRecurring) {
      selectedOffer = offer;
      break;
    }
  }

  // Fallback: use first offer if no monthly recurring found
  if (!selectedOffer) {
    console.warn('[IAP] No monthly recurring offer found, using first offer');
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
export const purchaseProduct = async (productId) => {
  console.log('[IAP] purchaseProduct called for:', productId);
  console.log('[IAP] Platform:', Platform.OS);

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.error('[IAP] Platform not supported:', Platform.OS);
    throw new Error('IAP_NOT_SUPPORTED');
  }

  console.log('[IAP] Initializing IAP connection...');
  await initIAPIfNeeded();

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
        console.log('[IAP] Fetching products for:', [productId]);
        const products = await RNIap.fetchProducts({
          skus: [productId],
          type: 'subs'
        });
        console.log('[IAP] Products fetched:', products?.length || 0);

        if (!products || products.length === 0) {
          console.error('[IAP] No products found for:', productId);
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
      console.error('[IAP] Error details:', JSON.stringify(err, null, 2));
      finish(() => reject(err));
    }
  });
};

/**
 * Purchase or upgrade a subscription.
 * On Android, if user has an active main plan, this will trigger an upgrade flow
 * with immediate proration. Uses v14 requestPurchase with replacementModeAndroid.
 */
export const purchaseOrUpgrade = async (targetProductId) => {
  console.log('[IAP] purchaseOrUpgrade called for:', targetProductId);

  if (Platform.OS === 'android') {
    // Check for existing active main plan subscription
    const currentPurchases = await getAvailablePurchases();
    const mainPlanIds = [
      ANDROID_PRODUCTS.PRO_MONTHLY,
      ANDROID_PRODUCTS.BUSINESS_MONTHLY,
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
          if (purchasedId === targetProductId || ids.includes(targetProductId)) {
            finish(async () => {
              try {
                await RNIap.finishTransaction({ purchase, isConsumable: false });
              } catch (e) {
                console.error('[IAP] Failed to acknowledge upgrade:', e);
              }
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

  // No existing plan or iOS - do normal purchase
  return purchaseProduct(targetProductId);
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

  // Determine main plan (highest tier wins)
  let plan = 'free';
  if (activeProductIds.includes(allProductIds.ENTERPRISE_MONTHLY)) {
    plan = 'enterprise';
  } else if (activeProductIds.includes(allProductIds.BUSINESS_MONTHLY)) {
    plan = 'business';
  } else if (activeProductIds.includes(allProductIds.PRO_MONTHLY)) {
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
    console.error('[IAP] Error details:', JSON.stringify(error, null, 2));
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
 * Get localized prices for all subscription plans from the store.
 * Returns an object with plan keys and their formatted price strings.
 * Uses v14 fetchProducts API.
 */
export const getSubscriptionPrices = async () => {
  console.log('[IAP] Fetching subscription prices...');

  try {
    await initIAPIfNeeded();

    const allSkus = Object.values(IAP_PRODUCTS);

    // v14: use fetchProducts with type 'subs' for both platforms
    const products = await RNIap.fetchProducts({ skus: allSkus, type: 'subs' });
    const prices = {};

    for (const product of products || []) {
      if (Platform.OS === 'android') {
        // Android: extract price from subscriptionOfferDetailsAndroid
        const offers = product.subscriptionOfferDetailsAndroid || [];
        for (const offer of offers) {
          const phases = offer.pricingPhases?.pricingPhaseList || [];
          const recurringPhase = phases.find(p => p.billingPeriod === 'P1M' && p.recurrenceMode === 1);
          if (recurringPhase) {
            prices[product.id] = recurringPhase.formattedPrice;
            break;
          }
        }
        // Fallback to first phase price
        if (!prices[product.id] && offers[0]?.pricingPhases?.pricingPhaseList?.[0]) {
          prices[product.id] = offers[0].pricingPhases.pricingPhaseList[0].formattedPrice;
        }
      } else {
        // iOS: use displayPrice
        prices[product.id] = product.displayPrice || '';
      }
    }

    console.log('[IAP] Prices:', prices);
    return prices;
  } catch (error) {
    console.error('[IAP] Failed to fetch prices:', error);
    return {};
  }
};
