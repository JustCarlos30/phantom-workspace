import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Ban, Bell, Check, CheckCheck, CheckCircle2, ChevronDown, CircleDot, Clock, Gauge, GitBranch, GitMerge, Hand, LoaderCircle, MessageCircleQuestion, OctagonAlert, RefreshCw, TerminalSquare, X, XCircle } from 'lucide-react';
import { PhantomFace } from './Glyphs.jsx';
import RepoGraph, { branchColor } from './RepoGraph.jsx';
import EmptyState from './EmptyState.jsx';
import { ErrorNotice, useOperation, useResource } from './PluginPrimitives';
import { buildBranches, commitsText, filesText, shortBranch } from '../hooks/branches-model.mjs';
import IntegrationReview from './IntegrationReview.jsx';
import { activityTitle, ago, cardIdOf, freshness, rowKind } from '../hooks/activityModel.mjs';
import { buildBranchBoard } from '../hooks/incorporaciones-model.mjs';
import { MergeMissing, MergeSteps } from './MergePath.jsx';

export function TerminalActivityStatus({ session, compact = false }) {
  return <span className={`terminal-activity-status ${session?.tone || 'unknown'} ${compact ? 'compact' : ''}`} title={`Host · terminal.list${session?.linkedTasks?.length ? ' + Phantom · phantom.list (vínculo explícito)' : ''} · ${session?.label || 'Estado desconocido'}`}><i />{session?.label || 'Estado desconocido'}</span>;
}

export default function ActivityNotch({ activity, open, onToggle, buttonRef }) {
  // The count stays on screen whatever happens: a failed or old reading only
  // adds a mark next to it, and only when it is one of the sources the count
  // is built from. Limits or the Git radar failing do not touch it.
  const fresh = freshness(activity);
  const settled = fresh.state === 'fresh' || fresh.state === 'stale';
  const count = activity.needs.length;
  const staleWhy = fresh.failing.length ? `No se pudo leer: ${fresh.failing.join(', ')}. El conteo es el de la última lectura correcta.` : 'La última lectura tiene más de 45 s. Se actualiza sola; el conteo puede haber cambiado.';
  const expanded = filter => open === filter || (open === true && filter === 'all');
  const peak = peakLimit(activity.sources.limits?.data);
  const merges = activity.sources.merges, board = buildBranchBoard(merges?.data);
  const branches = !activity.connected || !merges?.at || merges.data?.enabled === false ? null : board.counts;
  return <div className="activity-strip" role="group" aria-label="Actividad del proyecto">
    <button ref={buttonRef} className={`activity-notch ${count && settled ? 'needs-you' : ''}`} aria-label="Actividad del proyecto" aria-expanded={expanded('needs')} aria-controls="activity-tray" onClick={() => onToggle('needs')}>
      <PhantomFace mood={fresh.state === 'offline' ? 'asleep' : fresh.state !== 'fresh' ? 'unsure' : count ? 'grin' : 'calm'} />
      <strong>{fresh.state === 'offline' ? 'Host desconectado' : fresh.state === 'loading' ? 'Recuperando actividad…' : count ? `${count} ${count === 1 ? 'necesita' : 'necesitan'} de ti` : 'Actividad'}</strong>
      {fresh.state === 'stale' && <span className="notch-stale" title={staleWhy}>desactualizado</span>}<ChevronDown size={12} />
    </button>
    <button className={`activity-summary-action ${branches?.attention ? 'has-returned' : ''}`} aria-label="Integraciones" aria-expanded={expanded('integration')} aria-controls="activity-tray" onClick={() => onToggle('integration')} title={branches ? `${branches.total} ramas sin incorporar · ${branches.queued} en cola · ${branches.attention} devueltas o bloqueadas` : 'Ramas activas y lo que les falta para el merge'}><GitMerge size={14} /><span>{branches ? `${branches.total} ${branches.total === 1 ? 'rama' : 'ramas'}` : 'Integraciones'}</span></button>
    <button className={`activity-summary-action ${peak ? `limit-${limitLevel(peak.percent)}` : ''}`} aria-label="Límites" aria-expanded={expanded('limits')} aria-controls="activity-tray" title={peak ? `Uso más alto: ${peak.provider} · ${peak.label} · ${Math.round(peak.percent)}%` : 'Límites de tus planes'} onClick={() => onToggle('limits')}><Gauge size={14} /><span>Límites{peak ? ` · ${Math.round(peak.percent)}%` : ''}</span></button>
    {activity.unread > 0 && <button className="activity-summary-action activity-unread" aria-label={`${activity.unread} avisos sin leer`} aria-expanded={expanded('notices')} aria-controls="activity-tray" onClick={() => onToggle('notices')}><Bell size={13} /><span>{activity.unread}</span></button>}
  </div>;
}

