import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Bell, Check, ChevronDown, Gauge, GitBranch, LoaderCircle, RefreshCw, TerminalSquare, X } from 'lucide-react';

export function TerminalActivityStatus({ session, compact = false }) {
  return <span className={`terminal-activity-status ${session?.tone || 'unknown'} ${compact ? 'compact' : ''}`} title={`Host · terminal.list${session?.linkedTasks?.length ? ' + Phantom · phantom.list (vínculo explícito)' : ''} · ${session?.label || 'Estado desconocido'}`}><i />{session?.label || 'Estado desconocido'}</span>;
}

export default function ActivityNotch({ activity, open, onToggle, buttonRef }) {
  const errors = Object.values(activity.sources).some(s => s.error);
  const unseen = Object.values(activity.sources).some(s => !s.at);
  const stale = Object.values(activity.sources).some(s => s.at && activity.now - s.at > 45000);
  const uncertain = errors || stale;
  const expanded = filter => open === filter || (open === true && filter === 'all');
  return <div className="activity-strip" role="group" aria-label="Actividad del proyecto">
    <button ref={buttonRef} className={`activity-notch ${activity.needs.length && activity.connected && !uncertain ? 'needs-you' : ''}`} aria-label="Actividad del proyecto" aria-expanded={expanded('needs')} aria-controls="activity-tray" onClick={() => onToggle('needs')}>
      {activity.needs.length || errors ? <AlertCircle size={14} /> : <Activity size={14} />}
      <strong>{!activity.connected ? 'Host desconectado' : uncertain ? 'Actividad sin confirmar' : unseen ? 'Recuperando actividad…' : activity.needs.length ? `${activity.needs.length} ${activity.needs.length === 1 ? 'necesita' : 'necesitan'} de ti` : 'Actividad'}</strong><ChevronDown size={12} />
    </button>
    <button className="activity-summary-action" aria-expanded={expanded('integration')} aria-controls="activity-tray" onClick={() => onToggle('integration')} title="Revisar ramas e incorporaciones"><GitBranch size={14} /><span>{!activity.connected || activity.sources.git.error || !activity.base || stale ? 'Integraciones' : `${activity.pendingBranches} por integrar`}</span></button>
    <button className="activity-summary-action" aria-expanded={expanded('limits')} aria-controls="activity-tray" onClick={() => onToggle('limits')}><Gauge size={14} /><span>Límites</span></button>
    {activity.unread > 0 && <button className="activity-summary-action activity-unread" aria-label={`${activity.unread} avisos sin leer`} aria-expanded={expanded('notices')} aria-controls="activity-tray" onClick={() => onToggle('notices')}><Bell size={13} /><span>{activity.unread}</span></button>}
  </div>;
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

export function ActivityTray({ activity, workspace, filter = 'all', onFilter, onClose, onTerminal, onInspector, onRead }) {
  const root = useRef(null), restore = useRef(true);
  const [draftBase, setDraftBase] = useState(activity.base);
  const [reading, setReading] = useState(''), [readError, setReadError] = useState('');
  const show = section => filter === 'all' || filter === section;
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
    if (item.target === 'tasks' && item.sessions?.some(s => s.nodeId)) return <button onClick={() => navigate('terminal', item.sessions.find(s => s.nodeId).nodeId)}>Ir a sesión</button>;
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
    <nav className="activity-filters" aria-label="Ver actividad">{[['needs', 'Tu atención'], ['integration', 'Integraciones'], ['limits', 'Límites'], ['all', 'Todo']].map(([id, name]) => <button key={id} aria-pressed={filter === id} onClick={() => onFilter(id)}>{name}</button>)}</nav>
    <div className="activity-tray-scroll">
      {!activity.connected && <p className="activity-warning" role="status">Host desconectado. No se puede confirmar el estado actual.</p>}
      {Object.values(activity.sources).some(s => s.error) && <p className="activity-warning" role="status">Fuentes incompletas. Los datos conservados corresponden a la última lectura; su estado actual no está confirmado.</p>}
      {show('needs') && <section aria-labelledby="activity-needs"><h2 id="activity-needs"><AlertCircle size={15} />Necesitan de ti <b>{activity.needs.length}</b></h2>
        {!activity.needs.length && <p className="activity-empty">Ninguna intervención indicada por las fuentes disponibles.</p>}
        {activity.needs.map(item => <article className="activity-row" key={item.key}><div><strong>{item.title || item.id}</strong><span className="activity-warning">{item.label}</span><small>{item.source}{!activity.connected ? ' · sin confirmar' : ''}</small></div>{action(item)}</article>)}
        <Source name="Phantom · phantom.list tasks" source={activity.sources.tasks} activity={activity} />
        <Source name="Host · terminal.list" source={activity.sources.sessions} activity={activity} />
      </section>}
      {show('integration') && <section aria-labelledby="activity-integration"><h2 id="activity-integration"><GitBranch size={15} />Integración <b>{activity.branches.length} ramas</b></h2>
        <button onClick={() => navigate('incorporaciones')}>Revisar incorporaciones</button>
        <button onClick={() => navigate('branches')}>Ordenar ramas y worktrees</button>
        <form className="activity-base" onSubmit={e => { e.preventDefault(); activity.setBase(draftBase.trim()); if (activity.base === draftBase.trim()) activity.retry(); }}><label>Base explícita<input aria-label="Base de integración" value={draftBase} maxLength={512} onChange={e => setDraftBase(e.target.value)} placeholder="p. ej. main" /></label><button disabled={!activity.connected || activity.sources.git.loading}>Comparar</button></form>
        <Source name="Git · git.inspect" source={activity.sources.git} activity={activity} />
        <p className="activity-empty">Base: {activity.sources.git.data?.base || activity.base || 'sin elegir'} · {activity.pendingBranches} no integradas · {activity.unknownBranches} desconocidas. No integrada no implica lista para merge.</p>
        {!activity.branches.length && !activity.sources.git.loading && <p className="activity-empty">Sin ramas disponibles en esta lectura.</p>}
        {activity.branches.map(branch => <article className="activity-row" key={branch.name}><div><strong>{branch.name}{branch.current ? ' · actual' : ''}</strong><span>{branch.label} · adelante {branch.ahead ?? '?'} / detrás {branch.behind ?? '?'}</span>{branch.sessions.map(s => <button className="activity-link" key={s.id} disabled={!s.nodeId} onClick={() => navigate('terminal', s.nodeId)}>Terminal vinculada: {s.title}</button>)}</div><button onClick={() => navigate('git')}>Ir a Git</button></article>)}
      </section>}
      {show('limits') && <section aria-labelledby="activity-limits"><h2 id="activity-limits"><Gauge size={15} />Límites de los proveedores</h2>
        <p className="activity-empty">El host todavía no recibe las cuotas de Claude ni de OpenCode. El consumo restante y la fecha de restablecimiento no están disponibles.</p>
        <p className="activity-empty">Los tokens y costes de cada respuesta, cuando el proveedor los informa, se pueden consultar en su conversación. No equivalen a la cuota restante de tu cuenta.</p>
        <button onClick={() => onFilter('all')}>Ver sesiones</button>
      </section>}
      {show('all') && <section aria-labelledby="activity-sessions"><h2 id="activity-sessions"><TerminalSquare size={15} />Sesiones <b>{activity.sessionCount}{activity.unknownViews > 0 ? ` · ${activity.unknownViews} vistas sin descriptor` : ''}</b></h2>
        <Source name="Host · terminal.list" source={activity.sources.sessions} activity={activity} />
        {!activity.sessions.length && !activity.sources.sessions.loading && <p className="activity-empty">Sin sesiones ni vistas de terminal en este proyecto.</p>}
        {activity.sessions.map(s => <article className="activity-row" key={s.id}><div><strong>{s.title}</strong><TerminalActivityStatus session={s} /><small>{s.hidden ? 'Vista oculta · se recupera al navegar' : 'Vista visible o historial sin panel'} · {s.id}</small>{s.linkedTasks.map(t => <button className="activity-link" key={t.id} onClick={() => navigate('tasks')}>Tarea vinculada: {t.title || t.id}</button>)}</div>{s.nodeId ? <button onClick={() => navigate('terminal', s.nodeId)}>Ir a terminal</button> : <button onClick={() => navigate('sessions')}>Ver historial</button>}</article>)}
      </section>}
      {show('notices') && <section aria-labelledby="activity-notices"><h2 id="activity-notices"><Bell size={15} />Avisos <b>{activity.unread} sin leer</b></h2>
        <p className="activity-empty">Fuente: estado local del proyecto · {activity.workspaceReadAt ? `leído hace ${Math.max(0, Math.floor((activity.now - activity.workspaceReadAt) / 1000))} s` : 'sin lectura confirmada'} · marcar leído no aprueba ni resuelve trabajo.</p>
        {!activity.notices.length && <p className="activity-empty">No hay avisos registrados.</p>}
        {readError && <p role="alert" className="activity-warning">{readError}</p>}
        {activity.notices.map(item => <article className="activity-row" key={item.id}><div><strong>{item.title || item.id}</strong><small>{typeof item.source === 'string' ? item.source : 'Fuente desconocida'} · {item.read ? 'Leído' : 'Sin leer'}</small><div className="activity-actions">{action({ ...item, target: 'notice' })}</div></div><button disabled={item.read || !!reading || !activity.connected} onClick={async () => { setReading(item.id); setReadError(''); try { await onRead(item.id); } catch (e) { setReadError(e.message); } finally { setReading(''); } }}>{reading === item.id ? <LoaderCircle size={13} className="spinning" /> : <Check size={13} />}{item.read ? 'Leído' : 'Marcar leído'}</button></article>)}
      </section>}
    </div><footer className="activity-footer"><span>{workspace.name} · abrir no resuelve pendientes</span><button disabled={!activity.connected || Object.values(activity.sources).some(s => s.loading)} onClick={activity.retry}><RefreshCw size={13} />Actualizar</button></footer>
  </section></>;
}
