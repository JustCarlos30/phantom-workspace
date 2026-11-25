import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { subscribe } from './useWorkspace';
import { mergeTraceEvents, agentOpenRequest } from './delegation-model.mjs';

// Host events only mark a resource as changed; every read goes through the exact RPCs.
// No polling: one read in flight per resource, change bursts coalesce into a single re-read,
// and an answer that arrives after the workspace/agent changed is dropped.
const COALESCE_MS = 400;

// How a canvas card asks the app to open one of its sub-agents in the dock. The canvas reaches ChatCard through
// CanvasNode, which has no such prop, so the app provides this function by context: open({ workspaceId, nodeId, id }).
export const AgentOpenContext = createContext(null);

// The app side of that opener, shared by App.jsx and the rendered test so both run the same code: a request is checked
// with agentOpenRequest (incomplete or foreign-project ones are dropped), kept until the dock's Orquestador consumes it,
// and openOrchestrator() brings the dock to that tab.
export function useAgentOpener(activeWorkspaceId, openOrchestrator) {
  const [agentRequest, setAgentRequest] = useState(null);
  const openAgent = useCallback(request => {
    const checked = agentOpenRequest(request, activeWorkspaceId);
    if (!checked) return;
    setAgentRequest(checked);
    openOrchestrator();
  }, [activeWorkspaceId, openOrchestrator]);
  const consumeAgentRequest = useCallback(() => setAgentRequest(null), []);
  return { agentRequest, openAgent, consumeAgentRequest };
}
const IDLE = { key: '', data: null, error: null, loading: false, updatedAt: null };
const NONE = [];

function useLive({ api, connected, workspaceId, method, request, eventType, enabled = true }) {
  const key = JSON.stringify([workspaceId, method, request]);
  const [state, setState] = useState(IDLE);
  const runRef = useRef(null);
  const active = enabled && Boolean(workspaceId) && typeof api === 'function';
  useEffect(() => {
    runRef.current = null;
    if (!active) return undefined;
    const payload = JSON.parse(key)[2];
    let disposed = false, inflight = false, again = false, timer = null;
    setState(old => old.key === key ? old : { key, data: null, error: null, loading: true, updatedAt: null });
    const load = async () => {
      if (disposed) return;
      if (inflight) { again = true; return; }
      inflight = true;
      try {
        const data = await api(method, payload);
        if (!disposed) setState({ key, data, error: null, loading: false, updatedAt: Date.now() });
      } catch (error) {
        if (!disposed) setState(old => ({ key, data: old.key === key ? old.data : null, error, loading: false, updatedAt: old.key === key ? old.updatedAt : null }));
      } finally { inflight = false; }
      if (!disposed && again) { again = false; load(); }
    };
    const off = subscribe(event => {
      if (event?.type !== eventType || event.workspaceId !== workspaceId || timer || !connected) return;
      timer = setTimeout(() => { timer = null; load(); }, COALESCE_MS);
    });
    if (connected) { runRef.current = load; load(); }
    return () => { disposed = true; runRef.current = null; clearTimeout(timer); off(); };
  }, [active, api, connected, eventType, key, method, workspaceId]);
  const current = state.key === key;
  const data = active && current ? state.data : null, error = active && current ? state.error : null;
  const loading = active && (!current || state.loading);
  const reload = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    setState(old => old.key === key ? { ...old, loading: true, error: null } : old);
    run();
  }, [key]);
  const status = !active ? 'idle' : !connected && !data ? 'disconnected' : error && !data ? 'error' : loading && !data ? 'loading' : data?.available === false ? 'unavailable' : 'ready';
  return { data, error, loading, status, reload, connected, updatedAt: current ? state.updatedAt : null, reason: data?.available === false ? data.reason || '' : '' };
}

