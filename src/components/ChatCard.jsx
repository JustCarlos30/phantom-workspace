import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useComposerSize } from '../hooks/useComposerSize';
import { AgentOpenContext } from '../hooks/useAgentTraces';
import { AlertCircle, ArrowUp, Brain, ChevronRight, Folder, LoaderCircle, MessageSquarePlus, Pencil, Settings2, Square, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { canSubmit, mergeDictation, sendAction } from '../hooks/voice-send.mjs';
import { VoiceActivity, VoiceTranscript, dictationPreview } from './VoiceActivity';
import { useVoiceDraft } from './VoiceProvider';
import { Mic } from 'lucide-react';
import { formatCost, formatDuration, formatElapsed, formatTokens } from '../hooks/chatState';
import { locationOf } from './TerminalCard';
import { sessionChipLabel } from '../hooks/sessionChipLabel.mjs';
import PlanPhases from './PlanPhases';
import TouchedFiles from './TouchedFiles.jsx';
import { ChangesCanvasContext } from './ChangesCanvasContext.jsx';
import { appendReviewComment } from '../hooks/changes-canvas.mjs';
import { planSummary } from '../hooks/plan-view.mjs';
import Markdown, { CopyButton } from './Markdown';
import { ProviderTile } from './Glyphs';
import { phantomRunIds, turnRunIds } from '../hooks/phantom-run-link.mjs';
import { delegatedRuns, delegationState } from '../hooks/delegated-runs.mjs';
import { delegateSummary } from '../hooks/delegation-model.mjs';
import { livePollDelay } from '../hooks/poll-schedule.mjs';
import { runHealthView } from '../hooks/run-health-view.mjs';
import { runProgressView } from '../hooks/run-progress-view.mjs';
import { plainMarkdown } from '../hooks/markdownTable.mjs';
import { compactionBlocked } from '../hooks/context-view.mjs';
import { AGENT_MODES, AgentChoices, ModeSwitch, PermissionRow, PermissionSwitch, ProjectPermissions } from './chat/ChatPermissions';
import { ContextMeter, ContextNudge, ModelPicker, ReasoningPicker } from './chat/ChatPickers';
import { PhantomRunCard, QuestionCard, SubagentCard, ToolGroup } from './chat/ChatTools';

export { rememberPolicy, useEnabledProviders, preferredCardMode, permissionLabel, PermissionSwitch, PermissionRow, ProjectPermissions, ProviderChoices, ModeSwitch } from './chat/ChatPermissions';
export { ModelPicker, ReasoningPicker, ContextMeter, ContextNudge } from './chat/ChatPickers';
export { PhantomRunCard, SubagentCard } from './chat/ChatTools';

// Branches Phantom creates per session are named after an id; show the project instead.
const AUTO_BRANCH = /^phantom\/terminal-/;

// Seconds since a turn started, ticking only while it runs.
export function useElapsed(since, active) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, since]);
  return active && since ? Math.max(0, now - Date.parse(since)) : 0;
}

const isSubagent = part => part.type === 'tool' && Boolean(part.agent);

// Consecutive tool calls read as one activity block between paragraphs of prose.
// The AskUserQuestion call itself is drawn by its question card, not as a tool row.
function groupParts(parts) {
  const groups = [], asked = new Set(parts.filter(p => p.type === 'question' && p.toolUseId).map(p => p.toolUseId));
  for (const part of parts) {
    if (part.type === 'tool' && asked.has(part.id)) continue;
    if (isSubagent(part)) { groups.push({ type: 'subagent', part }); continue; }
    const ids = phantomRunIds(part);
    if (ids.length) { groups.push({ type: 'phantom', part, ids }); continue; }
    const last = groups.at(-1);
    if (part.type === 'tool' && last?.type === 'tools') last.items.push(part);
    else groups.push(part.type === 'tool' ? { type: 'tools', items: [part] } : part);
  }
  return groups;
}
const clock = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); };

export const Message = React.memo(function Message({ message, label, provider, model, onAnswer, onReply, api, workspaceId, onOpenPanel, onOpenAgent }) {
  if (message.role === 'user') return <blockquote className="pc-message is-user"><Markdown source={message.parts.map(part => part.text).join('\n')} /></blockquote>;
  return <AgentMessage message={message} label={label} provider={provider} model={model} onAnswer={onAnswer} onReply={onReply} api={api} workspaceId={workspaceId} onOpenPanel={onOpenPanel} onOpenAgent={onOpenAgent} />;
});

