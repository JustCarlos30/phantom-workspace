import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useComposerSize } from '../hooks/useComposerSize';
import { AlertCircle, ArrowUp, Brain, Cpu, Check, ChevronDown, ChevronRight, Copy, FileText, FoldVertical, Folder, GitBranch, Globe, Lightbulb, ListChecks, LoaderCircle, MessageCircleQuestion, MessageSquarePlus, Pencil, Search, ShieldAlert, ShieldCheck, ShieldOff, Square, SquareTerminal, Wrench, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { canSubmit, mergeDictation, sendAction } from '../hooks/voice-send.mjs';
import { VoiceActivity, VoiceTranscript, dictationPreview } from './VoiceActivity';
import { useVoiceDraft } from './VoiceProvider';
import { Mic } from 'lucide-react';
import { BAND_RANK, CONTEXT_BANDS, CONTEXT_SIZE_CAPS, CONTEXT_TOKEN_BANDS, contextAdvice, contextNudge, contextUse, nudgeDismissal, formatCost, formatDuration, formatElapsed, formatTokens } from '../hooks/chatState';
import { locationOf } from './TerminalCard';
import Markdown, { CopyButton } from './Markdown';
import ToolOutput from './ToolOutput';
import { PhantomGlyph, ProviderGlyph, ProviderTile } from './Glyphs';
import { phantomRunIds, turnRunIds, summarizePhantomRun, summarizePhantomActivity } from '../hooks/phantom-run-link.mjs';
import { delegatedRuns, delegationState } from '../hooks/delegated-runs.mjs';
import { itemsOf } from '../hooks/plugin-model.mjs';
import { EFFORTS } from '../../shared/chat-options.mjs';
import { executionPolicy } from '../../shared/execution-policy.mjs';
import { plainMarkdown } from '../hooks/markdownTable.mjs';
import { compactionBlocked } from '../hooks/context-view.mjs';

const AGENT_MODES = [
  { id: 'claude', key: 'claude', label: 'Claude', hint: 'Conversar con Claude Code en esta carpeta' },
  { id: 'opencode', key: 'opencode', label: 'OpenCode', hint: 'Conversar con OpenCode en esta carpeta' },
  { id: 'codex', key: 'codex', label: 'Codex', hint: 'Conversar con Codex en esta carpeta' },
];
const SHELL_MODE = { id: null, key: 'shell', label: 'Terminal', hint: 'Usar la sesión de terminal de esta card' };

// Enabled providers from the global policy (settings.providers). Without it, Claude Code only, as before.
let policyCache = { enabled: ['claude'], chat: 'claude' }, policyRead = null, policyAt = 0;
export function rememberPolicy(settings) {
  try { const policy = executionPolicy(settings); policyCache = { enabled: Object.keys(policy.providers).filter(id => policy.providers[id].enabled), chat: policy.defaults.chat.client, policy }; policyAt = Date.now(); }
  catch (error) { policyCache = { enabled: ['claude'], chat: 'claude', error }; }
  return policyCache;
}
export function useEnabledProviders(api) {
  const [value, setValue] = useState(policyCache);
  useEffect(() => {
    let live = true;
    if (Date.now() - policyAt > 3000) policyRead ||= Promise.resolve().then(() => api('state.get', {})).then(state => rememberPolicy(state?.settings), () => policyCache).finally(() => { policyRead = null; });
    Promise.resolve(policyRead || policyCache).then(next => { if (live) setValue(next); });
    return () => { live = false; };
  }, [api]);
  return value;
}
const MODE_KEY = 'phantom.cardMode';
// New cards open in the mode chosen last if it is still enabled; otherwise the chats default (Claude Code unless configured).
export function preferredCardMode() {
  let saved = null;
  try { saved = localStorage.getItem(MODE_KEY); } catch { /* per-viewer preference only */ }
  if (saved === 'terminal') return null;
  if (saved && saved !== 'claude' && policyCache.enabled.includes(saved)) return saved;
  return saved === 'claude' && policyCache.enabled.includes('claude') ? 'claude' : policyCache.enabled.includes(policyCache.chat) ? policyCache.chat : 'claude';
}
const FULL_LIST = 'sudo, borrar a la fuerza fuera de la carpeta, git push --force o --delete, escribir en ~/.ssh, /etc o los archivos de arranque de la shell, curl | sh y formatear discos';
// Branches Phantom creates per session are named after an id; show the project instead.
const AUTO_BRANCH = /^phantom\/terminal-/;
const AUTO_APPROVE = {
  claude: { auto: 'Trabaja solo. Te pide permiso para borrar, publicar o salir de su carpeta.', ask: 'Te pide permiso antes de cada cambio.', full: `Hace todo sin preguntar. Solo te pide permiso para: ${FULL_LIST}.` },
  opencode: { auto: 'Trabaja solo, según la configuración de OpenCode.', ask: 'Te pide permiso antes de cada cambio.', full: 'Hace todo sin preguntar, según la configuración de OpenCode.' },
  codex: { auto: 'Edita dentro de su carpeta. No puede pedirte permiso: lo que lo requiera se rechaza.', ask: 'Solo lee. No edita ni pide permiso.', full: 'Hace todo sin preguntar, también fuera de su carpeta y en la red.' },
};
const PERMISSION_LABELS = { ask: { claude: 'Pregunta todo', other: 'Solo lectura' }, auto: { claude: 'Autónomo', other: 'Puede editar' }, full: { claude: 'Total', other: 'Total' } };
const NEXT_MODE = { ask: 'auto', auto: 'full', full: 'ask' };
export const permissionLabel = (mode, provider) => provider === 'opencode' && mode === 'ask' ? 'Con aprobación' : PERMISSION_LABELS[mode]?.[provider === 'claude' ? 'claude' : 'other'] || mode;

// The card's permission mode, cycled with one button: Pregunta todo → Autónomo → Total.
export function PermissionSwitch({ mode, provider, descriptions = AUTO_APPROVE, disabled, onChange, row = false }) {
  const Shield = mode === 'full' ? ShieldAlert : mode === 'auto' ? ShieldCheck : ShieldOff;
  const text = permissionLabel(mode, provider), next = NEXT_MODE[mode] || 'ask';
  return <button type="button" className={`pc-permission${row ? ' pc-session-row' : ''}`} data-mode={mode} aria-pressed={mode !== 'ask'} disabled={disabled}
    aria-label={`Permisos: ${text}. Cambiar a ${permissionLabel(next, provider)}`} title={`${descriptions[provider]?.[mode] || ''}\n\nPulsa para cambiar a «${permissionLabel(next, provider)}».`}
    onClick={() => onChange(next)}>{row ? <><span className="pc-session-badge is-permission"><Shield size={18} aria-hidden="true" /></span><span className="pc-session-label">Permisos</span><span className="pc-session-value">{text}</span><ChevronRight size={16} aria-hidden="true" /></> : <><Shield size={14} aria-hidden="true" /><span>{text}</span></>}</button>;
}
const PERMISSION_STATUS = { allowed: 'Aprobado', always: 'Aprobado siempre', denied: 'Rechazado', cancelled: 'Sin respuesta' };

// A permission the agent is waiting on, answered in place.
export function PermissionRow({ part, onAnswer }) {
  const [busy, setBusy] = useState(false);
  const pending = part.status === 'pending';
  const answer = async decision => { setBusy(true); try { await onAnswer?.(part.id, decision); } catch { setBusy(false); } };
  return <div className={`pc-ask is-${part.status}`} role={pending ? 'group' : undefined} aria-label={pending ? `${part.tool} pide permiso` : undefined}>
    <span className="pc-ask-icon" aria-hidden="true"><ShieldAlert size={14} /></span>
    <div className="pc-ask-body">
      <p><strong>{part.tool}</strong> <span>{part.reason}</span></p>
      {part.detail && <code title={part.detail}>{part.detail}</code>}
    </div>
    {pending
      ? <div className="pc-ask-actions">
        <button type="button" disabled={busy} onClick={() => answer('deny')}>Rechazar</button>
        <button type="button" disabled={busy} title={`No volver a preguntar en esta conversación: ${part.key}`} onClick={() => answer('always')}>Siempre</button>
        <button type="button" className="is-primary" disabled={busy} onClick={() => answer('allow')}>Aprobar</button>
      </div>
      : <span className="pc-ask-state">{PERMISSION_STATUS[part.status] || part.status}</span>}
  </div>;
}

// Who answers in this card: shared by the segmented switch and the compact one.
function useModeChoice({ node, workspace, api, notify, disabled }) {
  const current = node.data?.chat?.provider ?? null;
  const [pending, setPending] = useState(undefined);
  const choosing = useRef(false);
  const active = pending === undefined ? current : pending;
  const choose = async id => {
    if (id === active || choosing.current || disabled) return;
    choosing.current = true;
    setPending(id);
    try {
      await api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, provider: id });
      try { localStorage.setItem(MODE_KEY, id ?? 'terminal'); } catch { /* per-viewer preference only */ }
    } catch (e) { setPending(undefined); notify?.(e.message, 'error'); }
    finally { choosing.current = false; }
  };
  useEffect(() => { setPending(undefined); }, [current]);
  return { active, pending, choosing, choose };
}

