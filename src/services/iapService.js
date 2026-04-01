import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';

// Product IDs from App Store Connect / Google Play
export const IAP_PRODUCTS = {
  PRO_MONTHLY: 'com.goscha01.proofpix.pro.monthly',
  BUSINESS_MONTHLY: 'com.goscha01.proofpix.business.monthly',
  ENTERPRISE_MONTHLY: 'com.goscha01.proofpix.enterprise.monthly',
  BUSINESS_SEAT: 'com.goscha01.proofpix.business.seat',
  ENTERPRISE_SEAT: 'com.goscha01.proofpix.enterprise.seat',
};

let purchaseUpdateSubscription = null;
let purchaseErrorSubscription = null;
let connectionInitialized = false;

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
    console.log('[IAP] ✅ Connection initialized successfully');
  } catch (e) {
    console.error('[IAP] ❌ Failed to init connection:', e);
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
 * Purchase a single product and resolve when the transaction is completed.
 * Throws 'USER_CANCELLED' on user cancellation.
 */
export const purchaseProduct = async (productId) => {
  console.log('[IAP] purchaseProduct called for:', productId);
  console.log('[IAP] Platform:', Platform.OS);

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.error('[IAP] ❌ Platform not supported:', Platform.OS);
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
      const { productId: purchasedId, transactionReceipt, transactionReasonIOS, expirationDateIOS } = purchase || {};
      
      // Handle renewals
      if (transactionReasonIOS === 'RENEWAL') {
        const now = Date.now();
        const isExpired = expirationDateIOS && expirationDateIOS < now;
        const isActive = expirationDateIOS && expirationDateIOS > now;
        
        console.log('[IAP] 🔄 Renewal detected for:', purchasedId);
        console.log('[IAP] Renewal expired:', isExpired);
        console.log('[IAP] Renewal active:', isActive);
        console.log('[IAP] Expiration date:', expirationDateIOS ? new Date(expirationDateIOS).toISOString() : 'N/A');
        
        // If renewal is ACTIVE (not expired), treat it as valid purchase!
        if (isActive) {
          console.log('[IAP] ✅ Active renewal detected - treating as valid subscription');
          // Don't return - let it proceed through normal validation
        } else {
          // Expired renewals should be ignored
          console.log('[IAP] Ignoring expired renewal');
          return;
        }
      }
      
      console.log('[IAP] purchaseUpdatedListener triggered');
      console.log('[IAP] Purchased ID:', purchasedId, 'Expected:', productId);
      console.log('[IAP] Transaction reason:', transactionReasonIOS);
      console.log('[IAP] Has receipt:', !!transactionReceipt);

      // Validate purchase matches expected product
      if (!purchasedId || purchasedId !== productId) {
        // Check if this is a renewal event (iOS fires these during upgrade attempts)
        if (transactionReasonIOS === 'RENEWAL') {
          console.log('[IAP] ⏭️ Ignoring renewal event during purchase (waiting for actual purchase event)');
          return;
        }
        
        console.log('[IAP] Purchase validation failed - wrong product or missing product ID');
        return;
      }

      // In sandbox, receipts can be delayed or missing - handle gracefully
      if (!transactionReceipt) {
        console.log('[IAP] ⚠️ No receipt yet - this may be a delayed sandbox purchase');
        
        // In sandbox, sometimes receipts never arrive but purchase is valid
        // Check if this is a sandbox environment and handle accordingly
        if (__DEV__) {
          console.log('[IAP] 📝 Development mode: Accepting purchase without receipt');
          console.log('[IAP] ✅ Purchase validated (dev mode bypass)');
          
          finish(async () => {
            // In sandbox without receipt, finishTransaction may fail internally
            // This is a known issue with react-native-iap in sandbox
            // We'll try to finish, but don't worry if it fails
            try {
              console.log('[IAP] Attempting to finish transaction (no receipt - may fail)...');
              await RNIap.finishTransaction(purchase, false);
              console.log('[IAP] ✅ Transaction finished successfully');
            } catch (finishErr) {
              // This is expected in sandbox without receipt
              // The purchase is still valid and will be resolved
              console.log('[IAP] ℹ️ Could not finish transaction (expected in sandbox without receipt)');
            }
            console.log('[IAP] ✅ Resolving purchase (transaction may finish later)');
            resolve(purchase);
          });
          return;
        }
        
        // Production: Don't finish without receipt
        console.log('[IAP] Production mode: Waiting for receipt...');
        return;
      }

      console.log('[IAP] ✅ Purchase validated successfully');
      finish(async () => {
        try {
          console.log('[IAP] Calling finishTransaction...');
          await RNIap.finishTransaction(purchase, false);
          console.log('[IAP] ✅ Transaction finished');
        } catch (finishErr) {
          console.error('[IAP] ⚠️ Failed to finish transaction:', finishErr);
          // Even if finish fails, treat as purchased so user is not stuck.
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
      if (errorCode === 'E_USER_CANCELLED' || errorCode === 'user-cancelled' || errorMsg.includes('cancelled')) {
        console.log('[IAP] User cancelled purchase');
        finish(() => reject(new Error('user-cancelled')));
        return;
      }

      // Check if item already owned - this is expected behavior
      if (errorCode === 'already-owned' || errorMsg.includes('already owned')) {
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
        console.error('[IAP] ❌ Purchase error:', errorCode || 'IAP_ERROR');
        reject(new Error(errorCode || 'IAP_ERROR'));
      });
    });

    try {
      console.log('[IAP] Fetching products for:', [productId]);
      const products = await RNIap.fetchProducts({
        skus: [productId],
        type: 'subs'
      });
      // Log products without the massive JSON representation
      const cleanProducts = products.map(p => {
        const { jsonRepresentationIOS, ...rest } = p;
        return { ...rest, jsonRepresentationIOS: '[REDACTED]' };
      });
      console.log('[IAP] Products fetched:', JSON.stringify(cleanProducts, null, 2));

      if (!products || products.length === 0) {
        console.error('[IAP] ❌ No products found for:', productId);
        throw new Error('PRODUCT_NOT_FOUND');
      }

      console.log('[IAP] Requesting purchase...');
      
      try {
        await RNIap.requestPurchase({
          request: {
            ios: { sku: productId },
            android: { skus: [productId] }
          }
        });
        console.log('[IAP] Purchase request sent, waiting for response...');
        
        // Set a reasonable timeout for network issues
        // Per Apple docs, subscription upgrades in same group complete immediately
        purchaseTimeout = setTimeout(() => {
          if (!finished) {
            console.warn('[IAP] ⏰ Purchase request timed out after 15 seconds');
            console.warn('[IAP] ⚠️ This may indicate a network issue or system problem');
            finish(() => reject(new Error('PURCHASE_TIMEOUT')));
          }
        }, 15000); // 15 seconds - generous for any network delays
      } catch (requestErr) {
        throw requestErr;
      }
    } catch (err) {
      console.error('[IAP] ❌ Error during purchase flow:', err);
      console.error('[IAP] Error details:', JSON.stringify(err, null, 2));
      finish(() => reject(err));
    }
  });
};

