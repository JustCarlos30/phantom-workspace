// One bridge listener fans events out to any number of renderer subscribers.
export function createEventHub(register) {
  const all = new Set(), sessions = new Map();
  let unregister = null;
  const call = (callback, event) => {
    try { callback(event); } catch (e) { console.error(e); }
  };
  const dispatch = event => {
    if (!event) return;
    for (const callback of [...all]) call(callback, event);
    if (event.type === 'connection') {
      for (const set of [...sessions.values()]) for (const callback of [...set]) call(callback, event);
    } else if (event.sessionId && sessions.has(event.sessionId)) {
      for (const callback of [...sessions.get(event.sessionId)]) call(callback, event);
    }
  };
  const retain = () => { if (!unregister) unregister = register(dispatch); };
  const release = () => {
    if (all.size || sessions.size || !unregister) return;
    const off = unregister; unregister = null; off();
  };
  return {
    subscribe(callback) {
      all.add(callback); retain();
      return () => { all.delete(callback); release(); };
    },
    subscribeSession(sessionId, callback) {
      let set = sessions.get(sessionId);
      if (!set) sessions.set(sessionId, set = new Set());
      set.add(callback); retain();
      return () => {
        set.delete(callback);
        if (!set.size && sessions.get(sessionId) === set) sessions.delete(sessionId);
        release();
      };
    },
  };
}
