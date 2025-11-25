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
  if (connectionInitialized) return;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

  try {
    await RNIap.initConnection();
    connectionInitialized = true;
  } catch (e) {
    // If connection fails, purchases will fail later and be handled per-call.
    console.warn('[IAP] Failed to init connection:', e);
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
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('IAP_NOT_SUPPORTED');
  }

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
      const { productId: purchasedId, transactionReceipt } = purchase || {};
      if (!purchasedId || purchasedId !== productId || !transactionReceipt) {
        return;
      }

      finish(async () => {
        try {
          await RNIap.finishTransaction(purchase, false);
        } catch {
          // Even if finish fails, treat as purchased so user is not stuck.
        }
        resolve(purchase);
      });
    });

    purchaseErrorSubscription = RNIap.purchaseErrorListener((error) => {
      finish(() => {
        if (error?.code === 'E_USER_CANCELLED') {
          reject(new Error('USER_CANCELLED'));
        } else {
          reject(new Error(error?.code || 'IAP_ERROR'));
        }
      });
    });

    try {
      // Ensure product is known to the store (will also fetch localized price if needed later)
      await RNIap.getProducts([productId]);
      await RNIap.requestPurchase(productId, false);
    } catch (err) {
      finish(() => reject(err));
    }
  });
};