/**
 * Check for active subscriptions without showing UI.
 * Returns the active subscription info if found, or null if none.
 */
export const purchaseOrUpgrade = async (targetProductId) => {
  console.log('[IAP] purchaseOrUpgrade called for:', targetProductId);

  try {
    return await _purchaseOrUpgradeInner(targetProductId);
  } catch (err) {
    // If subscription is already owned (common on iOS upgrades), treat as success
    if (err?.message === 'already-owned') {
      console.log('[IAP] Subscription already owned — treating as successful purchase');
      return { productId: targetProductId, alreadyOwned: true };
    }
    throw err;
  }
};

const _purchaseOrUpgradeInner = async (targetProductId) => {

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
  return purchaseProduct(targetProductId);
};

/**
 * Clear all pending transactions from the queue.
 * Use this to clear stuck/ghost transactions from sandbox testing.
 * NUCLEAR OPTION: Clears everything including expired renewals.
 */
export const clearPendingTransactions = async () => {
  console.log('[IAP] 🧹 Starting NUCLEAR clear of all transactions...');
  
  try {
    await initIAPIfNeeded();
    
    // Step 1: Clear iOS transaction queue first (removes incomplete transactions)
    if (Platform.OS === 'ios') {
      try {
        console.log('[IAP] Step 1: Clearing iOS transaction queue...');
        await RNIap.clearTransactionIOS();
        console.log('[IAP] ✅ iOS transaction queue cleared');
      } catch (err) {
        console.warn('[IAP] ⚠️ Could not clear transaction queue:', err?.message);
      }
    }
    
    // Step 2: Get and finish ALL available purchases
    // Note: Step 1 (clearTransactionIOS) already cleared the main queue
    // This step handles any remaining completed transactions
    console.log('[IAP] Step 2: Getting available purchases...');
    const purchases = await RNIap.getAvailablePurchases();
    console.log('[IAP] Found', purchases?.length || 0, 'available purchase(s)');
    
    if (purchases && purchases.length > 0) {
      console.log('[IAP] ℹ️ Attempting to finish available purchases (errors are expected for old transactions)');
      console.log('[IAP] 📋 Pending purchases to clear:');
      purchases.forEach((purchase, index) => {
        console.log(`[IAP]   ${index + 1}. ${purchase.productId || purchase.productID || 'unknown'}`);
        console.log(`[IAP]      Transaction ID: ${purchase.transactionId || 'missing'}`);
        console.log(`[IAP]      Has receipt: ${!!purchase.transactionReceipt}`);
      });
    }
    
    // Finish all available purchases
    let successCount = 0;
    let failCount = 0;
    
    for (const purchase of purchases || []) {
      try {
        const productId = purchase.productId || purchase.productID || 'unknown';
        console.log('[IAP] 🔧 Attempting to finish:', productId);
        
        // Validate purchase has required structure before attempting to finish
        if (!purchase || !purchase.transactionId) {
          console.log('[IAP] ⚠️ Skipping invalid purchase (missing transactionId)');
          failCount++;
          continue;
        }
        
        // Try to finish the transaction
        // Note: Some old sandbox purchases may fail to finish - this is expected
        await RNIap.finishTransaction(purchase, false);
        console.log('[IAP] ✅ Successfully finished:', productId);
        successCount++;
      } catch (err) {
        // This is expected for corrupted/old sandbox transactions
        // Just log and continue - clearTransactionIOS already cleared the queue
        console.log('[IAP] ❌ Could not finish purchase (likely old/corrupted transaction)');
        failCount++;
        // Continue with other purchases even if one fails
      }
    }
    
    if (purchases && purchases.length > 0) {
      console.log(`[IAP] 📊 Clear results: ${successCount} succeeded, ${failCount} failed out of ${purchases.length} total`);
    }
    
    // Step 3: Try to restore and clear any subscriptions
    try {
      console.log('[IAP] Step 3: Attempting to restore and clear subscriptions...');
      const restored = await RNIap.restorePurchases();
      console.log('[IAP] Found', restored?.length || 0, 'restored purchase(s) to clear');
      
      // Note: We can't actually "delete" subscriptions, but finishing transactions helps
      // The expired renewals will eventually time out from iOS's system
    } catch (err) {
      const errorMessage = err?.message || '';
      // If user canceled, handle silently
      if (errorMessage.includes('Request Canceled') || errorMessage.includes('USER_CANCELLED')) {
        console.log('[IAP] ℹ️ User canceled verification during clear - partial clear completed');
      } else {
        console.warn('[IAP] Could not restore for clearing:', err?.message);
      }
    }
    
    console.log('[IAP] ✅ Clear process completed!');
    console.log('[IAP] ℹ️ Note: Some transactions may persist until you restart the device');
    return true;
  } catch (error) {
    console.error('[IAP] ❌ Failed to clear transactions:', error);
    return false;
  }
};

