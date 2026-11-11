import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, ArrowUpRight, Bell, Check, ChevronDown, GitBranch, LoaderCircle, RotateCcw, TerminalSquare, X } from 'lucide-react';

export function TerminalActivity({ session, connected = true, compact = false, stale = false }) {
  const label = !connected ? 'Sin conexión' : session?.state?.label || 'Sin señal · estado desconocido';
  return <span className={`terminal-activity ${session?.state?.tone || 'unknown'} ${compact ? 'compact' : ''}`} title={`${label}${stale ? ' · Datos sin confirmar' : ''} · Fuente: terminal.list${session?.agentStatus ? ' / estado de agente explícito' : ''}`} aria-label={compact ? label : undefined}><i aria-hidden="true" />{!compact && <span>{label}{stale && ' · sin confirmar'}</span>}</span>;
}

export default function ActivityNotch({ activity, open, onToggle, triggerRef }) {
  const { needs, sessions, branches, pendingBranches, unknownBranches, unread, connected, loading, hasError, stale } = activity;
  return <div className="activity-strip"><button ref={triggerRef} className={`activity-notch ${needs.length ? 'needs-you' : ''}`} aria-label="Actividad del proyecto" aria-expanded={open} aria-controls="activity-tray" onClick={onToggle}>
    {loading ? <LoaderCircle size={14} className="spinning" /> : needs.length ? <AlertCircle size={14} /> : <Activity size={14} />}
    <strong>{needs.length ? `${needs.length} necesitan de ti` : 'Actividad'}</strong>
    <span><TerminalSquare size={13} />{sessions.filter(s => !s.descriptorMissing).length} sesiones</span>
    <span><GitBranch size={13} />{branches.length} ramas <small>· {pendingBranches} pendientes{unknownBranches ? ` · ${unknownBranches} sin comparar` : ''}</small></span>
    {unread > 0 && <span><Bell size={13} />{unread}</span>}
    <span className="activity-confidence">{!connected ? 'Sin conexión' : hasError ? 'Fuentes con error' : stale ? 'Sin confirmar' : 'Actualizada'}</span><ChevronDown size={13} />
  </button></div>;
}

function Source({ name, resource, connected, now, retry }) {
  const age = resource.at ? Math.max(0, Math.floor((now - resource.at) / 1000)) : null;
  return <div className="activity-source"><span>Fuente: {name} · {!connected ? 'desconectada' : resource.loading ? 'actualizando…' : resource.error ? 'error' : 'conectada'} · {age === null ? 'sin lectura confirmada' : `última lectura hace ${age} s`}</span>{resource.error && <div role="alert"><span>{resource.error}</span><button onClick={retry} disabled={!connected || resource.loading}><RotateCcw size={13} /> Reintentar {name}</button></div>}</div>;
}

