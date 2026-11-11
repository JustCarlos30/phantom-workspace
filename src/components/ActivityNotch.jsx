import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Bell, Check, ChevronDown, GitBranch, LoaderCircle, RefreshCw, TerminalSquare, X } from 'lucide-react';

export function TerminalActivityStatus({ session, compact = false }) {
  return <span className={`terminal-activity-status ${session?.tone || 'unknown'} ${compact ? 'compact' : ''}`} title={`Host · terminal.list${session?.linkedTasks?.length ? ' + Phantom · phantom.list (vínculo explícito)' : ''} · ${session?.label || 'Estado desconocido'}`}><i />{session?.label || 'Estado desconocido'}</span>;
}

export default function ActivityNotch({ activity, open, onToggle, buttonRef }) {
  const loading = Object.values(activity.sources).some(s => s.loading);
  const errors = Object.values(activity.sources).some(s => s.error);
  const unseen = Object.values(activity.sources).some(s => !s.at);
  const oldest = Math.min(...Object.values(activity.sources).map(s => s.at || activity.now));
  const age = Math.max(0, Math.floor((activity.now - oldest) / 1000));
  return <div className="activity-strip"><button ref={buttonRef} className={`activity-notch ${activity.needs.length ? 'needs-you' : ''}`} aria-label="Actividad del proyecto" aria-expanded={open} aria-controls="activity-tray" onClick={onToggle}>
    {loading ? <LoaderCircle size={14} className="spinning" /> : activity.needs.length || errors ? <AlertCircle size={14} /> : <Activity size={14} />}
    <strong>{!activity.connected ? 'Host desconectado' : activity.needs.length ? `${activity.needs.length} ${activity.needs.length === 1 ? 'necesita' : 'necesitan'} de ti` : errors ? 'Revisar fuentes' : unseen ? 'Recuperando actividad…' : 'Sin intervención declarada'}</strong>
    <span><TerminalSquare size={13} />{activity.sessionCount} sesiones{activity.unknownViews > 0 ? ` · ${activity.unknownViews} vistas sin descriptor` : ''}</span><span><GitBranch size={13} />{activity.branches.length} ramas</span>
    <span className="notch-detail">{activity.base ? `${activity.pendingBranches} no integradas · ${activity.base}` : 'Base sin elegir'}</span>
    <span className="notch-freshness">{unseen ? 'Fuentes sin confirmar' : `Fuentes · hace ${age} s${age > 45 ? ' · sin confirmar' : ''}`}</span>
    {activity.unread > 0 && <span><Bell size={12} />{activity.unread}</span>}<ChevronDown size={13} />
  </button></div>;
}

function Source({ name, source, activity }) {
  const age = source.at ? Math.max(0, Math.floor((activity.now - source.at) / 1000)) : null;
  return <div className={`activity-source ${source.error ? 'source-error' : ''}`}>
    <span>{name} · {!activity.connected ? 'desconectada' : source.loading ? 'actualizando…' : source.error ? 'lectura fallida' : 'conectada'} · {age == null ? 'sin lectura confirmada' : `leída hace ${age} s${age > 45 || source.error ? ' · sin confirmar' : ''}`}</span>
    {source.data?.observedAt && <small>Observada: {source.data.observedAt}</small>}
    {source.error && <span role="alert">{source.error}</span>}
    {source.error && <button disabled={!activity.connected || source.loading} onClick={activity.retry}><RefreshCw size={12} />Reintentar fuente</button>}
  </div>;
}