export const checkActiveSubscription = async () => {
  console.log('[IAP] Checking for active subscriptions...');
  
  try {
    await initIAPIfNeeded();
    const purchases = await RNIap.restorePurchases();
    
    if (!purchases || purchases.length === 0) {
      console.log('[IAP] No active subscriptions found');
      return null;
    }
    
    // Find an active subscription (not expired)
    const now = Date.now();
    const activeSubscription = purchases.find(purchase => {
      // Check if subscription is still valid
      const expirationDate = purchase.expirationDateIOS;
      if (expirationDate && expirationDate > now) {
        return true;
      }
      return false;
    });
    
    if (activeSubscription) {
      console.log('[IAP] ✅ Active subscription found:', activeSubscription.productId);
      return activeSubscription;
    } else {
      console.log('[IAP] No active (non-expired) subscriptions found');
      return null;
    }
  } catch (error) {
    console.warn('[IAP] ⚠️ Error checking subscriptions:', error);
    return null; // Don't block purchase on error
  }
};

/**
 * Get available purchases (completed transactions that haven't been finalized yet).
 * This can help debug restore purchase issues.
 */
export const getAvailablePurchases = async () => {
  console.log('[IAP] getAvailablePurchases called');
  
  try {
    await initIAPIfNeeded();
    const availablePurchases = await RNIap.getAvailablePurchases();
    console.log('[IAP] ✅ Found', availablePurchases?.length || 0, 'available purchase(s)');
    
    if (availablePurchases && availablePurchases.length > 0) {
      availablePurchases.forEach((purchase, index) => {
        console.log(`[IAP] Available Purchase ${index + 1}:`, {
          productId: purchase.productId,
          transactionId: purchase.transactionId,
          transactionDate: purchase.transactionDateIOS,
        });
      });
    }
    
    return availablePurchases;
  } catch (error) {
    console.error('[IAP] ❌ Failed to get available purchases:', error);
    return [];
  }
};