export function ActivityTray({ activity, onClose, onNavigate, onRead, triggerRef }) {
  const dialog = useRef(null);
  const navigating = useRef(false);
  const [base, setBase] = useState(activity.base);
  const [reading, setReading] = useState('');
  const [readError, setReadError] = useState('');
  useEffect(() => {
    dialog.current?.querySelector('button')?.focus();
    return () => { if (!navigating.current) triggerRef.current?.focus(); };
  }, [triggerRef]);
  const navigate = target => { navigating.current = true; onNavigate(target); };
  const source = (name, key) => <Source name={name} resource={activity.resources[key]} connected={activity.connected} now={activity.now} retry={activity.reload} />;
  return <><button className="popover-dismiss top-dismiss" aria-label="Cerrar actividad" onClick={onClose} /><section ref={dialog} id="activity-tray" className="activity-tray" role="dialog" aria-modal="true" aria-label="Actividad del proyecto" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') {
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input,summary')];
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="popover-heading"><strong>Actividad del proyecto</strong><button className="icon-button" aria-label="Cerrar bandeja de actividad" onClick={onClose}><X size={16} /></button></div>
    <div className="activity-tray-content">
      <p className="activity-explanation">{!activity.connected ? 'Host desconectado. Se muestran las últimas lecturas, sin confirmar.' : 'Sesiones, tareas y Git · actualización por eventos y cada 20 s.'} Leer un aviso no aprueba ni resuelve trabajo.</p>
      <section aria-labelledby="activity-needs"><h2 id="activity-needs"><AlertCircle size={15} />Necesitan de ti <b>{activity.needs.length}</b></h2>
        {activity.loading && <p role="status"><LoaderCircle size={13} className="spinning" /> Consultando fuentes…</p>}
        {!activity.needs.length && <p className="activity-empty">{activity.stale || activity.hasError ? 'Sin necesidades confirmadas con las fuentes disponibles.' : 'No hay necesidades de intervención observadas.'}</p>}
        {activity.needs.map(item => <article className="activity-row" key={item.key}><div><strong>{item.title}</strong><span className="activity-warning">{item.label}</span><small>{item.source}{activity.stale || activity.hasError ? ' · lectura sin confirmar' : ''}</small></div><button onClick={() => navigate(item.target)}>Abrir <ArrowUpRight size={14} /></button></article>)}
        {source('Phantom · tareas', 'tasks')}
        <details><summary>Estados de tareas ({activity.tasks.length})</summary>{activity.tasks.map(t => <article className="activity-row" key={t.id}><div><strong>{t.title || t.id}</strong><span>{t.state.label}{!t.state.known && t.status ? ` · ${t.status}` : ''}</span><small>Phantom · {t.id}</small></div><button onClick={() => navigate({ tab: 'tasks' })}>Ver tarea <ArrowUpRight size={14} /></button></article>)}</details>
      </section>
      <section aria-labelledby="activity-git"><h2 id="activity-git"><GitBranch size={15} />Integración <b>{activity.branches.length} ramas</b><button onClick={() => navigate({ tab: 'git' })}>Abrir Git <ArrowUpRight size={13} /></button></h2>
        <form className="activity-base" onSubmit={e => { e.preventDefault(); if (base.trim() === activity.base) activity.reload(); else activity.setBase(base); }}><label htmlFor="activity-base">Base explícita de comparación</label><div><input id="activity-base" value={base} onChange={e => setBase(e.target.value)} placeholder="p. ej. main u origin/main" maxLength={512} /><button disabled={!activity.connected || activity.loading} type="submit">Comparar</button></div></form>
        <p className="activity-explanation">Base: {activity.base || 'sin elegir'} · {activity.base ? `${activity.pendingBranches} pendientes frente a esta base · ${activity.unknownBranches} desconocidas` : 'integración desconocida hasta elegir una referencia'}. No integrada no implica lista.</p>
        {source('Git · git.inspect', 'git')}
        {!activity.branches.length && !activity.resources.git.loading && <p className="activity-empty">No hay ramas disponibles en esta lectura.</p>}
        {activity.branches.map(b => <article className="activity-row activity-branch" key={b.name}><div><strong>{b.name}{b.current ? ' · actual' : ''}</strong><span>{b.integration === 'integrated' ? 'Integrada' : b.integration === 'pending' ? 'No integrada' : 'Integración desconocida'} · adelante {b.integration === 'unknown' ? '?' : b.ahead ?? '?'} / detrás {b.integration === 'unknown' ? '?' : b.behind ?? '?'}</span>{b.sessions.length ? b.sessions.map(s => <button className="activity-link" key={s.id} disabled={!s.node} onClick={() => navigate(s.node ? { nodeId: s.node.id } : { tab: 'sessions' })}>Sesión vinculada: {s.title}{s.hidden ? ' · oculta' : ''}<ArrowUpRight size={12} /></button>) : <small>Sin sesión vinculada acreditada</small>}</div></article>)}
      </section>
      <section aria-labelledby="activity-sessions"><h2 id="activity-sessions"><TerminalSquare size={15} />Sesiones <b>{activity.sessions.filter(s => !s.descriptorMissing).length}</b></h2>
        {source('Host · terminal.list', 'sessions')}
        {!activity.sessions.length && !activity.resources.sessions.loading && <p className="activity-empty">No hay sesiones ni vistas de terminal registradas.</p>}
        {activity.sessions.map(s => <article className="activity-row" key={s.id}><div><strong>{s.title}{s.hidden ? ' · Vista oculta' : ''}</strong><TerminalActivity session={s} connected={activity.connected} stale={Boolean(activity.resources.sessions.error) || activity.stale} /><small>{s.descriptorMissing ? 'Descriptor de sesión no disponible' : `${s.id} · proveedor: ${s.provider || 'desconocido'}`}</small></div><button onClick={() => navigate(s.node ? { nodeId: s.node.id } : { tab: 'sessions' })}>{s.hidden ? 'Recuperar terminal' : s.node ? 'Ir a terminal' : 'Ver sesiones'}<ArrowUpRight size={14} /></button></article>)}
      </section>
      <section aria-labelledby="activity-notices"><h2 id="activity-notices"><Bell size={15} />Avisos <b>{activity.unread} sin leer</b></h2>
        <p className="activity-explanation">Fuente: atención persistida del host · leído no equivale a aprobado ni resuelto.</p>
        {readError && <p role="alert" className="activity-warning">{readError}</p>}
        {!activity.notices.length && <p className="activity-empty">No hay avisos registrados.</p>}
        {activity.notices.map(item => <article className="activity-row" key={item.id}><div><strong>{item.title}</strong><small>{item.source || 'Host'} · {item.observedAt || item.createdAt || 'fecha desconocida'} · {item.read ? 'Leído' : 'Sin leer'}</small></div><div className="activity-actions">{(item.session?.node || item.task || item.source === 'phantom') && <button onClick={() => navigate(item.session?.node ? { nodeId: item.session.node.id } : { tab: 'tasks' })}>Abrir <ArrowUpRight size={13} /></button>}<button disabled={item.read || !!reading || !activity.connected} onClick={async () => { setReading(item.id); setReadError(''); try { await onRead(item.id); } catch (error) { setReadError(error.message); } finally { setReading(''); } }}>{reading === item.id ? <LoaderCircle size={13} className="spinning" /> : <Check size={13} />}{item.read ? 'Leído' : 'Marcar leído'}</button></div></article>)}
      </section>
    </div>
  </section></>;
}
