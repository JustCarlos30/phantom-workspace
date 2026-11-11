import { useCallback, useEffect, useRef, useState } from 'react';
import { api, subscribe } from './useWorkspace';
import { buildActivity } from './activityModel.mjs';

const sources = ['sessions', 'tasks', 'git'];
const empty = () => Object.fromEntries(sources.map(key => [key, { data: null, loading: true, error: '', at: null }]));
export const ACTIVITY_EVENTS = new Set(['state.changed', 'attention.new', 'terminal.exit', 'tool.status', 'task.changed', 'agent.status', 'git.changed']);

export function useActivity(workspace, connection) {
  const id = workspace?.id;
  const connected = connection.status === 'connected';
  const [snapshot, setSnapshot] = useState({ id: null, base: '', resources: empty() });
  const [selection, setSelection] = useState({ id: null, base: '' });
  const base = selection.id === id ? selection.base : '';
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const reload = useCallback(() => setRevision(n => n + 1), []);
  const setBase = useCallback(value => setSelection({ id, base: value.trim() }), [id]);
  useEffect(() => {
    const version = ++generation.current;
    let disposed = false, running = false, queued = false, timer;
    const valid = () => !disposed && generation.current === version;
    if (!id || !connected) return () => { disposed = true; };
    setSnapshot(previous => ({ id, base, resources: previous.id === id && previous.base === base ? previous.resources : empty() }));
    const load = async () => {
      if (running) { queued = true; return; }
      running = true;
      setSnapshot(previous => ({ id, base, resources: Object.fromEntries(sources.map(key => [key, { ...(previous.id === id && previous.base === base ? previous.resources[key] : empty()[key]), loading: true }])) }));
      const requests = [
        ['terminal.list', { workspaceId: id }],
        ['phantom.list', { workspaceId: id, topic: 'tasks' }],
        ['git.inspect', { workspaceId: id, ...(base ? { base } : {}) }],
      ];
      await Promise.all(requests.map(async ([method, payload], i) => {
        const key = sources[i];
        try {
          const data = await api(method, payload);
          if (key === 'sessions' && !Array.isArray(data)) throw new Error('Descriptor de sesiones no válido');
          if (key !== 'sessions' && data?.available !== true) throw new Error(data?.reason || 'Fuente no disponible');
          if (valid()) setSnapshot(s => ({ ...s, resources: { ...s.resources, [key]: { data, loading: false, error: '', at: Date.now() } } }));
        } catch (error) {
          if (valid()) setSnapshot(s => ({ ...s, resources: { ...s.resources, [key]: { ...s.resources[key], loading: false, error: error.message } } }));
        }
      }));
      running = false;
      if (valid() && queued) { queued = false; timer = setTimeout(load, 200); }
    };
    load();
    const off = subscribe(event => {
      if (event.type === 'connection' && event.status !== 'connected') { disposed = true; ++generation.current; clearTimeout(timer); return; }
      const workspaceId = event.workspaceId || event.result?.workspaceId;
      if (!ACTIVITY_EVENTS.has(event.type) || (workspaceId && workspaceId !== id)) return;
      if (!timer) timer = setTimeout(() => { timer = null; if (valid()) load(); }, 250);
    });
    const interval = setInterval(() => { setNow(Date.now()); if (valid()) load(); }, 20000);
    return () => { disposed = true; clearTimeout(timer); clearInterval(interval); off(); };
  }, [id, connected, base, revision]);
  const resources = snapshot.id === id && snapshot.base === base ? snapshot.resources : empty();
  const model = buildActivity({ workspace, connected, sessions: resources.sessions.data || [], tasks: resources.tasks.data?.items || [], git: resources.git.data });
  return { ...model, resources, connected, base, setBase, reload, now,
    loading: sources.some(key => resources[key].loading) && connected,
    hasError: sources.some(key => resources[key].error),
    stale: !connected || sources.some(key => !resources[key].at || Math.max(now, Date.now()) - resources[key].at > 45000),
  };
}
