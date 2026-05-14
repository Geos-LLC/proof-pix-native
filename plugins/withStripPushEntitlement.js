const { withEntitlementsPlist } = require('@expo/config-plugins');

// Strips the `aps-environment` entitlement from the iOS Entitlements.plist
// after every other plugin has run. The app only uses LOCAL notifications,
// but expo-notifications' native autolinking still tries to declare Push
// Notifications, which fails the build when the provisioning profile does
// not include that capability. Re-enable this when you regenerate the
// provisioning profile with Push enabled.
const withStripPushEntitlement = (config) => {
  return withEntitlementsPlist(config, (cfg) => {
    if (cfg.modResults && 'aps-environment' in cfg.modResults) {
      delete cfg.modResults['aps-environment'];
    }
    return cfg;
  });
};

module.exports = withStripPushEntitlement;
