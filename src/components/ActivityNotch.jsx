import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Bell, Check, ChevronDown, GitBranch, LoaderCircle, RefreshCw, TerminalSquare, X } from 'lucide-react';

export function TerminalActivity({ session, compact = false }) {
  const label = session?.state?.label || 'Estado desconocido · sin señal';
  return <span className={`terminal-activity ${session?.state?.needsIntervention ? 'needs' : ''} ${compact ? 'compact' : ''}`} title={`${label} · Fuente: ${session?.source || 'terminal.list sin lectura'}`}><i />{label}</span>;
}

function Source({ name, source, clock, connected, retry }) {
  const seconds = source.checkedAt ? Math.max(0, Math.floor((Math.max(clock, Date.now()) - source.checkedAt) / 1000)) : null;
  return <div className="activity-source"><span>{name} · {!connected ? 'desconectada' : source.loading ? 'actualizando…' : source.error ? 'error / no disponible' : seconds === null ? 'sin lectura' : `lectura hace ${seconds} s`}{source.data?.observedAt && <small>Fuente observada: {source.data.observedAt}</small>}</span>{source.loading && <LoaderCircle size={13} className="spinning" />}{source.error && <><p role="alert">{source.error}</p><button disabled={!connected || source.loading} onClick={retry}>Reintentar</button></>}</div>;
}

