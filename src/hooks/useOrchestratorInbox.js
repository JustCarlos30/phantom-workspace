import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildInbox } from './orchestrator-inbox.mjs';

const POLL_MS = 30000, TIMEOUT_MS = 15000;
const SOURCES = { sessions: ['terminal.list', {}], tasks: ['phantom.list', { topic: 'tasks' }], merges: ['merge.status', {}], supervisor: ['supervisor.read', {}] };

async function read(api, method, payload) {
  let timeout;
  try {
    return await Promise.race([api(method, payload), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('La lectura tardó demasiado.')), TIMEOUT_MS); })]);
  } finally { clearTimeout(timeout); }
}

// Reads, for every project in state.workspaces, what buildInbox needs. Polls
// moderately; while disconnected it stops asking and keeps the last reading.
export function useOrchestratorInbox({ workspaces, api, connected }) {
  const [per, setPer] = useState({});
  const [phase, setPhase] = useState({ loading: true, error: '' });
  const [now, setNow] = useState(() => Date.now());
  const apiRef = useRef(api); apiRef.current = api;
  const runner = useRef(() => {});
  const ids = (Array.isArray(workspaces) ? workspaces : []).map(w => w?.id).filter(id => typeof id === 'string' && id).join('|');

  useEffect(() => {
    if (!connected) return undefined;
    let disposed = false, inFlight = false, again = false;
    const list = ids ? ids.split('|') : [];
    async function load() {
      if (disposed) return;
      if (inFlight) { again = true; return; }
      inFlight = true;
      const results = await Promise.all(list.map(async workspaceId => {
        const entries = await Promise.all(Object.entries(SOURCES).map(async ([name, [method, payload]]) => {
          try { return [name, await read(apiRef.current, method, { workspaceId, ...payload }), '']; }
          catch (error) { return [name, undefined, error?.message || String(error)]; }
        }));
        return [workspaceId, entries];
      }));
      inFlight = false;
      if (disposed) return;
      const all = results.flatMap(([, entries]) => entries), failed = all.filter(([, , error]) => error);
      const firstError = failed[0]?.[2] || '', failures = failed.length, total = all.length;
      setPer(previous => {
        const next = {};
        for (const [workspaceId, entries] of results) {
          const record = { ...previous[workspaceId], errors: {} };
          for (const [name, data, error] of entries) if (error) record.errors[name] = error; else record[name] = data;
          next[workspaceId] = record;
        }
        return next;
      });
      setNow(Date.now());
      setPhase({ loading: false, error: total > 0 && failures === total ? firstError || 'No se pudo leer ningún proyecto.' : '' });
      if (again) { again = false; load(); }
    }
    runner.current = load;
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { disposed = true; clearInterval(timer); runner.current = () => {}; };
  }, [ids, connected]);

  const reload = useCallback(() => runner.current(), []);
  const inbox = useMemo(() => {
    const result = buildInbox({ workspaces, perWorkspace: per, connected, now });
    return { ...result, projects: result.projects.map(project => ({ ...project, supervisor: per[project.workspaceId]?.supervisor ?? null, readErrors: Object.values(per[project.workspaceId]?.errors || {}) })) };
  }, [workspaces, per, connected, now]);
  const status = !connected ? 'offline' : phase.loading ? 'loading' : phase.error ? 'error' : 'ready';
  return { inbox, status, error: phase.error, reload };
}