export function ProviderChoices({ active, enabled, disabled, onChoose }) {
  const modes = AGENT_MODES.filter(mode => enabled.includes(mode.id));
  const navigate = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (disabled || !modes.length) return;
    const index = Math.max(0, modes.findIndex(mode => mode.id === active));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? modes.length - 1 : 1)) % modes.length;
    event.currentTarget.querySelectorAll('button')[next]?.focus();
    onChoose(modes[next].id);
  };
  return <section className="pc-session-section"><h3>Quién responde</h3><div className="pc-providers" role="radiogroup" aria-label="Quién responde" onKeyDown={navigate}>
    {modes.map((mode, i) => <button key={mode.id} type="button" className="pc-session-row" role="radio" aria-checked={active === mode.id} tabIndex={active === mode.id || !modes.some(item => item.id === active) && i === 0 ? 0 : -1} disabled={disabled} onClick={() => onChoose(mode.id)}>
      <span className="pc-session-badge" data-provider={mode.id}><ProviderGlyph provider={mode.id} size={18} /></span><span className="pc-provider-text"><strong>{mode.label}</strong><small>{mode.hint}</small></span><span className="pc-radio" aria-hidden="true" />
    </button>)}
  </div>{!modes.length && <p role="status">No hay proveedores habilitados.</p>}{active && !enabled.includes(active) && <p className="pc-provider-history">Historial de {AGENT_MODES.find(mode => mode.id === active)?.label || active} · proveedor no habilitado</p>}</section>;
}

function AgentChoices(props) {
  const { active, pending, choose } = useModeChoice(props);
  const { enabled } = useEnabledProviders(props.api);
  return <ProviderChoices active={active} enabled={enabled} disabled={props.disabled || pending !== undefined} onChoose={choose} />;
}

export function ModeSwitch({ node, workspace, api, notify, disabled = false }) {
  const { active, pending, choosing, choose } = useModeChoice({ node, workspace, api, notify, disabled });
  const policy = useEnabledProviders(api);
  const chatProvider = active || (policy.enabled.includes(policy.chat) ? policy.chat : policy.enabled[0]);
  const modes = [{ id: chatProvider, key: 'chat', label: 'Chat', hint: 'Conversar con el agente elegido' }, SHELL_MODE];
  const navigate = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (disabled || choosing.current) return;
    const count = modes.length;
    const index = modes.findIndex(mode => mode.id === active);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? count - 1 : 1)) % count;
    event.currentTarget.querySelectorAll('button')[next]?.focus();
    if (modes[next].id !== undefined) choose(modes[next].id);
  };
  const activeMode = modes.find(mode => mode.id === active) || modes[0];
  return <div className="pc-modes control-segmented" data-active={activeMode.key} role="radiogroup" aria-label="Interfaz de la sesión" aria-busy={pending !== undefined} onKeyDown={navigate} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    {modes.map(mode => <button key={mode.key} type="button" role="radio" aria-label={mode.label} tabIndex={active === mode.id ? 0 : -1} aria-checked={active === mode.id} title={mode.hint} disabled={mode.id === undefined || (disabled || pending !== undefined) && active !== mode.id} onClick={() => choose(mode.id)}>{mode.key === 'chat' ? <MessageSquarePlus size={16} aria-hidden="true" /> : <SquareTerminal size={16} aria-hidden="true" />}<span>{mode.label}</span></button>)}
  </div>;
}

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

const TOOL_KINDS = [[/^(read|view|cat|notebookread)/, FileText, 'read'], [/^(edit|multiedit|write|patch|apply|notebookedit)/, Pencil, 'edit'], [/^(bash|shell|exec|run)/, SquareTerminal, 'shell'], [/^(grep|glob|search|list|ls|find|toolsearch)/, Search, 'search'], [/^(web|fetch)/, Globe, 'web'], [/^(task|agent)/, Cpu, 'agent'], [/^(check|verify)$/, ListChecks, 'check'], [/^todo/, ListChecks, 'todo']];
const toolKind = name => TOOL_KINDS.find(([pattern]) => pattern.test(String(name).toLowerCase())) || [null, Wrench, 'other'];
// Codex-style: each action is a sentence. The verb's tense carries the state
// (gerund while it runs, past once done); only failures and stops add a word.
const TOOL_VERBS = { read: ['Leyendo', 'Leyó'], edit: ['Editando', 'Editó'], shell: ['Ejecutando', 'Ejecutó'], search: ['Buscando', 'Buscó'], web: ['Consultando', 'Consultó'], agent: ['Delegando', 'Delegó'], todo: ['Actualizando el plan', 'Actualizó el plan'] };
const TOOL_STATES = { error: 'Falló', stopped: 'Detenida' };

// One action, one quiet line: a dot, what was done, and on what. The dot and the verb's tense say whether it is still running.
const ToolRow = React.memo(function ToolRow({ part }) {
  const [open, setOpen] = useState(false);
  const [, Icon, kind] = toolKind(part.name);
  const phantom = phantomRunIds(part).length > 0 || /phantom[._:-]/i.test(part.name);
  const expandable = Boolean(part.output || (kind === 'edit' && part.change));
  const [doing, did] = TOOL_VERBS[kind] || ['Usando', 'Usó'];
  const codeDetail = ['read', 'edit', 'shell', 'search', 'web'].includes(kind);
  const summary = <>
    <span className="pc-tool-mark" aria-hidden="true">{phantom ? <PhantomGlyph size={16} /> : <Icon size={16} />}</span>
    <span className="pc-tool-label" title={part.name}>{phantom ? 'Phantom' : part.status === 'running' ? doing : did}</span>
    {!phantom && !TOOL_VERBS[kind] && <span className="pc-tool-name">{part.name}</span>}
    <span className={`pc-tool-detail${codeDetail ? ' is-code' : ''}`} title={part.detail || undefined}>{part.detail}</span>
    {part.diff && <span className="pc-tool-diff" aria-label={`${part.diff.added} líneas añadidas, ${part.diff.removed} quitadas`}><b>+{part.diff.added}</b><i>−{part.diff.removed}</i></span>}
    {TOOL_STATES[part.status] && <span className={`pc-tool-state is-${part.status}`}>
      {part.status === 'error' && <X size={14} aria-hidden="true" />}
      <span>{TOOL_STATES[part.status]}</span>
    </span>}
    {expandable ? <ChevronRight className="pc-tool-caret" size={14} aria-hidden="true" /> : <span className="pc-tool-caret" aria-hidden="true" />}
  </>;
  const className = `pc-tool is-${part.status}`;
  if (!expandable) return <li className={className} data-kind={kind}><div className="pc-tool-row">{summary}</div></li>;
  return <li className={className} data-kind={kind}><details onToggle={e => { if (e.target === e.currentTarget) setOpen(e.currentTarget.open); }}><summary className="pc-tool-row">{summary}</summary><div className="pc-tool-output">
    <p className="pc-tool-context"><span>{part.name}</span>{part.detail && (kind !== 'shell' || part.status === 'error') && <span className={codeDetail ? 'is-code' : undefined}>{part.detail}</span>}</p>
    {open && <ToolOutput part={part} kind={kind} />}
  </div></details></li>;
});

