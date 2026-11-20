// Shares one throttled stream of terminal.tail reads among all subscribers of a session.
export function createTailPoller({ sessionId, lines, invoke, subscribeSession, throttleMs = 350, heartbeatMs = 5000 }) {
  const subscribers = new Set();
  let offSession = null, heartbeat = null, timer = null, inflight = false, again = false, last = 0, value = null, active = false;
  const emit = result => { value = result; for (const callback of [...subscribers]) callback(result); };
  const load = async () => {
    if (inflight) { again = true; return; }
    inflight = true; last = Date.now();
    try {
      const result = await invoke('terminal.tail', { sessionId, lines });
      if (active) emit(result);
    } catch (e) { if (active) emit({ error: e.message }); }
    finally {
      inflight = false;
      if (again && active) { again = false; schedule(); }
    }
  };
  const schedule = () => {
    if (timer || !active) return;
    timer = setTimeout(() => { timer = null; load(); }, Math.max(0, throttleMs - (Date.now() - last)));
  };
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const onVisible = () => { if (!hidden()) load(); };
  const start = () => {
    active = true;
    offSession = subscribeSession(sessionId, event => {
      if (event.sessionId !== sessionId) return;
      if (event.type === 'terminal.output' || event.type === 'terminal.exit' || event.type === 'session.changed') schedule();
    });
    heartbeat = setInterval(() => { if (!hidden()) schedule(); }, heartbeatMs);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    load();
  };
  const stop = () => {
    active = false; again = false; value = null;
    clearTimeout(timer); timer = null; clearInterval(heartbeat); heartbeat = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    offSession?.(); offSession = null;
  };
  return {
    subscribe(callback) {
      subscribers.add(callback);
      if (!active) start();
      else if (value) callback(value);
      return () => {
        subscribers.delete(callback);
        if (!subscribers.size && active) stop();
      };
    },
  };
}
