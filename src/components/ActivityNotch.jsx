import React, { useEffect, useRef, useState } from 'react';
import { Ban, Bell, Check, CheckCircle2, CircleDot, Clock, GitBranch, GitMerge, Hand, LoaderCircle, MessageCircleQuestion, OctagonAlert, Save, ShieldAlert, TriangleAlert, X, XCircle } from 'lucide-react';
import { PhantomFace } from './Glyphs.jsx';
import EmptyState from './EmptyState.jsx';
import { STUCK_STEPS, ago, excerptLines, freshness, leadNeed, waiting } from '../hooks/activityModel.mjs';
import { useTerminalTail } from '../hooks/useTerminalTail';

export function TerminalActivityStatus({ session, compact = false, panelState }) {
  if (panelState) return <span className="panel-state" data-state={panelState}>{({ attention: 'Te necesita', working: 'Trabajando', finished: 'Terminó', error: 'Error', rest: 'En reposo' })[panelState]}</span>;
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
export default function ActivityNotch({ activity, open, onToggle, buttonRef, identity = false }) {
  const fresh = freshness(activity);
  const count = activity.needs.length, working = workingCount(activity);
  const status = fresh.state === 'offline' ? 'Sin conexión' : fresh.state === 'loading' && !count ? 'Cargando…' : count ? 'Te necesitan' : working ? `${working} en curso` : 'Todo en orden';
  const shown = count > 0 && fresh.state !== 'offline';
  const lead = leadNeed(activity), leadText = lead ? `${lead.where && lead.where !== lead.headline ? `${lead.where}: ` : ''}${lead.headline}${lead.at ? ` · ${ago(lead.at, activity.now)}` : ''}` : '';
  return <div className="activity-strip" role="group" aria-label="Te necesitan">
    <button ref={buttonRef} className={`activity-notch ${shown ? 'needs-you' : ''}`} aria-label={shown ? `Te necesitan, ${count} ${count === 1 ? 'pendiente' : 'pendientes'}, ${leadText}` : status} aria-expanded={!!open} aria-controls="activity-tray" onClick={() => onToggle('needs')}>
      {identity ? <PhantomFace mood={activityMood(activity)} size={28} data-identity="dock" /> : <CircleDot className="notch-state-fallback" size={16} aria-hidden="true" />}
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
function Row({ kind, title, code, meta = [], expanded, onOpen, detail, children }) {
  const [Icon, ink] = NEED[kind] || NEED.blocked;
  return <li className="activity-item" data-ink={ink}>
    <span className="activity-item-icon" aria-hidden="true"><Icon size={16} /></span>
    <div className="activity-item-main">
      {onOpen ? <button type="button" className="activity-item-title activity-need-title" aria-expanded={expanded} onClick={onOpen}>{title}</button> : <strong className="activity-item-title" title={title}>{title}{code && <> <code title={code}>{code}</code></>}</strong>}
      {meta.some(Boolean) && <p className="activity-item-meta">{meta.filter(Boolean).map((part, index) => <span key={index}>{part}</span>)}</p>}
      {detail}
    </div>
    {children && <div className="activity-actions">{children}</div>}
  </li>;
}
function Group({ id, title, total, children }) {
  return <section aria-labelledby={id}><h2 id={id}>{title}{total > 0 && <b className="activity-total">{total}</b>}</h2><ul className="activity-list">{children}</ul></section>;
}

const dotsAt = count => { const n = Math.min(count, 4); return Array.from({ length: n }, (_, i) => n === 1 ? 135 : 70 + (i * 130) / (n - 1)); };
function ConflictLanes({ item }) {
  const files = item.files || [], { ahead, behind } = item, base = item.base || 'main';
  const lanes = ahead != null && behind != null;
  return <>
    {lanes && <figure className="need-lanes" aria-label={`La rama lleva ${ahead} ${ahead === 1 ? 'cambio propio' : 'cambios propios'} y ${base} ${behind} ${behind === 1 ? 'nuevo' : 'nuevos'} desde que se separaron; chocan en ${files.length} ${files.length === 1 ? 'archivo' : 'archivos'}`}>
      <svg width="248" height="48" viewBox="0 0 248 48" aria-hidden="true">
        <path className="lane" d="M0 12H240" /><path className="lane" d="M18 12C32 12 28 36 44 36H240" /><path className="clash" d="M240 12V36" />
        <circle className="dot" cx="18" cy="12" r="3" />
        {dotsAt(behind).map(x => <circle key={`b${x}`} className="dot" cx={x} cy="12" r="3" />)}
        {dotsAt(ahead).map(x => <circle key={`a${x}`} className="dot" cx={x} cy="36" r="3" />)}
        <circle className="hit" cx="240" cy="12" r="4" /><circle className="hit" cx="240" cy="36" r="4" />
      </svg>
      <figcaption><span>{base} · {behind} {behind === 1 ? 'nuevo' : 'nuevos'}</span><span>rama · {ahead} {ahead === 1 ? 'propio' : 'propios'}</span></figcaption>
    </figure>}
    {files.length > 0 && <ul className="need-files">{files.slice(0, 6).map(file => <li key={file}><code>{file}</code></li>)}{files.length > 6 && <li className="need-more">y {files.length - 6} más</li>}</ul>}
  </>;
}

const clock = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function TerminalExcerpt({ item, api, activity }) {
  const { tail, error } = useTerminalTail({ sessionId: item.sessionId, api, lines: 24, connected: activity.connected });
  const lines = excerptLines(tail?.lines);
  return error ? <p className="activity-copy">No se pudo leer la pantalla.</p> : lines.length ? <pre className="activity-excerpt" aria-label="Lo último que dijo">{lines.join('\n')}</pre> : null;
}
function TerminalReply({ item, disabled, send }) {
  const [text, setText] = useState('');
  const submit = e => { e.preventDefault(); if (!disabled && text.trim()) send(text, () => setText('')); };
  return <form className="activity-reply" onSubmit={submit}>
    <textarea rows={Math.min(4, text.split('\n').length)} aria-label={`Responder a ${item.title}…`} placeholder={`Responder a ${item.title}…`} value={text} disabled={disabled} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e); }} />
    <button type="submit" className="is-primary" disabled={disabled || !text.trim()}>Enviar</button>
  </form>;
}

