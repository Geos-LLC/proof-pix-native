# Apple Sign In & iCloud Proxy Server Implementation Guide

This guide explains how to update your ProofPix proxy server to support Apple Sign In and iCloud Drive integration.

## Overview

The React Native app now sends Apple authentication credentials to your proxy server at the `/api/admin/init` endpoint with `accountType: 'apple'`. Your server needs to:

1. Verify the Apple identity token
2. Exchange the authorization code for refresh/access tokens
3. Store tokens for team member uploads
4. Handle file uploads to iCloud Drive (using CloudKit)

---

## 1. Verify Apple Identity Token

Apple provides an `identityToken` (JWT) that you must verify on your server for security.

### Install Dependencies

```bash
npm install jsonwebtoken jwks-rsa node-fetch
```

### Verification Code

```javascript
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Apple's public key endpoint
const client = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys'
});

function getApplePublicKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

async function verifyAppleToken(identityToken) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      identityToken,
      getApplePublicKey,
      {
        issuer: 'https://appleid.apple.com',
        audience: 'com.proofpix.app', // Your bundle ID
      },
      (err, decoded) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded);
        }
      }
    );
  });
}
```

---

## 2. Exchange Authorization Code for Tokens

Apple provides a one-time `authorizationCode` that must be exchanged for refresh and access tokens.

### Token Exchange Code

```javascript
async function exchangeAppleAuthCode(authorizationCode) {
  const clientSecret = generateAppleClientSecret(); // See below

  const params = new URLSearchParams({
    client_id: 'com.proofpix.app', // Your bundle ID
    client_secret: clientSecret,
    code: authorizationCode,
    grant_type: 'authorization_code',
  });

  const response = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    idToken: data.id_token,
  };
}
```

### Generate Client Secret (JWT)

Apple requires a client secret (JWT) signed with your private key.

```javascript
const jwt = require('jsonwebtoken');
const fs = require('fs');

function generateAppleClientSecret() {
  // Download your private key from Apple Developer Portal
  // Services IDs > Configure > Download
  const privateKey = fs.readFileSync('./AuthKey_XXXXXXXXXX.p8', 'utf8');

  const headers = {
    kid: 'YOUR_KEY_ID', // From Apple Developer Portal
    typ: undefined,
  };

  const claims = {
    iss: 'YOUR_TEAM_ID', // 10-character Team ID from Apple
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 180, // 6 months
    aud: 'https://appleid.apple.com',
    sub: 'com.proofpix.app', // Your bundle ID
  };

  return jwt.sign(claims, privateKey, {
    algorithm: 'ES256',
    header: headers,
  });
}
```

**Important**: Store these values as environment variables:
- `APPLE_TEAM_ID` - Your 10-character Team ID
- `APPLE_KEY_ID` - Key ID from the .p8 file
- `APPLE_PRIVATE_KEY` - Contents of the .p8 file

---

## 3. Update Proxy Server `/api/admin/init` Endpoint

```javascript
app.post('/api/admin/init', async (req, res) => {
  const { accountType, userId } = req.body;

  try {
    if (accountType === 'apple') {
      const { identityToken, authorizationCode, appleUserId, folderId } = req.body;

      // 1. Verify the identity token
      const decodedToken = await verifyAppleToken(identityToken);
      console.log('[APPLE] Token verified for user:', decodedToken.sub);

      // 2. Exchange authorization code for tokens
      const tokens = await exchangeAppleAuthCode(authorizationCode);
      console.log('[APPLE] Tokens obtained');

      // 3. Store refresh token in your database
      // Associate with userId for team member access
      await db.storeAppleRefreshToken({
        userId: userId || appleUserId,
        refreshToken: tokens.refreshToken,
        folderId: folderId,
        email: decodedToken.email,
      });

      // 4. Create session
      const sessionId = generateSessionId();
      sessions[sessionId] = {
        accountType: 'apple',
        userId: userId || appleUserId,
        folderId: folderId,
        refreshToken: tokens.refreshToken,
        createdAt: Date.now(),
      };

      return res.json({ sessionId });

    } else if (accountType === 'google') {
      // Existing Google implementation
      // ...
    } else if (accountType === 'dropbox') {
      // Existing Dropbox implementation
      // ...
    }
  } catch (error) {
    console.error('[PROXY] Init error:', error);
    res.status(500).send(error.message);
  }
});
```

---

## 4. Refresh Apple Access Tokens

Access tokens expire after 3600 seconds. Use the refresh token to get new ones.

```javascript
async function refreshAppleAccessToken(refreshToken) {
  const clientSecret = generateAppleClientSecret();

  const params = new URLSearchParams({
    client_id: 'com.proofpix.app',
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error('Failed to refresh Apple access token');
  }

  const data = await response.json();
  return data.access_token;
}
```

---

## 5. iCloud Drive Integration via CloudKit

### Option A: Use CloudKit JS API

CloudKit provides a JavaScript API for web/server access to iCloud.

1. **Configure CloudKit Dashboard**:
   - Go to https://icloud.developer.apple.com/
   - Select your app's iCloud container
   - Enable "CloudKit Database" access
   - Create an API token for server-to-server communication

2. **Install CloudKit SDK**:
```bash
npm install cloudkit
```

