# Proxy Server Deep Link Setup

Add these routes/files to your proxy server to enable invite link deep linking.

## 1. Serve `/join` and `/referral` redirect pages

Add these Express routes to your proxy server:

```javascript
const path = require('path');

// Serve the join redirect page
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'join.html'));
});

// Serve the referral redirect page
app.get('/referral/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'referral.html'));
});
```

## 2. Apple App Site Association (iOS Universal Links)

Serve this at `/.well-known/apple-app-site-association` with `Content-Type: application/json`:

```javascript
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: "YOUR_TEAM_ID.com.proofpix.app",
          paths: ["/join*", "/referral/*"]
        }
      ]
    }
  });
});
```

Replace `YOUR_TEAM_ID` with your Apple Developer Team ID (found in Apple Developer Portal > Membership).

## 3. Android Asset Links

Serve this at `/.well-known/assetlinks.json` with `Content-Type: application/json`:

```javascript
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.proofpix.app",
        sha256_cert_fingerprints: [
          "YOUR_SHA256_FINGERPRINT"
        ]
      }
    }
  ]);
});
```

Get your SHA-256 fingerprint with:
```bash
keytool -list -v -keystore your-keystore.jks -alias your-alias
```

## Without server changes

The `proofpix://` custom URL scheme works without any server setup. The invite share message already includes the web link which will fall back to a browser. Users can:
1. Copy the invite code from the share message
2. Open ProofPix app
3. Navigate to "Join Team" screen
4. Paste the code

The deep link auto-redirect is a UX improvement but not strictly required for the feature to work.
