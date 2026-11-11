import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, ArrowUpRight, Bell, Check, ChevronDown, GitBranch, LoaderCircle, RefreshCw, TerminalSquare, X } from 'lucide-react';

export function TerminalActivity({ session, connected = true, compact = false }) {
  const state = !connected ? { label: 'Sin conexión', tone: 'warning' } : session?.state || { label: 'Sin señal', tone: 'neutral' };
  return <span className={`terminal-activity activity-tone-${state.tone} ${compact ? 'compact' : ''}`} title={`${state.label} · ${session?.source || 'Sin descriptor actualizado'}${state.rawState ? ` · ${state.rawState}` : ''}`}><i aria-hidden="true" /><span>{state.label}</span></span>;
}
function Source({ name, value, now, connected }) {
  const age = value?.at ? Math.max(0, Math.floor((now - value.at) / 1000)) : null;
  return <p className={`activity-source ${value?.error || !connected || age > 40 ? 'activity-tone-warning' : ''}`}><span>{name}</span> · {!connected ? 'desconectada' : value?.error ? `Error: ${value.error}` : age === null ? 'sin lectura' : `consultada hace ${age} s`}{value?.error && value?.at ? ' · datos anteriores' : ''}{age > 40 ? ' · desactualizada' : ''}{value?.observedAt && <time dateTime={value.observedAt}> · fuente: {value.observedAt}</time>}</p>;
}
export default function ActivityNotch({ activity, open, setOpen, onNavigate, onRead }) {
  const button = useRef(null), tray = useRef(null), origin = useRef(null), navigating = useRef(false);
  const [draft, setDraft] = useState(activity.base);
  const [reading, setReading] = useState(null), [readError, setReadError] = useState('');
  useEffect(() => { setDraft(activity.base); setReadError(''); }, [activity.base]);
  useEffect(() => {
    if (!open) return;
    navigating.current = false;
    origin.current = document.activeElement;
    tray.current?.querySelector('button')?.focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      if (event.key !== 'Tab') return;
      const controls = [...(tray.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select,a[href]') || [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !tray.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !tray.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (!navigating.current) (origin.current?.isConnected ? origin.current : button.current)?.focus();
    };
  }, [open, setOpen]);
  const navigate = target => { navigating.current = true; setOpen(false); onNavigate(target); };
  const errors = ['sessions', 'tasks', 'git'].filter(name => activity.sources[name]?.error);
  return <>
    <div className="activity-notch-wrap"><button ref={button} className={`activity-notch ${activity.needs.length ? 'needs-attention' : ''}`} aria-label="Actividad del proyecto" aria-expanded={open} aria-controls="activity-tray" onClick={() => setOpen(!open)}>
      <Activity size={15} /><strong>{activity.needs.length ? `${activity.needs.length} necesitan de ti` : 'Actividad'}</strong><span><TerminalSquare size={13} />{activity.sessions.length} sesiones</span><span><GitBranch size={13} />{activity.branches.length} ramas</span><span className="activity-notch-detail">{activity.base ? `${activity.pendingBranches} no integradas` : 'Base sin definir'}</span>{activity.unread > 0 && <span><Bell size={13} />{activity.unread}<span className="activity-notch-detail"> sin leer</span></span>}{!activity.connected ? <span className="activity-tone-warning">Sin conexión</span> : activity.loading ? <LoaderCircle aria-label="Actualizando actividad" size={13} className="spinning" /> : errors.length > 0 ? <AlertCircle aria-label="Fuentes con error" size={14} /> : <span className="activity-notch-detail">Fuentes consultadas</span>}<ChevronDown size={13} />
    </button></div>
    {open && <><button className="popover-dismiss top-dismiss" aria-label="Cerrar actividad" onClick={() => setOpen(false)} /><section ref={tray} id="activity-tray" className="activity-tray" role="dialog" aria-modal="true" aria-label="Actividad del proyecto">
      <div className="popover-heading"><strong>Actividad del proyecto</strong><div className="activity-actions"><button className="icon-button" aria-label="Actualizar actividad" disabled={activity.loading || !activity.connected} onClick={activity.retry}><RefreshCw size={15} className={activity.loading ? 'spinning' : ''} /></button><button className="icon-button" aria-label="Cerrar bandeja de actividad" onClick={() => setOpen(false)}><X size={16} /></button></div></div>
      <div className="activity-scroll">
        {!activity.connected && <p className="activity-banner" role="status">Host desconectado. Los estados actuales no se pueden confirmar.</p>}
        {activity.loading && <p className="activity-source" role="status"><LoaderCircle size={13} className="spinning" /> Consultando fuentes…</p>}
        {!!errors.length && <div className="activity-banner" role="alert">Hay fuentes con error. La actividad puede estar incompleta.<button disabled={activity.loading || !activity.connected} onClick={activity.retry}>Reintentar fuentes</button></div>}
        <section aria-labelledby="activity-needs"><h2 id="activity-needs">Necesitan de ti <b>{activity.needs.length}</b></h2>{!activity.needs.length && <p className="activity-empty">{activity.loading ? 'Esperando señales de las fuentes.' : errors.length || !activity.connected ? 'Sin necesidades confirmadas; cobertura incompleta.' : 'Sin necesidades de intervención declaradas por las fuentes.'}</p>}{activity.needs.map(item => <div className="activity-row" key={item.key}><AlertCircle size={15} className={`activity-tone-${item.state.tone}`} /><div><strong>{item.title || item.id}</strong><span className={`activity-tone-${item.state.tone}`}>{item.state.label}</span><small>{item.source} · estado: {item.status || item.state.rawState || 'desconocido'}</small></div><button onClick={() => navigate(item.target)}>Abrir<ArrowUpRight size={13} /></button></div>)}</section>
        <section aria-labelledby="activity-integration"><h2 id="activity-integration">Integración <b>{activity.branches.length} ramas</b><button onClick={() => navigate({ kind: 'git' })}>Abrir Git<ArrowUpRight size={13} /></button></h2>
          <form className="activity-base" onSubmit={event => { event.preventDefault(); activity.setBase(draft); }}><label htmlFor="activity-base">Base explícita de comparación</label><div><input id="activity-base" value={draft} onChange={e => setDraft(e.target.value)} placeholder="p. ej. main" maxLength={512} /><button type="submit" disabled={!activity.connected}>Comparar</button></div></form>
          <p className="activity-source">Base: {activity.base || 'sin definir'} · {activity.pendingBranches} no integradas · {activity.unknownBranches} desconocidas. No integrada no implica lista para integrar.</p>
          {!activity.branches.length && <p className="activity-empty">{activity.sources.git?.error ? 'No se pudo consultar el radar Git.' : 'Sin ramas observadas.'}</p>}
          {activity.branches.map(branch => <div className="activity-branch" key={branch.name}><div><strong>{branch.name}</strong><span>{branch.integration}</span></div><small>Adelante {branch.ahead ?? '?'} / detrás {branch.behind ?? '?'} · frente a {activity.base || 'base desconocida'}</small>{branch.sessions.map(s => <button key={s.id} onClick={() => navigate(s.nodeId ? { kind: 'terminal', id: s.nodeId } : { kind: 'sessions' })}><TerminalSquare size={12} />{s.title}<ArrowUpRight size={12} /></button>)}{branch.tasks.map(t => <button key={t.id} onClick={() => navigate({ kind: 'tasks', id: t.id })}>{t.title || t.id}<ArrowUpRight size={12} /></button>)}{!branch.sessions.length && !branch.tasks.length && <small>Sin asociación de sesión o tarea acreditada</small>}</div>)}
          <Source name="git.inspect" value={activity.sources.git} now={activity.now} connected={activity.connected} />
        </section>
        <section aria-labelledby="activity-sessions"><h2 id="activity-sessions">Sesiones <b>{activity.sessions.length}</b></h2>{!activity.sessions.length && <p className="activity-empty">Sin sesiones registradas.</p>}{activity.sessions.map(session => <div className="activity-row" key={session.id}><TerminalSquare size={15} /><div><strong>{session.title}</strong><TerminalActivity session={session} connected={activity.connected} /><small>{session.hidden ? 'Vista oculta · ' : ''}{session.id}</small></div><button onClick={() => navigate(session.nodeId ? { kind: 'terminal', id: session.nodeId } : { kind: 'sessions' })}>{session.hidden ? 'Recuperar terminal' : session.nodeId ? 'Ir a terminal' : 'Ver sesión'}<ArrowUpRight size={13} /></button></div>)}<Source name="terminal.list" value={activity.sources.sessions} now={activity.now} connected={activity.connected} /><Source name="Phantom · phantom.list tasks" value={activity.sources.tasks} now={activity.now} connected={activity.connected} /></section>
        <section aria-labelledby="activity-notices"><h2 id="activity-notices">Avisos <b>{activity.unread} sin leer</b></h2><p className="activity-source">Marcar leído solo registra lectura: no aprueba ni resuelve trabajo.</p>{readError && <p role="alert" className="activity-tone-danger">{readError}</p>}{!activity.notices.length && <p className="activity-empty">Sin avisos registrados.</p>}{activity.notices.map(item => <div className="activity-row" key={item.id}><Bell size={14} /><div><strong>{item.title}</strong><small>{item.source || 'Fuente desconocida'} · {item.read ? 'Leído' : 'Sin leer'} · {item.observedAt || item.createdAt || 'fecha desconocida'}</small><button onClick={() => navigate(item.target)}>Abrir origen<ArrowUpRight size={12} /></button></div><button disabled={item.read || !!reading || !activity.connected} onClick={async () => { setReading(item.id); setReadError(''); try { await onRead(item.id); } catch (error) { setReadError(error.message); } finally { setReading(null); } }}>{reading === item.id ? <LoaderCircle size={13} className="spinning" /> : <Check size={13} />}{item.read ? 'Leído' : 'Marcar leído'}</button></div>)}</section>
      </div>
    </section></>}
  </>;
}