export function PhantomRunCard({ id, api, workspaceId, onOpenPanel }) {
  const [state, setState] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const stepsRef = useRef(null);
  const open = chosen ?? state?.live ?? false;
  useEffect(() => {
    if (open && stepsRef.current) stepsRef.current.scrollTop = stepsRef.current.scrollHeight;
  }, [state, open]);
  useEffect(() => {
    let disposed = false, timer;
    setState(null);
    setChosen(null);
    if (typeof api !== 'function' || !workspaceId) {
      setState({ error: true });
      return;
    }
    const refresh = async () => {
      try {
        const [detail, controllers, activity] = await Promise.all([
          api('phantom.detail', { workspaceId, topic: 'tasks', id }),
          api('phantom.controllers', { workspaceId }),
          Promise.resolve().then(() => api('phantom.events', { workspaceId, id, view: 'activity' })).catch(() => null),
        ]);
        if (disposed) return;
        if (!detail || detail.available === false || detail.task?.available === false || controllers?.available === false || !Array.isArray(controllers?.items)) throw new Error('No disponible');
        const summary = summarizePhantomRun(detail, itemsOf(controllers), id);
        setState({ ...summary, activity: summarizePhantomActivity(activity, detail.contract?.workspace || detail.task?.contract?.workspace), model: summary.model || activity?.model });
        if (summary.live) timer = setTimeout(refresh, 3000);
      } catch {
        if (!disposed) setState({ error: true });
      }
    };
    refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [api, workspaceId, id, attempt]);
  if (!state) return null;
  if (state.error) return <p className="pc-phantom-warning" role="alert">Seguimiento Phantom no disponible para <code>{id.slice(0, 13)}</code>. <button type="button" className="pc-phantom-open" onClick={() => setAttempt(n => n + 1)}>Reintentar</button></p>;
  const stepList = (activity, latest = false) => <ol className="pc-subagent-steps" ref={latest ? stepsRef : undefined} aria-label="Pasos del encargo">
    {activity.hidden > 0 && <li className="pc-subagent-hidden">{activity.hidden} pasos anteriores</li>}
    {activity.steps.map(step => { const [, Icon] = toolKind(step.kind); return <li key={step.id} className={`is-${step.status}`}><Icon size={14} aria-hidden="true" /><span className="pc-tool-name">{step.label}</span><span className="pc-tool-detail" title={step.detail}>{step.detail}</span><StepState status={step.status} /></li>; })}
  </ol>;
  return <section className="pc-subagent pc-phantom-run" aria-label={`Encargo Phantom ${id}`}>
    <header className="pc-subagent-head">
      <span className="pc-subagent-mark" aria-hidden="true"><PhantomGlyph size={16} /></span>
      <span className="pc-subagent-label">Encargo Phantom</span>
      <code className="pc-phantom-id" title={id}>{id.slice(0, 13)}</code>
      <span className={`pc-phantom-status is-${state.tone}`} role="status">{state.label}</span>
      {state.model && <span className="pc-subagent-type" title={state.model}>{state.model.split('/').at(-1)}</span>}
    </header>
    <p className="pc-subagent-goal" title={state.goal}>{state.goal}</p>
    {state.activity.runs.length <= 1 && state.activity.reason && <p className="pc-phantom-reason" role="alert">{state.activity.reason}</p>}
    {state.activity.runs.length === 1 && state.activity.runs[0].reasonRaw && state.activity.runs[0].reasonRaw !== state.activity.runs[0].reason && <details className="pc-subagent-more"><summary>Detalle técnico</summary><pre className="pc-phantom-reason">{state.activity.runs[0].reasonRaw}</pre></details>}
    {state.live && state.activity.current && <p className="pc-subagent-now" role="status" aria-label="Actividad actual"><LoaderCircle className="spinning" size={14} aria-hidden="true" /><span className="pc-tool-name">{state.activity.current.label}</span><span className="pc-tool-detail" title={state.activity.current.detail}>{state.activity.current.detail}</span></p>}
    <p className="pc-phantom-meta"><span>{state.phase}</span>{state.duration && <span>· {state.duration}</span>}{state.turns !== undefined && <span>· {state.turns} turnos</span>}{state.tools !== undefined && <span>· {state.tools} herramientas</span>}</p>
    {state.activity.runs.length > 1 ? <div className="pc-phantom-attempts">{state.activity.runs.map((run, index) => <details className="pc-subagent-more" key={run.runId} open={index === state.activity.runs.length - 1}>
      <summary><ChevronRight size={14} aria-hidden="true" />Intento {run.attempt} de {state.activity.runs.length}</summary>
      {run.reason && <p className="pc-phantom-reason" role="alert">{run.reason}</p>}
      {run.reasonRaw && run.reasonRaw !== run.reason && <details className="pc-subagent-more"><summary>Detalle técnico</summary><pre className="pc-phantom-reason">{run.reasonRaw}</pre></details>}
      {stepList(run, index === state.activity.runs.length - 1)}
    </details>)}</div> : (state.activity.total > 0 || state.activity.runs.length > 0 || state.activity.reason) && <details className="pc-subagent-more" open={open} onToggle={e => { if (e.target === e.currentTarget && e.currentTarget.open !== open) setChosen(e.currentTarget.open); }}>
      <summary><ChevronRight size={14} aria-hidden="true" />Pasos del encargo · {state.activity.total}</summary>
      {stepList(state.activity, true)}
    </details>}
    {state.line && <p className="pc-subagent-said">{state.line}</p>}
    {state.output && <details className="pc-subagent-more"><summary><ChevronRight size={14} aria-hidden="true" />Salida del ejecutor</summary><pre className="pc-subagent-prompt">{state.output}</pre></details>}
    {state.total > 0 && <details className="pc-subagent-more"><summary><ChevronRight size={14} aria-hidden="true" />Checks · {state.passed}/{state.total} pasados</summary><ul className="pc-phantom-checks">{state.checks.map((check, index) => <li key={index}>{check.name || `Check ${index + 1}`} · {check.result}</li>)}</ul></details>}
    {state.live && state.total > 0 && <progress className="pc-progress" max={state.total} value={state.passed} aria-label={`${state.passed} de ${state.total} checks pasados`} />}
    {onOpenPanel && <button type="button" className="pc-phantom-open" onClick={() => onOpenPanel('phantom-cards', { pluginId: 'phantom', panelId: 'cards', cardId: id }, state.goal)}>Abrir en Phantom</button>}
  </section>;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const KIND_PHRASE = {
  read: items => `leyó ${plural(new Set(items.map(part => part.detail || part.id)).size, 'archivo', 'archivos')}`,
  edit: items => `hizo ${plural(items.length, 'cambio', 'cambios')}`,
  shell: items => `ejecutó ${plural(items.length, 'comando', 'comandos')}`,
  search: items => `hizo ${plural(items.length, 'búsqueda', 'búsquedas')}`,
  web: items => `consultó ${plural(items.length, 'página', 'páginas')}`,
  todo: () => 'actualizó el plan',
  other: items => `usó ${plural(items.length, 'herramienta', 'herramientas')}`,
};
// A run of actions. Up to three stay in view; a longer run folds into one
// sentence of what was done (open while it is still working).
const ToolGroup = React.memo(function ToolGroup({ items }) {
  const live = items.some(part => part.status === 'running'), failed = items.some(part => part.status === 'error');
  const [chosen, setChosen] = useState(null);
  const list = <ul className="pc-tools" aria-label="Herramientas usadas">{items.map(part => <ToolRow key={part.id} part={part} />)}</ul>;
  if (items.length < 4) return list;
  const open = chosen ?? live, kinds = new Map();
  for (const part of items) { const [, , kind] = toolKind(part.name), key = KIND_PHRASE[kind] ? kind : 'other'; if (!kinds.has(key)) kinds.set(key, []); kinds.get(key).push(part); }
  const text = [...kinds].map(([kind, group]) => KIND_PHRASE[kind](group)).join(' · ');
  return <details className={`pc-steps${live ? ' is-live' : ''}${failed ? ' is-error' : ''}`} open={open} onToggle={e => { if (e.target === e.currentTarget && e.currentTarget.open !== open) setChosen(e.currentTarget.open); }}>
    <summary>
      <span className="pc-tool-mark" aria-hidden="true"><ChevronRight size={16} /></span>
      <span className="pc-steps-text">{text.charAt(0).toUpperCase() + text.slice(1)}</span>
      {failed && <span className="pc-tool-state is-error">con fallos</span>}
      <ChevronRight className="pc-tool-caret" size={14} aria-hidden="true" />
    </summary>
    {list}
  </details>;
}, (previous, next) => previous.items.length === next.items.length && previous.items.every((part, i) => part === next.items[i]));

// A delegation: the agent handed work to a sub-agent (Claude's Agent/Task,
// OpenCode's task, Codex's spawn_agent). Drawn as its own card in the turn so
// the user sees who was delegated, what it is doing now and how it ended.
const AGENT_STATE = { running: 'Trabajando', done: 'Terminó', error: 'Falló', stopped: 'Detenido' };
function StepState({ status }) {
  if (status === 'running') return <LoaderCircle className="pc-tool-state is-running" size={14} aria-label="En curso" />;
  if (status === 'error') return <X className="pc-tool-state is-error" size={14} aria-label="Falló" />;
  if (status === 'stopped') return <span className="pc-tool-state">detenido</span>;
  return <Check className="pc-tool-state is-done" size={14} aria-label="Completado" />;
}
export const SubagentCard = React.memo(function SubagentCard({ part }) {
  const [open, setOpen] = useState(false);
  const agent = part.agent || { steps: [] }, steps = agent.steps || [], total = Math.max(agent.total || 0, steps.length);
  const running = part.status === 'running', current = running ? steps.findLast(step => step.status === 'running') || steps.at(-1) : null;
  const hidden = total - steps.length;
  return <section className={`pc-subagent is-${part.status}`} aria-label={`Subagente${agent.type ? ` ${agent.type}` : ''}: ${part.detail || part.name}`}>
    <header className="pc-subagent-head">
      <span className="pc-subagent-mark" aria-hidden="true"><Cpu size={16} /></span>
      <span className="pc-subagent-label">Subagente</span>
      {agent.type && <span className="pc-subagent-type">{agent.type}</span>}
      <span className="pc-subagent-state" role="status">{running && <LoaderCircle className="spinning" size={14} aria-hidden="true" />}{AGENT_STATE[part.status] || part.status}{total > 0 && <span className="pc-num"> · {total} {total === 1 ? 'paso' : 'pasos'}</span>}</span>
    </header>
    <p className="pc-subagent-goal" title={part.detail}>{part.detail || part.name}</p>
    {current && <p className="pc-subagent-now"><span className="pc-tool-name">{current.name}</span><span className="pc-tool-detail" title={current.detail}>{current.detail}</span></p>}
    {agent.text && <p className="pc-subagent-said" title={agent.text}>{agent.text}</p>}
    {steps.length > 0 && <details className="pc-subagent-more">
      <summary><ChevronRight size={14} aria-hidden="true" />Pasos del subagente</summary>
      <ol className="pc-subagent-steps">
        {hidden > 0 && <li className="pc-subagent-hidden">{hidden} {hidden === 1 ? 'paso anterior' : 'pasos anteriores'} sin detalle</li>}
        {steps.map(step => { const [, Icon] = toolKind(step.name); return <li key={step.id} className={`is-${step.status}`}>
          <Icon size={14} aria-hidden="true" /><span className="pc-tool-name">{step.name}</span><span className="pc-tool-detail" title={step.detail}>{step.detail}</span><StepState status={step.status} />
        </li>; })}
      </ol>
    </details>}
    {agent.prompt && <details className="pc-subagent-more">
      <summary><ChevronRight size={14} aria-hidden="true" />Encargo</summary>
      <pre className="pc-subagent-prompt">{agent.prompt}</pre>
    </details>}
    {part.output && <details className="pc-subagent-more" onToggle={e => { if (e.target === e.currentTarget) setOpen(e.currentTarget.open); }}>
      <summary><ChevronRight size={14} aria-hidden="true" />Resultado</summary>
      <div className="pc-subagent-output">{open && <ToolOutput part={part} kind="agent" />}</div>
    </details>}
  </section>;
});
const isSubagent = part => part.type === 'tool' && Boolean(part.agent);
// Sub-agents still at work in a reply, for the "Trabajando" line.
export const activeSubagents = parts => parts.filter(part => isSubagent(part) && part.status === 'running').length;

const OTHER = '\u0000other';
const QUESTION_STATUS = { skipped: 'Sin responder · el agente sigue con su criterio', cancelled: 'La respuesta terminó antes de contestar' };
// AskUserQuestion: the agent is waiting on a choice. Each question is a
// native radio/checkbox group plus a free answer; the turn resumes on submit.
function QuestionCard({ part, onReply }) {
  const [picked, setPicked] = useState(() => part.questions.map(() => []));
  const [other, setOther] = useState(() => part.questions.map(() => ''));
  const [busy, setBusy] = useState(false);
  const pending = part.status === 'pending';
  const value = i => picked[i].map(label => label === OTHER ? other[i].trim() : label).filter(Boolean).join(', ');
  const complete = part.questions.every((_, i) => value(i));
  const toggle = (i, label, multi) => setPicked(all => all.map((list, j) => j !== i ? list : multi ? (list.includes(label) ? list.filter(l => l !== label) : [...list, label]) : [label]));
  const submit = async answers => {
    setBusy(true);
    try { await onReply?.(part.id, answers); } catch { setBusy(false); }
  };
  const send = event => { event.preventDefault(); if (complete && !busy) submit(Object.fromEntries(part.questions.map((q, i) => [q.question, value(i)]))); };
  if (!pending) return <div className={`pc-question is-${part.status}`}>
    <span className="pc-question-mark" aria-hidden="true"><MessageCircleQuestion size={14} /></span>
    <div className="pc-question-record">
      {part.status === 'answered'
        ? part.questions.map(q => <p key={q.question}><span>{q.header || q.question}</span><strong>{part.answers?.[q.question]}</strong></p>)
        : <p><span>{part.questions.map(q => q.header || q.question).join(' · ')}</span><em>{QUESTION_STATUS[part.status] || part.status}</em></p>}
    </div>
  </div>;
  return <form className="pc-question is-pending" onSubmit={send} aria-label="El agente te pregunta">
    <header className="pc-question-head"><span className="pc-question-mark" aria-hidden="true"><MessageCircleQuestion size={14} /></span><strong>{part.questions.length > 1 ? `${part.questions.length} preguntas para ti` : 'Pregunta para ti'}</strong><span>El agente espera tu respuesta</span></header>
    {part.questions.map((q, i) => {
      const type = q.multiSelect ? 'checkbox' : 'radio', name = `${part.id}-${i}`;
      const preview = q.options.find(o => picked[i].includes(o.label) && o.preview)?.preview;
      return <fieldset key={name} className="pc-question-group" disabled={busy}>
        <legend>{q.header && <span className="pc-question-chip">{q.header}</span>}{q.question}{q.multiSelect && <small> · elige una o varias</small>}</legend>
        <div className="pc-question-options">
          {q.options.map(option => <label key={option.label} className={`pc-option ${picked[i].includes(option.label) ? 'is-picked' : ''}`}>
            <input type={type} name={name} checked={picked[i].includes(option.label)} onChange={() => toggle(i, option.label, q.multiSelect)} />
            <span className="pc-option-text"><strong>{option.label}</strong>{option.description && <span>{option.description}</span>}</span>
          </label>)}
          <label className={`pc-option is-other ${picked[i].includes(OTHER) ? 'is-picked' : ''}`}>
            <input type={type} name={name} checked={picked[i].includes(OTHER)} onChange={() => toggle(i, OTHER, q.multiSelect)} />
            <span className="pc-option-text"><strong>Otra respuesta</strong>
              <input type="text" className="pc-option-input" aria-label={`Otra respuesta: ${q.question}`} placeholder="Escribe tu respuesta…" value={other[i]}
                onFocus={() => !picked[i].includes(OTHER) && toggle(i, OTHER, q.multiSelect)}
                onChange={e => setOther(all => all.map((v, j) => j === i ? e.target.value : v))}
                onKeyDown={e => e.stopPropagation()} />
            </span>
          </label>
        </div>
        {preview && <pre className="pc-question-preview" aria-label="Vista previa de la opción elegida">{preview}</pre>}
      </fieldset>;
    })}
    <footer className="pc-question-actions">
      <button type="button" disabled={busy} onClick={() => submit(null)}>No responder</button>
      <button type="submit" className="is-primary" disabled={busy || !complete}>{busy ? <LoaderCircle size={14} className="spinning" aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />}Responder</button>
    </footer>
  </form>;
}

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

export const Message = React.memo(function Message({ message, label, provider, model, onAnswer, onReply, api, workspaceId, onOpenPanel }) {
  if (message.role === 'user') return <blockquote className="pc-message is-user"><Markdown source={message.parts.map(part => part.text).join('\n')} /></blockquote>;
  return <AgentMessage message={message} label={label} provider={provider} model={model} onAnswer={onAnswer} onReply={onReply} api={api} workspaceId={workspaceId} onOpenPanel={onOpenPanel} />;
});

function AgentMessage({ message, label, provider, model, onAnswer, onReply, api, workspaceId, onOpenPanel }) {
  const streaming = message.status === 'streaming', usage = message.usage;
  const elapsed = useElapsed(message.createdAt, streaming);
  const waiting = message.parts.some(part => ['permission', 'question'].includes(part.type) && part.status === 'pending');
  const text = message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n');
  const groups = groupParts(message.parts.filter(part => !(part.type === 'permission' && part.status === 'pending')));
  const runIds = turnRunIds(message.parts);
  const delegated = streaming ? activeSubagents(message.parts) : 0;
  const facts = usage ? [usage.outputTokens ? `${formatTokens(usage.outputTokens)} tokens de salida` : '', Number.isFinite(usage.costUsd) && usage.costUsd > 0 ? formatCost(usage.costUsd) : ''].filter(Boolean) : [];
  const stamp = [message.model || model, streaming ? formatElapsed(elapsed) : formatDuration(usage?.durationMs) || clock(message.createdAt), ...facts].filter(Boolean).join(' · ');
  return <article className={`pc-message is-agent is-${message.status}`} aria-label={`Respuesta de ${label || provider}`}>
    {groups.map((group, i) => group.type === 'tools'
      ? <ToolGroup key={i} items={group.items} />
      : group.type === 'phantom'
        ? <div key={group.part.id} className="pc-phantom-link"><ToolGroup items={[group.part]} /><details className="pc-phantom-command"><summary>Comando original</summary><pre className="pc-subagent-prompt">{typeof group.part.input === 'string' ? group.part.input : group.part.input?.command || group.part.input?.cmd || group.part.detail}</pre></details></div>
      : group.type === 'subagent'
        ? <SubagentCard key={group.part.id} part={group.part} />
      : group.type === 'permission'
        ? <PermissionRow key={group.id} part={group} onAnswer={onAnswer} />
      : group.type === 'question'
        ? <QuestionCard key={group.id} part={group} onReply={onReply} />
      : group.type === 'thinking'
        ? <details key={i} className="pc-thinking"><summary><Brain size={14} aria-hidden="true" />Razonamiento<ChevronRight className="pc-tool-caret" size={14} aria-hidden="true" /></summary><p>{group.text}</p></details>
        : <Markdown key={i} source={group.text} streaming={streaming && i === groups.length - 1} />)}
    {runIds.length > 0 && <div className="pc-phantom-final" role="group" aria-label="Estado actual en Phantom">{runIds.map(id => <PhantomRunCard key={id} id={id} api={api} workspaceId={workspaceId} onOpenPanel={onOpenPanel} />)}</div>}
    {streaming && !waiting && <p className="pc-working" role="status"><span className="pc-tool-mark" aria-hidden="true"><LoaderCircle size={16} /></span>{message.parts.length ? 'Trabajando' : 'Pensando'}{delegated > 0 && <span className="pc-working-agents"> · {delegated === 1 ? '1 subagente activo' : `${delegated} subagentes activos`}</span>}</p>}
    {message.status === 'stopped' && <p className="pc-note">Respuesta detenida.</p>}
    {message.error && <p className="pc-note is-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{message.error}</span></p>}
    {(stamp || text) && <footer className="pc-turn-foot">{!streaming && text && <CopyButton text={text} label="Copiar respuesta" />}<time className="pc-num" dateTime={message.createdAt}>{stamp}</time></footer>}
  </article>;
}

// The model for this provider in this card. The list comes from the provider
// (OpenCode's catalog, Claude's aliases); any other model name can be typed.
export function ModelPicker({ node, workspace, api, notify, provider, label, observed, disabled, row = false }) {
  const selected = node.data.chat.models?.[provider] || null;
  const [open, setOpen] = useState(false), [catalog, setCatalog] = useState(null), [failure, setFailure] = useState(''), [query, setQuery] = useState('');
  const root = useRef(null), search = useRef(null);
  useEffect(() => { setOpen(false); setCatalog(null); }, [provider]);
  useEffect(() => {
    if (!open) return;
    setQuery(''); setFailure(''); search.current?.focus({ preventScroll: true });
    let stale = false;
    api('chat.models', { workspaceId: workspace.id, nodeId: node.id }).then(value => { if (!stale) setCatalog(value); }, e => { if (!stale) setFailure(e.message); });
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => { stale = true; document.removeEventListener('pointerdown', outside, true); };
  }, [open, api, workspace.id, node.id]);
  const choose = async model => {
    setOpen(false);
    if (model === selected) return;
    try { await api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, model }); } catch (e) { notify?.(e.message, 'error'); }
  };
  const needle = query.trim().toLowerCase(), items = (catalog?.items || []).filter(item => !needle || item.id.toLowerCase().includes(needle));
  const groups = []; for (const item of items) { const last = groups.at(-1); if (last?.name === item.group) last.items.push(item); else groups.push({ name: item.group, items: [item] }); }
  const custom = query.trim() && !catalog?.items.some(item => item.id === query.trim()) ? query.trim() : '';
  const shown = selected || observed;
  return <div ref={root} className="pc-model-picker" onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
    <button type="button" className={`pc-model ${shown ? '' : 'is-empty'}${row ? ' pc-session-row' : ''}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} title={selected ? `Modelo elegido para ${label}: ${selected}` : observed ? `Modelo predeterminado de ${label}: ${observed}` : `Se usa el modelo predeterminado de ${label}`} onClick={() => setOpen(value => !value)}>
      {row ? <><span className="pc-session-badge is-model"><Cpu size={18} aria-hidden="true" /></span><span className="pc-session-label">Modelo</span><span className="pc-session-value">{shown || 'Predeterminado'}</span><ChevronRight size={16} aria-hidden="true" /></> : <><ProviderGlyph provider={provider} size={14} /><span>{shown || 'modelo predeterminado'}</span><ChevronDown size={14} aria-hidden="true" /></>}
    </button>
    {open && <div className="pc-models" role="dialog" aria-label={`Modelo de ${label}`}>
      <input ref={search} type="text" value={query} placeholder="Buscar o escribir un modelo…" aria-label="Buscar modelo" spellCheck={false} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const first = custom || items[0]?.id; if (first) choose(first); } }} />
      <div className="pc-models-list" role="listbox" aria-label="Modelos disponibles">
        {!needle && <button type="button" role="option" aria-selected={!selected} onClick={() => choose(null)}><span>Predeterminado de {label}</span>{!selected && <Check size={14} aria-hidden="true" />}</button>}
        {groups.map(group => <React.Fragment key={group.name}><h4>{group.name}</h4>{group.items.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === selected} onClick={() => choose(item.id)}><span className="pc-mono">{item.id}</span>{item.id === selected && <Check size={14} aria-hidden="true" />}</button>)}</React.Fragment>)}
        {custom && <button type="button" role="option" aria-selected={false} onClick={() => choose(custom)}><span>Usar <span className="pc-mono">{custom}</span></span></button>}
        {!catalog && !failure && <p role="status">Leyendo modelos…</p>}
        {failure && <p role="alert">{failure}. Puedes escribir el nombre del modelo.</p>}
        {catalog && !items.length && !custom && <EmptyState size="compact" description="Ningún modelo coincide." />}
        {catalog?.note && <p>{catalog.note}</p>}
      </div>
    </div>}
  </div>;
}

// How much of the model's window the conversation occupies, as read from the
// provider. Without a known window only the occupied tokens are stated.
export function ReasoningPicker({ node, workspace, api, notify, provider, observed, disabled }) {
  const selected = node.data.chat.reasoning?.[provider] || '';
  const save = async next => {
    if (next === selected) return;
    try { await api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, reasoning: next || null }); }
    catch (error) { notify?.(error.message, 'error'); }
  };
  if (provider === 'opencode') return <VariantPicker key={provider} node={node} workspace={workspace} api={api} observed={observed} selected={selected} disabled={disabled} onChoose={save} />;
  return <EffortMenu key={provider} label="Effort" heading="Esfuerzo de razonamiento" ariaName={`Effort de ${provider}`} title="Esfuerzo de razonamiento; auto usa el predeterminado del proveedor" levels={EFFORTS[provider] || []} selected={selected} disabled={disabled} onChoose={save} />;
}

// OpenCode's variants belong to each model: the catalog (`opencode models
// --verbose`) names the ones the chosen model accepts.
function VariantPicker({ node, workspace, api, observed, selected, disabled, onChoose }) {
  const model = node.data.chat.models?.opencode || observed || '';
  const [catalog, setCatalog] = useState(null), [failure, setFailure] = useState('');
  useEffect(() => {
    let stale = false; setFailure('');
    api('chat.models', { workspaceId: workspace.id, nodeId: node.id }).then(value => { if (!stale) setCatalog(value); }, e => { if (!stale) setFailure(e.message); });
    return () => { stale = true; };
  }, [workspace.id, node.id, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = model ? catalog?.items?.find(entry => entry.id === model) : null;
  const levels = item?.variants || [];
  const note = failure ? `${failure}.`
    : !catalog ? 'Leyendo las variantes del modelo…'
    : !model ? 'Elige un modelo para ver sus variantes.'
    : !item ? `OpenCode no informa variantes de ${model}.`
    : !levels.length ? `${model} no tiene variantes.` : '';
  return <EffortMenu label="Variant" heading={model ? `Variantes de ${model}` : 'Variant'} ariaName="Variant de OpenCode" title="Variant del modelo en OpenCode; auto usa el predeterminado" levels={levels} selected={selected} note={note} disabled={disabled} onChoose={onChoose} />;
}

// Levels as a short ascending meter: the pill reads at a glance, the menu
// lines every option up against the same scale.
function EffortMeter({ level, total }) {
  const bars = Math.max(1, Math.min(total, 5)), filled = level < 0 ? 0 : Math.max(1, Math.round((level + 1) / Math.max(total, 1) * bars));
  return <span className="pc-effort-meter" aria-hidden="true">{Array.from({ length: bars }, (_, i) => <i key={i} className={i < filled ? 'is-on' : ''} style={{ height: `${4 + i * 2}px` }} />)}</span>;
}

function EffortMenu({ label, heading, ariaName, title, levels, selected, note, disabled, onChoose }) {
  // A saved value the current model no longer offers stays visible so it can be cleared.
  const stray = selected && !levels.includes(selected) ? selected : '';
  const options = ['', ...levels, ...(stray ? [stray] : [])];
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const root = useRef(null), list = useRef(null), trigger = useRef(null);
  const id = React.useId();
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.indexOf(selected)));
    list.current?.focus({ preventScroll: true });
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const choose = value => { close(); onChoose(value); };
  const keys = e => {
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move) { e.preventDefault(); setActive(i => (i + move + options.length) % options.length); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setActive(e.key === 'Home' ? 0 : options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  const level = levels.indexOf(selected);
  return <div ref={root} className="pc-effort">
    <button ref={trigger} type="button" className={`pc-reasoning ${selected ? '' : 'is-empty'} ${open ? 'is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label={`${ariaName}: ${selected || 'auto'}`} title={title} disabled={disabled}
      onClick={() => setOpen(value => !value)} onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); } }}>
      <EffortMeter level={stray ? -1 : level} total={levels.length || 3} />
      <span className="pc-reasoning-label">{label}</span>
      <span className="pc-reasoning-value">{selected || 'auto'}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div ref={list} className="pc-effort-menu" role="listbox" tabIndex={-1} aria-label={ariaName} aria-activedescendant={`${id}-${active}`} onKeyDown={keys}>
      <h4>{heading}</h4>
      {options.map((option, i) => <div key={option || 'auto'} id={`${id}-${i}`} role="option" aria-selected={option === selected} className={i === active ? 'is-active' : ''} onPointerEnter={() => setActive(i)} onClick={() => choose(option)}>
        <EffortMeter level={option === stray && stray ? -1 : i - 1} total={levels.length || 3} />
        <span>{option || 'auto'}</span>
        {!option && <small>predeterminado</small>}
        {option && option === stray && <small>no disponible en este modelo</small>}
        {option === selected && <Check size={14} aria-hidden="true" />}
      </div>)}
      {note && <p className="pc-effort-note" role="status">{note}</p>}
    </div>}
  </div>;
}

const share = ratio => ratio < .01 ? '<1' : String(Math.round(ratio * 100));
// The meter opens a panel that reads the context against quality/cost bands and
// offers compaction. `onCompact` is optional: until a provider wires it the
// action stays visible but disabled, so the recommendation is never a dead end.
export function ContextMeter({ meta, running = false, onCompact, onNew, reveal = 0 }) {
  const use = contextUse(meta);
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null), panel = useRef(null);
  const id = React.useId();
  // A bumped `reveal` opens the panel from outside, e.g. from the context nudge.
  useEffect(() => { if (reveal) setOpen(true); }, [reveal]);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  if (!use) return <span className="pc-context is-empty" title="El proveedor no ha expuesto una medición válida de la última petición">{running ? 'Operación en curso…' : 'Contexto no disponible'}{onCompact && <button type="button" disabled={running} onClick={onCompact}>Compactar…</button>}</span>;
  const advice = contextAdvice(use);
  const level = use.ratio >= .9 ? 'is-full' : use.ratio >= .7 ? 'is-high' : '';
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const perTurn = Number.isFinite(meta.costUsd) && meta.costUsd > 0 && meta.turns > 0 ? meta.costUsd / meta.turns : null;
  const bands = use.window
    ? [['ok', 'Óptima', `< ${CONTEXT_BANDS.watch * 100}%`], ['watch', 'Vigilar', `${CONTEXT_BANDS.watch * 100}–${CONTEXT_BANDS.compact * 100}%`], ['compact', 'Larga', `≥ ${CONTEXT_BANDS.compact * 100}%`]]
    : [['ok', 'Óptima', `< ${formatTokens(CONTEXT_TOKEN_BANDS.watch)}`], ['watch', 'Vigilar', `${formatTokens(CONTEXT_TOKEN_BANDS.watch)}–${formatTokens(CONTEXT_TOKEN_BANDS.compact)}`], ['compact', 'Larga', `≥ ${formatTokens(CONTEXT_TOKEN_BANDS.compact)}`]];
  // Without a window the scale ends at 1.5× the compaction size.
  const watchAt = use.window ? CONTEXT_BANDS.watch * 100 : 100 / 1.5 * CONTEXT_TOKEN_BANDS.watch / CONTEXT_TOKEN_BANDS.compact;
  const compactAt = use.window ? CONTEXT_BANDS.compact * 100 : 100 / 1.5;
  const compactBlocked = running ? 'Disponible cuando termine la respuesta' : '';
  return <span ref={root} className="pc-context-wrap">
    <button ref={trigger} type="button" className={`pc-context ${level} is-${advice.band} ${open ? 'is-open' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      title={use.window ? `${use.tokens.toLocaleString()} de ${use.window.toLocaleString()} tokens de contexto en uso · ${advice.title}` : `${use.tokens.toLocaleString()} tokens de contexto en uso · ${advice.title}`}
      onClick={() => setOpen(value => !value)}>
      {use.window && <span className="pc-context-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, use.ratio * 100))}%` }} /></span>}
      <span>{formatTokens(use.tokens)}{use.window ? ` / ${formatTokens(use.window)}` : ' tokens'}</span>
      {use.window && <span className="pc-context-share">{share(use.ratio)}%</span>}
      {advice.band === 'compact' && <span className="pc-context-flag">larga</span>}
    </button>
    {open && <div ref={panel} id={id} className={`pc-context-panel is-${advice.band}`} role="dialog" aria-label="Ventana de contexto" tabIndex={-1}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <header>
        <h4>Ventana de contexto</h4>
        <p className="pc-context-reading"><strong>{formatTokens(use.tokens)}</strong>{use.window ? <> de {formatTokens(use.window)} · <span className="pc-context-share">{share(use.ratio)}%</span></> : ' tokens · ventana no informada'}</p>
      </header>
      <div className="pc-context-scale" aria-hidden="true">
        <span className="pc-context-track" style={{ '--watch': `${watchAt}%`, '--compact': `${compactAt}%` }}>
          {use.window
            ? <i style={{ width: `${Math.max(1, Math.min(100, use.ratio * 100))}%` }} />
            : <i style={{ width: `${Math.max(1, Math.min(100, use.tokens / (CONTEXT_TOKEN_BANDS.compact * 1.5) * 100))}%` }} />}
          <b style={{ left: `${watchAt}%` }} />
          <b style={{ left: `${compactAt}%` }} />
        </span>
      </div>
      <ol className="pc-context-bands">
        {bands.map(([band, name, range]) => <li key={band} className={`is-${band} ${band === advice.band ? 'is-current' : ''}`} aria-current={band === advice.band ? 'true' : undefined}>
          <i aria-hidden="true" /><span>{name}</span><small>{range}</small>
        </li>)}
      </ol>
      {use.window && (advice.cause === 'size' || use.window * CONTEXT_BANDS.watch > CONTEXT_SIZE_CAPS.watch) && <p className={`pc-context-cap ${advice.cause === 'size' ? 'is-active' : ''}`}>
        En ventanas grandes también cuenta el tamaño: vigilar desde {formatTokens(CONTEXT_SIZE_CAPS.watch)} y compactar desde {formatTokens(CONTEXT_SIZE_CAPS.compact)} tokens, aunque el porcentaje sea bajo.
      </p>}
      <div className="pc-context-advice" role="status">
        <strong>{advice.title}</strong>
        <p>{advice.hint}</p>
      </div>
      {perTurn != null && <dl className="pc-context-facts">
        <div><dt>Costo acumulado</dt><dd>{formatCost(meta.costUsd)}</dd></div>
        <div><dt>Promedio por turno</dt><dd>{formatCost(perTurn)}</dd></div>
      </dl>}
      {onCompact ? <button type="button" className={`pc-context-compact ${advice.band === 'compact' ? 'is-primary' : ''}`} disabled={!!compactBlocked} title={compactBlocked || 'Resumir el historial y liberar la ventana'}
        onClick={() => { close(); onCompact(); }}>
        <FoldVertical size={14} aria-hidden="true" />Compactar…
      </button> : onNew && advice.band !== 'ok' && <button type="button" className={`pc-context-compact ${advice.band === 'compact' ? 'is-primary' : ''}`} disabled={!!compactBlocked} title={compactBlocked || undefined}
        onClick={() => { close(); onNew(); }}>
        <MessageSquarePlus size={14} aria-hidden="true" />Empezar conversación nueva
      </button>}
    </div>}
  </span>;
}

// A friendly, dismissible heads-up when the context crosses into a costlier band.
// Dismissing silences the current band only; dropping back (after compacting or
// a new conversation) re-arms it.
export function ContextNudge({ meta, nodeId, firstMessageId, onReveal }) {
  const use = contextUse(meta);
  const key = `phantom.chatNudge.${nodeId}.${firstMessageId}`;
  const [dismissed, setDismissed] = useState(() => {
    try { const value = Number(localStorage.getItem(key)); return [0, 1, 2].includes(value) ? value : 0; } catch { return 0; }
  });
  const rank = use ? BAND_RANK[contextAdvice(use).band] : null;
  useEffect(() => { setDismissed(previous => nudgeDismissal(previous, rank)); }, [rank]);
  useEffect(() => { try { localStorage.setItem(key, String(dismissed)); } catch { /* Memory only. */ } }, [key, dismissed]);
  const nudge = contextNudge(use, dismissed);
  if (!nudge) return null;
  return <section className={`pc-nudge is-${nudge.band}`} role="status" aria-label="Aviso de contexto">
    <Lightbulb size={15} aria-hidden="true" />
    <div><strong>{nudge.title}</strong><p>{nudge.body}</p></div>
    <span className="pc-nudge-actions">
      <button type="button" onClick={onReveal}>Ver opciones</button>
      <button type="button" className="pc-icon" title="Entendido" aria-label="Ocultar este aviso" onClick={() => setDismissed(nudge.rank)}><X size={14} /></button>
    </span>
  </section>;
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

export function SessionContext({ node, workspace, api, notify, provider, label, model, permissionMode, descriptions, running, ready = true }) {
  const { cwd, branch } = locationOf(node, workspace);
  return <section className="pc-session-section pc-session-context" aria-label="Contexto de la sesión">
    <h3>Contexto</h3>
    <div className="pc-context-rows">
      <details className="pc-folder"><summary className="pc-session-row"><span className="pc-session-badge is-folder"><Folder size={18} aria-hidden="true" /></span><span className="pc-session-label">Carpeta</span><span className="pc-session-value pc-mono" title={cwd}>{cwd}</span><ChevronRight size={16} aria-hidden="true" /></summary><p>{cwd}{branch && <><br />{AUTO_BRANCH.test(branch) ? 'Copia propia de esta sesión' : `Rama: ${branch}`}</>}</p></details>
      <PermissionSwitch row mode={permissionMode} provider={provider} descriptions={descriptions} disabled={!ready} onChange={next => api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, permissionMode: next }).catch(e => notify?.(e.message, 'error'))} />
      <ModelPicker row node={node} workspace={workspace} api={api} notify={notify} provider={provider} label={label} observed={model} disabled={!ready || running} />
    </div>
    <ReasoningPicker node={node} workspace={workspace} api={api} notify={notify} provider={provider} observed={model} disabled={!ready || running} />
  </section>;
}

export function CompactionControls({ chat, connected, capabilities, compact, continueSession, reveal = 0 }) {
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
  return <div>
    <ContextMeter meta={chat?.meta || {}} running={!!blocked || busy} reveal={reveal} onCompact={act} />
    {blocked && <small role="status">{blocked}</small>}
    {chat?.operation && <p role="status">{chat.operation === 'compact' ? 'Compactando con la API nativa…' : 'Comprobando capacidades instaladas…'} Puedes detener la operación.</p>}
    {latest && <p role="status">{latest.status === 'done' ? 'Compactación nativa verificada. La medición se actualizará con la próxima petición; no se calcula ahorro.' : latest.status === 'running' ? 'Compactación en curso.' : `Compactación sin verificar (${latest.status}): ${latest.error || ''}`}</p>}
    {continuation && <p role="status">{continuation.status === 'done' ? 'Sesión nueva de Codex confirmada; resumen e historial preservados.' : `Continuidad de Codex: ${continuation.status}${continuation.error ? ` · ${continuation.error}` : ''}`}</p>}
    {capability?.kind === 'continuation' && <section aria-label="Continuar Codex con resumen">
      <p>{capability.reason}</p>
      <label>Resumen para la sesión nueva (revísalo antes de enviar)<textarea value={summary} disabled={busy} onChange={event => setSummary(event.target.value)} maxLength={32768} /></label>
      <p>Se enviará este resumen a una sesión nueva con los mismos permisos y modelo. El historial anterior seguirá visible.</p>
      <button type="button" disabled={!!blocked || busy || !summary.trim()} onClick={proceed}>Crear sesión nueva y enviar resumen</button>
      <button type="button" disabled={busy} onClick={() => setCapability(null)}>Cancelar</button>
    </section>}
  </div>;
}

export default function ChatCard({ node, workspace, api, notify, overview = false, focused = false, connected = true, seen = false, onPulse, onOpenPanel }) {
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
  const recorderVoice = useVoiceRecorder({ api, workspaceId: workspace.id, scopeId: `${node.id}:${provider}`, enabled: connected && !overview,
    onText: text => {
      const merged = mergeDictation(draftRef.current, text), pendingSend = armedRef.current;
      arm(false); draftRef.current = merged; setDraft(merged);
      if (pendingSend) submitRef.current(merged, true);
    } });
  const voice = { ...recorderVoice, cancel: () => { arm(false); recorderVoice.cancel(); } };
  const listening = voice.status === 'recording';
  const dictating = listening || voice.status === 'transcribing';
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
  const runs = delegatedRuns(node.id, controllers);
  const delegation = delegationState(turnPhase, runs);
  const phase = delegation.phase, liveRuns = runs.live.length;
  const refreshRuns = useRef(null);
  refreshRuns.current = async () => {
    try { const response = await api('phantom.controllers', { workspaceId: workspace.id }); if (Array.isArray(response?.items)) setControllers(response.items); } catch { /* Se reintenta en el siguiente ciclo. */ }
  };
  useEffect(() => { if (connected && turnPhase === 'idle' && typeof api === 'function') refreshRuns.current(); }, [connected, turnPhase, workspace.id]);
  useEffect(() => {
    if (!connected || !liveRuns || typeof api !== 'function') return;
    const timer = setInterval(() => refreshRuns.current(), 3000);
    return () => clearInterval(timer);
  }, [connected, liveRuns, workspace.id]);
  const delegatedSince = runs.live.map(item => item.createdAt).filter(Boolean).sort()[0];
  const delegatedElapsed = useElapsed(delegatedSince, phase === 'delegating');
  const [ackedRun, setAckedRun] = useState(null);
  const finishedRun = delegation.outcome === 'attention' ? runs.latest : null;
  useEffect(() => { if (seen && finishedRun) setAckedRun(finishedRun.id); }, [seen, finishedRun?.id]);
  const delegating = phase === 'delegating', delegatingLabel = `Esperando ${liveRuns} ${liveRuns === 1 ? 'encargo' : 'encargos'} Phantom`;
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
  const context = <SessionContext node={node} workspace={workspace} api={api} notify={notify} provider={provider} label={label} model={model} permissionMode={permissionMode} running={running} ready={!!chat} />;
  if (overview) {
    const lastText = last?.parts.findLast?.(part => part.type === 'text')?.text;
    return <div className="pt-card pc is-overview" data-agent={waiting ? 'approval' : running ? 'working' : 'idle'}>
      <div className="pt-card-identity">
        <span className="pt-provider is-agent"><ProviderTile provider={provider} /><span>{label}</span></span>
        {(running || waiting) && <span className={`pt-state ${waiting ? 'is-approval' : 'is-working'}`}><i aria-hidden="true" />{waiting || 'Respondiendo'}</span>}
        {lastText && <p className="pt-card-step">{plainMarkdown(lastText).slice(-240)}</p>}
      </div>
    </div>;
  }
  return <div className={`pt-card pc ${focused ? 'is-focused' : ''}`} data-provider={provider} data-agent={waiting ? 'approval' : running ? 'working' : 'idle'}>
    <span className="pc-live" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    <div ref={thread} className="pc-thread" role="log" aria-label={`Conversación con ${label}`} aria-live="off" onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
      <div className="pc-column">
        {!messages.length && (!connected || !chat) && <p role="status">{connected ? 'Cargando la conversación…' : 'Sin conexión con el host'}</p>}
        {!messages.length && connected && chat && <div className="pc-session-new">
          <AgentChoices node={node} workspace={workspace} api={api} notify={notify} disabled={running} />
          <section className="pc-session-section"><h3>Interfaz</h3><ModeSwitch node={node} workspace={workspace} api={api} notify={notify} disabled={running} /></section>
          {context}
        </div>}
        {messages.map(message => <Message key={message.id} message={message} label={label} provider={provider} model={model} onAnswer={answer} onReply={reply} api={api} workspaceId={workspace.id} onOpenPanel={onOpenPanel} />)}
        {delegating && !running && !waiting && <p className="pc-working" role="status">{delegatingLabel} · <span className="pc-num">{formatElapsed(delegatedElapsed)}</span></p>}
      </div>
    </div>
    {error && <p className="pc-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{error}</span></p>}
    {pendingAsks.length > 0 && <div className="pc-dock">{pendingAsks.map(part => <PermissionRow key={part.id} part={part} onAnswer={answer} />)}</div>}
    <form className="pc-composer" data-dictating={voice.status !== 'idle' || undefined} onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Escape' && voice.status !== 'idle') { e.preventDefault(); e.stopPropagation(); voice.cancel(); } }}>
      <ContextNudge key={`${node.id}.${chat?.messages?.[0]?.id || 'empty'}`} nodeId={node.id} firstMessageId={chat?.messages?.[0]?.id || 'empty'} meta={meta} onReveal={() => setReveal(n => n + 1)} />
      <QueuedMessages queue={chat?.queue} running={running} connected={connected} unqueue={unqueue} resume={resume} notify={notify} onEdit={text => { setDraft(withEdited(text)); input.current?.focus({ preventScroll: true }); }} />
      {messages.length > 0 && <details className="pc-session-settings"><summary>Contexto de la sesión<ChevronDown size={16} aria-hidden="true" /></summary><AgentChoices node={node} workspace={workspace} api={api} notify={notify} disabled={running} /><ModeSwitch node={node} workspace={workspace} api={api} notify={notify} disabled={running} />{context}</details>}
      <div className="pc-field" onPointerDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
        {voice.error && <p className="voice-inline-error" role="alert">{voice.error}</p>}
        <div className="pc-input" data-preview={voice.status !== 'idle' || undefined}>
          <VoiceTranscript voice={voice} draft={draft} />
          <textarea ref={input} rows={1} value={preview} readOnly={voice.status !== 'idle'} disabled={!connected} aria-label={`Mensaje para ${label}`} placeholder={running ? `${label} está respondiendo · lo que envíes queda en espera` : `Escribe a ${label}…`} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        </div>
        <div className="pc-controls">
          <VoiceActivity voice={voice} hint="Esc descarta · Enter envía" />
          {voice.status === 'idle' && <button type="button" className="pc-icon pc-new-conversation" title="Conversación nueva" aria-label="Empezar una conversación nueva" disabled={running || !messages.length} onClick={() => clear().catch(() => {})}><MessageSquarePlus size={18} /></button>}
          {voice.status === 'idle' && <button type="button" className="phantom-chat-mic" disabled={!connected || voice.busyElsewhere} title={voice.busyElsewhere ? 'Otro dictado en curso: detén o cancela su audio' : `Dictar a ${label}`} aria-label={`Dictar a ${label}`} onClick={voice.start}><Mic size={18} /></button>}
          {running && <button type="button" className="pc-send is-stop" title="Detener respuesta" aria-label="Detener respuesta" onClick={() => stop().catch(() => {})}><Square size={14} /></button>}
          {(!running || draft.trim() || dictating || armed) && <button type="submit" className="pc-send" title={armed ? 'Se enviará al terminar la transcripción' : dictating ? 'Terminar dictado y enviar · Enter' : running ? 'Poner en espera · Enter' : 'Enviar · Enter'} aria-label={armed ? 'Se enviará al terminar la transcripción' : dictating ? 'Terminar dictado' : running ? 'Poner mensaje en espera' : 'Enviar mensaje'} aria-busy={armed} disabled={!canSubmit({ status: voice.status, draft, armed, sending, connected })}>{dictating || armed ? <Check size={18} /> : <ArrowUp size={18} />}</button>}
        </div>
      </div>
      <div className="pc-meta">
         <CompactionControls chat={chat} connected={connected} capabilities={capabilities} compact={compact} continueSession={continueSession} reveal={reveal} />
        <span className="pc-bar-space" />
        {voice.status === 'idle' && <kbd className="pc-hint">{running ? '↵ poner en espera' : '↵ enviar · ⇧↵ línea'}</kbd>}
      </div>
    </form>
  </div>;
}
import EmptyState from './EmptyState.jsx';
