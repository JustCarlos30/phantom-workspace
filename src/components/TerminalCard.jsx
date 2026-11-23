import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, GitBranch, Folder, RotateCcw } from 'lucide-react';
import { ProviderTile, providerKey } from './Glyphs';
import { AGENT_LABELS } from './AgentIdentity';
import { useTerminalTail } from '../hooks/useTerminalTail';
import { formatSince, stateTone, useNow } from '../hooks/terminalPulse.mjs';
import { runProgressView } from '../hooks/run-progress-view.mjs';
import { CopyButton } from './CopyButton';
import { ModeSwitch } from './ChatCard';
import EmptyState from './EmptyState.jsx';
import PlanPhases from './PlanPhases';

const LINE_HEIGHT = 22;

// Who drives this terminal, and how we know: a live foreground process the
// host recognised wins over a declared OpenCode link; otherwise it is a shell.
export function providerOf(node, foreground) {
  const agent = node.data?.agent || {};
  if (foreground?.agent) return { kind: 'agent', name: foreground.agent, source: `Detectado en ejecución · ${foreground.command}` };
  if (agent.providerSessionId) return { kind: 'agent', name: 'OpenCode', source: `Sesión vinculada · ${agent.providerSessionId}` };
  if (foreground?.command && !foreground.shell) return { kind: 'process', name: foreground.command, source: 'Proceso en primer plano' };
  return { kind: 'shell', name: foreground?.command || 'Shell', source: foreground ? 'Shell en espera' : 'Sin proceso observado' };
}

export function sessionLabel(status, preparing) {
  if (preparing) return 'Preparando la sesión…';
  return { running: 'En ejecución', connecting: 'Conectando…', disconnected: 'Sin conexión', exited: 'Finalizada', lost: 'Sin sesión activa' }[status] || 'Sin sesión activa';
}

export function ProviderBadge({ provider }) {
  return <span className={`pt-provider is-${provider.kind}`} title={provider.source}><ProviderTile provider={providerKey(provider.name, provider.kind)} /><span>{provider.name}</span></span>;
}

const SCREEN_LABELS = { approval: 'Pide permiso', turn: 'Terminó · tu turno' };

// The screen outranks a declared 'working': a visible question means it waits on you.
export function effectiveStatus(agent, screenState) {
  const declared = agent?.status || null;
  if (screenState === 'awaiting_approval') return 'approval';
  if (screenState === 'awaiting_input' && declared !== 'blocked') return 'turn';
  if (declared) return declared;
  return screenState === 'working' ? 'working' : null;
}

export function AgentState({ agent, status = agent?.status || 'idle', reason = null }) {
  const label = status === 'approval' && reason === 'trust' ? 'Pide confiar en la carpeta' : SCREEN_LABELS[status] || AGENT_LABELS[status] || AGENT_LABELS.idle;
  return <span className={`pt-state is-${status}`}><i aria-hidden="true" />{label}</span>;
}

export function locationOf(node, workspace) {
  const cwd = node.data?.cwd || node.data?.worktree?.path || workspace.canonicalPath || workspace.path || '';
  const folder = cwd.split('/').filter(Boolean).pop() || cwd || 'Carpeta desconocida';
  const branch = node.data?.worktree ? node.data.worktree.branch || 'HEAD separado' : null;
  // A branch Phantom made for the session is named after an id: say the project instead.
  const own = branch && /^phantom\/terminal-/.test(branch);
  const where = !branch || own ? workspace?.name || folder : `${branch} · ${workspace?.name || folder}`;
  return { cwd, folder, branch, where };
}

const HM = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
const hm = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? HM.format(t) : ''; };

