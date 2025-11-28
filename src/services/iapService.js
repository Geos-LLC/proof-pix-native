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
  if (connectionInitialized) {
    console.log('[IAP] Connection already initialized');
    return;
  }
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.log('[IAP] Platform not supported:', Platform.OS);
    return;
  }

  try {
    console.log('[IAP] Initializing connection...');
    await RNIap.initConnection();
    connectionInitialized = true;
    console.log('[IAP] ✅ Connection initialized successfully');
  } catch (e) {
    // If connection fails, purchases will fail later and be handled per-call.
    console.error('[IAP] ❌ Failed to init connection:', e);
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

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.error('[IAP] Platform not supported:', Platform.OS);
    throw new Error('IAP_NOT_SUPPORTED');
  }

  console.log('[IAP] Initializing IAP connection if needed...');
  await initIAPIfNeeded();

  return new Promise(async (resolve, reject) => {
    let finished = false;

    const finish = (fn) => {
      if (finished) return;
      finished = true;
      cleanupListeners();
      fn();
    };

    purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(async (purchase) => {
      console.log('[IAP] Purchase update received:', purchase);
      const { productId: purchasedId, transactionReceipt } = purchase || {};
      if (!purchasedId || purchasedId !== productId || !transactionReceipt) {
        console.log('[IAP] Purchase update not for this product, ignoring');
        return;
      }

      console.log('[IAP] ✅ Purchase successful for:', productId);
      finish(async () => {
        try {
          await RNIap.finishTransaction(purchase, false);
          console.log('[IAP] Transaction finished');
        } catch (finishErr) {
          console.warn('[IAP] Failed to finish transaction:', finishErr);
          // Even if finish fails, treat as purchased so user is not stuck.
        }
        resolve(purchase);
      });
    });

    purchaseErrorSubscription = RNIap.purchaseErrorListener((error) => {
      console.error('[IAP] Purchase error:', error);
      finish(() => {
        if (error?.code === 'E_USER_CANCELLED') {
          console.log('[IAP] User cancelled purchase');
          reject(new Error('USER_CANCELLED'));
        } else {
          console.error('[IAP] Purchase failed with code:', error?.code);
          reject(new Error(error?.code || 'IAP_ERROR'));
        }
      });
    });

    try {
      // Ensure product is known to the store (will also fetch localized price if needed later)
      console.log('[IAP] Fetching product from store:', productId);
      const products = await RNIap.getProducts([productId]);
      console.log('[IAP] Products fetched:', products);

      if (!products || products.length === 0) {
        throw new Error('PRODUCT_NOT_FOUND');
      }

      console.log('[IAP] Requesting purchase...');
      await RNIap.requestPurchase(productId, false);
      console.log('[IAP] Purchase request sent');
    } catch (err) {
      console.error('[IAP] Error during purchase flow:', err);
      finish(() => reject(err));
    }
  });
};

