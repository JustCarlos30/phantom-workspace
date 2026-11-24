// Local, per-project usage of launcher tools. Stores only tool type ids,
// counts, timestamps and preferences: no content, no network.
export const USAGE_VERSION = 1;
export const MIN_OPENS = 2;
export const MAX_FREQUENT = 3;
const KEY = id => `phantom.toolUsage.v${USAGE_VERSION}:${id}`;

export const emptyUsage = () => ({ v: USAGE_VERSION, paused: false, tools: {}, hidden: [], stats: { total: 0, fromFrequent: 0, dismissed: 0 } });

const num = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

export function parseUsage(raw) {
  const usage = emptyUsage();
  if (typeof raw !== 'string') return usage;
  let data;
  try { data = JSON.parse(raw); } catch { return usage; }
  if (!data || typeof data !== 'object' || data.v !== USAGE_VERSION) return usage;
  usage.paused = data.paused === true;
  if (data.tools && typeof data.tools === 'object' && !Array.isArray(data.tools)) {
    for (const [type, entry] of Object.entries(data.tools)) {
      const count = num(entry?.count);
      if (count > 0) usage.tools[type] = { count, last: num(entry.last) };
    }
  }
  if (Array.isArray(data.hidden)) usage.hidden = [...new Set(data.hidden.filter(type => typeof type === 'string'))];
  for (const field of ['total', 'fromFrequent', 'dismissed']) usage.stats[field] = num(data.stats?.[field]);
  return usage;
}

// Returns true only when the write really happened.
export function writeUsage(storage, workspaceId, usage) {
  try { storage.setItem(KEY(workspaceId), JSON.stringify(usage)); return true; } catch { return false; }
}

export function recordOpen(usage, type, { fromFrequent = false, now = Date.now() } = {}) {
  if (usage.paused || typeof type !== 'string' || !type) return usage;
  const previous = usage.tools[type]?.count || 0;
  return {
    ...usage,
    tools: { ...usage.tools, [type]: { count: previous + 1, last: now } },
    stats: { ...usage.stats, total: usage.stats.total + 1, fromFrequent: usage.stats.fromFrequent + (fromFrequent ? 1 : 0) },
  };
}

export function frequentTools(usage, availableTypes) {
  const available = new Set(availableTypes);
  const hidden = new Set(usage.hidden);
  return Object.entries(usage.tools)
    .filter(([type, entry]) => available.has(type) && !hidden.has(type) && entry.count >= MIN_OPENS)
    .sort(([a, x], [b, y]) => y.count - x.count || y.last - x.last || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_FREQUENT)
    .map(([type]) => type);
}

export const hideTool = (usage, type) => usage.hidden.includes(type) ? usage
  : { ...usage, hidden: [...usage.hidden, type], stats: { ...usage.stats, dismissed: usage.stats.dismissed + 1 } };

export const setPaused = (usage, paused) => ({ ...usage, paused: !!paused });

export const resetUsage = usage => ({ ...emptyUsage(), paused: usage.paused });

// Session memory per storage object (null storage shares one sentinel) and project.
// It wins over storage whenever the last write failed or storage cannot be read.
const NO_STORAGE = {};
const sessions = new WeakMap();
const sessionFor = (storage, workspaceId) => {
  const key = storage || NO_STORAGE;
  if (!sessions.has(key)) sessions.set(key, new Map());
  const map = sessions.get(key);
  return { get: () => map.get(workspaceId), set: entry => map.set(workspaceId, entry) };
};

function currentUsage(storage, workspaceId) {
  const session = sessionFor(storage, workspaceId);
  const entry = session.get();
  if (!storage) return { usage: entry?.usage || emptyUsage(), persisted: false };
  let raw;
  try { raw = storage.getItem(KEY(workspaceId)); } catch { return { usage: entry?.usage || emptyUsage(), persisted: false }; }
  if (entry && !entry.persisted) return { usage: entry.usage, persisted: false };
  return { usage: parseUsage(raw), persisted: true };
}

export function readUsage(storage, workspaceId) { return currentUsage(storage, workspaceId).usage; }

// Whether the current state is really stored on this device.
export function usagePersisted(storage, workspaceId) { return currentUsage(storage, workspaceId).persisted; }

// Read-modify-write; returns { usage, persisted }. Never throws.
export function updateUsage(storage, workspaceId, change) {
  const session = sessionFor(storage, workspaceId);
  const usage = change(currentUsage(storage, workspaceId).usage);
  const persisted = storage ? writeUsage(storage, workspaceId, usage) : false;
  session.set({ usage, persisted });
  return { usage, persisted };
}

export function localStorageOrNull() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