// Progreso en vivo de un run Phantom delegado (node.data.agent.run).
export function RunProgress({ run, workspaceId, api, notify }) {
  const live = !!run && !['completed', 'blocked', 'cancelled'].includes(run.phase);
  const now = useNow(live, 1000);
  const view = runProgressView(run, now);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(false);
  const previous = useRef(run?.phase);
  const log = useRef(null);
  useEffect(() => {
    const before = previous.current; previous.current = run?.phase;
    if (run?.phase !== 'completed' || !before || before === 'completed') return;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(timer);
  }, [run?.phase]);
  useEffect(() => { if (open && log.current) log.current.scrollTop = log.current.scrollHeight; }, [open, view?.lines.length, view?.lines.at(-1)?.text]);
  if (!view) return null;
  const { blocker } = view;
  async function amend() {
    setBusy(true); setError('');
    try {
      await api('phantom.control', { workspaceId, id: view.taskId, action: 'amend', reason: 'Ampliado por el usuario desde Workspace' });
      setConfirming(false); notify?.('Presupuesto ampliado');
    } catch (err) { setError(err?.message || String(err)); }
    finally { setBusy(false); }
  }
  return <section className={`pt-run${flash ? ' is-flash' : ''}`} data-tone={view.tone} aria-label="Progreso del encargo">
    <div className="pt-run-head">
      <strong className="pt-run-phase">{view.label}</strong>
      {view.activity && <span className="pt-run-activity" title={view.activity}>{view.activity}</span>}
      <span className="pt-run-times">{view.elapsed}{view.idle && ` · inactivo ${view.idle}`}</span>
    </div>
    {view.warning && <p className="pt-run-warning" data-level={view.level} role="status">{view.warning}</p>}
    {view.children.items.length > 0 && <ul className="pt-run-children" aria-label={`Hijos ${view.children.done} de ${view.children.total}`}>
      {view.children.items.map(item => <li key={item.key} data-status={item.status}><span>{item.key}</span><em>{item.statusLabel}</em>{item.activity && <small title={item.activity}>{item.activity}</small>}</li>)}
    </ul>}
    {blocker && <div className="pt-run-blocker" role="alert">
      <strong>{blocker.title}</strong>
      {blocker.summary && <p>{blocker.summary}</p>}
      {blocker.remedy && <p className="pt-run-remedy">{blocker.remedy}</p>}
      {blocker.retryAt && <p className="pt-run-remedy">Reintento: {blocker.retryAt}</p>}
      {blocker.commands.map(command => <div key={command} className="pt-run-command"><code>{command}</code><CopyButton value={command} label="Copiar comando" /></div>)}
      {blocker.action && (confirming
        ? <div className="pt-run-confirm"><span>¿Ampliar el presupuesto ×1,5?</span><button type="button" className="pt-card-action is-primary" disabled={busy} onClick={amend}>{busy ? 'Ampliando…' : 'Confirmar'}</button><button type="button" className="pt-card-action" disabled={busy} onClick={() => { setConfirming(false); setError(''); }}>Cancelar</button></div>
        : <button type="button" className="pt-card-action" onClick={() => setConfirming(true)}>{blocker.action.label}</button>)}
      {error && <p className="pt-run-error" role="alert">{error}</p>}
    </div>}
    {view.lines.length > 0 && <>
      <button type="button" className="pt-run-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Ocultar registro' : `Ver registro (${view.lines.length})`}</button>
      {open && <pre ref={log} className="pt-run-log" tabIndex={0} role="log" aria-label="Registro del encargo" aria-live="off">{view.lines.slice(-12).map(line => `${hm(line.at)} ${line.text}`.trim()).join('\n')}</pre>}
    </>}
  </section>;
}

