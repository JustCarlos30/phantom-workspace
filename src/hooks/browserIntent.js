export const isSiteURL = url => /^https?:\/\//i.test(url || '');
const sameURL = (a, b) => { try { return new URL(a).href === new URL(b).href; } catch { return a === b; } };

// Each panel has one serialized attach/navigation lane. Native state events do
// not carry navigation IDs, so old destinations are explicitly fenced while an
// intended destination is pending. Redirects are accepted only after loading.
export function createBrowserIntent({ id, workspaceId, url = '', invoke, onState, onAddress, onCommit, onError }) {
  let lane = Promise.resolve(), disposed = false, visible = false, attached = false;
  let visibilityVersion = 0, intentVersion = 0, stateVersion = 0, dirty = false;
  let intended = isSiteURL(url) ? url : 'about:blank', committed = isSiteURL(url) ? url : '';
  let pending = null, settled = false, currentState = {};
  const oldDestinations = new Set();
  const enqueue = operation => {
    const result = lane.then(() => { if (!disposed) return operation(); });
    lane = result.catch(() => {}); return result;
  };
  const report = error => { if (!disposed) onError(error.message || String(error)); };
  const begin = destination => {
    if (intended !== destination) oldDestinations.add(intended);
    if (committed && committed !== destination) oldDestinations.add(committed);
    intended = destination; settled = false; ++stateVersion;
    pending = { version: ++intentVersion, url: destination, dispatched: false, loading: false, seen: false };
    onState({ ...currentState, loading: true });
    return pending;
  };
  const dispatch = async intent => {
    if (disposed || !visible || !attached || pending !== intent || intent.sent) return;
    intent.dispatched = true; intent.sent = true;
    try { await invoke('browser.navigate', { id, url: intent.url }); }
    catch (error) { if (pending === intent) report(error); throw error; }
  };
  return {
    edit() { dirty = true; },
    navigate(destination) {
      const intent = begin(destination); dirty = false; onAddress(destination); onError('');
      return enqueue(() => dispatch(intent));
    },
    show(bounds) {
      visible = true; const version = ++visibilityVersion;
      return enqueue(async () => {
        if (!visible || version !== visibilityVersion) return false;
        onError('');
        const requested = intended, intent = pending;
        // Mark before invoking: attach may synchronously emit browser.state.
        if (intent) { intent.dispatched = true; intent.sent = true; }
        else if (isSiteURL(requested) && !settled) {
          const initial = begin(requested); initial.dispatched = true;
        }
        try {
          const result = await invoke('browser.attach', { id, workspaceId, url: requested, bounds, visible: true });
          if (!visible || version !== visibilityVersion || disposed || result?.stale || result?.attached === false) return false;
          attached = true;
          // A URL submitted during an in-flight attach must run after attach,
          // never be replaced by its earlier about:blank or previous URL.
          if (pending && pending !== intent && pending.url !== requested) await dispatch(pending);
          return true;
        } catch (error) { if (version === visibilityVersion) report(error); throw error; }
      });
    },
    hide() {
      visible = false; attached = false; ++visibilityVersion;
      return invoke('browser.bounds', { id, visible: false }).catch(() => {});
    },
    bounds(bounds) {
      if (!visible || !attached || disposed) return Promise.resolve();
      return invoke('browser.bounds', { id, bounds, visible: true }).catch(report);
    },
    action(method) {
      if (pending || !attached || !visible) return Promise.resolve();
      settled = false; ++stateVersion; onError('');
      return enqueue(() => invoke(method, { id })).catch(report);
    },
    state(event) {
      if (disposed) return false;
      const address = event.url;
      if (pending) {
        const matches = sameURL(address, pending.url);
        // about:blank from initial creation is never a committed site, nor an
        // authority over the user's address field or a newer navigation intent.
        if (!pending.dispatched || (!matches && (!isSiteURL(address) || oldDestinations.has(address)))) return false;
        if (matches) pending.seen = true;
        if (event.loading) pending.loading = true;
        if (!matches && !pending.seen && !(pending.loading && !event.loading && isSiteURL(address))) return false;
        if (event.error) { report(new Error(event.error)); return false; }
        if (event.loading || !isSiteURL(address)) { currentState = event; onState(event); return true; }
        pending = null;
      } else if (!isSiteURL(address)) {
        // Initial blank events can report spinner state, but cannot erase a
        // typed draft or a previously committed HTTP(S) destination.
        if (!committed && !dirty) { currentState = event; onState(event); }
        return false;
      }
      currentState = event; ++stateVersion; settled = !event.loading && !event.error;
      onState(event);
      if (event.error) report(new Error(event.error));
      if (settled) {
        intended = address;
        if (!sameURL(committed, address)) { committed = address; onCommit(address); }
        if (!dirty) onAddress(address);
        onError('');
      }
      return settled;
    },
    captureTicket() {
      return !disposed && settled && !pending && isSiteURL(committed) && sameURL(currentState.url, committed)
        ? { version: stateVersion, url: committed, title: currentState.title || '' } : null;
    },
    captureCurrent(ticket) { return !!ticket && !disposed && !pending && settled && ticket.version === stateVersion && sameURL(ticket.url, committed); },
    get pending() { return !!pending; },
    dispose() { disposed = true; visible = false; attached = false; ++visibilityVersion; },
  };
}