// One row per thing, read left to right: why it is here (glyph and ink), what
// it is, where it comes from and when, and the one place to go for it.
const KIND = {
  approval: [Hand, 'attention'], input: [MessageCircleQuestion, 'attention'], blocked: [OctagonAlert, 'attention'],
  failed: [XCircle, 'danger'], returned: [GitMerge, 'danger'], working: [CircleDot, 'working'], waiting: [Clock, 'muted'],
  done: [CheckCircle2, 'success'], cancelled: [Ban, 'muted'], unread: [Bell, 'accent'], read: [Bell, 'muted'],
};
function Item({ kind, title, state, meta = [], actions, children }) {
  const [Icon, ink] = KIND[kind] || KIND.working;
  return <article className="activity-item" data-ink={ink}>
    <span className="activity-item-icon" aria-hidden="true"><Icon size={15} /></span>
    <div className="activity-item-main">
      <strong className="activity-item-title" title={title}>{title}</strong>
      <p className="activity-item-meta">{state && <span className="activity-item-state">{state}</span>}{meta.filter(Boolean).map((part, index) => <span key={index}>{part}</span>)}</p>
      {children}
    </div>
    {actions && <div className="activity-actions">{actions}</div>}
  </article>;
}
function Group({ id, icon: Icon, title, count, children }) {
  return <section aria-labelledby={id}><h2 id={id}>{Icon && <Icon size={15} />}{title} <b>{count}</b></h2>{children}</section>;
}