function AgentMessage({ message, label, provider, model, onAnswer, onReply, api, workspaceId, onOpenPanel, onOpenAgent }) {
  const streaming = message.status === 'streaming', usage = message.usage;
  const elapsed = useElapsed(message.createdAt, streaming);
  const waiting = message.parts.some(part => ['permission', 'question'].includes(part.type) && part.status === 'pending');
  const text = message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n');
  const groups = groupParts(message.parts.filter(part => !(part.type === 'permission' && part.status === 'pending')));
  const runIds = turnRunIds(message.parts);
  // Assignments report their own tone once Phantom answers; only those working count in the "Trabajando" line.
  const [runViews, setRunViews] = useState({});
  const reportRun = useCallback((id, tone) => setRunViews(known => {
    if (known[id] === tone || (!tone && !(id in known))) return known;
    const { [id]: gone, ...rest } = known;
    return tone ? { ...rest, [id]: tone } : rest;
  }), []);
  const delegated = streaming ? delegateSummary(message.parts, Object.values(runViews).map(tone => ({ kind: 'run', tone }))) : '';
  const facts = usage ? [usage.outputTokens ? `${formatTokens(usage.outputTokens)} tokens de salida` : '', Number.isFinite(usage.costUsd) && usage.costUsd > 0 ? formatCost(usage.costUsd) : ''].filter(Boolean) : [];
  const stamp = [message.model || model, streaming ? formatElapsed(elapsed) : formatDuration(usage?.durationMs) || clock(message.createdAt), ...facts].filter(Boolean).join(' · ');
  return <article className={`pc-message is-agent is-${message.status}`} aria-label={`Respuesta de ${label || provider}`}>
    {groups.map((group, i) => group.type === 'tools'
      ? <ToolGroup key={i} items={group.items} />
      : group.type === 'phantom'
        ? <div key={group.part.id} className="pc-phantom-link"><ToolGroup items={[group.part]} /><details className="pc-phantom-command"><summary>Comando original</summary><pre className="pc-subagent-prompt">{typeof group.part.input === 'string' ? group.part.input : group.part.input?.command || group.part.input?.cmd || group.part.detail}</pre></details></div>
      : group.type === 'subagent'
        ? <SubagentCard key={group.part.id} part={group.part} onOpenAgent={onOpenAgent} />
      : group.type === 'permission'
        ? <PermissionRow key={group.id} part={group} onAnswer={onAnswer} />
      : group.type === 'question'
        ? <QuestionCard key={group.id} part={group} onReply={onReply} />
      : group.type === 'thinking'
        ? <details key={i} className="pc-thinking"><summary><Brain size={14} aria-hidden="true" />Razonamiento<ChevronRight className="pc-tool-caret" size={14} aria-hidden="true" /></summary><p>{group.text}</p></details>
        : <Markdown key={i} source={group.text} streaming={streaming && i === groups.length - 1} />)}
    {runIds.length > 0 && <div className="pc-phantom-final" role="group" aria-label="Estado actual en Phantom">{runIds.map(id => <PhantomRunCard key={id} id={id} api={api} workspaceId={workspaceId} onOpenPanel={onOpenPanel} onTone={reportRun} />)}</div>}
    {streaming && !waiting && <p className="pc-working" role="status"><span className="pc-tool-mark" aria-hidden="true"><LoaderCircle size={16} /></span>{message.parts.length ? 'Trabajando' : 'Pensando'}{delegated && <span className="pc-working-agents"> · {delegated}</span>}</p>}
    {message.status === 'stopped' && <p className="pc-note">Respuesta detenida.</p>}
    {message.error && <p className="pc-note is-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{message.error}</span></p>}
    {(stamp || text) && <footer className="pc-turn-foot">{!streaming && text && <CopyButton text={text} label="Copiar respuesta" />}<time className="pc-num" dateTime={message.createdAt}>{stamp}</time></footer>}
  </article>;
}

// Messages written while the agent works, sent one by one when it finishes.
// A stopped or failed reply pauses the line until the user resumes it.
export function QueuedMessages({ queue, running, connected = true, unqueue, resume, onEdit, notify }) {
  const [busy, setBusy] = useState(false);
  if (!queue?.length) return null;
  const act = async action => { setBusy(true); try { return await action(); } catch (e) { notify?.(e.message, 'error'); } finally { setBusy(false); } };
  const paused = !running;
  return <section className={`pc-queue ${paused ? 'is-paused' : ''}`} aria-label="Mensajes en espera">
    <header>
      <span>{paused ? 'En pausa' : 'En espera'} · {queue.length} {queue.length === 1 ? 'mensaje' : 'mensajes'}</span>
      {paused && <button type="button" disabled={busy || !connected} onClick={() => act(() => resume())}><ArrowUp size={14} aria-hidden="true" />Reanudar</button>}
    </header>
    <ol>
      {queue.map((item, index) => <li key={item.id}>
        <span className="pc-queue-num" aria-hidden="true">{index + 1}</span>
        <p title={item.text}>{item.text}</p>
        {paused && index > 0 && <button type="button" className="pc-icon" disabled={busy || !connected} title="Enviar este ahora" aria-label="Enviar este mensaje ahora" onClick={() => act(() => resume(item.id))}><ArrowUp size={14} /></button>}
        <button type="button" className="pc-icon" disabled={busy || !connected} title="Editar" aria-label="Sacar de la cola para editar" onClick={() => act(async () => { const { text } = await unqueue(item.id); onEdit?.(text); })}><Pencil size={14} /></button>
        <button type="button" className="pc-icon" disabled={busy || !connected} title="Quitar" aria-label="Quitar de la cola" onClick={() => act(() => unqueue(item.id))}><X size={14} /></button>
      </li>)}
    </ol>
  </section>;
}
// Pulls a queued message back into the composer without losing what was typed.
export const withEdited = text => value => value.trim() ? `${text}\n\n${value}` : text;

// The card's border speaks the same states as a terminal's: working breathes,
// a pending permission or question calls, and a reply that finished or failed
// holds until the user looks at the card. "Looked at" is remembered per card,
// so a reply that lands while Phantom is closed still waits on the next open.
const SEEN_KEY = nodeId => `phantom.chatSeen.${nodeId}`;
const readSeen = nodeId => { try { return localStorage.getItem(SEEN_KEY(nodeId)); } catch { return null; } };
const writeSeen = (nodeId, id) => { try { localStorage.setItem(SEEN_KEY(nodeId), id); } catch { /* Memory only. */ } };
function useChatPulse({ nodeId, chat, running, waitingOn, last, seen }) {
  const [seenId, setSeenId] = useState(() => readSeen(nodeId));
  const settled = !running && last?.role === 'assistant' && (last.status === 'done' || last.status === 'error') ? last.id : null;
  useEffect(() => {
    if (!chat) return;
    // A card met for the first time starts quiet; only replies after that light it.
    if (seenId === null) { const id = settled || ''; writeSeen(nodeId, id); setSeenId(id); return; }
    if (seen && settled && settled !== seenId) { writeSeen(nodeId, settled); setSeenId(settled); }
  }, [chat, settled, seenId, seen, nodeId]);
  if (!chat) return '';
  if (waitingOn) return 'pulse-attention';
  if (running) return 'pulse-working';
  if (settled && settled !== seenId && seenId !== null) return last.status === 'error' ? 'pulse-error' : 'pulse-turn';
  return '';
}

export const configurePermission = (api, workspace, node, notify) => next => api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, permissionMode: next }).catch(e => notify?.(e.message, 'error'));

