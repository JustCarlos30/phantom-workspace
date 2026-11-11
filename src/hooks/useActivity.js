import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, subscribe } from './useWorkspace';
import { activityEvent, buildActivity } from './activityModel.mjs';

const readBases = () => { try { return JSON.parse(localStorage.getItem('phantom.activity.bases') || '{}'); } catch { return {}; } };
export function useActivity(workspace, connection) {
  const [bases, setBases] = useState(readBases);
  const base = typeof bases?.[workspace?.id] === 'string' ? bases[workspace.id] : '';
  const [snapshot, setSnapshot] = useState({});
  const [now, setNow] = useState(Date.now());
  const [transportEpoch, setTransportEpoch] = useState(0);
  const reloadRef = useRef(() => {});
  const connected = connection.status === 'connected';
  const key = `${workspace?.id || ''}:${base}:${connected}:${transportEpoch}`;
  const liveKey = useRef(key); liveKey.current = key;
  const setBase = useCallback(value => setBases(previous => {
    const next = { ...previous, [workspace.id]: value.trim() };
    try { localStorage.setItem('phantom.activity.bases', JSON.stringify(next)); } catch { /* Preference remains available for this window. */ }
    return next;
  }), [workspace?.id]);
  useEffect(() => {
    let disposed = false, invalidated = false, inFlight = false, queued = false, timer;
    const workspaceId = workspace?.id;
    const valid = () => !disposed && !invalidated && liveKey.current === key;
    const load = async () => {
      if (!workspaceId || !connected || !valid()) return;
      if (inFlight) { queued = true; return; }
      inFlight = true;
      setSnapshot(old => ({ ...(old.key === key ? old : {}), key, loading: true }));
      const specs = [['sessions', 'terminal.list', {}], ['tasks', 'phantom.list', { topic: 'tasks' }], ['git', 'git.inspect', base ? { base } : {}]];
      const values = await Promise.all(specs.map(async ([name, method, payload]) => {
        let timeout;
        try {
          const data = await Promise.race([api(method, { workspaceId, ...payload }), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('La fuente no respondió en 20 s')), 20000); })]);
          if (data?.available === false || (name === 'git' && data?.reason)) throw new Error(data.reason || 'Fuente no disponible');
          if (name === 'git' ? !Array.isArray(data?.branches) : !Array.isArray(data) && !Array.isArray(data?.items)) throw new Error('Formato de respuesta desconocido');
          return [name, { data, at: Date.now(), observedAt: data?.observedAt, error: '' }];
        } catch (error) { return [name, { error: error.message }]; }
        finally { clearTimeout(timeout); }
      }));
      if (valid()) setSnapshot(old => {
        const next = { key, loading: false };
        for (const [name, value] of values) next[name] = value.error ? { ...(old.key === key ? old[name] : {}), error: value.error } : value;
        return next;
      });
      inFlight = false;
      if (queued && valid()) { queued = false; timer = setTimeout(load, 250); }
    };
    reloadRef.current = load;
    const off = subscribe(event => {
      if (event.type === 'connection') { invalidated = true; clearTimeout(timer); setTransportEpoch(value => value + 1); return; }
      if (activityEvent(event, workspaceId)) { clearTimeout(timer); timer = setTimeout(load, 250); }
    });
    load();
    const interval = setInterval(() => { setNow(Date.now()); load(); }, 20000);
    return () => { disposed = true; clearTimeout(timer); clearInterval(interval); off(); };
  }, [key]);
  const data = snapshot.key === key ? snapshot : {};
  const model = useMemo(() => buildActivity({ workspace, sessions: data.sessions?.data, tasks: data.tasks?.data, git: data.git?.data, connected }), [workspace, data.sessions, data.tasks, data.git, connected]);
  return { ...model, sources: data, loading: connected && (!snapshot.key || snapshot.key !== key || !!data.loading), connected, base, setBase, now, retry: useCallback(() => reloadRef.current(), []) };
}
