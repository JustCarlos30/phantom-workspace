import { useEffect, useState } from 'react';

export function formatSince(ms) {
  if (!Number.isFinite(ms) || ms < 10000) return 'ahora';
  if (ms < 60000) return `hace ${Math.floor(ms / 1000)} s`;
  if (ms < 3600000) return `hace ${Math.floor(ms / 60000)} min`;
  if (ms < 86400000) return `hace ${Math.floor(ms / 3600000)} h`;
  return `hace ${Math.floor(ms / 86400000)} d`;
}

export function stateTone(state) {
  if (state === 'working') return 'working';
  return ['approval', 'turn', 'blocked', 'review'].includes(state) ? 'attention' : null;
}

export function useNow(active, intervalMs = 15000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [active, intervalMs]);
  return now;
}