const limitLevel = percent => percent >= 90 ? 'full' : percent >= 70 ? 'high' : 'ok';
// The window closest to running out, across every plan.
function peakLimit(data) {
  let peak = null;
  for (const provider of data?.providers || []) for (const window of provider.windows || []) if (!peak || window.percent > peak.percent) peak = { ...window, provider: provider.label };
  return peak;
}
function resetIn(iso, now) {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'se restablece ahora';
  const minutes = Math.round(ms / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  const span = days >= 1 ? `${days} d ${hours % 24} h` : hours >= 1 ? `${hours} h ${minutes % 60} min` : `${Math.max(1, minutes)} min`;
  const at = new Date(iso).toLocaleString([], days >= 1 ? { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `se restablece en ${span} · ${at}`;
}
function ProviderLimits({ provider, now }) {
  return <article className="activity-limit">
    <header><strong>{provider.label}</strong>{provider.plan && <span className="activity-limit-plan">{provider.plan}</span>}{provider.limitReached && <span className="activity-warning">Límite alcanzado</span>}</header>
    {!provider.available && <p className="activity-copy" role="status">{provider.reason}</p>}
    {provider.available && !provider.windows.length && <EmptyState className="activity-empty" size="compact" description="El proveedor no informó ventanas de uso para este plan." />}
    {provider.windows.map(window => <div key={window.id} className={`activity-limit-row limit-${limitLevel(window.percent)}`}>
      <div className="activity-limit-line"><span>{window.label}</span><b>{Math.round(window.percent)}%</b></div>
      <div className="activity-limit-bar" role="meter" aria-label={`${provider.label} · ${window.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(window.percent)}><i style={{ width: `${Math.max(1, Math.min(100, window.percent))}%` }} /></div>
      {window.resetsAt && <small>{resetIn(window.resetsAt, now)}</small>}
    </div>)}
    {provider.extra && <small className="activity-copy">Uso extra activo{Number.isFinite(provider.extra.percent) ? ` · ${Math.round(provider.extra.percent)}%` : ''}{Number.isFinite(provider.extra.limit) ? ` de ${provider.extra.limit} ${provider.extra.currency || ''}` : ''}</small>}
    {provider.credits && <small className="activity-copy">Créditos: {provider.credits.balance}</small>}
  </article>;
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

function IntegrationHistory({ activity, workspace, api, notify, navigate, openRepository, children }) {
  const enabled = Boolean(api && workspace?.id && activity.connected);
  const overview = useResource(api, 'branch.overview', { workspaceId: workspace.id }, { enabled });
  const history = useResource(api, 'repo.graph', { workspaceId: workspace.id, limit: 40 }, { enabled });
  const model = useMemo(() => buildBranches(overview.data), [overview.data]);
  const trees = useMemo(() => [model.baseRow, ...model.groups.flatMap(group => group.rows)].filter(Boolean), [model]);
  const pending = trees.filter(tree => !tree.isBase && (tree.ahead > 0 || tree.changeCount > 0 || tree.error));
  const op = useOperation(notify), busy = useRef(false);
  busy.current = op.busy;
  const [notices, setNotices] = useState({});
  const gitAt = activity.sources.git.at;
  const lastGitAt = useRef(gitAt);
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy.current) { overview.reload(); history.reload(); }
    }, 8000);
    return () => clearInterval(timer);
  }, [enabled, overview.reload, history.reload]);
  useEffect(() => {
    if (lastGitAt.current === gitAt) return;
    lastGitAt.current = gitAt;
    if (enabled && !busy.current) { overview.reload(); history.reload(); }
  }, [gitAt, enabled, overview.reload, history.reload]);
  const reload = () => Promise.all([overview.reload(), history.reload()]);
  const integrate = tree => op.run(async () => {
    try {
      const result = await api('branch.integrate', { workspaceId: workspace.id, branch: tree.name });
      const notice = result.status === 'conflict'
        ? { tone: 'warn', text: `No se hizo: choca en ${result.conflicts.slice(0, 4).join(', ')}. El merge se deshizo y nada cambió.` }
        : result.status === 'checks-failed'
          ? { tone: 'warn', text: `No se integró: los checks fallaron (${result.checks.command}, código ${result.checks.code}). El merge se deshizo y nada cambió.` }
          : { tone: 'ok', text: result.status === 'merged' ? `Integrada en ${result.base || model.base}${result.checks ? ' · checks OK' : ''}.` : 'Hecho.' };
      setNotices(old => ({ ...old, [tree.id]: { ...notice, title: tree.title } }));
    } finally { await reload(); activity.retry(); }
  });
  return <section className="activity-integrations" aria-labelledby="activity-integration">
    <h2 id="activity-integration"><GitBranch size={15} />Ramas e historia <b>{overview.data?.available ? `${pending.length} con trabajo` : `${activity.branches.length} ramas`}</b></h2>
    <p className="activity-copy">Diagnóstico de ramas. Tener cambios no equivale a una solicitud de integración.</p>
    {model.base && <p className="activity-integration-base">Destino <span className="rp-ref" style={{ '--ref-color': branchColor(model.base) }}><GitMerge size={11} aria-hidden="true" /><span className="rp-ref-label">{model.base}</span></span></p>}
    {overview.loading && !overview.data && <p className="activity-empty" role="status">Leyendo ramas pendientes…</p>}
    {overview.error && <ErrorNotice error={overview.error} retry={reload} />}
    {overview.data?.available === false && <p className="activity-warning">{overview.data.reason || 'Ramas no disponibles.'}</p>}
    {op.error && <ErrorNotice error={op.error} clear={op.clear} />}
    {op.busy && <p className="activity-empty" role="status"><LoaderCircle size={13} className="spinning" /> Integrando commits…</p>}
    <div className="activity-branch-cards">
      {pending.map(tree => <article className="activity-branch-card" key={tree.id} style={{ '--branch-color': branchColor(tree.name || tree.id) }}>
        <header><GitBranch size={14} aria-hidden="true" /><strong title={tree.name || tree.title}>{tree.terminal?.title || shortBranch(tree.name)}</strong></header>
        <p className="activity-branch-stats"><span>↑ {commitsText(tree.ahead)} adelante</span><span>↓ {commitsText(tree.behind)} detrás</span><span className={tree.changeCount ? 'is-wip' : ''}>{tree.changeCount ? `WIP · ${filesText(tree.changeCount)} sin guardar` : 'Sin WIP · árbol limpio'}</span></p>
        {tree.conflicts.length > 0 && <p className="activity-warning">Solapes de archivos: {tree.conflicts.slice(0, 4).join(', ')}{tree.conflicts.length > 4 ? '…' : ''}. No acreditan un conflicto de merge.</p>}
        {tree.error && <p className="activity-warning">Git no pudo leer esta rama: {tree.error}</p>}
        <div className="activity-integration-actions">
          <button type="button" className="activity-integrate" disabled={!enabled || op.busy || overview.loading || Boolean(overview.error) || !tree.can.integrate || Boolean(tree.error)} onClick={() => integrate(tree)}><GitMerge size={13} aria-hidden="true" />Integrar {commitsText(tree.ahead)} en {model.base}</button>
          {tree.terminal?.nodeId && <button type="button" onClick={() => navigate('terminal', tree.terminal.nodeId)}><TerminalSquare size={13} aria-hidden="true" />Ir a terminal</button>}
        </div>
      </article>)}
    </div>
    {overview.data?.available && !pending.length && <p className="activity-empty">Sin trabajo de ramas indicado por esta lectura.</p>}
    {Object.entries(notices).map(([id, notice]) => <p key={id} className={`activity-integration-notice is-${notice.tone}`} role="status"><strong>{notice.title}</strong> · {notice.text}</p>)}
    <div className="activity-history">
      <div className="activity-history-heading"><h3>Historia reciente</h3><button type="button" disabled={!enabled || op.busy || overview.loading || history.loading} onClick={reload} aria-label="Actualizar historia"><RefreshCw size={13} aria-hidden="true" /></button></div>
      {history.error ? <ErrorNotice error={history.error} retry={history.reload} /> : <RepoGraph graph={history.data} trees={trees} base={model.base} compact onSelectCommit={openRepository} onSelectTree={openRepository} />}
      {openRepository && <button type="button" className="activity-open-repo" onClick={openRepository}>Abrir Repositorio completo</button>}
    </div>
    <div className="activity-integration-actions"><button type="button" onClick={() => navigate('incorporaciones')}>Revisar incorporaciones</button><button type="button" onClick={() => navigate('branches')}>Ordenar ramas y worktrees</button></div>
    <details className="activity-integration-details"><summary>Detalles</summary>{children}</details>
  </section>;
}

export function ActivityTray({ activity, workspace, api, notify, filter = 'needs', onFilter, onClose, onTerminal, onInspector, onPanel, onCard, onRead }) {
  const root = useRef(null), restore = useRef(true);
  const [draftBase, setDraftBase] = useState(activity.base);
  const [reading, setReading] = useState(''), [readError, setReadError] = useState('');
  const show = section => filter === 'all' || filter === section;
  const merges = activity.sources.merges, base = merges?.data?.base?.branch;
  const board = useMemo(() => buildBranchBoard(merges?.data), [merges?.data]);
  const pathOf = item => board.rows.find(row => row.key === (item.id || item.nodeId));
  const failing = Object.entries({ tasks: 'tareas de Phantom', sessions: 'terminales', merges: 'incorporaciones', git: 'Git', limits: 'límites' }).filter(([key]) => activity.sources[key]?.error).map(([, name]) => name);
  const origin = item => item.sessions?.[0]?.title || (item.target === 'terminal' ? 'Terminal' : item.target === 'notice' ? item.source : item.target === 'integration' ? 'Incorporaciones' : item.kind === 'card' ? 'Card' : 'Tarea');
  const DONE_LIMIT = 25;
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.querySelector('button')?.focus();
    return () => { if (restore.current && previous?.isConnected) previous.focus(); };
  }, []);
  const navigate = (target, id) => { restore.current = false; onClose(); if (target === 'terminal') onTerminal(id); else onInspector(target); };
  const openCard = id => { restore.current = false; onClose(); onCard(id); };
  const openRepository = onPanel ? () => { restore.current = false; onClose(); onPanel('repo'); } : undefined;
  const noticeTarget = item => {
    const ref = item.ref;
    const node = workspace.nodes?.find(n => n.type === 'terminal' && (n.id === item.nodeId || n.data?.sessionId === item.sessionId || (ref?.kind === 'terminal' && ref.id === n.id) || (ref?.kind === 'session' && ref.id === n.data?.sessionId)));
    if (node) return { target: 'terminal', id: node.id, label: 'Ir a terminal' };
    if (cardIdOf(item)) return { target: 'card', id: cardIdOf(item), label: 'Ver Card' };
    if (ref?.kind === 'branch' || ref?.kind === 'git') return { target: 'git', label: 'Ir a Git' };
    return null;
  };
  const action = item => {
    const cardId = cardIdOf(item), terminal = [item.nodeId, ...(item.sessions || []).map(s => s.nodeId)].find(id => id && workspace.nodes?.some(node => node.id === id && node.type === 'terminal'));
    if (cardId || terminal) return <div className="activity-actions">{cardId && <button onClick={() => openCard(cardId)}>Ver Card</button>}{terminal && <button onClick={() => navigate('terminal', terminal)}>Ir a terminal</button>}</div>;
    if (item.target === 'tasks') return <button onClick={() => openCard(item.id)}>Ver Card</button>;
    if (item.target === 'terminal') return <button onClick={() => navigate('sessions')}>Ver sesión</button>;
    const target = noticeTarget(item);
    return target ? <button onClick={() => target.target === 'card' ? openCard(target.id) : navigate(target.target, target.id)}>{target.label}</button> : null;
  };
  const review = item => <IntegrationReview item={item} workspace={workspace} api={api} base={base} label="Detalle" bare />;
  const branchActions = item => <>{cardIdOf(item) && <button onClick={() => openCard(cardIdOf(item))}>Ver Card</button>}{item.nodeId && workspace.nodes?.some(node => node.id === item.nodeId && node.type === 'terminal') && <button onClick={() => navigate('terminal', item.nodeId)}>Ir a terminal</button>}</>;
  const tabs = [['needs', 'Necesitan de ti', activity.needs.length], ['progress', 'En curso', activity.inProgress.length + activity.integrations.active.length + activity.activeSessions.length], ['done', 'Terminadas', activity.finished.length], ['integration', 'Ramas', board.counts.total], ['notices', 'Avisos', activity.unread], ['limits', 'Límites'], ['all', 'Todo y diagnósticos']];
  const readAll = async () => { setReading('all'); setReadError(''); try { for (const item of activity.notices.filter(n => !n.read)) await onRead(item.id); } catch (e) { setReadError(e.message); } finally { setReading(''); } };
  const keydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    if (e.key !== 'Tab') return;
    const controls = [...root.current.querySelectorAll('button:not(:disabled),input,summary')].filter(control => control.checkVisibility());
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  return <><button className="popover-dismiss top-dismiss" aria-label="Cerrar actividad" onClick={onClose} /><section ref={root} id="activity-tray" className="activity-tray" role="dialog" aria-modal="true" aria-label="Actividad del proyecto" onKeyDown={keydown}>
    <div className="popover-heading"><strong>Actividad del proyecto</strong><button className="icon-button" aria-label="Cerrar bandeja de actividad" onClick={onClose}><X size={16} /></button></div>
    <nav className="activity-filters" aria-label="Ver actividad">{tabs.map(([id, name, count]) => <button key={id} type="button" data-tab={id} aria-pressed={filter === id} onClick={() => onFilter(id)}><Check className="activity-filter-check" size={12} aria-hidden="true" /><span>{name}</span>{count != null && <b className={count ? '' : 'is-zero'}>{count}</b>}</button>)}</nav>
    <div className="activity-tray-scroll">
      {!activity.connected && <p className="activity-warning" role="status">Host desconectado. No se puede confirmar el estado actual.</p>}
      {failing.length > 0 && <p className="activity-warning" role="status">Fuentes incompletas: no se pudo leer {failing.join(', ')}. Lo que ves de ahí es la última lectura correcta.</p>}
      {show('needs') && <Group id="activity-needs" icon={AlertCircle} title="Necesitan de ti" count={activity.needs.length}>
        {!activity.needs.length && <EmptyState className="activity-empty" size="compact" icon={CheckCircle2} description="Nada espera una decisión tuya." />}
        {activity.needs.map(item => {
          if (item.target !== 'integration') return <Item key={item.key} kind={rowKind(item)} title={activityTitle(item)} state={item.label} meta={[origin(item), ago(item.at, activity.now)]} actions={action(item)} />;
          const row = pathOf(item);
          return <Item key={item.key} kind={rowKind(item)} title={item.title || activityTitle(item)} state={item.label} meta={['Incorporaciones', ago(item.at, activity.now)]} actions={branchActions(item)}>{row && <MergeMissing path={row.path} />}{review(item)}</Item>;
        })}
        <details className="activity-sources"><summary>Fuentes de atención</summary><Source name="Phantom · phantom.list tasks" source={activity.sources.tasks} activity={activity} /><Source name="Host · terminal.list" source={activity.sources.sessions} activity={activity} /><Source name="Host · merge.status" source={activity.sources.merges || {}} activity={activity} /></details>
      </Group>}
      {show('integration') && <Group id="activity-branches" icon={GitBranch} title="Ramas activas" count={board.counts.total}>
        <p className="activity-copy">Cada rama que aún no está en <b>{board.base || base || 'la rama base'}</b> y lo que le falta para llegar. El orquestador decide el orden y hace el merge.</p>
        {merges?.data?.enabled === false && <p className="activity-warning">Incorporaciones está desactivado. Las solicitudes conservadas no se pueden integrar por este flujo hasta reactivarlo.</p>}
        {merges?.loading && !merges?.at && <p role="status">Leyendo ramas…</p>}
        {board.counts.total > 0 && <p className="activity-tally">{[[board.counts.attention, 'devueltas o bloqueadas', 'danger'], [board.counts.queued, 'en cola', 'accent'], [board.counts.ready, 'listas sin solicitar', 'success'], [board.counts.working, 'en curso', 'working']].filter(([count]) => count).map(([count, name, ink]) => <span key={name} data-ink={ink}><b>{count}</b> {name}</span>)}</p>}
        {board.rows.map(({ key, item, label, tone, path }) => <article className="activity-branch" key={key} data-ink={tone}>
          <header><strong title={item.branch}>{item.title || shortBranch(item.branch || '')}</strong><span className="activity-chip">{label}</span></header>
          {(item.summary || item.step || item.cardTitle) && <p className="activity-branch-summary" title={item.summary || item.step || item.cardTitle}>{item.summary || item.step || item.cardTitle}</p>}
          <MergeSteps path={path} />
          <MergeMissing path={path} />
          {item.note && <p className="activity-branch-note">Orquestador: {item.note}</p>}
          <footer>{review(item)}<div className="activity-actions">{branchActions(item)}</div></footer>
        </article>)}
        {merges?.at && !merges?.error && !board.counts.total && <EmptyState className="activity-empty" size="compact" icon={CheckCircle2} description={`Ninguna rama con trabajo pendiente: todo está en ${board.base || 'la rama base'}.`} />}
        {merges?.data?.plan && <details className="activity-sources"><summary>Plan del orquestador</summary><p className="inc-full-text">{merges.data.plan}</p></details>}
        <div className="activity-actions"><button onClick={() => navigate('incorporaciones')}>Revisar incorporaciones</button></div>
        <details className="activity-sources"><summary>Fuente</summary><Source name="Host · merge.status" source={merges || {}} activity={activity} /></details>
      </Group>}
      {show('progress') && <Group id="activity-progress" icon={CircleDot} title="En curso" count={tabs[1][2]}>
        {activity.inProgress.map(item => <Item key={item.id} kind={item.tone} title={activityTitle(item)} state={item.label} meta={[origin(item), ago(item.at, activity.now)]} actions={action(item)} />)}
        {activity.integrations.active.map(item => { const row = pathOf(item); return <Item key={item.id || item.nodeId} kind={item.status === 'idle' || item.status === 'review' ? 'waiting' : 'working'} title={item.title || activityTitle(item)} state={row?.label || 'Rama con trabajo'} meta={[row && `${row.path.done} de ${row.path.total} pasos al merge`, row?.path.missing[0] && `falta: ${row.path.missing[0].toLowerCase()}`]} actions={branchActions(item)} />; })}
        {activity.activeSessions.map(s => <Item key={s.id} kind="working" title={s.title} state={s.label} meta={['Terminal']} actions={action({ ...s, target: 'terminal' })} />)}
        {!tabs[1][2] && <EmptyState className="activity-empty" size="compact" description="Nadie está trabajando ahora mismo." />}
        <details className="activity-sources"><summary>Fuentes del trabajo actual</summary><Source name="Phantom · phantom.list tasks" source={activity.sources.tasks} activity={activity} /><Source name="Host · terminal.list" source={activity.sources.sessions} activity={activity} /><Source name="Host · merge.status" source={activity.sources.merges || {}} activity={activity} /></details>
      </Group>}
      {show('done') && <Group id="activity-done" icon={CheckCircle2} title="Terminadas" count={activity.finished.length}>
        {!activity.finished.length && <EmptyState className="activity-empty" size="compact" description="Todavía no hay tareas cerradas en este proyecto." />}
        {activity.finished.slice(0, DONE_LIMIT).map(item => <Item key={item.key} kind={item.tone} title={item.title || activityTitle(item)} state={item.label} meta={[origin(item), ago(item.at, activity.now)]} actions={item.target === 'integration' ? branchActions(item) : action(item)} />)}
        {activity.finished.length > DONE_LIMIT && <p className="activity-copy">Se muestran las {DONE_LIMIT} más recientes de {activity.finished.length}.</p>}
        <div className="activity-actions"><button onClick={() => { restore.current = false; onClose(); onPanel?.('phantom-cards', { pluginId: 'phantom', panelId: 'cards' }); }}>Ver todas las Cards</button></div>
      </Group>}
      {filter === 'all' && <IntegrationHistory activity={activity} workspace={workspace} api={api} notify={notify} navigate={navigate} openRepository={openRepository}>
        <form className="activity-base" onSubmit={e => { e.preventDefault(); activity.setBase(draftBase.trim()); if (activity.base === draftBase.trim()) activity.retry(); }}><label>Base explícita<input aria-label="Base de integración" value={draftBase} maxLength={512} onChange={e => setDraftBase(e.target.value)} placeholder="p. ej. main" /></label><button disabled={!activity.connected || activity.sources.git.loading}>Comparar</button></form>
        <Source name="Git · git.inspect" source={activity.sources.git} activity={activity} />
        <p className="activity-copy">Base: {activity.sources.git.data?.base || activity.base || 'sin elegir'} · {activity.pendingBranches} no integradas · {activity.unknownBranches} desconocidas. No integrada no implica lista para merge.</p>
        {!activity.branches.length && !activity.sources.git.loading && <EmptyState className="activity-empty" size="compact" description="Sin ramas disponibles en esta lectura." />}
        {activity.branches.map(branch => <article className="activity-row" key={branch.name}><div><strong>{branch.name}{branch.current ? ' · actual' : ''}</strong><span>{branch.label} · adelante {branch.ahead ?? '?'} / detrás {branch.behind ?? '?'}</span>{branch.sessions.map(s => <button className="activity-link" key={s.id} disabled={!s.nodeId} onClick={() => navigate('terminal', s.nodeId)}>Terminal vinculada: {s.title}</button>)}</div><button onClick={() => navigate('git')}>Ir a Git</button></article>)}
      </IntegrationHistory>}
      {show('limits') && <section aria-labelledby="activity-limits"><h2 id="activity-limits"><Gauge size={15} />Límites de tus planes</h2>
        {(activity.sources.limits?.data?.providers || []).map(provider => <ProviderLimits key={provider.id} provider={provider} now={activity.now} />)}
        <Source name="Host · limits.read" source={activity.sources.limits || {}} activity={activity} />
        <p className="activity-copy">Leído de la cuenta con la que iniciaste sesión en cada CLI. Se consulta como máximo una vez por minuto.</p>
      </section>}
      {show('all') && <section aria-labelledby="activity-sessions"><h2 id="activity-sessions"><TerminalSquare size={15} />Sesiones <b>{activity.sessionCount}{activity.unknownViews > 0 ? ` · ${activity.unknownViews} vistas sin descriptor` : ''}</b></h2>
        <Source name="Host · terminal.list" source={activity.sources.sessions} activity={activity} />
        {!activity.sessions.length && !activity.sources.sessions.loading && <EmptyState className="activity-empty" size="compact" description="Sin sesiones ni vistas de terminal en este proyecto." />}
        {activity.sessions.map(s => <article className="activity-row" key={s.id}><div><strong>{s.title}</strong><TerminalActivityStatus session={s} /><small>{s.hidden ? 'Vista oculta · se recupera al navegar' : 'Vista visible o historial sin panel'} · {s.id}</small>{s.linkedTasks.map(t => <button className="activity-link" key={t.id} onClick={() => openCard(t.id)}>Card vinculada: {t.title || t.id}</button>)}</div>{s.nodeId ? <button onClick={() => navigate('terminal', s.nodeId)}>Ir a terminal</button> : <button onClick={() => navigate('sessions')}>Ver historial</button>}</article>)}
      </section>}
      {show('notices') && <Group id="activity-notices" icon={Bell} title="Avisos" count={`${activity.unread} sin leer`}>
        {!activity.notices.length && <EmptyState className="activity-empty" size="compact" description="No hay avisos registrados." />}
        {readError && <p role="alert" className="activity-warning">{readError}</p>}
        {activity.unread > 1 && <div className="activity-actions"><button disabled={!!reading || !activity.connected} onClick={readAll}><CheckCheck size={13} />Marcar todos como leídos</button></div>}
        {activity.notices.map(item => <Item key={item.id} kind={item.read ? 'read' : 'unread'} title={item.title || item.id} state={item.read ? 'Leído' : 'Sin leer'} meta={[typeof item.source === 'string' ? item.source : 'Fuente desconocida', ago(item.at, activity.now)]}
          actions={<>{action({ ...item, target: 'notice' })}{!item.read && <button disabled={!!reading || !activity.connected} onClick={async () => { setReading(item.id); setReadError(''); try { await onRead(item.id); } catch (e) { setReadError(e.message); } finally { setReading(''); } }}>{reading === item.id ? <LoaderCircle size={13} className="spinning" /> : <Check size={13} />}Marcar leído</button>}</>} />)}
        {activity.notices.length > 0 && <p className="activity-copy">Marcar leído solo quita el aviso de la cuenta: no aprueba ni resuelve nada.</p>}
      </Group>}
    </div><footer className="activity-footer"><span>{workspace.name} · abrir no resuelve pendientes</span><button disabled={!activity.connected || Object.values(activity.sources).some(s => s.loading)} onClick={activity.retry}><RefreshCw size={13} />Actualizar</button></footer>
  </section></>;
}
