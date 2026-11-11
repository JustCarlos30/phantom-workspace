import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, subscribe } from './useWorkspace';
import { buildActivity } from './activityModel.mjs';

const empty = () => ({ sessions: {}, tasks: {}, git: {} });
const relevant = new Set(['state.changed', 'attention.new', 'terminal.exit', 'tool.status', 'task.changed', 'git.changed', 'session.changed']);
async function readSource(name, method, payload) {
  let timeout;
  try {
    const data = await Promise.race([api(method, payload), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('La fuente tardó demasiado. Reintenta la lectura.')), 15000); })]);
    if (name === 'sessions' && !Array.isArray(data)) throw new Error('El host devolvió un catálogo de sesiones inválido.');
    if (name === 'tasks' && data?.available !== false && !Array.isArray(data?.items)) throw new Error('Phantom devolvió un catálogo de tareas inválido.');
    if (name === 'git' && (typeof data?.available !== 'boolean' || !Array.isArray(data?.branches))) throw new Error('Git devolvió un radar inválido.');
    return data;
  } finally { clearTimeout(timeout); }
}
export function useActivity(workspace, connection, workspaceReadAt) {
  const [base, setBase] = useState('');
  const [snapshot, setSnapshot] = useState({ key: '', sources: empty() });
  const [, setTick] = useState(0);
  const runner = useRef(() => {});
  const identity = `${workspace?.id || ''}:${connection.status}:${base}`;
  const current = useRef(identity); current.current = identity;
  useEffect(() => {
    let disposed = false, timer, inFlight = false, again = false, revision = 0, online = connection.status === 'connected';
    const sources = empty();
    const valid = () => !disposed && current.current === identity;
    const publish = () => { if (valid()) setSnapshot({ key: identity, sources: { ...sources } }); };
    async function load() {
      if (!valid() || !workspace?.id || !online) return;
      if (inFlight) { again = true; return; }
      inFlight = true;
      const request = ++revision;
      const queries = { sessions: ['terminal.list', {}], tasks: ['phantom.list', { topic: 'tasks' }], git: ['git.inspect', base ? { base } : {}] };
      for (const name of Object.keys(queries)) sources[name] = { ...sources[name], loading: true };
      publish();
      await Promise.all(Object.entries(queries).map(async ([name, [method, payload]]) => {
        try {
          const data = await readSource(name, method, { workspaceId: workspace.id, ...payload });
          if (!valid() || request !== revision) return;
          sources[name] = { data, loading: false, at: Date.now(), error: data?.available === false ? data.reason || 'Fuente no disponible' : '' };
        } catch (error) {
          if (!valid() || request !== revision) return;
          sources[name] = { ...sources[name], loading: false, error: error.message || String(error) };
        }
        publish();
      }));
      inFlight = false;
      if (again && valid()) { again = false; schedule(); }
    }
    function schedule() { if (!timer && valid()) timer = setTimeout(() => { timer = null; load(); }, 250); }
    runner.current = load;
    load();
    const interval = setInterval(() => { setTick(t => t + 1); load(); }, 20000);
    const off = subscribe(event => {
      if (event.type === 'connection') {
        online = event.status === 'connected';
        if (!online) { ++revision; clearTimeout(timer); timer = null; }
        else schedule();
        return;
      }
      if (relevant.has(event.type) && (!event.workspaceId || event.workspaceId === workspace?.id)) schedule();
    });
    return () => { disposed = true; ++revision; clearTimeout(timer); clearInterval(interval); off(); };
  }, [identity, workspace?.id, connection.status, base]);
  const sources = snapshot.key === identity ? snapshot.sources : empty();
  const activity = useMemo(() => {
    const result = buildActivity({ workspace, sessions: sources.sessions.data, tasks: sources.tasks.data, git: sources.git.data, connected: connection.status === 'connected' });
    if (sources.sessions.error || sources.tasks.error) result.sessions = result.sessions.map(s => ({ ...s, label: `${s.label} · lectura sin confirmar`, tone: 'unknown' }));
    return result;
  }, [workspace, sources.sessions.data, sources.tasks.data, sources.git.data, sources.sessions.error, sources.tasks.error, connection.status]);
  const retry = useCallback(() => runner.current(), []);
  return { ...activity, sources, base, setBase, retry, connected: connection.status === 'connected', workspaceReadAt, now: Date.now() };
}
