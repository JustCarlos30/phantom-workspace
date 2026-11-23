import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { summarize } from '../hooks/limits-view.mjs';

function Bar({ percent, tone }) {
  return <span className="usage-bar" data-tone={tone} aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }} /></span>;
}

export default function RailUsage({ data, loading, error, onRefresh }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const box = useRef(null);
  const id = useId();
  const rows = useMemo(() => summarize(data), [data, open]);

  useEffect(() => {
    if (!open) return undefined;
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); button.current?.focus(); } };
    const down = e => { if (!box.current?.contains(e.target) && !button.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', down, true);
    box.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', down, true); };
  }, [open]);

  if (!data && !error) return null;
  if (!data) return <div className="rail-usage rail-usage-off">Límites no disponibles</div>;

  const worst = rows.reduce((m, r) => (r.percent != null && (!m || r.percent > m.percent) ? r : m), null);

  return <div className="rail-usage">
    <button ref={button} type="button" className="usage-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label="Uso y límites de proveedores" onClick={() => setOpen(v => !v)}>
      <Gauge size={16} className="usage-icon" aria-hidden="true" />
      <span className="usage-rows">
        {rows.map(r => <span key={r.id} className={`usage-row ${r.available && r.percent != null ? '' : 'usage-off'}`}>
          <span className="usage-name">{r.label}</span>
          {r.available && r.percent != null ? <><Bar percent={r.percent} tone={r.tone} /><span className="usage-pct" data-tone={r.tone}>{r.percent}%</span></> : <span className="usage-none">Sin sesión</span>}
        </span>)}
      </span>
      {worst && <span className="usage-mini" data-tone={worst.tone}>{worst.percent}%</span>}
    </button>
    {open && <div ref={box} id={id} className="usage-popover" role="dialog" aria-label="Detalle de límites">
      {rows.map(r => <section key={r.id} className="usage-detail">
        <h3>{r.label}{r.plan && <small>{r.plan}</small>}</h3>
        {!r.available && <p className="usage-reason">{r.reason || 'Sin sesión'}</p>}
        {r.windows.map((w, i) => <div key={i} className="usage-window">
          <span>{w.label}</span><Bar percent={w.percent} tone={w.tone} /><b data-tone={w.tone}>{w.percent}%</b><em>{w.reset}</em>
        </div>)}
        {(() => { const p = (data.providers || []).find(x => x.id === r.id); return <>
          {p?.credits != null && <p className="usage-extra">Créditos: {typeof p.credits === 'object' ? (p.credits.balance ?? JSON.stringify(p.credits)) : String(p.credits)}</p>}
          {p?.extra != null && <p className="usage-extra">Uso extra: {typeof p.extra === 'object' ? (p.extra.label ?? p.extra.used ?? JSON.stringify(p.extra)) : String(p.extra)}</p>}
          {p?.limitReached && <p className="usage-extra" data-tone="danger">Límite alcanzado</p>}
        </>; })()}
      </section>)}
      <button type="button" className="usage-refresh" disabled={loading} onClick={() => onRefresh?.()}><RefreshCw size={14} aria-hidden="true" className={loading ? 'spin' : ''} />Actualizar</button>
    </div>}
  </div>;
}
