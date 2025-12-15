/**
 * Proxy Server Configuration
 *
 * This is the URL of the ProofPix proxy server that handles team member uploads.
 *
 * For development: Use 'http://localhost:3000' if running proxy locally
 * For production: Use your deployed proxy URL on Railway
 */

// Use environment variable if set, otherwise default to Railway deployment
// For local development, set EXPO_PUBLIC_PROXY_URL=http://localhost:3000 in .env
export const PROXY_SERVER_URL = process.env.EXPO_PUBLIC_PROXY_URL || 'https://steadfast-blessing-production.up.railway.app';

export default {
  PROXY_SERVER_URL
};
