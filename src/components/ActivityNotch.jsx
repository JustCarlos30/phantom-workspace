import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Bell, Check, ChevronDown, GitBranch, LoaderCircle, RefreshCw, TerminalSquare, X } from 'lucide-react';

export function TerminalActivity({ state, compact = false }) {
  const value = state || { kind: 'unknown', label: 'Sin señal de sesión' };
  return <span className={`terminal-activity activity-${value.kind} ${compact ? 'compact' : ''}`} title={`Fuente: terminal.list · ${value.label} · ${value.freshness || 'frescura desconocida'}`}><i aria-hidden="true" /><span>{value.label}</span></span>;
}

export default function ActivityNotch({ activity, open, onToggle, onClose, onNavigate, onRead, workspaceId }) {
  const trigger = useRef(null), dialog = useRef(null), returning = useRef(true);
  const [baseInput, setBaseInput] = useState(activity.base);
  const [reading, setReading] = useState(null), [readError, setReadError] = useState('');
  const readEpoch = useRef(0);
  const { counts, snapshot } = activity;
  useEffect(() => { ++readEpoch.current; setBaseInput(activity.base); setReadError(''); setReading(null); }, [workspaceId, activity.base]);
  useEffect(() => {
    if (!open) return;
    returning.current = true;
    const origin = document.activeElement;
    dialog.current?.querySelector('button:not(:disabled)')?.focus();
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (returning.current) (origin?.isConnected ? origin : trigger.current)?.focus(); };
  }, [open, onClose]);
  const navigate = target => { returning.current = false; onNavigate(target); };
  const markRead = async item => {
    const token = readEpoch.current;
    setReading(item.id); setReadError('');
    try { await onRead(item.id); }
    catch (error) { if (token === readEpoch.current) setReadError(error.message); }
    finally { if (token === readEpoch.current) setReading(null); }
  };
  const sourceNames = { sessions: 'terminal.list', tasks: 'phantom.list · tasks', git: 'git.inspect', notices: 'attention.list' };
  const errorCount = Object.values(snapshot.errors).filter(Boolean).length;
  return <>
    <div className="activity-strip">
      <button ref={trigger} className={`activity-notch ${counts.needs ? 'needs-you' : ''}`} disabled={!workspaceId} onClick={onToggle} aria-expanded={open} aria-controls="activity-tray" aria-haspopup="dialog" aria-label={`Actividad del proyecto: ${counts.needs} necesitan de ti, ${counts.sessions} sesiones, ${counts.branches} ramas`}>
        {snapshot.loading ? <LoaderCircle size={15} className="spinning" /> : counts.needs ? <AlertCircle size={15} /> : <Activity size={15} />}
        <strong>{counts.needs ? `${counts.needs} necesitan de ti` : 'Actividad'}</strong>
        <span><TerminalSquare size={13} />{counts.sessions}<span className="notch-word"> sesiones</span></span>
        <span><GitBranch size={13} />{counts.branches}<span className="notch-word"> ramas</span>{counts.pending !== null ? ` · ${counts.pending} pendientes` : ' · base sin comparar'}</span>
        {counts.unread > 0 && <span><Bell size={13} />{counts.unread}<span className="notch-word"> sin leer</span></span>}
        <small className={activity.stale || errorCount ? 'activity-warning' : ''}>{!activity.connected ? 'Sin conexión' : errorCount ? `${errorCount} fuentes con error` : activity.stale ? 'Datos antiguos' : snapshot.loading ? 'Consultando…' : `Local · ${activity.freshness('sessions')}`}</small><ChevronDown size={13} />
      </button>
    </div>
    {open && <>
      <button className="activity-dismiss" tabIndex={-1} aria-label="Cerrar actividad" onClick={onClose} />
      <section ref={dialog} id="activity-tray" className="activity-tray" role="dialog" aria-modal="true" aria-labelledby="activity-title">
        <header className="activity-heading"><div><strong id="activity-title">Actividad del proyecto</strong><small>{activity.connected ? 'Host conectado' : 'Host desconectado · datos conservados'} · refresco cada 20 s</small></div><button className="icon-button" disabled={snapshot.loading || !activity.connected} aria-label="Actualizar actividad" onClick={activity.refresh}><RefreshCw size={16} className={snapshot.loading ? 'spinning' : ''} /></button><button className="icon-button" aria-label="Cerrar bandeja de actividad" onClick={onClose}><X size={17} /></button></header>
        <div className="activity-scroll">
          <div className="activity-sources" aria-label="Estado de las fuentes">{Object.entries(sourceNames).map(([key, name]) => <div key={key}><span title={snapshot[key]?.observedAt ? `Observación de fuente: ${snapshot[key].observedAt}` : 'La fuente no declara fecha propia; se muestra antigüedad de la lectura.'}>{name}</span><small>{activity.freshness(key)}{snapshot.errors[key] ? ' · error' : ''}</small>{snapshot.errors[key] && <p role="alert">{snapshot.errors[key]} <button disabled={!activity.connected || snapshot.loading} onClick={activity.refresh}>Reintentar</button></p>}</div>)}</div>
          {snapshot.loading && <p className="activity-empty" role="status"><LoaderCircle size={14} className="spinning" /> Actualizando fuentes…</p>}
          <section aria-labelledby="activity-needs"><h2 id="activity-needs"><AlertCircle size={15} />Necesitan de ti <b>{counts.needs}</b></h2>
            {!activity.needs.length && <p className="activity-empty">{snapshot.loading ? 'Consultando necesidades…' : 'Sin necesidades explícitas en las fuentes consultadas. Los estados desconocidos no equivalen a trabajo resuelto.'}</p>}
            {activity.needs.map(item => <article className="activity-row" key={item.key}><div><strong>{item.title}</strong><span className="activity-warning">{item.state.label}</span><small>Fuente: {item.source}{!activity.connected ? ' · última observación sin conexión' : activity.stale || snapshot.errors[item.target.type === 'terminal' ? 'sessions' : 'tasks'] ? ' · última observación; confirmar fuente' : ''}</small></div><button onClick={() => navigate(item.target)}>{item.target.type === 'terminal' ? 'Ir a terminal' : item.target.type === 'tasks' ? 'Ver tarea' : 'Ver sesiones'}</button></article>)}
          </section>
          <section aria-labelledby="activity-git"><h2 id="activity-git"><GitBranch size={15} />Integración <b>{counts.branches} ramas</b></h2>
            <form className="activity-base" onSubmit={event => { event.preventDefault(); activity.setBase(baseInput); if (baseInput.trim() === activity.base) activity.refresh(); }}><label>Base explícita de comparación<input aria-label="Base de integración" value={baseInput} maxLength={512} placeholder="Ej.: main o un SHA" onChange={event => setBaseInput(event.target.value)} /></label><button disabled={!activity.connected || snapshot.loading}>Comparar</button></form>
            <p className="activity-empty">{activity.comparisonKnown ? `Frente a ${snapshot.git.base} (${snapshot.git.comparison.baseOid.slice(0, 12)}): ${counts.pending} pendientes de integración.` : 'Integración desconocida: elige una base y consulta Git.'} No integrada no significa lista ni aprobada.</p>
            {snapshot.git?.reason && !snapshot.errors.git && <p className="activity-warning">{snapshot.git.reason}</p>}
            {!activity.branches.length && !snapshot.loading && <p className="activity-empty">No hay ramas observadas.</p>}
            {activity.branches.map(branch => <article className="activity-row activity-branch" key={branch.name}><div><strong>{branch.name}{branch.current ? ' · actual' : ''}</strong><span className={`activity-${branch.state}`}>{branch.label} · adelante {activity.comparisonKnown ? branch.ahead ?? '?' : '?'} / detrás {activity.comparisonKnown ? branch.behind ?? '?' : '?'}</span><small>Fuente: git.inspect{branch.sessions.length || branch.tasks.length ? '' : ' · sin asociaciones acreditadas'}</small><div className="activity-links">{branch.sessions.map(session => <button key={session.id} disabled={!session.node} onClick={() => navigate({ type: 'terminal', id: session.node.id })}>{session.title}{session.hidden ? ' · oculta' : ''}</button>)}{branch.tasks.map(task => <button key={task.id} onClick={() => navigate({ type: 'tasks', id: task.id })}>{task.title || task.id}</button>)}</div></div><button onClick={() => navigate({ type: 'git' })}>Ver Git</button></article>)}
          </section>
          <section aria-labelledby="activity-sessions"><h2 id="activity-sessions"><TerminalSquare size={15} />Sesiones <b>{counts.sessions}</b></h2>
            {!activity.sessions.length && !snapshot.loading && <p className="activity-empty">No hay sesiones observadas. Las vistas ocultas también aparecen aquí.</p>}
            {activity.sessions.map(session => <article className="activity-row" key={session.id}><div><strong>{session.title}{session.hidden ? ' · Vista oculta' : ''}</strong><TerminalActivity state={session.state} /><small>terminal.list · {session.id} · PID {session.pid ?? 'desconocido'}{session.node ? '' : ' · sin vista asociada'}</small></div><button disabled={!session.node} onClick={() => navigate({ type: 'terminal', id: session.node.id })}>{session.hidden ? 'Recuperar terminal' : 'Ir a terminal'}</button></article>)}
          </section>
          <section aria-labelledby="activity-notices"><h2 id="activity-notices"><Bell size={15} />Avisos <b>{counts.unread} sin leer</b></h2><p className="activity-empty">Marcar leído solo registra lectura; no aprueba ni resuelve tareas.</p>
            {readError && <p className="activity-warning" role="alert">{readError} · Puedes reintentar la lectura.</p>}
            {!activity.notices.length && !snapshot.loading && <p className="activity-empty">Sin avisos registrados.</p>}
            {activity.notices.map(item => <article className="activity-row" key={item.id}><div><strong>{item.title}</strong><small>Fuente: {item.source || 'desconocida'} · {item.read ? 'Leído' : 'Sin leer'} · {item.observedAt || item.createdAt || 'fecha desconocida'}</small></div><div className="activity-actions">{item.target && <button onClick={() => navigate(item.target)}>Ir al origen</button>}{!item.read && <button disabled={Boolean(reading) || !activity.connected} onClick={() => markRead(item)}>{reading === item.id ? <LoaderCircle size={13} className="spinning" /> : <Check size={13} />}Marcar leído</button>}</div></article>)}
          </section>
        </div>
      </section>
    </>}
  </>;
}
