import { branchTitle } from './branches-model.mjs';

export function isReadyToMerge(row) {
  return !row.isBase && row.work === 'ready' && row.ahead > 0
    && row.changeCount === 0 && Array.isArray(row.conflicts) && row.conflicts.length === 0
    && !row.error && row.terminal?.status !== 'working';
}

export function trackReady(seen, overview) {
  const ready = (overview?.branches || []).filter(isReadyToMerge);
  return {
    seen: new Map(ready.map(row => [row.name, row.oid])),
    fresh: seen === null ? [] : ready.filter(row => !seen.has(row.name) || seen.get(row.name) !== row.oid),
    initial: seen === null ? ready : [],
  };
}

// The session's name; a closed session is named after its branch, never a UUID.
export function readyTitle(row) {
  return row.terminal?.title || branchTitle(row.name).replace(/^phantom\//, '');
}

export function readyLabel(row) {
  return `${readyTitle(row)} · ${row.ahead} ${row.ahead === 1 ? 'commit' : 'commits'}`;
}

export function readySummary(count) {
  return count === 1 ? '1 rama lista para integrar' : `${count} ramas listas para integrar`;
}