/**
 * Check if user has an active IAP subscription.
 * Returns true if there's an active, non-expired subscription.
 */
export const hasActiveIAPSubscription = async () => {
  console.log('[IAP] Checking for active IAP subscription...');
  
  try {
    await initIAPIfNeeded();
    
    // Get available purchases
    const availablePurchases = await RNIap.getAvailablePurchases();
    console.log('[IAP] Available purchases:', availablePurchases?.length || 0);
    
    if (!availablePurchases || availablePurchases.length === 0) {
      console.log('[IAP] No available purchases found');
      return false;
    }
    
    // Check for active subscriptions
    const now = Date.now();
    for (const purchase of availablePurchases) {
      console.log('[IAP] Checking purchase:', {
        productId: purchase.productId,
        transactionDate: purchase.transactionDateIOS,
      });
      
      // For subscriptions, check if there's a renewal or expiration date
      if (purchase.transactionReceipt || purchase.originalTransactionDateIOS) {
        // Check for iOS renewal
        const expirationDate = purchase.expirationDateIOS 
          ? new Date(purchase.expirationDateIOS).getTime()
          : null;
        
        const isActive = expirationDate ? expirationDate > now : true;
        
        console.log('[IAP] Subscription status:', {
          productId: purchase.productId,
          expirationDate: purchase.expirationDateIOS,
          isActive,
        });
        
        if (isActive) {
          console.log('[IAP] ✅ Found active subscription:', purchase.productId);
          return true;
        }
      }
    }
    
    console.log('[IAP] No active subscriptions found');
    return false;
  } catch (error) {
    console.error('[IAP] ❌ Failed to check active subscription:', error);
    return false;
  }
};

/**
 * Comprehensive IAP diagnostic function.
 * Call this to get detailed information about the current IAP state.
 * Useful for troubleshooting "no purchases found" issues.
 */
