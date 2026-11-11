import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, subscribe } from './useWorkspace';
import { buildActivity } from './activityModel.mjs';

const empty = () => ({ sessions: {}, tasks: {}, git: {} });
export function useActivity(workspace, connection) {
  const [base, setBase] = useState('');
  const [snapshot, setSnapshot] = useState({ key: '', sources: empty() });
  const [clock, setClock] = useState(Date.now());
  const refreshRef = useRef(() => {});
  const key = `${workspace?.id || ''}:${connection.status}:${base}`;
  const identity = useRef(key); identity.current = key;
  useEffect(() => { setBase(''); }, [workspace?.id]);
  useEffect(() => {
    if (!workspace?.id || connection.status !== 'connected') return;
    let disposed = false, running = false, again = false, timer;
    const valid = () => !disposed && identity.current === key;
    const load = async () => {
      if (!valid()) return;
      if (running) { again = true; return; }
      running = true;
      setSnapshot(old => ({ key, sources: Object.fromEntries(Object.entries(old.key === key ? old.sources : empty()).map(([name, source]) => [name, { ...source, loading: true }])) }));
      await Promise.all([['sessions', 'terminal.list', {}], ['tasks', 'phantom.list', { topic: 'tasks' }], ['git', 'git.inspect', base ? { base } : {}]].map(async ([name, method, payload]) => {
        let update;
        try {
          const data = await api(method, { workspaceId: workspace.id, ...payload });
          update = { data, loading: false, checkedAt: Date.now(), error: data?.available === false ? data.reason || 'Fuente no disponible' : '' };
        } catch (error) { update = { loading: false, error: error.message }; }
        if (valid()) setSnapshot(old => ({ key, sources: { ...(old.key === key ? old.sources : empty()), [name]: { ...(old.key === key ? old.sources[name] : {}), ...update } } }));
      }));
      running = false;
      if (again && valid()) { again = false; clearTimeout(timer); timer = setTimeout(load, 200); }
    };
    refreshRef.current = load;
    load();
    const off = subscribe(event => {
      if (event.workspaceId && event.workspaceId !== workspace.id) return;
      if (event.type === 'connection' && event.status !== 'connected') { disposed = true; clearTimeout(timer); return; }
      if (['state.changed', 'attention.new', 'terminal.exit', 'tool.status', 'git.changed', 'task.changed', 'phantom.changed', 'agent.status'].includes(event.type)) {
        if (!timer) timer = setTimeout(() => { timer = null; load(); }, 200);
      }
    });
    const interval = setInterval(() => { setClock(Date.now()); load(); }, 20000);
    return () => { disposed = true; off(); clearTimeout(timer); clearInterval(interval); refreshRef.current = () => {}; };
  }, [key, workspace?.id, connection.status, base]);
  const sources = snapshot.key === key ? snapshot.sources : empty();
  const activity = useMemo(() => buildActivity({ workspace, sessions: sources.sessions.data, tasks: sources.tasks.data, git: sources.git.data, connected: connection.status === 'connected' }), [workspace, sources.sessions.data, sources.tasks.data, sources.git.data, connection.status]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { ...activity, sources, base, setBase, refresh, clock, connected: connection.status === 'connected' };
}
