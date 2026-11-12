import { useEffect, useRef } from 'react';
import { readyLabel, trackReady } from './ready-branches.mjs';

export function useReadyBranches(api, workspace, connection, notify) {
  const tracking = useRef(null);
  const inFlight = useRef(false);
  const workspaceId = workspace?.id;
  if (!tracking.current || tracking.current.workspaceId !== workspaceId) {
    tracking.current = { workspaceId, seen: null, unavailable: false };
  }
  useEffect(() => {
    const tracker = tracking.current;
    let disposed = false;
    if (!workspaceId || connection.status !== 'connected' || tracker.unavailable) return;
    const valid = () => !disposed && tracking.current === tracker;
    async function desktopNotify(body) {
      if (!document.hidden && document.hasFocus()) return;
      try {
        await window.phantom?.invoke('desktop.notify', {
          title: 'Lista para integrar', body: body.slice(0, 300), target: 'branches',
        });
      } catch { /* Native notifications are best effort. */ }
    }
    async function load() {
      if (!valid() || tracker.unavailable || inFlight.current) return;
      inFlight.current = true;
      try {
        // Workspace state has no Git flag: the first overview discovers availability.
        const overview = await api('branch.overview', { workspaceId });
        if (!valid()) return;
        if (overview?.available === false) { tracker.unavailable = true; return; }
        if (!Array.isArray(overview?.branches)) return;
        const result = trackReady(tracker.seen, overview);
        tracker.seen = result.seen;
        if (result.initial.length) notify(`${result.initial.length} ramas listas para integrar`);
        if (result.fresh.length > 3) {
          const summary = `${result.fresh.length} ramas listas para integrar`;
          notify(summary);
          void desktopNotify(summary);
        } else {
          for (const row of result.fresh) {
            const label = readyLabel(row);
            notify(`Lista para integrar: ${label}`);
            void desktopNotify(label);
          }
        }
      } catch { /* Retry on the next poll without repeated error toasts. */ }
      finally { inFlight.current = false; }
    }
    void load();
    const timer = setInterval(load, 20000);
    return () => { disposed = true; clearInterval(timer); };
  }, [api, workspaceId, connection.status, notify]);
}