export const diagnoseIAPState = async () => {
  console.log('='.repeat(60));
  console.log('[IAP DIAGNOSTICS] Starting comprehensive IAP state check...');
  console.log('='.repeat(60));
  
  try {
    // 1. Platform check
    console.log('[DIAG] Platform:', Platform.OS);
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      console.warn('[DIAG] ⚠️ IAP not supported on this platform');
      return { supported: false };
    }
    
    // 2. Connection status
    console.log('[DIAG] Connection initialized:', connectionInitialized);
    await initIAPIfNeeded();
    console.log('[DIAG] ✅ Connection initialized successfully');
    
    // 3. Check available purchases (completed but not finalized)
    console.log('[DIAG] Checking available purchases...');
    const availablePurchases = await RNIap.getAvailablePurchases();
    console.log('[DIAG] Available purchases (not finalized):', availablePurchases?.length || 0);
    
    // 4. Check restored purchases
    console.log('[DIAG] Checking restored purchases...');
    const restoredPurchases = await RNIap.restorePurchases();
    console.log('[DIAG] Restored purchases:', restoredPurchases?.length || 0);
    
    // 5. Check for active subscriptions
    const now = Date.now();
    const activeSubs = restoredPurchases?.filter(p => 
      p.expirationDateIOS && p.expirationDateIOS > now
    ) || [];
    console.log('[DIAG] Active (non-expired) subscriptions:', activeSubs.length);
    
    // 6. Log detailed purchase info
    if (restoredPurchases && restoredPurchases.length > 0) {
      console.log('[DIAG] Purchase details:');
      restoredPurchases.forEach((purchase, index) => {
        const isExpired = purchase.expirationDateIOS 
          ? purchase.expirationDateIOS < now 
          : 'N/A';
        console.log(`[DIAG]   ${index + 1}. ${purchase.productId}`);
        console.log(`[DIAG]      Transaction ID: ${purchase.transactionId}`);
        console.log(`[DIAG]      Transaction Date: ${purchase.transactionDateIOS ? new Date(purchase.transactionDateIOS).toISOString() : 'N/A'}`);
        console.log(`[DIAG]      Expiration Date: ${purchase.expirationDateIOS ? new Date(purchase.expirationDateIOS).toISOString() : 'N/A'}`);
        console.log(`[DIAG]      Is Expired: ${isExpired}`);
      });
    }
    
    console.log('='.repeat(60));
    console.log('[IAP DIAGNOSTICS] Diagnostic check complete');
    console.log('='.repeat(60));
    
    return {
      supported: true,
      connectionInitialized,
      availablePurchasesCount: availablePurchases?.length || 0,
      restoredPurchasesCount: restoredPurchases?.length || 0,
      activeSubscriptionsCount: activeSubs.length,
      availablePurchases,
      restoredPurchases,
      activeSubscriptions: activeSubs
    };
  } catch (error) {
    console.error('[DIAG] ❌ Diagnostic check failed:', error);
    console.log('='.repeat(60));
    return { supported: true, error: error.message };
  }
};

/**
 * Restore purchases for the user.
 * This is required by Apple for apps with auto-renewable subscriptions.
 * Call this when user taps "Restore Purchases" button.
 */
export const restorePurchases = async () => {
  console.log('[IAP] restorePurchases called');
  console.log('[IAP] Platform:', Platform.OS);

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.error('[IAP] ❌ Platform not supported:', Platform.OS);
    throw new Error('IAP_NOT_SUPPORTED');
  }

  console.log('[IAP] Initializing IAP connection...');
  await initIAPIfNeeded();

  try {
    console.log('[IAP] Calling RNIap.restorePurchases()...');
    const purchases = await RNIap.restorePurchases();
    console.log('[IAP] ✅ Restore successful, found', purchases?.length || 0, 'purchase(s)');
    
    // Enhanced logging for debugging
    if (purchases && purchases.length > 0) {
      purchases.forEach((purchase, index) => {
        console.log(`[IAP] Purchase ${index + 1}:`, {
          productId: purchase.productId,
          transactionId: purchase.transactionId,
          transactionDate: purchase.transactionDateIOS,
          expirationDate: purchase.expirationDateIOS,
          isExpired: purchase.expirationDateIOS ? purchase.expirationDateIOS < Date.now() : 'N/A'
        });
      });
    } else {
      console.log('[IAP] ℹ️ No purchases to restore. This could mean:');
      console.log('[IAP]   1. No purchases have been made');
      console.log('[IAP]   2. Sandbox test account not properly signed in');
      console.log('[IAP]   3. Purchases not finalized after completion');
      console.log('[IAP]   4. Need to wait a moment for App Store to sync');
    }
    
    return purchases;
  } catch (error) {
    console.error('[IAP] ❌ Restore failed:', error);
    console.error('[IAP] Error details:', JSON.stringify(error, null, 2));
    throw error;
  }
};


