import { useEffect, useState } from 'react';
import { subscribe } from './useWorkspace';

// Phantom's map card never mounts xterm. It reads a plain-text tail parsed by
// the host's headless terminal, refreshed on output (throttled) and on a slow
// heartbeat so the detected agent stays current while the screen is idle.
const THROTTLE_MS = 350, HEARTBEAT_MS = 5000;

export function useTerminalTail({ sessionId, api, lines = 12, enabled = true, connected = true }) {
  const [tail, setTail] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setTail(null); setError('');
    if (!sessionId || !enabled || !connected) return;
    let disposed = false, inflight = false, again = false, timer = null, last = 0;
    const load = async () => {
      if (inflight) { again = true; return; }
      inflight = true; last = Date.now();
      try {
        const value = await api('terminal.tail', { sessionId, lines });
        if (!disposed) { setTail(value); setError(''); }
      } catch (e) { if (!disposed) setError(e.message); }
      finally {
        inflight = false;
        if (again && !disposed) { again = false; schedule(); }
      }
    };
    const schedule = () => {
      if (timer || disposed) return;
      timer = setTimeout(() => { timer = null; load(); }, Math.max(0, THROTTLE_MS - (Date.now() - last)));
    };
    const off = subscribe(event => {
      if (event.sessionId !== sessionId) return;
      if (event.type === 'terminal.output' || event.type === 'terminal.exit' || event.type === 'session.changed') schedule();
    });
    const heartbeat = setInterval(schedule, HEARTBEAT_MS);
    load();
    return () => { disposed = true; off(); clearTimeout(timer); clearInterval(heartbeat); };
  }, [sessionId, api, lines, enabled, connected]);
  return { tail, error };
}
