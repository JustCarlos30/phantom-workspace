export function peakWindow(provider) {
  const windows = Array.isArray(provider?.windows) ? provider.windows : [];
  let peak = null;
  for (const w of windows) if (Number.isFinite(w?.percent) && (!peak || w.percent > peak.percent)) peak = w;
  return peak;
}

const RAIL_WINDOWS = [['session', 'Sesión 5 h', ['Sesión · 5 h']], ['weekly', 'Semanal', ['Semanal · todos los modelos', 'Semanal']]];
export function railWindows(provider) {
  const windows = Array.isArray(provider?.windows) ? provider.windows : [];
  const out = [];
  for (const [key, short, labels] of RAIL_WINDOWS) {
    const w = windows.find(x => labels.includes(x?.label) && Number.isFinite(x.percent));
    if (w) { const percent = Math.round(w.percent); out.push({ key, label: short, percent, tone: toneOf(percent) }); }
  }
  return out;
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

const agoText = (value, now) => {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
};

const retryText = (value, now) => {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return `reintenta en ${Math.max(1, Math.ceil((t - now) / 60000))} min`;
};

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
      status: p.status ?? null,
      stale: p.stale === true,
      staleSince: p.stale ? agoText(p.staleSince, now) : null,
      retryAt: p.retryAt ?? null,
      retry: p.retryAt ? retryText(p.retryAt, now) : null,
      percent,
      rail: railWindows(p),
      tone: percent == null ? 'ok' : toneOf(percent),
      windows: (Array.isArray(p.windows) ? p.windows : []).map(w => {
        const pc = Math.round(Number.isFinite(w.percent) ? w.percent : 0);
        return { label: w.label, percent: pc, tone: toneOf(pc), reset: resetIn(w.resetsAt, now) };
      })
    };
  });
}
