import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useComposerSize } from '../hooks/useComposerSize';
import { AlertCircle, ArrowUp, Brain, Cpu, Check, ChevronDown, ChevronRight, Copy, FileText, FoldVertical, Folder, GitBranch, Globe, Lightbulb, ListChecks, LoaderCircle, MessageCircleQuestion, MessageSquarePlus, Pencil, Search, ShieldAlert, ShieldCheck, ShieldOff, Square, SquareTerminal, Wrench, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { canSubmit, mergeDictation, sendAction } from '../hooks/voice-send.mjs';
import { VoiceActivity } from './VoiceActivity';
import { useVoiceDraft } from './VoiceProvider';
import { Mic } from 'lucide-react';
import { BAND_RANK, CONTEXT_BANDS, CONTEXT_SIZE_CAPS, CONTEXT_TOKEN_BANDS, contextAdvice, contextNudge, contextUse, formatCost, formatDuration, formatElapsed, formatTokens } from '../hooks/chatState';
import { locationOf } from './TerminalCard';
import Markdown, { CopyButton } from './Markdown';
import ToolOutput from './ToolOutput';
import { ProviderGlyph, ProviderTile } from './Glyphs';
import { EFFORTS } from '../../shared/chat-options.mjs';
import { plainMarkdown } from '../hooks/markdownTable.mjs';

export const CARD_MODES = [
  { id: 'claude', key: 'claude', label: 'Claude', hint: 'Conversar con Claude Code en esta carpeta' },
  { id: 'opencode', key: 'opencode', label: 'OpenCode', hint: 'Conversar con OpenCode en esta carpeta' },
  { id: 'codex', key: 'codex', label: 'Codex', hint: 'Conversar con Codex en esta carpeta' },
  { id: null, key: 'shell', label: 'Terminal', hint: 'Usar la sesión de terminal de esta card' },
];
const MODE_KEY = 'phantom.cardMode';
// New cards open in the mode chosen last; chat with Claude until one is chosen.
export function preferredCardMode() {
  try { const saved = localStorage.getItem(MODE_KEY); return saved === 'terminal' ? null : ['opencode', 'codex'].includes(saved) ? saved : 'claude'; } catch { return 'claude'; }
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
export function PermissionSwitch({ mode, provider, descriptions = AUTO_APPROVE, disabled, onChange }) {
  const Shield = mode === 'full' ? ShieldAlert : mode === 'auto' ? ShieldCheck : ShieldOff;
  const text = permissionLabel(mode, provider), next = NEXT_MODE[mode] || 'ask';
  return <button type="button" className="pc-permission" data-mode={mode} aria-pressed={mode !== 'ask'} disabled={disabled}
    aria-label={`Permisos: ${text}. Cambiar a ${permissionLabel(next, provider)}`} title={`${descriptions[provider]?.[mode] || ''}\n\nPulsa para cambiar a «${permissionLabel(next, provider)}».`}
    onClick={() => onChange(next)}><Shield size={14} aria-hidden="true" /><span>{text}</span></button>;
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

// An agent to chat with, or the plain terminal: the prominent choice.
export function ModeSwitch({ node, workspace, api, notify, disabled = false }) {
  const { active, pending, choosing, choose } = useModeChoice({ node, workspace, api, notify, disabled });
  const navigate = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (disabled || choosing.current) return;
    const count = CARD_MODES.length;
    const index = CARD_MODES.findIndex(mode => mode.id === active);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? count - 1 : 1)) % count;
    event.currentTarget.querySelectorAll('button')[next]?.focus();
    choose(CARD_MODES[next].id);
  };
  const activeMode = CARD_MODES.find(mode => mode.id === active) || CARD_MODES[0];
  return <div className="pc-modes" data-active={activeMode.key} style={{ '--mode-index': CARD_MODES.indexOf(activeMode), '--mode-count': CARD_MODES.length }} role="radiogroup" aria-label="Quién responde en esta card" aria-busy={pending !== undefined} onKeyDown={navigate} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    {CARD_MODES.map(mode => <button key={mode.label} type="button" role="radio" data-provider={mode.key} aria-label={mode.label} tabIndex={active === mode.id ? 0 : -1} aria-checked={active === mode.id} title={mode.hint} disabled={(disabled || pending !== undefined) && active !== mode.id} onClick={() => choose(mode.id)}><ProviderGlyph provider={mode.key} size={16} /><span>{mode.label}</span></button>)}
  </div>;
}