export function SessionContext({ node, workspace, api, notify, provider, label, model, permissionMode, descriptions, running, ready = true }) {
  const { cwd, branch } = locationOf(node, workspace);
  return <section className="pc-session-section pc-session-context" aria-label="Contexto de la sesión">
    <h3>Contexto</h3>
    <div className="pc-context-rows">
      <details className="pc-folder"><summary className="pc-session-row"><span className="pc-session-badge is-folder"><Folder size={18} aria-hidden="true" /></span><span className="pc-session-label">Carpeta</span><span className="pc-session-value pc-mono" title={cwd}>{cwd}</span><ChevronRight size={16} aria-hidden="true" /></summary><p>{cwd}{branch && <><br />{AUTO_BRANCH.test(branch) ? 'Copia propia de esta sesión' : `Rama: ${branch}`}</>}</p></details>
      <ProjectPermissions key={workspace.id} workspace={workspace} api={api} mode={permissionMode} provider={provider} disabled={!ready} />
    </div>
  </section>;
}

// Compaction for the composer: props for the meter in the island, one status
// line above it only while something real happens, and Codex's continuation form.
export function useCompaction({ chat, connected, capabilities, compact, continueSession }) {
  const [busy, setBusy] = useState(false), [capability, setCapability] = useState(null), [summary, setSummary] = useState('');
  const pending = useRef(false);
  useEffect(() => { setCapability(null); setSummary(''); }, [chat?.provider, chat?.sessionId]);
  const blocked = compactionBlocked(chat, connected), latest = chat?.compactions?.at(-1), continuation = chat?.continuations?.at(-1);
  const act = async () => {
    if (blocked || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const value = await capabilities(); setCapability(value);
      if (value.kind === 'native') await compact();
    } catch { /* The hook shows the host error. */ }
    finally { pending.current = false; setBusy(false); }
  };
  const proceed = async () => {
    if (blocked || pending.current || !summary.trim()) return;
    pending.current = true; setBusy(true);
    try { await continueSession(summary); setCapability(null); setSummary(''); }
    catch { /* Keep the reviewed summary for retry. */ }
    finally { pending.current = false; setBusy(false); }
  };
  const status = [
    chat?.operation && `${chat.operation === 'compact' ? 'Compactando con la API nativa…' : 'Comprobando capacidades instaladas…'} Puedes detener la operación.`,
    latest && (latest.status === 'done' ? 'Compactación nativa verificada. La medición se actualizará con la próxima petición; no se calcula ahorro.' : latest.status === 'running' ? 'Compactación en curso.' : `Compactación sin verificar (${latest.status}): ${latest.error || ''}`),
    continuation && (continuation.status === 'done' ? 'Sesión nueva de Codex confirmada; resumen e historial preservados.' : `Continuidad de Codex: ${continuation.status}${continuation.error ? ` · ${continuation.error}` : ''}`),
  ].filter(Boolean).join(' · ');
  return {
    meter: { running: !!chat?.running || !!chat?.operation || busy, blocked, onCompact: act },
    status: status ? <p className="pc-status-line" role="status">{status}</p> : null,
    form: capability?.kind === 'continuation' ? <section className="pc-continuation" aria-label="Continuar Codex con resumen">
      <p>{capability.reason}</p>
      <label>Resumen para la sesión nueva (revísalo antes de enviar)<textarea value={summary} disabled={busy} onChange={event => setSummary(event.target.value)} maxLength={32768} /></label>
      <p>Se enviará este resumen a una sesión nueva con los mismos permisos y modelo. El historial anterior seguirá visible.</p>
      <button type="button" disabled={!!blocked || busy || !summary.trim()} onClick={proceed}>Crear sesión nueva y enviar resumen</button>
      <button type="button" disabled={busy} onClick={() => setCapability(null)}>Cancelar</button>
    </section> : null,
  };
}