export function useAgentTraces({ api, workspaceId, connected, nodeId }) {
  const live = useLive({ api, connected, workspaceId, method: 'agent.traces.list', request: { workspaceId, ...(nodeId ? { nodeId } : {}) }, eventType: 'agent.traces.changed' });
  const items = Array.isArray(live.data?.items) ? live.data.items : NONE;
  const status = live.status === 'ready' && live.data != null && !Array.isArray(live.data?.items) ? 'error' : live.status;
  return { ...live, status, items, error: status === 'error' && !live.error ? new Error('No se pudo leer la lista de agentes.') : live.error };
}

const NO_MORE = { key: '', pages: [], cursor: undefined, hasMore: false, loading: false, error: null };

// One agent's history: the first page follows host changes, older pages are requested by the user and kept.
export function useAgentDetail({ api, workspaceId, id, connected, limit = 50 }) {
  const live = useLive({ api, connected, workspaceId, method: 'agent.traces.detail', request: { workspaceId, id, limit }, eventType: 'agent.traces.changed', enabled: Boolean(id) });
  const pagesKey = JSON.stringify([workspaceId, id]);
  const [more, setMore] = useState(NO_MORE);
  const keyRef = useRef(pagesKey);
  keyRef.current = pagesKey;
  const extra = more.key === pagesKey ? more : NO_MORE;
  const cursor = extra.pages.length ? extra.cursor : live.data?.cursor;
  const hasMore = extra.pages.length ? extra.hasMore : live.data?.hasMore === true;
  const loadMore = useCallback(async () => {
    if (!cursor || !hasMore || extra.loading || !connected) return;
    const key = pagesKey;
    setMore(old => ({ ...(old.key === key ? old : { ...NO_MORE, key }), loading: true, error: null }));
    try {
      const page = await api('agent.traces.detail', { workspaceId, id, cursor, limit });
      if (keyRef.current !== key) return;
      setMore(old => { const base = old.key === key ? old : { ...NO_MORE, key }; return { ...base, pages: [...base.pages, Array.isArray(page?.events) ? page.events : []], cursor: page?.cursor, hasMore: page?.hasMore === true, loading: false, error: null }; });
    } catch (error) {
      if (keyRef.current === key) setMore(old => ({ ...(old.key === key ? old : { ...NO_MORE, key }), loading: false, error }));
    }
  }, [api, connected, cursor, extra.loading, hasMore, id, limit, pagesKey, workspaceId]);
  const detail = live.data;
  return {
    status: live.status, error: live.error, reason: live.reason, reload: live.reload, connected, updatedAt: live.updatedAt,
    agent: detail?.agent && typeof detail.agent === 'object' ? detail.agent : null,
    availability: detail?.availability ?? null,
    events: mergeTraceEvents(Array.isArray(detail?.events) ? detail.events : [], ...extra.pages),
    hasMore, loadMore, loadingMore: extra.loading, moreError: extra.error,
  };
}

export function useSupervisor({ api, workspaceId, connected }) {
  const live = useLive({ api, connected, workspaceId, method: 'supervisor.read', request: { workspaceId }, eventType: 'supervisor.changed' });
  const [action, setAction] = useState({ key: '', busy: '', error: null });
  const lock = useRef(false);
  const run = useCallback(async (name, method, payload) => {
    if (lock.current || !connected || !workspaceId) return false;
    lock.current = true;
    setAction({ key: workspaceId, busy: name, error: null });
    try {
      await api(method, { workspaceId, ...payload });
      setAction(old => old.key === workspaceId ? { key: workspaceId, busy: '', error: null } : old);
      live.reload();
      return true;
    } catch (error) {
      setAction(old => old.key === workspaceId ? { key: workspaceId, busy: '', error } : old);
      return false;
    } finally { lock.current = false; }
  }, [api, connected, live.reload, workspaceId]);
  const current = action.key === workspaceId;
  return {
    ...live,
    busy: current ? action.busy : '', actionError: current ? action.error : null, clearActionError: () => setAction({ key: workspaceId, busy: '', error: null }),
    configure: useCallback(patch => run('configure', 'supervisor.configure', { patch }), [run]),
    refresh: useCallback(() => run('refresh', 'supervisor.refresh', {}), [run]),
  };
}