// The same choice, compact: "Claude ▾" opening a short menu downward.
function AgentSwitch({ node, workspace, api, notify, disabled = false }) {
  const { active, choose } = useModeChoice({ node, workspace, api, notify, disabled });
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null), menu = useRef(null);
  const mode = CARD_MODES.find(item => item.id === active) || CARD_MODES[0];
  const items = () => [...(menu.current?.querySelectorAll('[role="menuitemradio"]') || [])];
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    (items().find(item => item.getAttribute('aria-checked') === 'true') || items()[0])?.focus({ preventScroll: true });
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const onKeyDown = event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { if (event.key === 'Tab') setOpen(false); return; }
    event.preventDefault(); event.stopPropagation();
    if (!open) { if (!disabled && event.key !== 'Home' && event.key !== 'End') setOpen(true); return; }
    const list = items(), index = list.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + (event.key === 'ArrowUp' ? list.length - 1 : 1)) % list.length;
    list[next]?.focus({ preventScroll: true });
  };
  return <div ref={root} className="pc-agent" onKeyDown={onKeyDown} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    <button ref={trigger} type="button" className="pc-agent-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={`Quién responde: ${mode.label}`} title="Quién responde en esta card" disabled={disabled} onClick={() => setOpen(value => !value)}>
      <ProviderGlyph provider={mode.key} size={14} /><span>{mode.label}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div ref={menu} className="pc-agent-menu" role="menu" aria-label="Quién responde en esta card">
      {CARD_MODES.map(item => <button key={item.label} type="button" role="menuitemradio" aria-checked={item.id === active} tabIndex={-1} onClick={() => { close(); choose(item.id); }}>
        <ProviderGlyph provider={item.key} size={16} /><span>{item.label}<small>{item.hint}</small></span>{item.id === active && <Check size={14} aria-hidden="true" />}
      </button>)}
    </div>}
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

const TOOL_KINDS = [[/^(read|view|cat|notebookread)/, FileText, 'read'], [/^(edit|multiedit|write|patch|apply|notebookedit)/, Pencil, 'edit'], [/^(bash|shell|exec|run)/, SquareTerminal, 'shell'], [/^(grep|glob|search|list|ls|find|toolsearch)/, Search, 'search'], [/^(web|fetch)/, Globe, 'web'], [/^(task|agent)/, Cpu, 'agent'], [/^todo/, ListChecks, 'todo']];
const toolKind = name => TOOL_KINDS.find(([pattern]) => pattern.test(String(name).toLowerCase())) || [null, Wrench, 'other'];
const TOOL_LABELS = { read: 'Leer', edit: 'Editar', shell: 'Ejecutar', search: 'Buscar', web: 'Web', agent: 'Agente', todo: 'Tareas' };
const TOOL_STATES = { running: 'En curso', error: 'Falló', stopped: 'Detenida', done: 'Completada' };

