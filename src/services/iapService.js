import { Platform } from 'react-native';

// Try to import the native module, but handle gracefully if it's not available
let InAppPurchases = null;
try {
  InAppPurchases = require('expo-in-app-purchases');
} catch (e) {
  console.warn('[IAP] expo-in-app-purchases native module not available. Rebuild the app to enable IAP functionality.');
}

// Product IDs from App Store Connect
export const IAP_PRODUCTS = {
  PRO_MONTHLY: 'com.goscha01.proofpix.pro.monthly',
  BUSINESS_MONTHLY: 'com.goscha01.proofpix.business.monthly',
  ENTERPRISE_MONTHLY: 'com.goscha01.proofpix.enterprise.monthly',
  BUSINESS_SEAT: 'com.goscha01.proofpix.business.seat',
  ENTERPRISE_SEAT: 'com.goscha01.proofpix.enterprise.seat',
};

/**
 * Initialize IAP on iOS.
 * Safe to call multiple times; it will no-op on Android or if module is unavailable.
 */
export const initIAPIfNeeded = async () => {
  if (Platform.OS !== 'ios' || !InAppPurchases) return;
  try {
    await InAppPurchases.connectAsync();
  } catch (e) {
    // If connection fails, purchases will fail later and be handled per-call.
  }
};

/**
 * Purchase a single product and resolve when the transaction is completed.
 * Throws 'USER_CANCELLED' on user cancellation.
 */
export const purchaseProduct = async (productId) => {
  if (Platform.OS !== 'ios') {
    throw new Error('IAP_NOT_SUPPORTED');
  }

  if (!InAppPurchases) {
    throw new Error('IAP_MODULE_NOT_AVAILABLE - Please rebuild the app to enable in-app purchases.');
  }

  await initIAPIfNeeded();

  return new Promise(async (resolve, reject) => {
    let finished = false;

    InAppPurchases.setPurchaseListener(async ({ responseCode, results, errorCode }) => {
      if (finished) {
        return;
      }

      if (responseCode === InAppPurchases.IAPResponseCode.OK) {
        for (const purchase of results || []) {
          if (purchase.productId === productId && !purchase.acknowledged) {
            try {
              await InAppPurchases.finishTransactionAsync(purchase, false);
            } catch {
              // Even if finish fails, treat as purchased so user is not stuck.
            }
            finished = true;
            resolve(purchase);
            return;
          }
        }
      } else if (responseCode === InAppPurchases.IAPResponseCode.USER_CANCELED) {
        finished = true;
        reject(new Error('USER_CANCELLED'));
      } else {
        finished = true;
        reject(new Error(errorCode || 'IAP_ERROR'));
      }
    });

    try {
      // Ensure product is known to the store (will also fetch localized price if needed later)
      await InAppPurchases.getProductsAsync([productId]);
      await InAppPurchases.purchaseItemAsync(productId);
    } catch (err) {
      finished = true;
      reject(err);
    }
  });
};


