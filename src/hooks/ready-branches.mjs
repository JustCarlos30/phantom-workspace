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

export function readyLabel(row) {
  return `${row.terminal?.title || row.name.replace(/^phantom\//, '')} · ${row.ahead} commits`;
}
