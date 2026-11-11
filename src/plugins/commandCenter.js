export function buildCommandCenter({ tasks = [], controllers = [] } = {}) {
  const items = tasks.map(task => {
    const controller = controllers.filter(c => c.taskId === task.id && c.source === 'phantom').at(-1) || null;
    return { ...task, sourceStatus: task.status, controllerStatus: controller?.status ?? null, controller, raw: task.raw };
  });
  const rank = item => item.sourceStatus === 'blocked' ? 0 : item.sourceStatus === 'running' || item.controllerStatus === 'running' ? 1 : 2;
  return items.sort((a, b) => rank(a) - rank(b));
}

// One serialized reader per API/project, shared by canvas and inspector. Requests
// already in flight cannot be cancelled by IPC; epoch checks discard late results.
export function createCommandCenterMonitor({ api, workspaceId, interval = 4000, now = Date.now, schedule = setTimeout, cancel = clearTimeout, subscribeEvents }) {
  let state = { tasks: [], controllers: [], events: [], selectedId: null, eventsId: null, observedAt: null, eventsAt: null, eventsTruncated: false, loading: false, error: '', eventsError: '', paused: false, connected: true };
  let epoch = 0, flight = false, pending = false, timer, deadline, disposed = false, unsubscribeEvents;
  // Only overlays received during the current catalog read take precedence over
  // that response. A later successful read remains the canonical snapshot.
  let liveControllers = new Map();
  const listeners = new Map();
  const active = () => !disposed && state.connected && [...listeners.values()].some(value => value) && !state.paused;
  const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners.keys()) listener(state); };
  const stopTimer = () => { if (timer !== undefined) cancel(timer); timer = undefined; deadline = undefined; };
  const queue = delay => {
    if (!active()) { stopTimer(); return; }
    if (flight) { pending = true; return; }
    // A continuous stdout stream must not keep pushing the next read into the
    // future. Keep the earliest scheduled read, including the regular poll.
    const next = now() + delay;
    if (deadline !== undefined && deadline <= next) return;
    stopTimer(); deadline = next;
    timer = schedule(() => { timer = undefined; deadline = undefined; refresh(); }, delay);
  };
  async function refresh(manual = false) {
    if (!active() && !(manual && !disposed && state.connected && [...listeners.values()].some(Boolean))) return;
    if (flight) { pending = true; return; }
    stopTimer(); flight = true; pending = false;
    liveControllers = new Map();
    const version = epoch, selected = state.selectedId;
    const valid = () => !disposed && version === epoch;
    publish({ loading: true });
    try {
      const result = await api('phantom.list', { workspaceId, topic: 'tasks' });
      if (!valid()) return;
      if (!result || result.available === false) throw new Error(result?.reason || 'Phantom no está disponible.');
      if (!Array.isArray(result.items) || (result.controllers !== undefined && !Array.isArray(result.controllers))) throw new Error('Catálogo Phantom inválido.');
      const controllers = (result.controllers || []).map(controller => liveControllers.get(controller.id) || controller);
      for (const controller of liveControllers.values()) if (!controllers.some(item => item.id === controller.id) && result.items.some(item => item.id === controller.taskId)) controllers.push(controller);
      publish({ tasks: result.items, controllers, observedAt: result.observedAt || new Date(now()).toISOString(), error: '', ...(!result.items.some(task => task.id === state.selectedId) ? { events: [], eventsId: null, eventsAt: null, eventsError: '', eventsTruncated: false } : {}) });
       if (valid() && selected && selected === state.selectedId && result.items.some(task => task.id === selected)) {
        try {
          const events = await api('phantom.events', { workspaceId, id: selected });
          if (!valid() || selected !== state.selectedId) return;
          if (!Array.isArray(events?.items)) throw new Error('Eventos Phantom inválidos.');
          publish({ events: events.items, eventsId: selected, eventsAt: events.observedAt || new Date(now()).toISOString(), eventsTruncated: !!events.truncated, eventsError: '' });
        } catch (error) { if (valid() && selected === state.selectedId) publish({ eventsError: error.message }); }
      }
    } catch (error) { if (valid()) publish({ error: error.message }); }
    finally {
      flight = false;
      if (!disposed) publish({ loading: false });
      queue(pending ? 150 : interval);
    }
  }
  const monitor = {
    getState: () => state,
    subscribe(listener, enabled = true) {
      listeners.set(listener, enabled);
      if (!unsubscribeEvents && subscribeEvents) unsubscribeEvents = subscribeEvents(event => monitor.handleEvent(event));
      listener(state); if (active()) queue(0);
      return () => {
        listeners.delete(listener);
        if (!active()) { epoch++; stopTimer(); }
        if (!listeners.size) { unsubscribeEvents?.(); unsubscribeEvents = undefined; }
      };
    },
    select(id) { if (id === state.selectedId) return; epoch++; publish({ selectedId: id, events: [], eventsId: null, eventsAt: null, eventsError: '', eventsTruncated: false }); queue(0); },
    pause(value) { epoch++; publish({ paused: value }); stopTimer(); if (!value) queue(0); },
    setInterval(value) { if (Number.isInteger(value) && value >= 3000 && value <= 5000) interval = value; },
    refresh: () => refresh(true),
    handleEvent(event) {
      if (event.type === 'connection') {
        epoch++; publish({ connected: event.status === 'connected' }); stopTimer(); if (active()) queue(0); return;
      }
      if (!active() || event.workspaceId !== workspaceId || !['tool.output', 'tool.status'].includes(event.type)) return;
      const index = state.controllers.findIndex(controller => controller.id === event.id);
      if (event.result?.source === 'phantom' || index >= 0) {
        const controllers = [...state.controllers];
        if (event.type === 'tool.status' && event.result?.taskId) {
          const next = { ...(controllers[index] || {}), ...event.result };
          if (index >= 0) controllers[index] = next; else controllers.push(next);
        } else if (event.type === 'tool.output' && index >= 0) controllers[index] = { ...controllers[index], output: `${controllers[index].output || ''}${event.data || ''}`.slice(-65536) };
        if (flight) for (const controller of controllers) if (controller.id === event.id) liveControllers.set(controller.id, controller);
        publish({ controllers }); queue(150);
      }
    },
    dispose() { disposed = true; epoch++; stopTimer(); unsubscribeEvents?.(); listeners.clear(); },
  };
  return monitor;
}
const monitors = new WeakMap();
export function getCommandCenterMonitor(api, workspaceId) {
  if (!monitors.has(api)) monitors.set(api, new Map());
  const projects = monitors.get(api);
   if (!projects.has(workspaceId)) projects.set(workspaceId, createCommandCenterMonitor({ api, workspaceId, subscribeEvents: listener => globalThis.window?.phantom?.onEvent?.(listener) }));
  return projects.get(workspaceId);
}