export default function ActivityNotch({ activity, open, onToggle, onClose, onNavigate, onRead }) {
  const trigger = useRef(null), tray = useRef(null), restore = useRef(true);
  const [baseDraft, setBaseDraft] = useState(activity.base);
  const [reading, setReading] = useState(''), [readError, setReadError] = useState('');
  useEffect(() => { setBaseDraft(activity.base); }, [activity.base]);
  useEffect(() => {
    if (!open) return;
    restore.current = true;
    const previous = document.activeElement;
    tray.current?.querySelector('button')?.focus();
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(tray.current?.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]') || [])];
      const first = controls[0], last = controls.at(-1);
      if (!tray.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (restore.current) (previous?.isConnected ? previous : trigger.current)?.focus(); };
  }, [open, onClose]);
  const navigate = (target, nodeId) => { restore.current = false; onNavigate(target, nodeId); };
  const read = async item => {
    setReading(item.id); setReadError('');
    try { await onRead(item); } catch (error) { setReadError(error.message); } finally { setReading(''); }
  };
  const loading = Object.values(activity.sources).some(s => s.loading);
  const uncertain = !activity.connected || Object.values(activity.sources).some(s => s.error || !s.checkedAt);
  return <>
    <div className="activity-notch-host"><button ref={trigger} className={`activity-notch ${activity.needs.length ? 'needs' : ''}`} aria-label="Actividad del proyecto" aria-expanded={open} aria-controls="activity-tray" onClick={onToggle}>
      {loading ? <LoaderCircle size={15} className="spinning" /> : activity.needs.length ? <AlertCircle size={15} /> : <Activity size={15} />}
      <strong>{activity.needs.length ? `${activity.needs.length} necesitan de ti` : uncertain ? 'Actividad · señal incompleta' : 'Sin intervención señalada'}</strong>
      <span><TerminalSquare size={13} />{activity.sessions.length} sesiones</span><span><GitBranch size={13} />{activity.branches.length} ramas · {activity.base ? `${activity.pendingBranches} pendientes` : 'sin base'}</span>
      {activity.unread > 0 && <span><Bell size={13} />{activity.unread} sin leer</span>}<span className="activity-link-state">{activity.connected ? 'Host conectado' : 'Host desconectado'}</span><ChevronDown size={14} />
    </button></div>
    {open && <><button className="popover-dismiss top-dismiss" aria-label="Cerrar actividad" onClick={onClose} /><section ref={tray} id="activity-tray" className="activity-tray" role="dialog" aria-modal="true" aria-labelledby="activity-title">
      <div className="popover-heading"><strong id="activity-title">Actividad del proyecto</strong><button className="icon-button" disabled={!activity.connected || loading} aria-label="Actualizar actividad" onClick={activity.refresh}><RefreshCw size={15} className={loading ? 'spinning' : ''} /></button><button className="icon-button" aria-label="Cerrar bandeja de actividad" onClick={onClose}><X size={16} /></button></div>
      <div className="activity-scroll">
        {!activity.connected && <p className="activity-warning" role="status">Host desconectado. No hay una lectura vigente; recupera la conexión para actualizar.</p>}
        <section aria-labelledby="activity-needs"><h2 id="activity-needs"><AlertCircle size={15} />Necesitan de ti <b>{activity.needs.length}</b></h2>
          {!activity.needs.length && <p className="activity-empty">{uncertain ? 'No se puede confirmar si hay intervención pendiente. Revisa las fuentes.' : 'Las fuentes consultadas no señalan intervención. Un shell conectado no acredita trabajo del agente.'}</p>}
          {activity.needs.map(item => <div className="activity-row" key={item.key}><div><strong>{item.title || item.id}</strong><small className="activity-warning">{item.state.label}</small><small>{item.source}</small></div><button onClick={() => navigate(item.target, item.nodeId)}>Abrir {item.target === 'terminal' ? 'terminal' : item.target === 'sessions' ? 'sesiones' : 'tareas'}</button></div>)}
        </section>
        <section aria-labelledby="activity-git"><h2 id="activity-git"><GitBranch size={15} />Integración <b>{activity.branches.length} ramas</b><button onClick={() => navigate('git')}>Abrir Git</button></h2>
          <form className="activity-base" onSubmit={e => { e.preventDefault(); activity.setBase(baseDraft.trim()); }}><label htmlFor="activity-base">Base de comparación explícita</label><div><input id="activity-base" placeholder="Rama o commit de base" value={baseDraft} onChange={e => setBaseDraft(e.target.value)} maxLength={512} /><button disabled={!activity.connected || loading}>Comparar</button></div></form>
          <p className="activity-empty">{activity.base ? `Base: ${activity.base} · ${activity.pendingBranches} pendientes · ${activity.unknownBranches} desconocidas` : 'Sin base elegida: integración y pendientes desconocidos.'}</p>
          {activity.branches.map(branch => <div className="activity-row" key={branch.name}><div><strong>{branch.name}{branch.current ? ' · actual' : ''}</strong><small className={branch.integration === 'No integrada' ? 'activity-warning' : ''}>{branch.integration}{branch.compared ? ` · ahead ${branch.ahead} / behind ${branch.behind}` : ' · ahead/behind desconocidos'}</small>{!branch.sessions.length && !branch.tasks.length && <small>Sin asociación acreditada a sesión o tarea</small>}{branch.sessions.map(s => <button className="activity-inline" key={s.id} onClick={() => navigate(s.nodeId ? 'terminal' : 'sessions', s.nodeId)}>Sesión: {s.title}</button>)}{branch.tasks.map(t => <button className="activity-inline" key={t.id} onClick={() => navigate('tasks')}>Tarea: {t.title}</button>)}</div></div>)}
          {!activity.branches.length && !activity.sources.git.loading && !activity.sources.git.error && <p className="activity-empty">No hay ramas locales en la lectura.</p>}
          <Source name="git.inspect" source={activity.sources.git} {...activity} retry={activity.refresh} />
        </section>
        <section aria-labelledby="activity-sessions"><h2 id="activity-sessions"><TerminalSquare size={15} />Sesiones <b>{activity.sessions.length} · incluidas ocultas</b></h2>
          {activity.sessions.map(s => <div className="activity-row" key={s.id}><div><strong>{s.title}{s.hidden ? ' · Vista oculta' : ''}</strong><TerminalActivity session={s} /><small>{s.source}{s.cwd ? ` · ${s.cwd}` : ''}</small></div><button onClick={() => navigate(s.nodeId ? 'terminal' : 'sessions', s.nodeId)}>{s.hidden ? 'Recuperar terminal' : s.nodeId ? 'Abrir terminal' : 'Ver sesión'}</button></div>)}
          {!activity.sessions.length && !activity.sources.sessions.loading && <p className="activity-empty">Sin sesiones observadas en este proyecto.</p>}
          <Source name="terminal.list" source={activity.sources.sessions} {...activity} retry={activity.refresh} />
          <Source name="phantom.list · tasks" source={activity.sources.tasks} {...activity} retry={activity.refresh} />
          <p className="activity-empty">{activity.tasks.length} tareas consultadas. El estado de un proceso no acredita aceptación de su tarea.</p>
        </section>
        <section aria-labelledby="activity-notices"><h2 id="activity-notices"><Bell size={15} />Avisos <b>{activity.unread} sin leer</b></h2><p className="activity-empty">Marcar leído solo confirma lectura del aviso; no aprueba ni resuelve trabajo.</p>
          {readError && <p role="alert" className="activity-warning">{readError}</p>}
          {activity.notices.map(item => <div className="activity-row" key={item.id}><div><strong>{item.title}</strong><small>{item.source} · {item.read ? 'Leído' : 'Sin leer'} · {item.observedAt || item.createdAt || 'Fecha desconocida'}</small><button className="activity-inline" onClick={() => navigate(item.nodeId ? 'terminal' : item.sessionId ? 'sessions' : 'tasks', item.nodeId)}>Abrir origen</button></div><button disabled={item.read || !!reading || !activity.connected} onClick={() => read(item)}>{reading === item.id ? <LoaderCircle size={13} className="spinning" /> : <Check size={13} />}{item.read ? 'Leído' : 'Marcar leído'}</button></div>)}
          {!activity.notices.length && <p className="activity-empty">No hay avisos en el estado del proyecto.</p>}<small className="activity-empty">Fuente: atención del host · instantánea del proyecto, actualizada por eventos.</small>
        </section>
      </div>
    </section></>}
  </>;
}
