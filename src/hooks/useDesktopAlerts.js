import { useEffect, useRef, useState } from 'react';
import { alertFacts, pendingCount, planNotifications, trackAlerts } from './desktop-alerts.mjs';

const MAX_SUPERVISOR = 50;

// Navegación entre proyectos: si el destino es otro proyecto, primero se cambia
// (`select`) y el destino (nodo o panel) se ejecuta con `settle` cuando ese
// proyecto ya es el activo. Un destino posterior hacia el mismo proyecto
// sustituye al pendiente sin repetir el cambio. `select` devuelve null si falló.
export function createNavigation({ getActiveId, select, run }) {
  let pending = null;
  return {
    go(nav) {
      if (!nav.workspaceId || nav.workspaceId === getActiveId()) { pending = null; run(nav); return Promise.resolve(); }
      const already = pending?.workspaceId === nav.workspaceId;
      pending = nav;
      if (already) return Promise.resolve();
      return Promise.resolve(select(nav.workspaceId)).then(result => { if (result === null && pending === nav) pending = null; }, () => { if (pending === nav) pending = null; });
    },
    settle(activeId) {
      if (!pending || pending.workspaceId !== activeId) return;
      const nav = pending; pending = null; run(nav);
    },
    get pending() { return pending; }
  };
}

// Decisión de foco: con la ventana enfocada el aviso es un toast interno (la
// persona ya está mirando Phantom); sin foco (minimizada, oculta o en otra
// ventana) se envía una notificación nativa, cuyo clic navega al proyecto y
// a Incorporaciones o a la sesión. Nunca se emiten ambas para el mismo aviso.
// `subscribe` is the workspace event hub's (injected so this module stays loadable without the renderer).
export function useDesktopAlerts(subscribe, state, notify) {
  const seen = useRef(null);
  const lastCount = useRef(-1);
  const [supervisor, setSupervisor] = useState([]);
  const workspaces = state?.workspaces;

  useEffect(() => subscribe(event => {
    const alert = event?.type === 'workspace.event' ? event.event : null;
    if (!alert?.alert || !alert.workspaceId) return;
    const entry = { workspaceId: alert.workspaceId, kind: alert.alert, entityId: alert.entityId ?? null, title: alert.title ?? '', at: alert.at };
    setSupervisor(list => (list.some(a => a.workspaceId === entry.workspaceId && a.kind === entry.kind && a.entityId === entry.entityId && a.at === entry.at)
      ? list : [...list, entry].slice(-MAX_SUPERVISOR)));
  }), [subscribe]);

  useEffect(() => {
    if (!Array.isArray(workspaces)) return;
    const facts = alertFacts(workspaces, supervisor);
    const result = trackAlerts(seen.current, facts);
    seen.current = result.seen;
    const focused = !document.hidden && document.hasFocus();
    const plan = planNotifications(result.fresh, { focused });
    for (const text of plan.toasts) notify(text);
    for (const item of plan.native) {
      const payload = { title: item.title.slice(0, 120), target: item.target };
      if (item.body) payload.body = item.body.slice(0, 300);
      if (item.workspaceId) payload.workspaceId = String(item.workspaceId).slice(0, 128);
      if (item.nodeId) payload.nodeId = String(item.nodeId).slice(0, 128);
      try { Promise.resolve(window.phantom?.invoke('desktop.notify', payload)).catch(() => {}); } catch { /* best effort */ }
    }
    const count = Math.min(9999, pendingCount(facts));
    if (count !== lastCount.current) {
      lastCount.current = count;
      try { Promise.resolve(window.phantom?.invoke('desktop.badge', { count })).catch(() => {}); } catch { /* best effort */ }
    }
  }, [workspaces, supervisor, notify]);
}