const VIEWS = ['needs', 'progress', 'today'];
export function ActivityTray({ activity, workspace, api, notify, filter = 'needs', onFilter, onClose, onTerminal, onInspector, onPanel, onCard, onRead, onOrchestrator, onPhantom }) {
  const root = useRef(null), restore = useRef(true);
  const [busy, setBusy] = useState('');
  const [openKey, setOpenKey] = useState(''), [sent, setSent] = useState([]);
  const view = VIEWS.includes(filter) ? filter : 'needs';
  const { now, later } = activity.pending, count = now.length, stuck = activity.pending.stuck || [];
  const [allCauses, setAllCauses] = useState(false);
  const shownStuck = allCauses ? stuck : stuck.slice(0, 3), hiddenStuck = stuck.slice(3);
  const opened = [...now, ...shownStuck].some(item => item.key === openKey) ? openKey : '';
  useEffect(() => { setSent(keys => keys.filter(key => now.some(item => item.key === key))); }, [now]);
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
    if (item.target === 'terminal') return toSession(item, undefined, item.reply !== 'terminal') || <button type="button" className="is-primary" onClick={leave(() => onInspector('sessions'))}>Ver sesiones</button>;
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
    const controls = [...root.current.querySelectorAll('button:not(:disabled), textarea:not(:disabled)')].filter(control => control.checkVisibility());
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  return <><button className="popover-dismiss top-dismiss" aria-label="Cerrar" onClick={onClose} /><section ref={root} id="activity-tray" className="activity-tray needs-tray" role="dialog" aria-modal="true" aria-label="Te necesitan" onKeyDown={keydown}>
    <header className="activity-head">
      <h1 className="sr-only">{count ? <>Te necesitan <b>{count}</b></> : 'Todo en orden'}</h1>
      <button className="icon-button" aria-label="Cerrar" title="Cerrar" onClick={onClose}><X size={16} /></button>
    </header>
    <nav className="activity-filters" aria-label="Vista">{tabs.map(([id, name, total]) => <button key={id} type="button" data-tab={id} aria-pressed={view === id} onClick={() => onFilter(id)}><span>{name}</span>{total > 0 && <b>{total}</b>}</button>)}</nav>
    <div className="activity-body">
      <div className="activity-tray-scroll">
        {!activity.connected && <p className="activity-note" role="status">Sin conexión.</p>}
        {activity.connected && failing && <p className="activity-note" role="status">{STALE}. <button type="button" className="activity-link" onClick={activity.retry}>Reintentar</button></p>}
        {view === 'needs' && <>
          {count > 0 && <Group id="activity-now" title="Decide ahora">{now.map(item => <Row key={item.key} kind={item.need} title={item.headline} meta={[item.context, waiting(item.at, activity.now)]} expanded={opened === item.key} onOpen={() => setOpenKey(item.key)} detail={opened === item.key && <>
            {item.need === 'conflict' && <ConflictLanes item={item} />}
            {item.excerpt && <TerminalExcerpt item={item} api={api} activity={activity} />}
            {item.need === 'permission' && item.code && <pre className="activity-excerpt activity-command" aria-label="Comando">{item.code}</pre>}
            {item.reply === 'terminal' && <TerminalReply key={item.key} item={item} disabled={!!busy || !activity.connected} send={(text, clear) => run(item.key, async () => {
              await api('terminal.write', { sessionId: item.sessionId, data: text });
              await new Promise(resolve => setTimeout(resolve, 80));
              await api('terminal.write', { sessionId: item.sessionId, data: '\r' });
              clear(); setSent(keys => keys.includes(item.key) ? keys : [...keys, item.key]);
            })} />}
          </>}>{sent.includes(item.key) && <span role="status">Enviado</span>}{opened === item.key && decide(item)}</Row>)}</Group>}
          {stuck.length > 0 && <Group id="activity-stuck" title="Se atoraron" total={stuck.reduce((sum, group) => sum + group.count, 0)}>{shownStuck.map(group => <Row key={group.key} kind="failed" title={`${group.label} · ${group.count}`} meta={[group.meaning]} expanded={opened === group.key} onOpen={() => setOpenKey(opened === group.key ? '' : group.key)} detail={opened === group.key && <>
            {Number.isInteger(group.step) && <ol className="need-track" aria-label={`Se detuvo en ${STUCK_STEPS[group.step]}, paso ${group.step + 1} de 5`}>{STUCK_STEPS.map((name, index) => <li key={name} data-step={index < group.step ? 'done' : index === group.step ? 'fail' : 'todo'}>{name}</li>)}</ol>}
            <p className="activity-copy">{group.next}</p>
            <ul className="activity-stuck-list">{group.items.slice(0, 5).map(task => <li key={task.key}>
              <span className="activity-stuck-title" title={task.headline}>{task.headline}</span>
              {task.at > 0 && <span className="activity-stuck-age">{ago(task.at, activity.now)}</span>}
              {toCard(task, false) || toSession(task, undefined, false)}
            </li>)}</ul>
            {group.items.length > 5 && <p className="activity-copy">y {group.items.length - 5} más</p>}
          </>} />)}{hiddenStuck.length > 0 && <li className="activity-more"><button type="button" className="activity-link" aria-expanded={allCauses} onClick={() => setAllCauses(!allCauses)}>{allCauses ? 'Ver menos' : `${hiddenStuck.length} ${hiddenStuck.length === 1 ? 'causa más' : 'causas más'} · ${hiddenStuck.reduce((sum, group) => sum + group.count, 0)} ${hiddenStuck.reduce((sum, group) => sum + group.count, 0) === 1 ? 'tarea' : 'tareas'}`}</button></li>}</Group>}
          {later.length > 0 && <Group id="activity-later" title="Cuando puedas">{later.map(item => <Row key={item.key} kind={item.need} title={item.headline} meta={[item.context]}>{tidy(item)}</Row>)}</Group>}
          {!count && !stuck.length && !later.length && <EmptyState className="activity-empty" size="compact" icon={CheckCircle2} description="Aquí aparecerá lo que necesite una decisión tuya." />}
        </>}
        {view === 'progress' && (activity.current.length
          ? <Group id="activity-progress" title="En curso">{activity.current.map(item => <Row key={item.key} kind={item.tone} title={item.headline} meta={[item.state, item.context]}>{open(item)}</Row>)}</Group>
          : <EmptyState className="activity-empty" size="compact" description="Nadie está trabajando ahora mismo." />)}
        {view === 'today' && (activity.today.length
          ? <Group id="activity-today" title="Hoy">{activity.today.map(item => <Row key={item.key} kind={item.tone} title={item.headline} meta={[item.state, item.at ? clock(item.at) : '']}>{open(item)}{item.target === 'notice' && seen(item)}</Row>)}</Group>
          : <EmptyState className="activity-empty" size="compact" description="Hoy todavía no ha terminado nada." />)}
      </div>
    </div>
  </section></>;
}