export default function TerminalCard({ node, workspace, api, notify, overview = false, connected = true, enabled = true, onOpen, onRelaunch }) {
  const card = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  const sessionId = node.data?.sessionId;
  const lines = Math.max(4, Math.min(40, Math.floor(((node.height || 400) - 150) / LINE_HEIGHT)));
  // Overview keeps a few lines so the glimpse can skip a blank prompt row.
  const { tail, error } = useTerminalTail({ sessionId, api, lines: overview ? 4 : lines, connected, enabled: enabled && visible });
  const agent = node.data?.agent || {};
  const provider = providerOf(node, tail?.foreground);
  const state = effectiveStatus(agent, tail?.screenState);
  const updatedAt = agent.updatedAt != null && agent.updatedAt !== '' ? new Date(agent.updatedAt) : null;
  const hasTime = !!updatedAt && Number.isFinite(updatedAt.getTime());
  const now = useNow(!overview && !!agent.step && hasTime);
  const preparing = !sessionId && node.data?.launchState === 'creating';
  const status = !connected ? 'disconnected' : !sessionId ? 'lost' : tail?.status || 'connecting';
  const { cwd, branch, where } = locationOf(node, workspace);
  const alternate = tail?.screen === 'alternate';
  const currentLine = tail?.lines?.findLastIndex(line => line.trim()) ?? -1;
  const ended = !preparing && (status === 'lost' || status === 'exited');
  const emptyText = preparing ? 'Preparando una copia del proyecto para esta sesión…'
    : !sessionId ? node.data?.launchError || 'Sin sesión activa. Inicia una nueva para continuar.'
    : error ? `No se pudo leer la salida: ${error}`
    : !tail ? 'Leyendo la salida…' : 'Sin salida todavía.';
  const trustAsked = state === 'approval' && tail?.screenReason === 'trust' && status === 'running';
  const [trusting, setTrusting] = useState(false);
  const project = workspace?.name || 'este proyecto';
  async function trust() {
    setTrusting(true);
    try { await api('terminal.trust', { sessionId }); notify?.('Proyecto confiado'); }
    catch (err) { notify?.(err?.message || String(err)); }
    finally { setTrusting(false); }
  }
  const glimpse = overview ? (tail?.lines || []).filter(line => line.trim()).slice(-3).join('\n') : null;
  return <div ref={card} className={`pt-card ${overview ? 'is-overview' : ''}`} data-agent={state || 'idle'} data-session={status} onDoubleClick={e => { if (!e.target.closest('button')) onOpen(); }}>
    <div className="pt-card-identity">
      {!overview && <ModeSwitch node={node} workspace={workspace} api={api} notify={notify} />}
      {provider.kind !== 'shell' && <ProviderBadge provider={provider} />}
      {state && <AgentState agent={agent} status={state} reason={tail?.screenReason} />}
      {overview && <span className="pt-card-session"><i className={`status-dot ${status}`} aria-hidden="true" />{sessionLabel(status, preparing)}</span>}
      {agent.step && (overview ? <p className="pt-card-step" title={agent.step}>{agent.step}</p> : <div className="pt-card-now" data-tone={agent.run?.phase === 'blocked' ? 'attention' : stateTone(state)}>
        <i aria-hidden="true" />
        <p key={agent.step} className="pt-card-step" title={agent.step}>{agent.step}</p>
        {hasTime && <time dateTime={updatedAt.toISOString()} title={`${updatedAt.toLocaleString()} · ${agent.source === 'agent' ? 'Reportado por agente' : 'Declarado manualmente'}`}>{formatSince(now - updatedAt.getTime())}</time>}
      </div>)}
      {!overview && agent.run && <RunProgress run={agent.run} workspaceId={workspace?.id} api={api} notify={notify} />}
      <PlanPhases plan={node.data?.plan} compact />
    </div>
    {overview && !agent.step && <p className="pt-card-glimpse" aria-hidden="true">{glimpse || (ended || preparing ? '' : '…')}</p>}
    {!overview && <div className={`pt-card-screen ${alternate ? 'is-alternate' : ''}`} role="log" aria-label={`Últimas líneas de ${node.title}`} aria-live="off" style={alternate ? { '--rows': tail.lines.length || 1, '--cols': tail.cols || 80 } : undefined}>
      {tail?.lines?.length ? <pre>{alternate ? tail.lines.join('\n') : tail.lines.map((line, index) => <React.Fragment key={index}><span className={`pt-card-line${index === currentLine ? ' is-current' : ''}`}>{line}</span>{index < tail.lines.length - 1 ? '\n' : null}</React.Fragment>)}</pre> : preparing || !sessionId || error || !tail ? <p className="pt-card-status" role="status">{emptyText}</p> : <EmptyState className="pt-card-empty" description={emptyText} />}
    </div>}
    {!overview && <footer className="pt-card-footer">
      <span className="pt-card-location" title={cwd}>{branch ? <GitBranch size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}<span>{where}</span></span>
      <span className="pt-card-session"><i className={`status-dot ${status}`} aria-hidden="true" />{sessionLabel(status, preparing)}</span>
      {trustAsked && <button type="button" className="pt-card-action" disabled={trusting} onClick={trust} title={`Confiar en ${project} para Claude Code`} aria-label={`Confiar en el proyecto ${project}`}>Confiar en este proyecto</button>}
      {ended && <button type="button" className="pt-card-action" onClick={() => onRelaunch(node)}><RotateCcw size={14} aria-hidden="true" />Nueva sesión</button>}
      <button type="button" className="pt-card-action is-primary" onClick={onOpen} title="Abrir terminal · doble clic">Abrir<ArrowUpRight size={14} aria-hidden="true" /></button>
    </footer>}
  </div>;
}