export function ActivityTray({ activity, workspace, onClose, onTerminal, onInspector, onRead }) {
  const root = useRef(null), restore = useRef(true);
  const [draftBase, setDraftBase] = useState(activity.base);
  const [reading, setReading] = useState(''), [readError, setReadError] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.querySelector('button')?.focus();
    return () => { if (restore.current && previous?.isConnected) previous.focus(); };
  }, []);
  const navigate = (target, id) => { restore.current = false; onClose(); if (target === 'terminal') onTerminal(id); else onInspector(target); };
  const noticeTarget = item => {
    const ref = item.ref;
    const node = workspace.nodes?.find(n => n.type === 'terminal' && (n.id === item.nodeId || n.data?.sessionId === item.sessionId || (ref?.kind === 'terminal' && ref.id === n.id) || (ref?.kind === 'session' && ref.id === n.data?.sessionId)));
    if (node) return { target: 'terminal', id: node.id, label: 'Ir a terminal' };
    if (item.taskId || ref?.kind === 'card' || ref?.kind === 'task') return { target: 'tasks', label: 'Ir a tareas' };
    if (ref?.kind === 'branch' || ref?.kind === 'git') return { target: 'git', label: 'Ir a Git' };
    return null;
  };
  const action = item => {
    if (item.target === 'tasks') return <button onClick={() => navigate('tasks')}>Ir a tareas</button>;
    if (item.target === 'terminal') return item.nodeId ? <button onClick={() => navigate('terminal', item.nodeId)}>Ir a terminal</button> : <button onClick={() => navigate('sessions')}>Ver sesión</button>;
    const target = noticeTarget(item);
    return target ? <button onClick={() => navigate(target.target, target.id)}>{target.label}</button> : <button onClick={() => navigate('tasks')}>Ver avisos en tareas</button>;
  };
  const keydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    if (e.key !== 'Tab') return;
    const controls = [...root.current.querySelectorAll('button:not(:disabled),input')];
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  return <><button className="popover-dismiss top-dismiss" aria-label="Cerrar actividad" onClick={onClose} /><section ref={root} id="activity-tray" className="activity-tray" role="dialog" aria-modal="true" aria-label="Actividad del proyecto" onKeyDown={keydown}>
    <div className="popover-heading"><strong>Actividad del proyecto</strong><button className="icon-button" aria-label="Cerrar bandeja de actividad" onClick={onClose}><X size={16} /></button></div>
    <div className="activity-tray-scroll">
      {!activity.connected && <p className="activity-warning" role="status">Host desconectado. No se puede confirmar el estado actual.</p>}
      {Object.values(activity.sources).some(s => s.error) && <p className="activity-warning" role="status">Fuentes incompletas. Los datos conservados corresponden a la última lectura; su estado actual no está confirmado.</p>}
      <section aria-labelledby="activity-needs"><h2 id="activity-needs"><AlertCircle size={15} />Necesitan de ti <b>{activity.needs.length}</b></h2>
        {!activity.needs.length && <p className="activity-empty">Sin necesidades de intervención declaradas en las fuentes disponibles. No confirma que todo esté resuelto.</p>}
        {activity.needs.map(item => <article className="activity-row" key={item.key}><div><strong>{item.title || item.id}</strong><span className="activity-warning">{item.label}</span><small>{item.source}{!activity.connected ? ' · sin confirmar' : ''}</small></div>{action(item)}</article>)}
      </section>
      <section aria-labelledby="activity-integration"><h2 id="activity-integration"><GitBranch size={15} />Integración <b>{activity.branches.length} ramas</b></h2>
        <form className="activity-base" onSubmit={e => { e.preventDefault(); activity.setBase(draftBase.trim()); if (activity.base === draftBase.trim()) activity.retry(); }}><label>Base explícita<input aria-label="Base de integración" value={draftBase} maxLength={512} onChange={e => setDraftBase(e.target.value)} placeholder="p. ej. main" /></label><button disabled={!activity.connected || activity.sources.git.loading}>Comparar</button></form>
        <Source name="Git · git.inspect" source={activity.sources.git} activity={activity} />
        <p className="activity-empty">Base: {activity.sources.git.data?.base || activity.base || 'sin elegir'} · {activity.pendingBranches} no integradas · {activity.unknownBranches} desconocidas. No integrada no implica lista para merge.</p>
        {!activity.branches.length && !activity.sources.git.loading && <p className="activity-empty">Sin ramas disponibles en esta lectura.</p>}
        {activity.branches.map(branch => <article className="activity-row" key={branch.name}><div><strong>{branch.name}{branch.current ? ' · actual' : ''}</strong><span>{branch.label} · adelante {branch.ahead ?? '?'} / detrás {branch.behind ?? '?'}</span>{branch.sessions.map(s => <button className="activity-link" key={s.id} disabled={!s.nodeId} onClick={() => navigate('terminal', s.nodeId)}>Terminal vinculada: {s.title}</button>)}</div><button onClick={() => navigate('git')}>Ir a Git</button></article>)}
      </section>
      <section aria-labelledby="activity-sessions"><h2 id="activity-sessions"><TerminalSquare size={15} />Sesiones <b>{activity.sessionCount}{activity.unknownViews > 0 ? ` · ${activity.unknownViews} vistas sin descriptor` : ''}</b></h2>
        <Source name="Host · terminal.list" source={activity.sources.sessions} activity={activity} />
        {!activity.sessions.length && !activity.sources.sessions.loading && <p className="activity-empty">Sin sesiones ni vistas de terminal en este proyecto.</p>}
        {activity.sessions.map(s => <article className="activity-row" key={s.id}><div><strong>{s.title}</strong><TerminalActivityStatus session={s} /><small>{s.hidden ? 'Vista oculta · se recupera al navegar' : 'Vista visible o historial sin panel'} · {s.id}</small>{s.linkedTasks.map(t => <button className="activity-link" key={t.id} onClick={() => navigate('tasks')}>Tarea vinculada: {t.title || t.id}</button>)}</div>{s.nodeId ? <button onClick={() => navigate('terminal', s.nodeId)}>Ir a terminal</button> : <button onClick={() => navigate('sessions')}>Ver historial</button>}</article>)}
        <Source name="Phantom · phantom.list tasks" source={activity.sources.tasks} activity={activity} />
      </section>
      <section aria-labelledby="activity-notices"><h2 id="activity-notices"><Bell size={15} />Avisos <b>{activity.unread} sin leer</b></h2>
        <p className="activity-empty">Fuente: estado local del proyecto · {activity.workspaceReadAt ? `leído hace ${Math.max(0, Math.floor((activity.now - activity.workspaceReadAt) / 1000))} s` : 'sin lectura confirmada'} · marcar leído no aprueba ni resuelve trabajo.</p>
        {!activity.notices.length && <p className="activity-empty">No hay avisos registrados.</p>}
        {readError && <p role="alert" className="activity-warning">{readError}</p>}
        {activity.notices.map(item => <article className="activity-row" key={item.id}><div><strong>{item.title || item.id}</strong><small>{typeof item.source === 'string' ? item.source : 'Fuente desconocida'} · {item.read ? 'Leído' : 'Sin leer'}</small><div className="activity-actions">{action({ ...item, target: 'notice' })}</div></div><button disabled={item.read || !!reading || !activity.connected} onClick={async () => { setReading(item.id); setReadError(''); try { await onRead(item.id); } catch (e) { setReadError(e.message); } finally { setReading(''); } }}>{reading === item.id ? <LoaderCircle size={13} className="spinning" /> : <Check size={13} />}{item.read ? 'Leído' : 'Marcar leído'}</button></article>)}
      </section>
    </div><footer className="activity-footer"><span>Lectura de fuentes · sin acciones de aprobación ni merge</span><button disabled={!activity.connected || Object.values(activity.sources).some(s => s.loading)} onClick={activity.retry}><RefreshCw size={13} />Actualizar</button></footer>
  </section></>;
}
