import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePhotos } from '../context/PhotoContext';
import { syncServiceFlowJobs } from '../services/crm/serviceFlowSync';

/**
 * ServiceFlowSyncTrigger — mounts inside the PhotoProvider tree and
 * runs syncServiceFlowJobs on app open + every time the app comes
 * to foreground. Renders nothing.
 *
 * Kept as a UI-less component (instead of a hook) so it can sit at
 * a stable spot in the tree near the providers, without forcing
 * every screen that uses PhotoContext to call a hook.
 *
 * No-ops when:
 *   - the user hasn't connected a CRM (handled by syncServiceFlowJobs)
 *   - PhotoContext is still loading (we guard on `loading`)
 *
 * Throttles to at most one sync per 30 seconds so a user rapidly
 * backgrounding/foregrounding the app doesn't hammer the SF API.
 */
const MIN_SYNC_INTERVAL_MS = 30_000;

export default function ServiceFlowSyncTrigger() {
  const { projects, createProject, patchProject, loading } = usePhotos();
  const lastSyncAtRef = useRef(0);
  const inFlightRef = useRef(false);

  const runSync = async (reason) => {
    if (loading) return;
    if (inFlightRef.current) return;
    const now = Date.now();
    if (now - lastSyncAtRef.current < MIN_SYNC_INTERVAL_MS) return;
    inFlightRef.current = true;
    lastSyncAtRef.current = now;
    try {
      const result = await syncServiceFlowJobs({ projects, createProject, patchProject });
      if (result?.created > 0 || result?.error) {
        console.log('[ServiceFlowSync]', reason, result);
      }
    } catch (e) {
      console.warn('[ServiceFlowSync] sync threw:', e?.message);
    } finally {
      inFlightRef.current = false;
    }
  };

  // Mount sync.
  useEffect(() => {
    runSync('mount');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Foreground sync.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') runSync('foreground');
    });
    return () => sub?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
