/**
 * ServiceFlow → ProofPix project creation policy.
 *
 * Controls whether serviceFlowSync auto-creates local ProofPix
 * projects for SF jobs. Applies IN ADDITION to the existing tight
 * date creation window (`[-1, +2]` days around today), never
 * relaxes it.
 *
 * Values
 *   `all`           — default, backward-compatible. Every SF job in
 *                     the creation window becomes a local project.
 *   `new_customers` — auto-create only when the SF row reports
 *                     `is_first_job_for_customer === true`. If SF
 *                     didn't provide that field (older SF backend,
 *                     or RPC failure — comes through as null on the
 *                     adapter output), FAIL SAFE: do not create. The
 *                     product owner explicitly rejected a
 *                     customer_name / local-history fallback because
 *                     existing workspaces would classify every
 *                     recurring customer as "new" on first sync.
 *   `manual`        — no automatic creation of any SF-linked project.
 *                     Sync may still refresh metadata for jobs the
 *                     admin has already linked, but never spawns
 *                     a new local project.
 *
 * Storage
 *   `@sf_creation_policy_v1` in AsyncStorage. Plain string, no JSON.
 *   Missing/unknown values coerce to `all` so existing installs
 *   keep behaving exactly as before.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const CREATION_POLICY_KEY = '@sf_creation_policy_v1';

export const CREATION_POLICIES = Object.freeze({
  ALL: 'all',
  NEW_CUSTOMERS: 'new_customers',
  MANUAL: 'manual',
});

const VALID = new Set(Object.values(CREATION_POLICIES));

/**
 * Returns the current policy string. Any unrecognised / missing
 * value collapses to `all` — the safe default that preserves
 * pre-fix behavior for existing installs.
 */
export async function getCreationPolicy() {
  try {
    const raw = await AsyncStorage.getItem(CREATION_POLICY_KEY);
    if (raw && VALID.has(raw)) return raw;
  } catch {}
  return CREATION_POLICIES.ALL;
}

export async function setCreationPolicy(policy) {
  if (!VALID.has(policy)) throw new Error(`Invalid SF creation policy: ${policy}`);
  await AsyncStorage.setItem(CREATION_POLICY_KEY, policy);
}

/**
 * Decide whether a single SF job (already inside the creation
 * window) is eligible to auto-create a local ProofPix project
 * under the given policy.
 *
 *   all           → always true
 *   manual        → always false
 *   new_customers → job.isFirstJobForCustomer === true (strict).
 *                   null / false / undefined → false. No fallback.
 */
export function isJobEligibleForCreation(policy, job) {
  if (policy === CREATION_POLICIES.MANUAL) return false;
  if (policy === CREATION_POLICIES.NEW_CUSTOMERS) {
    return job?.isFirstJobForCustomer === true;
  }
  // 'all' — and any unrecognised value that slipped through
  return true;
}
