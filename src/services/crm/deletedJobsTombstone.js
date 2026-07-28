import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persistent tombstone set for SF `crmJobId`s the user explicitly
 * deleted. Sync consults this set before creating a new local
 * project for a job — if the id is here, we skip creation so a
 * user's manual cleanup isn't undone on the next foreground sync.
 *
 * One-way: once tombstoned, an id is skipped forever (until the user
 * clears app data). If SF ever recycles the id for a different job,
 * that new job won't surface locally either — acceptable trade-off
 * given how rare recycling is versus how confusing "I deleted this
 * but it came back" is.
 */

const KEY = '@sf_deleted_crm_job_ids';
// Bound the set so a user who deletes thousands of jobs doesn't
// bloat AsyncStorage. Drops the oldest entries FIFO when exceeded.
const MAX_TOMBSTONES = 2000;

let cachedSet = null;

const load = async () => {
  if (cachedSet) return cachedSet;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    cachedSet = new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (_) {
    cachedSet = new Set();
  }
  return cachedSet;
};

const persist = async () => {
  if (!cachedSet) return;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(Array.from(cachedSet)));
  } catch (_) {}
};

export async function getDeletedJobIds() {
  return await load();
}

export async function addDeletedJobId(jobId) {
  if (jobId == null || jobId === '') return;
  const set = await load();
  const key = String(jobId);
  if (set.has(key)) return;
  set.add(key);
  if (set.size > MAX_TOMBSTONES) {
    const arr = Array.from(set);
    cachedSet = new Set(arr.slice(-MAX_TOMBSTONES));
  }
  await persist();
}

/**
 * Wipe the tombstone set. Called from the SF connect flow so
 * reconnecting is a clean slate — otherwise a user who mass-deleted
 * their projects can never see any of those job ids again, even
 * after signing back in. Also good escape hatch for "why can't I
 * see anything from SF" support cases.
 */
export async function clearAllDeletedJobIds() {
  cachedSet = new Set();
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (_) {}
}