// «Contexto de la sesión» as a chip in the island; its settings open above it.
export function SessionChip({ cwd, branch, workspaceName, children }) {
  const root = useRef(null), pop = useRef(null), [open, setOpen] = useState(false), [place, setPlace] = useState(null);
  useEffect(() => {
    if (!open) return;
    const outside = e => { if (!root.current?.contains(e.target) && !pop.current?.contains(e.target)) { root.current.open = false; setOpen(false); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('wheel', outside, { capture: true, passive: true });
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('wheel', outside, true); };
  }, [open]);
  // The popover lives on <body> (fixed): the card and canvas node clip and scale their children.
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return; }
    const measure = () => {
      const rect = root.current?.querySelector('summary')?.getBoundingClientRect();
      if (!rect) return;
      const margin = 12, width = Math.min(440, window.innerWidth - margin * 2);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
      const above = rect.top - 8 - margin, below = window.innerHeight - rect.bottom - 8 - margin;
      const up = above >= Math.min(420, below);
      const next = { left, width, maxHeight: Math.max(120, up ? above : below), ...(up ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) };
      setPlace(prev => prev && Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every(k => prev[k] === next[k]) ? prev : next);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open]);
  const { own } = sessionChipLabel({ cwd, branch, workspaceName });
  return <details ref={root} className="pc-session-settings" onToggle={e => setOpen(e.currentTarget.open)}
    onKeyDown={e => { if (e.key === 'Escape' && root.current.open) { e.preventDefault(); e.stopPropagation(); root.current.open = false; root.current.querySelector('summary')?.focus({ preventScroll: true }); } }}>
    <summary className="pc-session-chip" aria-label={`Contexto de la sesión: ${cwd || 'carpeta desconocida'}${own ? ' · copia propia de esta sesión' : ''}`} title={own ? `${cwd} · copia propia de esta sesión` : cwd || undefined}><Settings2 size={16} aria-hidden="true" /></summary>
    {open && place && createPortal(<div ref={pop} className="pc pc-session-pop" style={place} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>{children}</div>, document.body)}
  </details>;
}

