import React, { useEffect, useRef, useState } from 'react';
import { Ban, Bell, Check, CheckCircle2, CircleDot, Clock, GitBranch, GitMerge, Hand, LoaderCircle, MessageCircleQuestion, OctagonAlert, Save, ShieldAlert, TriangleAlert, X, XCircle } from 'lucide-react';
import { PhantomFace } from './Glyphs.jsx';
import EmptyState from './EmptyState.jsx';
import { ago, freshness } from '../hooks/activityModel.mjs';

export function TerminalActivityStatus({ session, compact = false }) {
  const label = session?.label || 'Sin datos';
  return <span className={`terminal-activity-status ${session?.tone || 'unknown'} ${compact ? 'compact' : ''}`} title={label}><i />{label}</span>;
}

export function activityMood(activity) {
  const fresh = freshness(activity);
  const working = activity.inProgress.some(item => item.tone === 'working') || activity.activeSessions.length
    || activity.integrations.active.some(item => ['merging', 'working', 'running', 'verifying', 'recovering'].includes(item.status));
  return fresh.state === 'offline' ? 'asleep' : fresh.state !== 'fresh' ? 'unsure' : activity.needs.length ? 'grin' : working ? 'working' : 'calm';
}

const WORKING = ['merging', 'working', 'running', 'verifying', 'recovering'];
const STALE = 'Algunos datos pueden estar desactualizados';
// How many are working right now. `current` is the model's own list; the
// fallback reads the older fields so a bare fixture still renders.
const workingCount = activity => activity.current ? activity.current.filter(row => row.tone === 'working').length
  : activity.inProgress.filter(item => item.tone === 'working').length + activity.activeSessions.length + activity.integrations.active.filter(item => WORKING.includes(item.status)).length;

// One control: what is waiting on you, or that nothing is.
export default function ActivityNotch({ activity, open, onToggle, buttonRef }) {
  const fresh = freshness(activity);
  const count = activity.needs.length, working = workingCount(activity);
  const status = fresh.state === 'offline' ? 'Sin conexión' : fresh.state === 'loading' && !count ? 'Cargando…' : count ? 'Te necesitan' : working ? `${working} en curso` : 'Todo en orden';
  const shown = count > 0 && fresh.state !== 'offline';
  return <div className="activity-strip" role="group" aria-label="Te necesitan">
    <button ref={buttonRef} className={`activity-notch ${shown ? 'needs-you' : ''}`} aria-label={shown ? `Te necesitan, ${count} ${count === 1 ? 'pendiente' : 'pendientes'}` : status} aria-expanded={!!open} aria-controls="activity-tray" onClick={() => onToggle('needs')}>
      <PhantomFace mood={activityMood(activity)} /><CircleDot className="notch-state-fallback" size={14} aria-hidden="true" />
      <strong>{status}</strong>
      {shown && <b className="notch-count">{count}</b>}
      {fresh.failing.length > 0 && <i className="notch-dot" role="img" aria-label={STALE} title={STALE} />}
    </button>
  </div>;
}

// Why a row is here: its glyph and its ink.
const NEED = {
  permission: [ShieldAlert, 'attention'], approval: [Hand, 'attention'], question: [MessageCircleQuestion, 'attention'], input: [MessageCircleQuestion, 'attention'],
  turn: [MessageCircleQuestion, 'attention'], blocked: [OctagonAlert, 'attention'], conflict: [TriangleAlert, 'danger'], checks: [XCircle, 'danger'],
  failed: [XCircle, 'danger'], returned: [TriangleAlert, 'danger'], lost: [XCircle, 'danger'],
  ready: [GitBranch, 'muted'], unsaved: [Save, 'muted'], queue: [GitMerge, 'muted'],
  working: [CircleDot, 'working'], waiting: [Clock, 'muted'], done: [CheckCircle2, 'success'], cancelled: [Ban, 'muted'], unread: [Bell, 'attention'], read: [Bell, 'muted'],
};
function Row({ kind, title, code, meta = [], children }) {
  const [Icon, ink] = NEED[kind] || NEED.blocked;
  return <li className="activity-item" data-ink={ink}>
    <span className="activity-item-icon" aria-hidden="true"><Icon size={16} /></span>
    <div className="activity-item-main">
      <strong className="activity-item-title" title={title}>{title}{code && <> <code title={code}>{code}</code></>}</strong>
      {meta.some(Boolean) && <p className="activity-item-meta">{meta.filter(Boolean).map((part, index) => <span key={index}>{part}</span>)}</p>}
    </div>
    {children && <div className="activity-actions">{children}</div>}
  </li>;
}
function Group({ id, title, children }) {
  return <section aria-labelledby={id}><h2 id={id}>{title}</h2><ul className="activity-list">{children}</ul></section>;
}

