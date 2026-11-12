// Returns `next`, reusing every subtree of `previous` that is deeply equal.
// State arrives as fresh objects (IPC reads, save-queue overlays); keeping the
// identity of unchanged workspaces/nodes lets memoized panels skip renders.
// Array items carrying an `id` are matched by id, otherwise by index.
export function structuralShare(previous, next) {
  if (previous === next) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return next;
  if (Array.isArray(previous) !== Array.isArray(next)) return next;
  if (Array.isArray(next)) {
    const byId = new Map();
    for (const item of previous) if (item && typeof item === 'object' && item.id !== undefined) byId.set(item.id, item);
    let same = previous.length === next.length;
    const shared = next.map((item, index) => {
      const match = item && typeof item === 'object' && item.id !== undefined ? byId.get(item.id) : previous[index];
      const value = structuralShare(match, item);
      if (value !== previous[index]) same = false;
      return value;
    });
    return same ? previous : shared;
  }
  if (Object.getPrototypeOf(next) !== Object.prototype && Object.getPrototypeOf(next) !== null) return next;
  const keys = Object.keys(next);
  let same = keys.length === Object.keys(previous).length;
  const shared = {};
  for (const key of keys) {
    const value = structuralShare(previous[key], next[key]);
    if (value !== previous[key] || !(key in previous)) same = false;
    shared[key] = value;
  }
  return same ? previous : shared;
}
