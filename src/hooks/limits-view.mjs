export function peakWindow(provider) {
  const windows = Array.isArray(provider?.windows) ? provider.windows : [];
  let peak = null;
  for (const w of windows) if (Number.isFinite(w?.percent) && (!peak || w.percent > peak.percent)) peak = w;
  return peak;
}

export function toneOf(percent) {
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warn';
  return 'ok';
}

export function resetIn(resetsAt, now = Date.now()) {
  const t = typeof resetsAt === 'number' ? resetsAt : Date.parse(resetsAt);
  if (!Number.isFinite(t)) return '';
  const min = Math.ceil((t - now) / 60000);
  if (min <= 0) return 'ya';
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `en ${h} h ${min % 60} min` : `en ${h} h`;
  return `en ${Math.floor(h / 24)} d`;
}

export function summarize(data, now = Date.now()) {
  const providers = Array.isArray(data?.providers) ? data.providers : [];
  return providers.map(p => {
    const peak = peakWindow(p);
    const percent = peak ? Math.round(peak.percent) : null;
    return {
      id: p.id,
      label: p.label,
      plan: p.plan ?? null,
      available: !!p.available,
      reason: p.reason ?? null,
      percent,
      tone: percent == null ? 'ok' : toneOf(percent),
      windows: (Array.isArray(p.windows) ? p.windows : []).map(w => {
        const pc = Math.round(Number.isFinite(w.percent) ? w.percent : 0);
        return { label: w.label, percent: pc, tone: toneOf(pc), reset: resetIn(w.resetsAt, now) };
      })
    };
  });
}
