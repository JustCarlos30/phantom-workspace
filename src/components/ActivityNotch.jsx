import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, AlertCircle, ArrowUpRight, Bell, Check, ChevronDown, GitBranch, LoaderCircle, RefreshCw, TerminalSquare, X } from 'lucide-react';
import { api } from '../hooks/useWorkspace';

export function TerminalActivity({ value, compact = false }) {
  const label = value?.label || 'Estado desconocido';
  const freshness = value?.observedAt ? ` · Recibido: ${new Date(value.observedAt).toLocaleTimeString('es')}` : ' · Frescura desconocida';
  return <span className={`terminal-activity ${value?.unconfirmed ? 'warning' : value?.tone || 'neutral'} ${compact ? 'compact' : ''}`} title={`${label} · Fuente: terminal.list${value?.tasks?.length ? ' + phantom.list (vínculo explícito)' : ''}${freshness}`}><i aria-hidden="true" /><span>{label}{value?.unconfirmed ? ' · sin confirmar' : ''}</span></span>;
}

const sourceNames = { sessions: 'Host · terminal.list', tasks: 'Phantom · phantom.list', git: 'Git · git.inspect', notices: 'Host · attention.list' };
function Source({ name, resource = {}, now, connected }) {
  const age = resource.updatedAt ? Math.max(0, Math.floor((now - resource.updatedAt) / 1000)) : null;
  return <div className={`activity-source ${resource.error || !connected || age > 45 ? 'warning' : ''}`}>
    <span>{sourceNames[name]} · {!connected ? 'desconectado · datos retenidos' : resource.loading ? 'actualizando…' : resource.error ? 'lectura fallida' : age === null ? 'sin lectura' : age > 45 ? 'datos antiguos' : 'observado'}</span>
    <small>{resource.updatedAt ? `Recibido ${new Date(resource.updatedAt).toLocaleTimeString('es')} · hace ${age} s` : 'Frescura desconocida'}{resource.data?.observedAt ? ` · Observación fuente: ${resource.data.observedAt}` : ''}</small>
    {resource.error && <p role="status">{resource.error}</p>}
  </div>;
}
function Empty({ children }) { return <p className="activity-empty">{children}</p>; }

