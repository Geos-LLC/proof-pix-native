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

    const finish = (fn) => {
      if (finished) {
        console.log('[IAP] finish() called but already finished, ignoring');
        return;
      }
      console.log('[IAP] Finishing transaction...');
      finished = true;
      cleanupListeners();
      fn();
    };

    console.log('[IAP] Setting up purchaseUpdatedListener...');
    purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(async (purchase) => {
      console.log('[IAP] purchaseUpdatedListener triggered');
      console.log('[IAP] Purchase object:', JSON.stringify(purchase, null, 2));

      const { productId: purchasedId, transactionReceipt } = purchase || {};
      console.log('[IAP] Purchased ID:', purchasedId, 'Expected:', productId);
      console.log('[IAP] Has receipt:', !!transactionReceipt);

      if (!purchasedId || purchasedId !== productId || !transactionReceipt) {
        console.log('[IAP] Purchase validation failed - ignoring');
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
      console.error('[IAP] purchaseErrorListener triggered');
      console.error('[IAP] Error object:', JSON.stringify(error, null, 2));
      console.error('[IAP] Error code:', error?.code);
      console.error('[IAP] Error message:', error?.message);

      finish(() => {
        if (error?.code === 'E_USER_CANCELLED') {
          console.log('[IAP] User cancelled purchase');
          reject(new Error('USER_CANCELLED'));
        } else {
          console.error('[IAP] ❌ Purchase error:', error?.code || 'IAP_ERROR');
          reject(new Error(error?.code || 'IAP_ERROR'));
        }
      });
    });

    try {
      console.log('[IAP] Fetching products for:', [productId]);
      const products = await RNIap.fetchProducts({
        skus: [productId],
        type: 'subs'
      });
      console.log('[IAP] Products fetched:', JSON.stringify(products, null, 2));

      if (!products || products.length === 0) {
        console.error('[IAP] ❌ No products found for:', productId);
        throw new Error('PRODUCT_NOT_FOUND');
      }

      console.log('[IAP] Requesting purchase with v14 API...');
      
      // Set a timeout to detect if purchase is silently blocked (e.g., existing subscription)
      const purchaseTimeout = setTimeout(() => {
        console.warn('[IAP] ⚠️ Purchase request timed out after 3 seconds');
        console.warn('[IAP] ⚠️ This may indicate an existing active subscription');
        finish(() => reject(new Error('PURCHASE_TIMEOUT')));
      }, 3000);
      
      try {
        await RNIap.requestPurchase({
          request: {
            ios: { sku: productId },
            android: { skus: [productId] }
          }
        });
        clearTimeout(purchaseTimeout);
        console.log('[IAP] Purchase request sent, waiting for response...');
      } catch (requestErr) {
        clearTimeout(purchaseTimeout);
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
    console.log('[IAP] ✅ Restore successful, purchases:', JSON.stringify(purchases, null, 2));
    return purchases;
  } catch (error) {
    console.error('[IAP] ❌ Restore failed:', error);
    console.error('[IAP] Error details:', JSON.stringify(error, null, 2));
    throw error;
  }
};

