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
      const { productId: purchasedId, transactionReceipt, transactionReasonIOS } = purchase || {};
      
      // Only log detailed info for actual purchases, not renewals
      if (transactionReasonIOS === 'RENEWAL') {
        console.log('[IAP] 🔄 Renewal detected for:', purchasedId);
        // Silently ignore renewals - don't try to finish them as they're auto-renewed by iOS
        return;
      }
      
      console.log('[IAP] purchaseUpdatedListener triggered');
      console.log('[IAP] Purchased ID:', purchasedId, 'Expected:', productId);
      console.log('[IAP] Transaction reason:', transactionReasonIOS);
      console.log('[IAP] Has receipt:', !!transactionReceipt);

      if (!purchasedId || purchasedId !== productId || !transactionReceipt) {
        console.log('[IAP] Purchase validation failed - ignoring (wrong product or no receipt)');
        // Don't try to finish invalid/incomplete transactions - they may be missing required fields
        // These are likely from previous test sessions and will be cleared when subscriptions expire
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

      console.log('[IAP] Requesting purchase with v14 API...');
      
      try {
        await RNIap.requestPurchase({
          request: {
            ios: { sku: productId },
            android: { skus: [productId] }
          }
        });
        console.log('[IAP] Purchase request sent, waiting for response...');
        
        // Set a timeout to detect if purchase is silently blocked (e.g., existing subscription)
        // This timeout should trigger if no response comes from the purchase listeners within 3 seconds
        console.log('[IAP] Setting 3-second timeout...');
        purchaseTimeout = setTimeout(() => {
          console.warn('[IAP] ⏰ Timeout fired! finished=' + finished);
          if (!finished) {
            console.warn('[IAP] ⚠️ Purchase request timed out after 3 seconds');
            console.warn('[IAP] ⚠️ This usually means iOS blocked the purchase silently');
            console.warn('[IAP] ⚠️ This happens when the user already has an active subscription');
            finish(() => reject(new Error('PURCHASE_TIMEOUT')));
          } else {
            console.log('[IAP] Timeout fired but purchase already finished, ignoring');
          }
        }, 3000);
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
/**
 * Clear all pending transactions from the queue.
 * Use this to clear stuck/ghost transactions from sandbox testing.
 */
export const clearPendingTransactions = async () => {
  console.log('[IAP] Clearing pending transactions...');
  
  try {
    await initIAPIfNeeded();
    
    // Get all pending transactions
    const purchases = await RNIap.getAvailablePurchases();
    console.log('[IAP] Found', purchases?.length || 0, 'pending transaction(s)');
    
    // Finish all of them to clear the queue
    for (const purchase of purchases || []) {
      try {
        console.log('[IAP] Finishing transaction:', purchase.productId);
        await RNIap.finishTransaction(purchase, false);
      } catch (err) {
        console.warn('[IAP] Failed to finish transaction:', err?.message);
        // Continue with next transaction even if one fails
      }
    }
    
    console.log('[IAP] ✅ All pending transactions cleared');
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
    // Log count only to avoid massive token logs
    console.log('[IAP] ✅ Restore successful, found', purchases?.length || 0, 'purchase(s)');
    return purchases;
  } catch (error) {
    console.error('[IAP] ❌ Restore failed:', error);
    console.error('[IAP] Error details:', JSON.stringify(error, null, 2));
    throw error;
  }
};

