// Incorporaciones: groups what merge.status reports into the questions the
// panel answers at a glance. The host owns the facts; this only sorts them.
//   attention — requests returned to their terminal (conflict, failed checks)
//   ready     — branches that can be merged: queued requests in order, then
//               clean branches with commits nobody has requested yet
//   working   — terminals still editing or without commits to integrate
//   history   — requests already closed
const RETURNED = ['conflict', 'failed'];

// Commits saved, nothing uncommitted, branch readable and no agent mid-edit.
export function isReadyBranch(item) {
  return Boolean(item && !item.missing && item.ahead > 0 && item.uncommitted === 0 && item.status !== 'working' && item.status !== 'blocked');
}

export function buildIncorporaciones(data) {
  const queue = data?.queue ?? [], active = data?.active ?? [], history = data?.history ?? [];
  const merging = queue.find(item => item.status === 'merging') ?? null;
  const queued = queue.filter(item => item.status === 'queued');
  const attention = queue.filter(item => RETURNED.includes(item.status));
  const unrequested = active.filter(isReadyBranch);
  const working = active.filter(item => !isReadyBranch(item));
  const merged = history.filter(item => item.status === 'merged');
  const ready = [...queued.map(item => ({ kind: 'request', item })), ...unrequested.map(item => ({ kind: 'branch', item }))];
  const overlapping = new Set([...queue, ...active].filter(item => item.overlaps?.length).map(item => item.nodeId ?? item.id)).size;
  return {
    merging, queued, attention, unrequested, working, ready, merged, history,
    counts: {
      // Every integration request card that is still open, whatever its state.
      cards: queue.length,
      ready: ready.length,
      queued: queued.length,
      unrequested: unrequested.length,
      attention: attention.length,
      working: working.length,
      merged: merged.length,
      overlapping,
    },
  };
}