// One action, one quiet line: its glyph, what it was, and on what. A finished
// step states nothing more; only running, failed and stopped ones speak up.
function ToolRow({ part }) {
  const [, Icon, kind] = toolKind(part.name);
  const expandable = Boolean(part.output || (kind === 'edit' && part.change));
  const label = part.detail ? TOOL_LABELS[kind] || part.name : part.name;
  const codeDetail = ['read', 'edit', 'shell', 'search', 'web'].includes(kind);
  const summary = <>
    <span className="pc-tool-kind" data-kind={kind} aria-hidden="true"><Icon size={14} /></span>
    <span className="pc-tool-label" title={part.name}>{label}</span>
    {part.detail && <span className={`pc-tool-detail${codeDetail ? ' is-code' : ''}`} title={part.detail}>{part.detail}</span>}
    {part.diff && <span className="pc-tool-diff" aria-label={`${part.diff.added} líneas añadidas, ${part.diff.removed} quitadas`}><b>+{part.diff.added}</b><i>−{part.diff.removed}</i></span>}
    {TOOL_STATES[part.status] && <span className={`pc-tool-state is-${part.status}`} role="img" aria-label={TOOL_STATES[part.status]} title={TOOL_STATES[part.status]}>
      {part.status === 'running' ? <LoaderCircle className="pc-tool-spinner" size={14} aria-hidden="true" />
        : part.status === 'error' ? <X size={14} aria-hidden="true" />
          : part.status === 'stopped' ? <Square size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
      {part.status !== 'done' && <span aria-hidden="true">{TOOL_STATES[part.status]}</span>}
    </span>}
    {expandable ? <ChevronRight className="pc-tool-caret" size={14} aria-hidden="true" /> : <span className="pc-tool-caret" aria-hidden="true" />}
  </>;
  if (!expandable) return <li className={`pc-tool is-${part.status}`}><div className="pc-tool-row">{summary}</div></li>;
  return <li className={`pc-tool is-${part.status}`}><details><summary className="pc-tool-row">{summary}</summary><div className="pc-tool-output">
    <p className="pc-tool-context"><span>{part.name}</span>{part.detail && (kind !== 'shell' || part.status === 'error') && <span className={codeDetail ? 'is-code' : undefined}>{part.detail}</span>}</p>
    <ToolOutput part={part} kind={kind} />
  </div></details></li>;
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
function ToolGroup({ items }) {
  const live = items.some(part => part.status === 'running'), failed = items.some(part => part.status === 'error');
  const [chosen, setChosen] = useState(null);
  const list = <ul className="pc-tools" aria-label="Herramientas usadas">{items.map(part => <ToolRow key={part.id} part={part} />)}</ul>;
  if (items.length < 4) return list;
  const open = chosen ?? live, kinds = new Map();
  for (const part of items) { const [, Icon, kind] = toolKind(part.name), key = KIND_PHRASE[kind] ? kind : 'other'; if (!kinds.has(key)) kinds.set(key, { Icon: key === 'other' ? Wrench : Icon, items: [] }); kinds.get(key).items.push(part); }
  const text = [...kinds].map(([kind, group]) => KIND_PHRASE[kind](group.items)).join(' · ');
  return <details className="pc-steps" open={open} onToggle={e => { if (e.target === e.currentTarget && e.currentTarget.open !== open) setChosen(e.currentTarget.open); }}>
    <summary>
      <span className="pc-steps-kinds" aria-hidden="true">{[...kinds].slice(0, 4).map(([kind, group]) => <group.Icon key={kind} size={14} />)}</span>
      <span className="pc-steps-text">{text.charAt(0).toUpperCase() + text.slice(1)}</span>
      {failed && <span className="pc-tool-state is-error">con fallos</span>}
      {live && <LoaderCircle className="pc-tool-state is-running" size={14} aria-label="En curso" />}
      <ChevronRight className="pc-tool-caret" size={14} aria-hidden="true" />
    </summary>
    {list}
  </details>;
}

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
export function SubagentCard({ part }) {
  const agent = part.agent || { steps: [] }, steps = agent.steps || [], total = Math.max(agent.total || 0, steps.length);
  const running = part.status === 'running', current = running ? steps.findLast(step => step.status === 'running') || steps.at(-1) : null;
  const hidden = total - steps.length;
  return <section className={`pc-subagent is-${part.status}`} aria-label={`Subagente${agent.type ? ` ${agent.type}` : ''}: ${part.detail || part.name}`}>
    <header className="pc-subagent-head">
      <span className="pc-subagent-mark" aria-hidden="true"><Cpu size={14} /></span>
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
    {part.output && <details className="pc-subagent-more">
      <summary><ChevronRight size={14} aria-hidden="true" />Resultado</summary>
      <div className="pc-subagent-output"><ToolOutput part={part} kind="agent" /></div>
    </details>}
  </section>;
}
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
    const last = groups.at(-1);
    if (part.type === 'tool' && last?.type === 'tools') last.items.push(part);
    else groups.push(part.type === 'tool' ? { type: 'tools', items: [part] } : part);
  }
  return groups;
}
const clock = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); };