export function ComposerControls({ selectors, leading, meter, voice, hint, onFinish, finishLabel, children }) {
  return <div className="pc-controls">
    <div className="pc-selectors" role="group" aria-label="Configuración de la conversación">{selectors}</div>
    <div className="pc-composer-actions">
      <div className="pc-composer-tools">{leading}{meter}</div>
      <div className="pc-composer-send">
        <VoiceActivity voice={voice} onFinish={onFinish || voice.stop} hint={hint} finishLabel={finishLabel} />
        {children}
      </div>
    </div>
  </div>;
}

export default function ChatCard({ node, workspace, api, notify, overview = false, focused = false, connected = true, seen = false, onPulse, onOpenPanel, onOpenAgent: openAgentProp }) {
  // The canvas does not pass props down to this card: the app offers the dock opener by context and the card adds
  // its own identity (project, card) to the agent the user clicked. An explicit prop (the dock chat) wins.
  const openAgentContext = useContext(AgentOpenContext), workspaceId = workspace.id, nodeId = node.id;
  const onOpenAgent = useCallback(id => { if (openAgentProp) openAgentProp(id); else openAgentContext?.({ workspaceId, nodeId, id }); }, [openAgentProp, openAgentContext, workspaceId, nodeId]);
  const hasOpenAgent = Boolean(openAgentProp || openAgentContext);
  const provider = node.data.chat.provider, label = AGENT_MODES.find(mode => mode.id === provider)?.label || provider;
  const { chat, error, send, stop, clear, answer, reply, unqueue, resume, capabilities, compact, continueSession } = useChat({ workspaceId: workspace.id, nodeId: node.id, provider, api, connected });
  const [reveal, setReveal] = useState(0);
  const [draft, setDraft] = useVoiceDraft(`${workspace.id}:${node.id}:${provider}`);
  const [sending, setSending] = useState(false);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false), draftRef = useRef(draft), submitRef = useRef(null);
  draftRef.current = draft;
  const arm = value => { armedRef.current = value; setArmed(value); };
  const thread = useRef(null), input = useRef(null), pinned = useRef(true);
  const changesCanvas = useContext(ChangesCanvasContext);
  const recorderVoice = useVoiceRecorder({ api, workspaceId: workspace.id, scopeId: `${node.id}:${provider}`, enabled: connected && !overview,
    onText: text => {
      const merged = mergeDictation(draftRef.current, text), pendingSend = armedRef.current;
      arm(false); draftRef.current = merged; setDraft(merged);
      if (pendingSend) submitRef.current(merged, true);
    } });
  const voice = { ...recorderVoice, cancel: () => { arm(false); recorderVoice.cancel(); } };
  const listening = voice.status === 'recording';
  const dictating = listening || voice.status === 'transcribing';
  const commentOnChanges = comment => {
    const next = appendReviewComment(draftRef.current, comment);
    if (next === draftRef.current || !connected || voice.status !== 'idle') return;
    arm(false);
    draftRef.current = next;
    setDraft(next);
    changesCanvas?.close(node.id);
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  };
  useLayoutEffect(() => { if (voice.status === 'idle' || !connected || overview) arm(false); }, [voice.status, connected, overview]);
  useLayoutEffect(() => { arm(false); }, [workspace.id, node.id, provider]);
  const running = !!chat?.running, messages = chat?.messages || [], meta = chat?.meta || {};
  // Mirrors the host: inside its own worktree the card works on its own by default.
  const chosen = node.data.chat.permissionMode ?? (typeof node.data.chat.autoApprove === 'boolean' ? (node.data.chat.autoApprove ? 'auto' : 'ask') : null);
  const permissionMode = chosen ?? (provider === 'claude' && node.data.worktree ? 'auto' : 'ask');
  const waitingOn = messages.flatMap(message => message.parts || []).find(part => (part.type === 'permission' || part.type === 'question') && part.status === 'pending');
  const waiting = waitingOn ? (waitingOn.type === 'question' ? 'Espera tu respuesta' : 'Espera tu permiso') : '';
  const pendingAsks = messages.flatMap(message => (message.parts || []).filter(part => part.type === 'permission' && part.status === 'pending'));
  // Announce transitions only, never the state found on mount.
  const [announcement, setAnnouncement] = useState('');
  const turnPhase = waiting ? 'waiting' : running ? 'running' : 'idle', seenPhase = useRef(null);
  // Encargos Phantom lanzados desde este chat: consulta al terminar un turno y cada 3 s mientras haya vivos.
  const [controllers, setControllers] = useState([]);
  const [runHealth, setRunHealth] = useState([]);
  const runs = delegatedRuns(node.id, controllers);
  const delegation = delegationState(turnPhase, runs);
  const phase = delegation.phase, liveRuns = runs.live.length;
  const refreshRuns = useRef(null);
  refreshRuns.current = async () => {
    try {
      const response = await api('phantom.controllers', { workspaceId: workspace.id });
      if (!Array.isArray(response?.items)) return;
      setControllers(response.items);
      const live = delegatedRuns(node.id, response.items).live;
      const health = await Promise.all(live.map(item => api('phantom.events', { workspaceId: workspace.id, id: item.taskId, view: 'health' }).catch(() => null)));
      setRunHealth(health.filter(Boolean));
    } catch { /* Se reintenta en el siguiente ciclo. */ }
  };
  useEffect(() => { if (connected && turnPhase === 'idle' && typeof api === 'function') refreshRuns.current(); }, [connected, turnPhase, workspace.id]);
  useEffect(() => {
    if (!connected || !liveRuns || typeof api !== 'function') return;
    let timer;
    const tick = () => {
      clearTimeout(timer); timer = undefined;
      const delay = livePollDelay({ hidden: document.hidden, base: 5000 });
      if (delay !== null) timer = setTimeout(async () => { await refreshRuns.current(); tick(); }, delay);
    };
    const onVisibility = () => { if (!document.hidden) { refreshRuns.current(); } tick(); };
    document.addEventListener('visibilitychange', onVisibility);
    tick();
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [connected, liveRuns, workspace.id]);
  const [ackedRun, setAckedRun] = useState(null);
  const finishedRun = delegation.outcome === 'attention' ? runs.latest : null;
  useEffect(() => { if (seen && finishedRun) setAckedRun(finishedRun.id); }, [seen, finishedRun?.id]);
  const delegating = phase === 'delegating', healthView = runHealthView(runHealth);
  const progress = runProgressView(node.data?.agent?.run, Date.now());
  const delegatingLabel = progress ? `${progress.label}${progress.activity ? ` · ${progress.activity}` : ''}` : healthView.line;
  useEffect(() => {
    if (!chat) return;
    const before = seenPhase.current; seenPhase.current = phase;
    if (before === null || before === phase) return;
    setAnnouncement(phase === 'running' ? `${label} está respondiendo` : phase === 'waiting' ? `${label} ${waiting.toLowerCase()}` : phase === 'delegating' ? `${label} ${delegatingLabel.toLowerCase()}` : `${label} terminó de responder`);
  }, [phase, chat, label]);
  const last = messages.at(-1);
  const basePulse = useChatPulse({ nodeId: node.id, chat, running: running || delegating, waitingOn, last, seen });
  const pulse = !chat || waitingOn || running || delegating ? basePulse : finishedRun && ackedRun !== finishedRun.id ? 'pulse-attention' : basePulse;
  const panelState = waitingOn ? 'attention' : running || delegating ? 'working' : error || last?.status === 'error' || finishedRun ? 'error' : last?.role === 'assistant' && last.status === 'done' || delegation.outcome === 'turn' ? 'finished' : 'rest';
  useEffect(() => { onPulse?.(node.id, pulse, panelState); }, [onPulse, node.id, pulse, panelState]);
  useEffect(() => () => onPulse?.(node.id, ''), [onPulse, node.id]);
  // Follow the reply while the reader is at the end; never yank them back up.
  useLayoutEffect(() => { const el = thread.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [messages, overview, focused, pendingAsks.length]);
  useEffect(() => { pinned.current = true; }, [provider]);
  useEffect(() => { if (focused) input.current?.focus({ preventScroll: true }); }, [focused, provider]);
  const preview = dictationPreview(voice, draft);
  useComposerSize(input, preview, !overview);
  const submit = async (value = draftRef.current, fromVoice = false) => {
    if (sending || !connected) return;
    if (!fromVoice) {
      const action = sendAction({ status: voice.status, draft: value, armed: armedRef.current });
      if (action === 'none') return;
      if (action === 'stop-and-send' || action === 'await-voice') { arm(true); if (action === 'stop-and-send') voice.stop(); return; }
      if (voice.status !== 'idle') voice.cancel();
    }
    const text = value.trim();
    if (!text) return;
    setSending(true); pinned.current = true;
    try { await send(text); setDraft(''); } catch { /* Shown inline by the hook. */ }
    finally { setSending(false); }
  };
  submitRef.current = submit;
  const model = meta.model;
  const compaction = useCompaction({ chat, connected, capabilities, compact, continueSession });
  const startNew = () => clear().catch(() => {});
  const context =<SessionContext node={node} workspace={workspace} api={api} notify={notify} provider={provider} label={label} model={model} permissionMode={permissionMode} running={running} ready={!!chat} />;
  if (overview) {
    const lastText = last?.parts.findLast?.(part => part.type === 'text')?.text;
    return <div className="pt-card pc is-overview" data-agent={waiting ? 'approval' : running ? 'working' : 'idle'}>
      <div className="pt-card-identity">
        <span className="pt-provider is-agent"><ProviderTile provider={provider} /><span>{label}</span></span>
        {(running || waiting) && <span className={`pt-state ${waiting ? 'is-approval' : 'is-working'}`}><i aria-hidden="true" />{waiting || 'Respondiendo'}</span>}
        {lastText && <p className="pt-card-step">{plainMarkdown(lastText).slice(-240)}</p>}
        <PlanPhases plan={node.data?.plan} compact />
      </div>
    </div>;
  }
  return <div className={`pt-card pc ${focused ? 'is-focused' : ''}`} data-provider={provider} data-agent={waiting ? 'approval' : running ? 'working' : 'idle'}>
    <span className="pc-live" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    {planSummary(node.data?.plan) && <details className="plan-phases-toggle pc-plan"><summary><PlanPhases plan={node.data.plan} compact /></summary><PlanPhases plan={node.data.plan} /></details>}
    <div ref={thread} className="pc-thread" role="log" aria-label={`Conversación con ${label}`} aria-live="off" onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
      <div className="pc-column">
        {!messages.length && (!connected || !chat) && <p role="status">{connected ? 'Cargando la conversación…' : 'Sin conexión con el host'}</p>}
        {!messages.length && connected && chat && <div className="pc-session-new">
          <AgentChoices node={node} workspace={workspace} api={api} notify={notify} disabled={running} />
          <section className="pc-session-section"><h3>Interfaz</h3><ModeSwitch node={node} workspace={workspace} api={api} notify={notify} disabled={running} /></section>
          {context}
        </div>}
        {messages.map(message => <Message key={message.id} message={message} label={label} provider={provider} model={model} onAnswer={answer} onReply={reply} api={api} workspaceId={workspace.id} onOpenPanel={onOpenPanel} onOpenAgent={hasOpenAgent ? onOpenAgent : undefined} />)}
        {delegating && !running && !waiting && <p className="pc-working pc-run-health" data-level={healthView.level}><span className="pc-run-health-line">{delegatingLabel}{progress && progress.idle ? ` · inactivo ${progress.idle}` : ''}</span>{(progress?.warning || healthView.warning) && <span className="pc-run-health-warning" role="status">{progress?.warning || healthView.warning}</span>}{progress?.blocker && <span className="pc-run-health-warning" role="alert">{`${progress.blocker.title}: ${progress.blocker.summary}`}</span>}</p>}
      </div>
    </div>
    {error && <p className="pc-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{error}</span></p>}
    {pendingAsks.length > 0 && <div className="pc-dock">{pendingAsks.map(part => <PermissionRow key={part.id} part={part} onAnswer={answer} />)}</div>}
    <form className="pc-composer" data-dictating={voice.status !== 'idle' || undefined} onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Escape' && voice.status !== 'idle') { e.preventDefault(); e.stopPropagation(); voice.cancel(); } }}>
      <ContextNudge key={`${node.id}.${chat?.messages?.[0]?.id || 'empty'}`} nodeId={node.id} firstMessageId={chat?.messages?.[0]?.id || 'empty'} meta={meta} onReveal={() => setReveal(n => n + 1)} />
      <QueuedMessages queue={chat?.queue} running={running} connected={connected} unqueue={unqueue} resume={resume} notify={notify} onEdit={text => { setDraft(withEdited(text)); input.current?.focus({ preventScroll: true }); }} />
      {compaction.status}
      <div className="pc-field" onPointerDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
        {voice.error && <p className="voice-inline-error" role="alert">{voice.error}</p>}
        <div className="pc-input" data-preview={voice.status !== 'idle' || undefined}>
          <VoiceTranscript voice={voice} draft={draft} />
          <textarea ref={input} rows={1} value={preview} readOnly={voice.status !== 'idle'} disabled={!connected} aria-label={`Mensaje para ${label}`} placeholder={running ? `${label} está respondiendo · lo que envíes queda en espera` : `Escribe a ${label}…`} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        </div>
        <ComposerControls voice={voice} onFinish={() => submit()} finishLabel="Terminar dictado y enviar · Enter" selectors={<>
          <SessionChip cwd={locationOf(node, workspace).cwd} branch={locationOf(node, workspace).branch} workspaceName={workspace.name}>{context}</SessionChip>
          <PermissionSwitch mode={permissionMode} provider={provider} disabled={!chat} onChange={configurePermission(api, workspace, node, notify)} />
          <ModelPicker node={node} workspace={workspace} api={api} notify={notify} provider={provider} label={label} observed={model} disabled={!chat || running} />
          <ReasoningPicker node={node} workspace={workspace} api={api} notify={notify} provider={provider} observed={model} disabled={!chat || running} />
        </>} leading={<><button type="button" className="pc-icon pc-new-conversation" title="Conversación nueva" aria-label="Empezar una conversación nueva" disabled={running || !messages.length || voice.status !== 'idle'} onClick={startNew}><MessageSquarePlus size={18} /></button><TouchedFiles node={node} workspace={workspace} api={api} enabled={connected} onComment={connected && voice.status === 'idle' ? commentOnChanges : undefined} /></>}
          meter={<ContextMeter meta={meta} {...compaction.meter} reveal={reveal} onNew={messages.length ? startNew : undefined} />}>
          {voice.status === 'idle' && <button type="button" className="phantom-chat-mic" disabled={!connected || voice.busyElsewhere} title={voice.busyElsewhere ? 'Otro dictado en curso: detén o cancela su audio' : `Dictar a ${label}`} aria-label={`Dictar a ${label}`} onClick={voice.start}><Mic size={18} /></button>}
          {running && <button type="button" className="pc-send is-stop" title="Detener respuesta" aria-label="Detener respuesta" onClick={() => stop().catch(() => {})}><Square size={14} /></button>}
          {(!running || draft.trim() || dictating || armed) && <button type="submit" className="pc-send" title={armed ? 'Se enviará al terminar la transcripción' : dictating ? 'Terminar dictado y enviar · Enter' : running ? 'Poner en espera · ↵' : 'Enviar · ↵ enviar · ⇧↵ línea'} aria-label={armed ? 'Se enviará al terminar la transcripción' : dictating ? 'Terminar dictado y enviar' : running ? 'Poner mensaje en espera' : 'Enviar mensaje'} aria-busy={armed} disabled={!canSubmit({ status: voice.status, draft, armed, sending, connected })}><ArrowUp size={18} /></button>}
        </ComposerControls>
      </div>
      {compaction.form}
    </form>
  </div>;
}
