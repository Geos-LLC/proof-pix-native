# Proxy Server Separation Guide

## Overview
The proxy server is currently in the `/proxy-server` folder within the mobile app repo. It should be moved to a separate repository for better security, deployment, and maintenance.

## Why Separate?

1. **Security**: Server secrets stay separate from mobile app code
2. **Deployment**: Independent deployments to Vercel
3. **Version Control**: Separate git history for server vs. mobile
4. **Build Performance**: Mobile builds don't include server code
5. **Team Management**: Different access controls if needed

## Step-by-Step Separation

### 1. Create New Repository

```bash
# Navigate to your ProofPix parent directory
cd c:\Users\HP\Desktop\Projects\Active\Running\ProofPix

# Create new directory for proxy server
mkdir proof-pix-proxy

# Copy proxy server files
cp -r proof-pix-native/proxy-server/* proof-pix-proxy/

# Navigate to new proxy directory
cd proof-pix-proxy

# Initialize git
git init

# Create initial commit
git add .
git commit -m "Initial commit: ProofPix proxy server"
```

### 2. Update Proxy Server .env

The proxy server needs these variables (server-side only):

```env
# Vercel KV Configuration
VERCEL_KV_REST_API_URL=https://perfect-jackal-33123.upstash.io
VERCEL_KV_REST_API_TOKEN=your-token-here

# Google OAuth (server-side)
GOOGLE_CLIENT_SECRET=your-secret-here
```

**Create `.env.example` in the proxy repo:**
```env
# Vercel KV Configuration
VERCEL_KV_REST_API_URL=https://your-instance.upstash.io
VERCEL_KV_REST_API_TOKEN=your-token-here

# Google OAuth (server-side only)
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### 3. Verify Proxy Server .gitignore

Ensure the proxy server has this in `.gitignore`:

```
node_modules/
.env
.env.local
.vercel
```

### 4. Create GitHub Repository

1. Go to https://github.com/new
2. Create repository: `proof-pix-proxy` (or similar name)
3. Make it **PRIVATE** (contains server secrets in history)
4. Don't initialize with README (you already have files)

### 5. Connect Local Repo to GitHub

```bash
# In proof-pix-proxy directory
git remote add origin https://github.com/YOUR_USERNAME/proof-pix-proxy.git
git branch -M main
git push -u origin main
```

### 6. Deploy to Vercel

```bash
# Install Vercel CLI if not already installed
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
vercel --prod

# Set environment variables in Vercel dashboard
# Or via CLI:
vercel env add VERCEL_KV_REST_API_URL production
vercel env add VERCEL_KV_REST_API_TOKEN production
vercel env add GOOGLE_CLIENT_SECRET production
```

### 7. Update Mobile App

Your mobile app already points to the proxy:
```env
EXPO_PUBLIC_PROXY_URL=https://proof-pix-proxy.vercel.app
```

✅ No changes needed in mobile app!

### 8. Remove Proxy from Mobile Repo

```bash
# In proof-pix-native directory
cd c:\Users\HP\Desktop\Projects\Active\Running\ProofPix\proof-pix-native

# The proxy-server folder is already in .gitignore
# You can safely delete it locally (it's now in separate repo)
rm -rf proxy-server

# Commit the removal
git add -A
git commit -m "Remove proxy-server (moved to separate repository)"
```

## Final Structure

```
ProofPix/
├── proof-pix-native/          (Mobile app - PUBLIC or PRIVATE)
│   ├── src/
│   ├── .env                   (local only, not in git)
│   ├── .env.example           (in git)
│   └── app.config.js
│
└── proof-pix-proxy/           (Proxy server - PRIVATE)
    ├── index.js
    ├── .env                   (local only, not in git)
    ├── .env.example           (in git)
    ├── vercel.json
    └── package.json
```

## Verify Everything Works

1. **Test proxy server**: Visit your Vercel URL
2. **Test mobile app**: Ensure API calls still work
3. **Check secrets**: Ensure no secrets in mobile repo
4. **Verify deployments**: Both can deploy independently

## Security Checklist

- ✅ Proxy server in private GitHub repo
- ✅ `.env` files not committed to git
- ✅ `.env.example` files committed (safe templates)
- ✅ Server secrets only in proxy repo
- ✅ Client secrets (EXPO_PUBLIC_*) only in mobile repo
- ✅ Vercel environment variables configured

## Deployment URLs

- **Mobile App**:
  - iOS: https://apps.apple.com/app/id6754261444
  - Android: https://play.google.com/store/apps/details?id=com.proofpix.app

- **Proxy Server**: https://proof-pix-proxy.vercel.app

## Troubleshooting

**Proxy server not responding?**
- Check Vercel deployment logs
- Verify environment variables are set in Vercel
- Test endpoint: `curl https://proof-pix-proxy.vercel.app/health`

**Mobile app can't reach proxy?**
- Verify `EXPO_PUBLIC_PROXY_URL` in mobile `.env`
- Check network requests in React Native debugger
- Ensure proxy URL is correct (no trailing slash)

## Next Steps

1. ✅ Separate proxy server repository
2. ✅ Deploy proxy to Vercel
3. ✅ Remove proxy folder from mobile repo
4. 🚀 Build mobile app for stores