export const Message = React.memo(function Message({ message, label, provider, model, onAnswer, onReply }) {
  if (message.role === 'user') return <div className="pc-message is-user"><Markdown source={message.parts.map(part => part.text).join('\n')} /></div>;
  return <AgentMessage message={message} label={label} provider={provider} model={model} onAnswer={onAnswer} onReply={onReply} />;
});

function AgentMessage({ message, label, provider, model, onAnswer, onReply }) {
  const streaming = message.status === 'streaming', usage = message.usage;
  const waiting = message.parts.some(part => ['permission', 'question'].includes(part.type) && part.status === 'pending');
  const text = message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n');
  const groups = groupParts(message.parts.filter(part => !(part.type === 'permission' && part.status === 'pending')));
  const delegated = streaming ? activeSubagents(message.parts) : 0;
  const facts = usage ? [formatDuration(usage.durationMs), usage.outputTokens ? `${formatTokens(usage.outputTokens)} tokens de salida` : '', Number.isFinite(usage.costUsd) && usage.costUsd > 0 ? formatCost(usage.costUsd) : ''].filter(Boolean) : [];
  const stamp = [message.model || model, clock(message.createdAt), ...facts].filter(Boolean).join(' · ');
  return <article className={`pc-message is-agent is-${message.status}`} aria-label={`Respuesta de ${label || provider}`}>
    {groups.map((group, i) => group.type === 'tools'
      ? <ToolGroup key={i} items={group.items} />
      : group.type === 'subagent'
        ? <SubagentCard key={group.part.id} part={group.part} />
      : group.type === 'permission'
        ? <PermissionRow key={group.id} part={group} onAnswer={onAnswer} />
      : group.type === 'question'
        ? <QuestionCard key={group.id} part={group} onReply={onReply} />
      : group.type === 'thinking'
        ? <details key={i} className="pc-thinking"><summary><Brain size={14} aria-hidden="true" />Razonamiento<ChevronRight className="pc-tool-caret" size={14} aria-hidden="true" /></summary><p>{group.text}</p></details>
        : <Markdown key={i} source={group.text} streaming={streaming && i === groups.length - 1} />)}
    {streaming && !waiting && <p className="pc-working"><span className="pc-dots" aria-hidden="true"><i /><i /><i /></span>{message.parts.length ? 'Trabajando' : 'Pensando'}{delegated > 0 && <span className="pc-working-agents"> · {delegated === 1 ? '1 subagente activo' : `${delegated} subagentes activos`}</span>}</p>}
    {message.status === 'stopped' && <p className="pc-note">Respuesta detenida.</p>}
    {message.error && <p className="pc-note is-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{message.error}</span></p>}
    {!streaming && (stamp || text) && <footer className="pc-turn-foot">{text && <CopyButton text={text} label="Copiar respuesta" />}<time className="pc-num" dateTime={message.createdAt}>{stamp}</time></footer>}
  </article>;
}

// The model for this provider in this card. The list comes from the provider
// (OpenCode's catalog, Claude's aliases); any other model name can be typed.
export function ModelPicker({ node, workspace, api, notify, provider, label, observed, disabled }) {
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
    <button type="button" className={`pc-model ${shown ? '' : 'is-empty'}`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} title={selected ? `Modelo elegido para ${label}: ${selected}` : observed ? `Modelo predeterminado de ${label}: ${observed}` : `Se usa el modelo predeterminado de ${label}`} onClick={() => setOpen(value => !value)}>
      <ProviderGlyph provider={provider} size={14} /><span>{shown || 'modelo predeterminado'}</span><ChevronDown size={14} aria-hidden="true" />
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
  if (!use) return <span className="pc-context is-empty" title="El proveedor no ha expuesto una medición válida de la última petición">Contexto no disponible</span>;
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
        <FoldVertical size={14} aria-hidden="true" />Resumir conversación
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
export function ContextNudge({ meta, onReveal }) {
  const use = contextUse(meta);
  const [dismissed, setDismissed] = useState(0);
  const rank = BAND_RANK[contextAdvice(use)?.band ?? 'ok'];
  useEffect(() => { if (rank < dismissed) setDismissed(rank); }, [rank, dismissed]);
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

export default function ChatCard({ node, workspace, api, notify, overview = false, focused = false, connected = true, seen = false, onPulse }) {
  const provider = node.data.chat.provider, label = CARD_MODES.find(mode => mode.id === provider)?.label || provider;
  const { chat, error, send, stop, clear, answer, reply, unqueue, resume } = useChat({ workspaceId: workspace.id, nodeId: node.id, provider, api, connected });
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
  const { cwd, folder, branch, where } = locationOf(node, workspace);
  // Announce transitions only, never the state found on mount.
  const [announcement, setAnnouncement] = useState('');
  const phase = waiting ? 'waiting' : running ? 'running' : 'idle', seenPhase = useRef(null);
  useEffect(() => {
    if (!chat) return;
    const before = seenPhase.current; seenPhase.current = phase;
    if (before === null || before === phase) return;
    setAnnouncement(phase === 'running' ? `${label} está respondiendo` : phase === 'waiting' ? `${label} ${waiting.toLowerCase()}` : `${label} terminó de responder`);
  }, [phase, chat, label]);
  const last = messages.at(-1);
  const elapsed = useElapsed(last?.createdAt, running);
  const pulse = useChatPulse({ nodeId: node.id, chat, running, waitingOn, last, seen });
  useEffect(() => { onPulse?.(node.id, pulse); }, [onPulse, node.id, pulse]);
  useEffect(() => () => onPulse?.(node.id, ''), [onPulse, node.id]);
  // Follow the reply while the reader is at the end; never yank them back up.
  useLayoutEffect(() => { const el = thread.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [messages, overview, focused, pendingAsks.length]);
  useEffect(() => { pinned.current = true; }, [provider]);
  useEffect(() => { if (focused) input.current?.focus({ preventScroll: true }); }, [focused, provider]);
  useComposerSize(input, draft, !overview);
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
  const model = meta.model, cost = Number.isFinite(meta.costUsd) && meta.costUsd > 0 ? formatCost(meta.costUsd) : '';
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
    <div className="pc-bar">
      <AgentSwitch node={node} workspace={workspace} api={api} notify={notify} disabled={running} />
      <span className="pc-location" title={cwd}>{branch ? <GitBranch size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}<span>{where}</span></span>
      {(running || waiting) && (waiting
        ? <span className="pt-state is-approval"><i aria-hidden="true" />{waiting}</span>
        : <span className="pt-state is-working"><i aria-hidden="true" />Respondiendo<span className="pc-num">{formatElapsed(elapsed)}</span></span>)}
      <span className="pc-bar-space" />
      <button type="button" className="pc-icon" title="Conversación nueva" aria-label="Empezar una conversación nueva" disabled={running || !messages.length} onClick={() => clear().catch(() => {})}><MessageSquarePlus size={16} /></button>
    </div>
    <span className="pc-live" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    <div ref={thread} className="pc-thread" role="log" aria-label={`Conversación con ${label}`} aria-live="off" onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
      <div className="pc-column">
        {!messages.length && (!connected || !chat) && <p role="status">{connected ? 'Cargando la conversación…' : 'Sin conexión con el host'}</p>}
        {!messages.length && connected && chat && <EmptyState className="pc-empty" icon={<ProviderTile provider={provider} />} title={`Conversación nueva con ${label}`}>
          {chat && <ModeSwitch node={node} workspace={workspace} api={api} notify={notify} disabled={running} />}
          {chat && <dl className="pc-conversation-facts">
            <div><dt>Carpeta</dt><dd title={cwd}>{branch && AUTO_BRANCH.test(branch) ? `${workspace?.name || folder} · copia propia de esta sesión` : cwd}</dd></div>
            {branch && !AUTO_BRANCH.test(branch) && <div><dt>Rama</dt><dd>{branch}</dd></div>}
            <div><dt>Permisos</dt><dd className="is-prose">{AUTO_APPROVE[provider]?.[permissionMode]}</dd></div>
            <div><dt>Modelo</dt><dd className="is-prose">{node.data.chat.models?.[provider] || `El predeterminado de ${label}`}</dd></div>
          </dl>}
        </EmptyState>}
        {messages.map(message => <Message key={message.id} message={message} label={label} provider={provider} model={model} onAnswer={answer} onReply={reply} />)}
      </div>
    </div>
    {error && <p className="pc-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{error}</span></p>}
    {pendingAsks.length > 0 && <div className="pc-dock">{pendingAsks.map(part => <PermissionRow key={part.id} part={part} onAnswer={answer} />)}</div>}
    <form className="pc-composer" onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Escape' && voice.status !== 'idle') { e.preventDefault(); e.stopPropagation(); voice.cancel(); } }}>
      <ContextNudge key={chat?.messages?.[0]?.id || 'empty'} meta={meta} onReveal={() => setReveal(n => n + 1)} />
      <QueuedMessages queue={chat?.queue} running={running} connected={connected} unqueue={unqueue} resume={resume} notify={notify} onEdit={text => { setDraft(withEdited(text)); input.current?.focus({ preventScroll: true }); }} />
      <div className={`pc-field ${listening ? 'is-listening' : ''}`} style={{ '--voice-level': voice.level }} onPointerDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
        <VoiceActivity voice={voice} />
        {voice.error && <p className="voice-inline-error" role="alert">{voice.error}</p>}
        <textarea ref={input} rows={1} value={draft} disabled={!connected} aria-label={`Mensaje para ${label}`} placeholder={running ? `${label} está respondiendo · lo que envíes queda en espera` : `Escribe a ${label}…`} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        <div className="pc-controls">
          <div className="pc-settings">
            <ModelPicker node={node} workspace={workspace} api={api} notify={notify} provider={provider} label={label} observed={model} disabled={running} />
            <ReasoningPicker node={node} workspace={workspace} api={api} notify={notify} provider={provider} observed={model} disabled={running} />
            <PermissionSwitch mode={permissionMode} provider={provider} onChange={next => api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, permissionMode: next }).catch(e => notify?.(e.message, 'error'))} />
          </div>
          <button type="button" className={`phantom-chat-mic ${listening ? 'is-live' : ''}`} aria-pressed={listening} disabled={!connected || voice.busyElsewhere || ['requesting', 'transcribing'].includes(voice.status)} title={voice.busyElsewhere ? 'Otro dictado en curso: detén o cancela su audio' : listening ? 'Detener y transcribir' : `Dictar a ${label}`} aria-label={listening ? 'Detener y transcribir' : `Dictar a ${label}`} onClick={listening ? voice.stop : voice.start}>{listening ? <Square size={14} /> : <Mic size={16} />}</button>
          {running && <button type="button" className="pc-send is-stop" title="Detener respuesta" aria-label="Detener respuesta" onClick={() => stop().catch(() => {})}><Square size={14} /></button>}
          {(!running || draft.trim() || dictating || armed) && <button type="submit" className="pc-send" title={armed ? 'Se enviará al terminar la transcripción' : dictating ? 'Detener dictado y enviar · Enter' : running ? 'Poner en espera · Enter' : 'Enviar · Enter'} aria-label={armed ? 'Se enviará al terminar la transcripción' : dictating ? 'Detener dictado y enviar' : running ? 'Poner mensaje en espera' : 'Enviar mensaje'} aria-busy={armed} disabled={!canSubmit({ status: voice.status, draft, armed, sending, connected })}>{armed ? <LoaderCircle size={16} className="spinning" /> : <ArrowUp size={16} />}</button>}
        </div>
      </div>
      <div className="pc-meta">
        <ContextMeter meta={meta} running={running} reveal={reveal} onNew={() => clear().catch(() => {})} />
        {cost && <span className="pc-cost" title={`Costo acumulado de esta conversación · ${meta.turns || 0} ${meta.turns === 1 ? 'turno' : 'turnos'}`}>{cost}</span>}
        <span className="pc-bar-space" />
        <kbd className="pc-hint">{running ? '↵ poner en espera' : '↵ enviar · ⇧↵ línea'}</kbd>
      </div>
    </form>
  </div>;
}
import EmptyState from './EmptyState.jsx';