export default function ActivityNotch({ activity, workspace, open, onToggle, onClose, onNavigate, refreshWorkspace }) {
  const trigger = useRef(null), dialog = useRef(null), returnTo = useRef(null), navigating = useRef(false);
  const [baseDraft, setBaseDraft] = useState(activity.base);
  const [ack, setAck] = useState({ busy: '', error: '' });
  useEffect(() => { setBaseDraft(activity.base); setAck({ busy: '', error: '' }); }, [workspace.id, activity.base]);
  useEffect(() => {
    if (!open) return;
    navigating.current = false;
    returnTo.current = document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select') || [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      if (!navigating.current) {
        const target = returnTo.current?.isConnected ? returnTo.current : trigger.current;
        requestAnimationFrame(() => {
          const active = document.activeElement;
          if (!active || active === document.body || active === target || active === trigger.current) target?.focus();
        });
      }
    };
  }, [open, onClose]);
  const navigate = action => { navigating.current = true; onNavigate(action); };
  const read = async item => {
    const workspaceId = workspace.id;
    setAck({ busy: item.id, error: '' });
    try { await api('attention.ack', { workspaceId, id: item.id }); await refreshWorkspace(); activity.refresh(); setAck({ busy: '', error: '' }); }
    catch (error) { setAck({ busy: '', error: error.message }); }
  };
  const source = name => <Source name={name} resource={activity.sources[name]} now={activity.now} connected={activity.connected} />;
  const git = activity.sources.git.data;
  const unknown = activity.unknownBranches;
  const sessionCount = activity.sources.sessions.data ? activity.sessions.filter(row => row.session).length : null;
  return <div className="activity-strip">
    <button ref={trigger} className={`activity-notch ${activity.needs.length ? 'needs-attention' : ''}`} aria-label="Actividad del proyecto" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'activity-tray' : undefined} onClick={onToggle}>
      {activity.loading ? <LoaderCircle size={15} className="spinning" /> : activity.needs.length ? <AlertCircle size={15} /> : <Activity size={15} />}
      <strong>{activity.needs.length ? `${activity.needs.length} ${activity.needs.length === 1 ? 'necesita' : 'necesitan'} de ti` : 'Actividad'}</strong>
      <span className="notch-count"><TerminalSquare size={13} />{sessionCount ?? '—'} <span>sesiones</span></span>
      <span className="notch-count"><GitBranch size={13} />{git?.available ? activity.branches.length : '—'} <span>ramas</span></span>
      <small>{!activity.connected ? 'Host desconectado' : activity.degraded ? 'Fuentes por revisar' : 'Fuentes actualizadas'}</small><ChevronDown size={13} />
    </button>
    {open && createPortal(<div className="activity-overlay">
      <button className="activity-dismiss" aria-label="Cerrar bandeja de actividad" onClick={onClose} />
      <section ref={dialog} id="activity-tray" className="activity-tray" role="dialog" aria-modal="true" aria-labelledby="activity-title">
        <header className="activity-heading"><div><h2 id="activity-title">Actividad del proyecto</h2><small>{workspace.name} · actualización cada 20 s</small></div><button className="icon-button" aria-label="Cerrar actividad" onClick={onClose}><X size={17} /></button></header>
        <div className="activity-toolbar"><span role="status">{!activity.connected ? 'Host desconectado · no se confirma el estado actual' : activity.loading ? 'Consultando fuentes…' : activity.degraded ? 'Hay fuentes sin confirmar' : 'Conectado al host local'}</span><button disabled={!activity.connected || activity.loading} onClick={activity.refresh}><RefreshCw size={13} /> Reintentar / actualizar</button></div>
        <div className="activity-scroll">
          <section className="activity-section" aria-labelledby="activity-needs"><h3 id="activity-needs"><AlertCircle size={15} /> Necesitan de ti <b>{activity.needs.length}</b></h3>
            {activity.needs.length ? activity.needs.map(item => <article className="activity-row" key={item.key}><div><strong>{item.title}</strong><span className={`activity-semantic ${item.tone}`}>{item.label}</span><small>{item.source}</small></div><button onClick={() => navigate(item.action)} aria-label={`Revisar ${item.title}`}><ArrowUpRight size={14} /> Revisar</button></article>) : <Empty>{activity.loading ? 'Consultando necesidades de intervención…' : activity.degraded || !activity.connected ? 'No hay necesidades confirmadas en los datos disponibles. Revisa las fuentes.' : 'Sin necesidades explícitas de intervención en las fuentes consultadas.'}</Empty>}
            <p className="activity-hint">Leer un aviso no aprueba ni resuelve el trabajo. Una salida de proceso no acredita aceptación.</p>
          </section>
          <section className="activity-section" aria-labelledby="activity-integration"><h3 id="activity-integration"><GitBranch size={15} /> Integración</h3>
            {source('git')}
            <form className="activity-base" onSubmit={e => { e.preventDefault(); activity.setBase(baseDraft); if (baseDraft.trim() === activity.base) activity.refresh(); }}><label htmlFor="activity-base">Base explícita de comparación</label><div><input id="activity-base" value={baseDraft} onChange={e => setBaseDraft(e.target.value)} placeholder="p. ej. main u origin/main" maxLength={512} /><button disabled={!activity.connected || activity.loading} type="submit">Comparar</button></div></form>
            <p className="activity-hint">Base: <strong>{git?.base || activity.base || 'sin elegir'}</strong>{git?.comparison?.baseOid && <span title={git.comparison.baseOid}> · {git.comparison.baseOid.slice(0, 10)}</span>}. Sin base válida, la integración es desconocida.</p>
            <div className="activity-totals"><span>{git?.available ? activity.branches.length : '—'} ramas totales</span><span>{git?.comparison ? activity.pendingBranches : '—'} pendientes frente a base</span><span>{unknown} desconocidas</span></div>
            {!activity.branches.length && <Empty>{activity.sources.git.loading ? 'Leyendo radar Git…' : git?.available ? 'No hay ramas locales.' : 'Radar Git sin datos disponibles.'}</Empty>}
            {activity.branches.map(branch => <article className="activity-branch" key={branch.name}><div className="activity-branch-heading"><strong>{branch.name}{branch.current ? ' · actual' : ''}</strong><span className={`activity-semantic ${branch.integration === 'pending' ? 'warning' : branch.integration === 'integrated' ? 'success' : 'neutral'}`}>{branch.integration === 'integrated' ? 'Integrada' : branch.integration === 'pending' ? 'No integrada' : 'Desconocida'}</span></div><small>Ahead {branch.integration === 'unknown' ? '?' : branch.ahead ?? '?'} / behind {branch.integration === 'unknown' ? '?' : branch.behind ?? '?'}</small>
              {branch.links.sessions.map(session => { const row = activity.sessions.find(s => s.session?.id === session.id); return <button className="activity-link" key={session.id} onClick={() => navigate(row?.node ? { nodeId: row.node.id } : { tab: 'sessions' })}><TerminalSquare size={12} />{row?.title || session.id} · vínculo worktree<ArrowUpRight size={12} /></button>; })}
              {branch.links.tasks.map(task => <button className="activity-link" key={task.id} onClick={() => navigate({ tab: 'tasks', taskId: task.id })}>{task.title || task.id} · carpeta del contrato<ArrowUpRight size={12} /></button>)}
              {!branch.links.sessions.length && !branch.links.tasks.length && <small>Sin asociación de sesión o tarea acreditada</small>}
            </article>)}
            <button className="activity-link" onClick={() => navigate({ tab: 'git' })}>Abrir Git <ArrowUpRight size={13} /></button>
          </section>
          <section className="activity-section" aria-labelledby="activity-sessions"><h3 id="activity-sessions"><TerminalSquare size={15} /> Sesiones <b>{activity.sessions.length}</b></h3>{source('sessions')}{source('tasks')}
            {!activity.sessions.length && <Empty>{activity.sources.sessions.loading ? 'Recuperando sesiones…' : 'No hay sesiones registradas en este proyecto.'}</Empty>}
            {activity.sessions.map(row => <article className="activity-row" key={row.id}><div><strong>{row.title}</strong><TerminalActivity value={row} /><small>{row.hidden ? 'Vista oculta · se recupera al abrir' : row.node ? 'Vista en canvas' : 'Sin vista asociada'} · {row.session?.provider || 'Proveedor desconocido'}</small><small>{row.session?.cwd || 'Carpeta de sesión desconocida'}</small></div><button onClick={() => navigate(row.node ? { nodeId: row.node.id } : { tab: 'sessions' })}>{row.hidden ? 'Recuperar terminal' : row.node ? 'Ir a terminal' : 'Ver sesiones'}<ArrowUpRight size={13} /></button></article>)}
          </section>
          <section className="activity-section" aria-labelledby="activity-notices"><h3 id="activity-notices"><Bell size={15} /> Avisos <b>{activity.notices.filter(n => !n.read).length} sin leer</b></h3>{source('notices')}
            {ack.error && <p className="activity-error" role="alert">{ack.error} · Reintenta marcar leído.</p>}
            {!activity.notices.length && <Empty>{activity.sources.notices.loading ? 'Leyendo avisos…' : 'Sin avisos registrados.'}</Empty>}
            {activity.notices.map(item => <article className="activity-row" key={item.id}><div><strong>{item.title}</strong><small>{typeof item.source === 'string' ? item.source : 'Fuente desconocida'} · {item.read ? 'Leído' : 'Sin leer'} · {item.observedAt || item.createdAt || 'Fecha desconocida'}</small>{item.intervention && <span className={`activity-semantic ${item.tone}`}>{item.label}</span>}</div><div className="activity-row-actions"><button onClick={() => navigate(item.action)}>Abrir<ArrowUpRight size={13} /></button><button disabled={item.read || !!ack.busy || !activity.connected} onClick={() => read(item)}>{ack.busy === item.id ? <LoaderCircle className="spinning" size={13} /> : <Check size={13} />}{item.read ? 'Leído' : 'Marcar leído'}</button></div></article>)}
          </section>
        </div>
      </section>
    </div>, document.body)}
  </div>;
}
