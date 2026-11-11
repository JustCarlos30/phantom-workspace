import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, subscribe } from './useWorkspace';
import { buildActivity } from './activityModel.mjs';

const relevant = new Set(['state.changed', 'attention.new', 'terminal.exit', 'tool.status', 'agent.status', 'task.updated', 'git.changed']);
const empty = () => ({ sessions: {}, tasks: {}, git: {}, notices: {} });
const methods = { sessions: 'terminal.list', tasks: 'phantom.list', git: 'git.inspect', notices: 'attention.list' };

export function useActivity(workspace, connection) {
  const id = workspace?.id;
  const [baseChoice, setBaseChoice] = useState({ id, value: '' });
  const base = baseChoice.id === id ? baseChoice.value : '';
  const [snapshot, setSnapshot] = useState({ key: '', sources: empty() });
  const [now, setNow] = useState(Date.now());
  const runner = useRef(() => {});
  const connected = connection.status === 'connected';
  const key = `${id || ''}:${base}`;
  const identity = useRef(); identity.current = { key, connected };
  const refresh = useCallback(() => runner.current(), []);
  const setBase = useCallback(value => setBaseChoice({ id, value: value.trim() }), [id]);

  useEffect(() => {
    if (!id || !connected) return;
    let disposed = false, flight = false, dirty = false, timer;
    const valid = () => !disposed && identity.current.key === key && identity.current.connected;
    const run = async () => {
      if (!valid()) return;
      clearTimeout(timer); timer = null;
      if (flight) { dirty = true; return; }
      flight = true;
      setSnapshot(previous => ({ key, sources: Object.fromEntries(Object.keys(methods).map(name => [name, { ...(previous.key === key ? previous.sources[name] : {}), loading: true }])) }));
      await Promise.all(Object.entries(methods).map(async ([name, method]) => {
        let timeout;
        try {
          const data = await Promise.race([
            api(method, { workspaceId: id, ...(name === 'tasks' ? { topic: 'tasks' } : {}), ...(name === 'git' && base ? { base } : {}) }),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('La fuente tardó demasiado. Reintenta.')), 12000); }),
          ]);
          if ((name === 'sessions' || name === 'notices') && !Array.isArray(data)) throw new Error('La fuente devolvió un listado inválido.');
          if ((name === 'sessions' || name === 'notices') && data.some(item => !item || typeof item.id !== 'string')) throw new Error('La fuente devolvió identidades inválidas.');
          if (name === 'tasks' && data?.available !== false && !Array.isArray(data?.items)) throw new Error('Phantom devolvió un catálogo inválido.');
          if (name === 'tasks' && data?.items?.some(item => !item || typeof item.id !== 'string')) throw new Error('Phantom devolvió identidades inválidas.');
          if (name === 'git' && (!data || typeof data.available !== 'boolean')) throw new Error('Git devolvió una respuesta inválida.');
          if (name === 'git' && (!Array.isArray(data.branches) || data.branches.some(branch => !branch || typeof branch.name !== 'string') || !Array.isArray(data.worktrees))) throw new Error('Git devolvió un radar inválido.');
          if (valid()) setSnapshot(previous => ({ key, sources: { ...previous.sources, [name]: { data, loading: false, error: data?.available === false ? data.reason || 'Fuente no disponible' : '', updatedAt: Date.now() } } }));
        } catch (error) {
          if (valid()) setSnapshot(previous => ({ key, sources: { ...previous.sources, [name]: { ...previous.sources[name], loading: false, error: error.message } } }));
        } finally { clearTimeout(timeout); }
      }));
      flight = false;
      if (valid()) setNow(Date.now());
      if (dirty && valid()) { dirty = false; timer = setTimeout(() => { timer = null; run(); }, 180); }
    };
    const schedule = () => { if (flight) { dirty = true; return; } if (!timer) timer = setTimeout(() => { timer = null; run(); }, 180); };
    runner.current = run;
    const off = subscribe(event => {
      // Invalidate immediately, before React processes a connection update.
      if (event.type === 'connection' && event.status !== 'connected') { disposed = true; clearTimeout(timer); return; }
      if (relevant.has(event.type) && (!event.workspaceId || event.workspaceId === id)) schedule();
    });
    run();
    const interval = setInterval(() => { setNow(Date.now()); schedule(); }, 20000);
    return () => { disposed = true; off(); clearTimeout(timer); clearInterval(interval); runner.current = () => {}; };
  }, [id, base, key, connected, connection]);
  const sources = snapshot.key === key ? snapshot.sources : empty();
  const model = useMemo(() => buildActivity({ workspace, connected,
    sessions: sources.sessions.data || [], tasks: sources.tasks.data?.items || [],
    notices: sources.notices.data || workspace?.attention || [], git: sources.git.data,
  }), [workspace, connected, sources]);
  const sessionUnconfirmed = Boolean(sources.sessions.error || !sources.sessions.updatedAt || now - sources.sessions.updatedAt > 45000);
  const sessions = model.sessions.map(row => ({ ...row,
    unconfirmed: connected && (sessionUnconfirmed || (row.tasks.length > 0 && Boolean(sources.tasks.error || !sources.tasks.updatedAt || now - sources.tasks.updatedAt > 45000))),
    observedAt: sources.sessions.updatedAt,
  }));
  const byNode = Object.fromEntries(sessions.filter(row => row.node).map(row => [row.node.id, row]));
  return { ...model, sessions, byNode, sources, base, setBase, refresh, connected, now,
    loading: Object.values(sources).some(s => s.loading) || (connected && !sources.sessions.updatedAt && !sources.sessions.error),
    degraded: Object.values(sources).some(s => s.error || !s.updatedAt || now - s.updatedAt > 45000),
  };
}