3. **Upload Files to CloudKit**:
```javascript
const CloudKit = require('cloudkit');

CloudKit.configure({
  containers: [{
    containerIdentifier: 'iCloud.com.proofpix.app',
    apiTokenAuth: {
      apiToken: process.env.CLOUDKIT_API_TOKEN,
      persist: true,
    },
    environment: 'production',
  }],
});

const container = CloudKit.getDefaultContainer();
const database = container.publicCloudDatabase;

async function uploadToiCloud(fileBuffer, filename, recordName) {
  const record = {
    recordType: 'ProofPixPhoto',
    recordName: recordName,
    fields: {
      photo: {
        value: {
          downloadURL: fileBuffer, // Or upload to CDN first
        },
      },
      filename: { value: filename },
      uploadedAt: { value: new Date().toISOString() },
    },
  };

  return await database.saveRecords([record]);
}
```

### Option B: Use Apple's CloudKit Web Services

Make direct HTTP requests to CloudKit REST API.

```javascript
async function uploadToiCloudREST(sessionToken, fileData, filename) {
  const url = `https://api.apple-cloudkit.com/database/1/iCloud.com.proofpix.app/production/public/records/modify`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operations: [{
        operationType: 'create',
        record: {
          recordType: 'ProofPixPhoto',
          fields: {
            photo: { value: fileData },
            filename: { value: filename },
          },
        },
      }],
    }),
  });

  return await response.json();
}
```

---

## 6. Handle Team Member Uploads (Apple)

Update your team member upload endpoint:

```javascript
app.post('/api/team-member/upload', async (req, res) => {
  const { sessionId, token } = req.body;

  // Validate token
  const session = sessions[sessionId];
  if (!session) {
    return res.status(401).send('Invalid session');
  }

  if (session.accountType === 'apple') {
    // Get fresh access token
    const accessToken = await refreshAppleAccessToken(session.refreshToken);

    // Upload to iCloud
    const result = await uploadToiCloud(req.file.buffer, req.file.originalname, token);

    res.json({ success: true, recordName: result.recordName });

  } else if (session.accountType === 'google') {
    // Existing Google Drive upload
    // ...
  }
});
```

---

## 7. Apple Developer Portal Setup

### Prerequisites

1. **Enable Sign in with Apple**:
   - App ID: Enable "Sign in with Apple" capability
   - Bundle ID must match: `com.proofpix.app`

2. **Create Services ID**:
   - Go to Certificates, Identifiers & Profiles
   - Create a new Services ID (e.g., `com.proofpix.app.signin`)
   - Enable "Sign in with Apple"
   - Configure return URLs (not needed for native iOS)

3. **Create Private Key**:
   - Go to Keys section
   - Create a new key
   - Enable "Sign in with Apple"
   - Download the `.p8` file (keep it secure!)
   - Note the Key ID

4. **Enable iCloud**:
   - App ID: Enable "iCloud" capability
   - Create iCloud container: `iCloud.com.proofpix.app`

---

## 8. Environment Variables

Add these to your proxy server:

```bash
# Apple Sign In
APPLE_TEAM_ID=ABCDE12345
APPLE_KEY_ID=XYZ1234ABC
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# CloudKit (if using CloudKit API)
CLOUDKIT_API_TOKEN=your_cloudkit_api_token
CLOUDKIT_CONTAINER_ID=iCloud.com.proofpix.app
```

---

## 9. Testing

### Test the Flow:

1. **iOS App**: User taps "Sign in with Apple"
2. **App sends to proxy**:
   ```json
   {
     "accountType": "apple",
     "identityToken": "eyJraW...",
     "authorizationCode": "c1234...",
     "appleUserId": "001234.abcd...",
     "folderId": "icloud_12345",
     "userId": "user_123"
   }
   ```

3. **Proxy server**:
   - Verifies `identityToken`
   - Exchanges `authorizationCode` for tokens
   - Stores `refreshToken`
   - Returns `sessionId`

4. **Team member uploads**:
   - Uses `sessionId` to identify admin's iCloud
   - Refreshes Apple access token
   - Uploads photo to CloudKit

### Test Commands:

```bash
# Test token verification
curl -X POST http://localhost:3000/api/admin/init \
  -H "Content-Type: application/json" \
  -d '{"accountType":"apple","identityToken":"...","authorizationCode":"...","appleUserId":"...","folderId":"..."}'
```

---

## 10. Security Considerations

1. **Always verify identity tokens** on the server (never trust client)
2. **Store refresh tokens securely** (encrypted in database)
3. **Rotate client secrets** periodically (every 6 months)
4. **Use HTTPS** for all proxy server endpoints
5. **Rate limit** authentication attempts
6. **Monitor for** revoked tokens (Apple can revoke if user removes app access)

---

## 11. Alternative: Simplified Approach (Without iCloud Drive)

If CloudKit integration is too complex initially, you can:

1. Accept Apple Sign In for authentication only
2. Store photos on your own server or existing cloud storage
3. Use Apple user ID to identify users/teams
4. Implement iCloud integration later

This still meets Apple's requirement for an equivalent login service.

---

## Summary

Your proxy server needs to:

✅ Accept Apple credentials at `/api/admin/init` with `accountType: 'apple'`
✅ Verify `identityToken` using Apple's public keys
✅ Exchange `authorizationCode` for refresh token
✅ Store refresh token for team member access
✅ Implement token refresh logic
✅ (Optional) Integrate CloudKit for iCloud Drive storage

The React Native app implementation is complete. Once you update your proxy server with this code, the full Apple Sign In flow will work end-to-end!
