import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { summarize, freshness } from '../hooks/limits-view.mjs';

function Bar({ percent, tone }) {
  return <span className="usage-bar" data-tone={tone} aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }} /></span>;
}

export default function RailUsage({ data, loading, error, onRefresh }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const box = useRef(null);
  const id = useId();
  const rows = useMemo(() => summarize(data), [data, open]);
  const fresh = useMemo(() => freshness(data), [data, open]);

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
          {r.available && r.percent != null ? <>{(r.rail.length ? r.rail : [{ key: 'peak', label: '', percent: r.percent, tone: r.tone }]).map(w => <span key={w.key} className="usage-win" title={w.label || undefined}>{w.label && <span className="usage-wname">{w.key === 'session' ? '5 h' : 'Sem'}</span>}<Bar percent={w.percent} tone={w.tone} /><span className="usage-pct" data-tone={w.tone}>{w.percent}%</span></span>)}</> : <span className="usage-none" title={r.retry || r.reason || undefined}>{r.status === 'rate_limited' ? 'En espera' : r.status === 'error' ? 'Error' : 'Sin sesión'}</span>}
        </span>)}
      </span>
      {worst && <span className="usage-mini" data-tone={worst.tone}>{worst.percent}%</span>}
    </button>
    {open && <div ref={box} id={id} className="usage-popover" role="dialog" aria-label="Detalle de límites">
      {rows.map(r => <section key={r.id} className="usage-detail">
        <h3>{r.label}{r.plan && <small className="usage-plan">{r.plan}</small>}</h3>
        {(!r.available || r.stale) && <p className="usage-reason">{r.reason || 'Sin sesión'}{r.retry && ` · ${r.retry}`}</p>}
        {r.windows.map((w, i) => <div key={i} className="usage-window">
          <div className="usage-window-head"><span>{w.label}</span><b data-tone={w.tone}>{w.percent}%</b></div>
          <span className="usage-track" data-tone={w.tone} role="img" aria-label={`${w.label}: ${w.percent}% usado${w.pace != null ? `, ${w.pace}% del tiempo transcurrido` : ''}`}>
            <i style={{ width: `${Math.min(100, Math.max(0, w.percent))}%` }} />
            {w.pace != null && <u className="usage-pace" style={{ left: `${w.pace}%` }} title={`Ritmo: ${w.pace}% del tiempo transcurrido`} />}
          </span>
          {w.resetLabel && <em>reinicia {w.resetLabel}</em>}
        </div>)}
        {(() => { const p = (data.providers || []).find(x => x.id === r.id); return <>
          {p?.credits != null && <p className="usage-extra">Créditos: {typeof p.credits === 'object' ? (p.credits.balance ?? JSON.stringify(p.credits)) : String(p.credits)}</p>}
          {p?.extra != null && <p className="usage-extra">Uso extra: {typeof p.extra === 'object' ? (p.extra.label ?? p.extra.used ?? JSON.stringify(p.extra)) : String(p.extra)}</p>}
          {p?.limitReached && <p className="usage-extra" data-tone="danger">Límite alcanzado</p>}
        </>; })()}
      </section>)}
      {rows.some(r => r.status === 'rate_limited' && r.retry) && <p className="usage-reason">Actualizar no consulta a un proveedor en espera por 429: {rows.filter(r => r.status === 'rate_limited' && r.retry).map(r => `${r.label} ${r.retry}`).join('; ')}.</p>}
      <footer className="usage-foot">
        <span className="usage-fresh">{fresh.text || 'Sin lecturas'}{fresh.stale && <i className="usage-dot" title={fresh.reason || undefined} role="img" aria-label={`Dato desactualizado: ${fresh.reason || ''}`} />}</span>
        <button type="button" className="usage-refresh" aria-label="Actualizar límites" title="Actualizar" disabled={loading} onClick={() => onRefresh?.()}><RefreshCw size={14} aria-hidden="true" className={loading ? 'spin' : ''} /></button>
      </footer>
    </div>}
  </div>;
}
