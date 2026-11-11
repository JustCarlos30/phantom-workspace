import { useCallback, useEffect, useRef, useState } from 'react';
import { api, subscribe } from './useWorkspace';
import { buildActivity, createActivityFence, relevantActivityEvent } from './activityModel.mjs';

const empty = () => ({ loading: false, sessions: null, tasks: null, git: null, notices: null, errors: {}, times: {} });
export function useActivity(workspace, connection) {
  const [snapshot, setSnapshot] = useState(empty);
  const [baseChoice, setBaseChoice] = useState({ workspaceId: null, value: '' });
  const [clock, setClock] = useState(Date.now());
  const refreshRef = useRef(() => {});
  const fence = useRef(createActivityFence());
  const base = baseChoice.workspaceId === workspace?.id ? baseChoice.value : '';
  const connected = connection.status === 'connected';
  const identity = `${workspace?.id || ''}:${base}:${connected}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const refresh = useCallback(() => refreshRef.current(), []);
  const setBase = useCallback(value => setBaseChoice({ workspaceId: workspace?.id, value: value.trim() }), [workspace?.id]);
  useEffect(() => {
    fence.current.invalidate();
    let disposed = false, running = false, dirty = false, timer, online = connected;
    const valid = () => !disposed && online && identityRef.current === identity;
    setSnapshot(old => old.workspaceId === workspace?.id && old.base === base ? { ...old, loading: false } : { ...empty(), workspaceId: workspace?.id, base });
    const load = async () => {
      if (!workspace?.id || !connected || !valid()) return;
      if (running) { dirty = true; return; }
      running = true;
      const token = fence.current.token();
      const current = () => valid() && fence.current.current(token);
      setSnapshot(old => ({ ...old, loading: true }));
      const requests = [
        ['sessions', 'terminal.list', {}], ['tasks', 'phantom.list', { topic: 'tasks' }],
        ['git', 'git.inspect', base ? { base } : {}], ['notices', 'attention.list', {}],
      ];
      await Promise.all(requests.map(async ([key, method, payload]) => {
        try {
          const data = await api(method, { workspaceId: workspace.id, ...payload });
          if (!current()) return;
          const error = data?.available === false ? data.reason || 'Fuente no disponible' : '';
          setSnapshot(old => ({ ...old, [key]: data, errors: { ...old.errors, [key]: error }, times: { ...old.times, [key]: Date.now() } }));
        } catch (error) {
          if (current()) setSnapshot(old => ({ ...old, errors: { ...old.errors, [key]: error.message } }));
        }
      }));
      running = false;
      if (valid()) { setSnapshot(old => ({ ...old, loading: false })); setClock(Date.now()); if (dirty) { dirty = false; schedule(); } }
    };
    const schedule = () => { if (!timer) timer = setTimeout(() => { timer = null; load(); }, 200); };
    refreshRef.current = load;
    load();
    const off = subscribe(event => {
      // Invalidate immediately on transport loss, before React commits new props.
      if (event.type === 'connection') {
        online = event.status === 'connected'; fence.current.invalidate();
        clearTimeout(timer); timer = null;
        if (online) schedule();
        return;
      }
      if (relevantActivityEvent(event, workspace?.id)) schedule();
    });
    const interval = setInterval(() => { setClock(Date.now()); load(); }, 20000);
    // Aging the labels is renderer-only, including while a source is stalled.
    const aging = setInterval(() => setClock(Date.now()), 5000);
    return () => { disposed = true; fence.current.invalidate(); clearTimeout(timer); clearInterval(interval); clearInterval(aging); off(); };
  }, [identity, workspace?.id, connected, base]);
  const current = snapshot.workspaceId === workspace?.id && snapshot.base === base ? snapshot : empty();
  const activity = buildActivity({ workspace: { ...workspace, attention: current.notices || workspace?.attention || [] }, sessions: current.sessions, tasks: current.tasks, git: current.git, connected });
  const freshness = key => !current.times[key] ? 'Sin observación' : `${Math.max(0, Math.floor((clock - current.times[key]) / 1000))} s desde lectura`;
  const stale = !connected || Object.values(current.times).some(time => clock - time > 45000);
  for (const state of Object.values(activity.terminals)) {
    state.freshness = freshness('sessions');
    if (connected && (current.errors.sessions || (current.times.sessions && clock - current.times.sessions > 45000))) state.label += ' · última observación sin confirmar';
  }
  return { ...activity, snapshot: current, connected, base, setBase, refresh, freshness, stale };
}