const limitLevel = percent => percent >= 90 ? 'full' : percent >= 70 ? 'high' : 'ok';
const clock = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function Plan({ limits }) {
  const providers = (limits?.providers || []).filter(provider => provider.available !== false && provider.windows?.length);
  return <aside className="activity-plan" aria-labelledby="activity-plan-title">
    <h2 id="activity-plan-title">Tu plan</h2>
    {!providers.length && <p className="activity-copy">Sin datos</p>}
    {providers.flatMap(provider => provider.windows.map(window => <div key={`${provider.id}:${window.id}`} className={`activity-limit-row limit-${limitLevel(window.percent)}`}>
      <div className="activity-limit-line"><span>{provider.label} <small>{window.label}</small></span><b>{Math.round(window.percent)} %</b></div>
      <div className="activity-limit-bar" role="meter" aria-label={`${provider.label} · ${window.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(window.percent)}><i style={{ width: `${Math.max(1, Math.min(100, window.percent))}%` }} /></div>
    </div>))}
  </aside>;
}

const VIEWS = ['needs', 'progress', 'today'];
export function ActivityTray({ activity, workspace, api, notify, filter = 'needs', onFilter, onClose, onTerminal, onInspector, onPanel, onCard, onRead, onOrchestrator, onPhantom }) {
  const root = useRef(null), restore = useRef(true);
  const [busy, setBusy] = useState('');
  const view = VIEWS.includes(filter) ? filter : 'needs';
  const { now, later } = activity.pending, count = now.length;
  const failing = Object.values(activity.sources).some(source => source?.error);
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.querySelector('.activity-filters button[aria-pressed=true]')?.focus();
    return () => { if (restore.current && previous?.isConnected) previous.focus(); };
  }, []);
  const leave = fn => () => { restore.current = false; onClose(); fn(); };
  const isSession = id => !!id && workspace.nodes?.some(node => node.id === id && node.type === 'terminal');
  const run = async (key, fn) => { setBusy(key); try { await fn(); } catch (error) { notify?.(error.message || String(error), 'error'); } finally { setBusy(''); } };
  const answer = (item, decision) => run(item.key, () => api('chat.permission.answer', { workspaceId: workspace.id, nodeId: item.chatId, requestId: item.requestId, decision }));
  const reply = (item, option) => run(item.key, () => api('chat.question.answer', { workspaceId: workspace.id, nodeId: item.chatId, requestId: item.requestId, answers: { [item.question]: option } }));
  const toSession = (item, label = 'Ir a la sesión', primary = true) => {
    const node = [item.nodeId, ...(item.sessions || []).map(session => session.nodeId)].find(isSession);
    return node ? <button type="button" className={primary ? 'is-primary' : undefined} onClick={leave(() => onTerminal(node))}>{label}</button> : null;
  };
  const toCard = (item, primary = true) => item.cardId ? <button type="button" className={primary ? 'is-primary' : undefined} onClick={leave(() => onCard(item.cardId))}>Ver tarea</button> : null;
  // The one thing to do about a row, by what it is waiting for.
  const decide = item => {
    const waiting = busy === item.key || !activity.connected;
    if (item.need === 'permission') return <><button type="button" disabled={waiting} onClick={() => answer(item, 'deny')}>Rechazar</button><button type="button" className="is-primary" disabled={waiting} onClick={() => answer(item, 'allow')}>Aprobar</button></>;
    if (item.need === 'question') return <>{item.options.map(option => <button type="button" key={option} disabled={waiting} onClick={() => reply(item, option)}>{option}</button>)}{item.target === 'phantom' ? <button type="button" className="is-primary" onClick={leave(() => onPhantom?.())}>Responder</button> : toSession(item, 'Responder')}</>;
    if (item.target === 'tasks') return toCard(item) || toSession(item);
    if (item.target === 'integration') return toSession(item) || <button type="button" className="is-primary" onClick={leave(() => onPanel('incorporaciones'))}>Ver la cola</button>;
    if (item.target === 'terminal') return toSession(item) || <button type="button" className="is-primary" onClick={leave(() => onInspector('sessions'))}>Ver sesiones</button>;
    return toSession(item) || toCard(item);
  };
  const tidy = item => item.need === 'ready' ? <button type="button" onClick={leave(() => onPanel('branches'))}>Revisar</button>
    : item.need === 'unsaved' ? <button type="button" onClick={leave(() => onPanel('branches'))}>Guardar</button>
      : onOrchestrator ? <button type="button" onClick={leave(onOrchestrator)}>Abrir orquestador</button> : <button type="button" onClick={leave(() => onPanel('incorporaciones'))}>Ver la cola</button>;
  const open = item => item.target === 'tasks' ? toCard(item, false) || toSession(item, undefined, false) : toSession(item, undefined, false) || toCard(item, false);
  const seen = item => !item.read && <button type="button" className="icon-button" aria-label="Marcar como visto" title="Marcar como visto" disabled={busy === item.key || !activity.connected} onClick={() => run(item.key, () => onRead(item.id))}>{busy === item.key ? <LoaderCircle size={14} className="spinning" /> : <Check size={14} />}</button>;
  const tabs = [['needs', 'Pendientes', count], ['progress', 'En curso', activity.current.length], ['today', 'Hoy']];
  const keydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    if (e.key !== 'Tab') return;
    const controls = [...root.current.querySelectorAll('button:not(:disabled)')].filter(control => control.checkVisibility());
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  return <><button className="popover-dismiss top-dismiss" aria-label="Cerrar" onClick={onClose} /><section ref={root} id="activity-tray" className="activity-tray needs-tray" role="dialog" aria-modal="true" aria-label="Te necesitan" onKeyDown={keydown}>
    <header className="activity-head">
      <div>
        <h1 className={count ? 'needs-you' : undefined}>{count ? <>Te necesitan <b>{count}</b></> : 'Todo en orden'}</h1>
        <p>{count ? 'Al resolverlas, los agentes siguen solos.' : 'Nada espera una decisión tuya.'}</p>
      </div>
      <button className="icon-button" aria-label="Cerrar" title="Cerrar" onClick={onClose}><X size={16} /></button>
    </header>
    <nav className="activity-filters" aria-label="Vista">{tabs.map(([id, name, total]) => <button key={id} type="button" data-tab={id} aria-pressed={view === id} onClick={() => onFilter(id)}><span>{name}</span>{total > 0 && <b>{total}</b>}</button>)}</nav>
    <div className="activity-body">
      <div className="activity-tray-scroll">
        {!activity.connected && <p className="activity-note" role="status">Sin conexión.</p>}
        {activity.connected && failing && <p className="activity-note" role="status">{STALE}. <button type="button" className="activity-link" onClick={activity.retry}>Reintentar</button></p>}
        {view === 'needs' && <>
          {count > 0 && <Group id="activity-now" title="Decide ahora">{now.map(item => <Row key={item.key} kind={item.need} title={item.headline} code={item.code} meta={[item.context, item.at ? ago(item.at, activity.now) : '']}>{decide(item)}</Row>)}</Group>}
          {later.length > 0 && <Group id="activity-later" title="Cuando puedas">{later.map(item => <Row key={item.key} kind={item.need} title={item.headline} meta={[item.context]}>{tidy(item)}</Row>)}</Group>}
          {!count && !later.length && <EmptyState className="activity-empty" size="compact" icon={CheckCircle2} description="Aquí aparecerá lo que necesite una decisión tuya." />}
        </>}
        {view === 'progress' && (activity.current.length
          ? <Group id="activity-progress" title="En curso">{activity.current.map(item => <Row key={item.key} kind={item.tone} title={item.headline} meta={[item.state, item.context]}>{open(item)}</Row>)}</Group>
          : <EmptyState className="activity-empty" size="compact" description="Nadie está trabajando ahora mismo." />)}
        {view === 'today' && (activity.today.length
          ? <Group id="activity-today" title="Hoy">{activity.today.map(item => <Row key={item.key} kind={item.tone} title={item.headline} meta={[item.state, item.at ? clock(item.at) : '']}>{open(item)}{item.target === 'notice' && seen(item)}</Row>)}</Group>
          : <EmptyState className="activity-empty" size="compact" description="Hoy todavía no ha terminado nada." />)}
      </div>
      <Plan limits={activity.sources.limits?.data} />
    </div>
  </section></>;
}
