import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Cpu, Check, ChevronDown, ChevronRight, Copy, FileText, Folder, GitBranch, Globe, ListChecks, LoaderCircle, MessageSquarePlus, Pencil, Search, ShieldAlert, ShieldCheck, ShieldOff, Square, SquareTerminal, Wrench, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { contextUse, formatCost, formatDuration, formatElapsed, formatTokens } from '../hooks/chatState';
import { locationOf } from './TerminalCard';
import Markdown, { CopyButton } from './Markdown';
import { ProviderGlyph, ProviderTile } from './Glyphs';
import { EFFORTS } from '../../shared/chat-options.mjs';

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
const AUTO_APPROVE = {
  claude: { on: 'Trabaja libremente dentro de su carpeta (ediciones, git local, npm, tests) y te pide permiso aquí antes de tocar algo fuera: otras carpetas, push, red o sistema.', off: 'Puede leer todo, pero te pide permiso aquí antes de cada cambio.' },
  opencode: { on: 'OpenCode aprueba todo permiso que no esté denegado explícitamente en su configuración.', off: 'OpenCode no puede pedir permisos en modo headless: solo lee y responde.' },
  codex: { on: 'Codex puede editar dentro de la carpeta con sandbox workspace-write. Los permisos que requieren confirmación se deniegan en modo headless.', off: 'Codex usa sandbox de solo lectura y no solicita aprobaciones en modo headless.' },
};
const PERMISSION_STATUS = { allowed: 'Aprobado', always: 'Aprobado siempre', denied: 'Rechazado', cancelled: 'Sin respuesta' };

// A permission the agent is waiting on, answered in place.
function PermissionRow({ part, onAnswer }) {
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

// Who answers in this card: an agent to chat with, or the plain terminal.
export function ModeSwitch({ node, workspace, api, notify, disabled = false }) {
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
  const navigate = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (disabled || choosing.current) return;
    const index = CARD_MODES.findIndex(mode => mode.id === active);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? 2 : 1)) % 3;
    event.currentTarget.querySelectorAll('button')[next]?.focus();
    choose(CARD_MODES[next].id);
  };
  return <div className="pc-modes" style={{ '--mode-index': CARD_MODES.findIndex(mode => mode.id === active) }} role="radiogroup" aria-label="Quién responde en esta card" aria-busy={pending !== undefined} onKeyDown={navigate} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    {CARD_MODES.map(mode => <button key={mode.label} type="button" role="radio" data-provider={mode.key} aria-label={mode.label} tabIndex={active === mode.id ? 0 : -1} aria-checked={active === mode.id} title={mode.hint} disabled={(disabled || pending !== undefined) && active !== mode.id} onClick={() => choose(mode.id)}><ProviderGlyph provider={mode.key} size={16} /><span>{mode.label}</span></button>)}
  </div>;
}

// Seconds since a turn started, ticking only while it runs.
function useElapsed(since, active) {
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

function ToolRow({ part }) {
  const [, Icon, kind] = toolKind(part.name);
  const summary = <>
    {part.output ? <ChevronRight className="pc-tool-caret" size={12} aria-hidden="true" /> : <span className="pc-tool-caret" aria-hidden="true" />}
    <span className="pc-tool-kind" data-kind={kind} aria-hidden="true"><Icon size={13} /></span>
    <span className="pc-tool-name">{part.name}</span>
    <span className="pc-tool-detail" title={part.detail}>{part.detail}</span>
    {part.diff && <span className="pc-tool-diff" aria-label={`${part.diff.added} líneas añadidas, ${part.diff.removed} quitadas`}><b>+{part.diff.added}</b><i>−{part.diff.removed}</i></span>}
    {part.status === 'running' && <LoaderCircle className="pc-tool-state is-running" size={12} aria-label="En curso" />}
    {part.status === 'error' && <span className="pc-tool-state is-error"><X size={12} aria-hidden="true" />falló</span>}
    {part.status === 'stopped' && <span className="pc-tool-state">detenida</span>}
    {part.status === 'done' && !part.diff && <Check className="pc-tool-state is-done" size={12} aria-label="Completada" />}
  </>;
  if (!part.output) return <li className={`pc-tool is-${part.status}`}><div className="pc-tool-row">{summary}</div></li>;
  return <li className={`pc-tool is-${part.status}`}><details><summary className="pc-tool-row">{summary}</summary><pre className="pc-tool-output">{part.output}</pre></details></li>;
}

// Consecutive tool calls read as one activity block between paragraphs of prose.
function groupParts(parts) {
  const groups = [];
  for (const part of parts) {
    const last = groups.at(-1);
    if (part.type === 'tool' && last?.type === 'tools') last.items.push(part);
    else groups.push(part.type === 'tool' ? { type: 'tools', items: [part] } : part);
  }
  return groups;
}
const clock = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); };

const Message = React.memo(function Message({ message, label, provider, model, onAnswer }) {
  if (message.role === 'user') return <div className="pc-message is-user"><p>{message.parts.map(part => part.text).join('\n')}</p></div>;
  return <AgentMessage message={message} label={label} provider={provider} model={model} onAnswer={onAnswer} />;
});

function AgentMessage({ message, label, provider, model, onAnswer }) {
  const streaming = message.status === 'streaming', usage = message.usage;
  const elapsed = useElapsed(message.createdAt, streaming);
  const text = message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n');
  const facts = usage ? [formatDuration(usage.durationMs), usage.outputTokens ? `${formatTokens(usage.outputTokens)} tokens de salida` : '', Number.isFinite(usage.costUsd) && usage.costUsd > 0 ? formatCost(usage.costUsd) : ''].filter(Boolean) : [];
  return <article className={`pc-message is-agent is-${message.status}`}>
    <header className="pc-turn-head"><span className="pc-avatar" aria-hidden="true"><ProviderGlyph provider={provider} size={13} /></span><strong>{label}</strong>{(message.model || model) && <span className="pc-mono">{message.model || model}</span>}<time dateTime={message.createdAt}>{clock(message.createdAt)}</time></header>
    {groupParts(message.parts).map((group, i) => group.type === 'tools'
      ? <ul key={i} className="pc-tools" aria-label="Herramientas usadas">{group.items.map(part => <ToolRow key={part.id} part={part} />)}</ul>
      : group.type === 'permission'
        ? <PermissionRow key={group.id} part={group} onAnswer={onAnswer} />
      : group.type === 'thinking'
        ? <details key={i} className="pc-thinking"><summary><ChevronRight size={12} aria-hidden="true" />Razonamiento</summary><p>{group.text}</p></details>
        : <Markdown key={i} source={group.text} />)}
    {streaming && <p className="pc-working" role="status"><span className="pc-dots" aria-hidden="true"><i /><i /><i /></span>{message.parts.length ? 'Trabajando' : 'Pensando'} · <span className="pc-num">{formatElapsed(elapsed)}</span></p>}
    {message.status === 'stopped' && <p className="pc-note">Respuesta detenida.</p>}
    {message.error && <p className="pc-note is-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{message.error}</span></p>}
    {!streaming && (facts.length > 0 || text) && <footer className="pc-turn-foot"><span className="pc-num">{facts.join(' · ')}</span>{text && <CopyButton text={text} label="Copiar respuesta" />}</footer>}
  </article>;
}

// The model for this provider in this card. The list comes from the provider
// (OpenCode's catalog, Claude's aliases); any other model name can be typed.
function ModelPicker({ node, workspace, api, notify, provider, label, observed, disabled }) {
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
      <ProviderGlyph provider={provider} size={12} /><span>{shown || 'modelo predeterminado'}</span><ChevronDown size={11} aria-hidden="true" />
    </button>
    {open && <div className="pc-models" role="dialog" aria-label={`Modelo de ${label}`}>
      <input ref={search} type="text" value={query} placeholder="Buscar o escribir un modelo…" aria-label="Buscar modelo" spellCheck={false} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const first = custom || items[0]?.id; if (first) choose(first); } }} />
      <div className="pc-models-list" role="listbox" aria-label="Modelos disponibles">
        {!needle && <button type="button" role="option" aria-selected={!selected} onClick={() => choose(null)}><span>Predeterminado de {label}</span>{!selected && <Check size={12} aria-hidden="true" />}</button>}
        {groups.map(group => <React.Fragment key={group.name}><h4>{group.name}</h4>{group.items.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === selected} onClick={() => choose(item.id)}><span className="pc-mono">{item.id}</span>{item.id === selected && <Check size={12} aria-hidden="true" />}</button>)}</React.Fragment>)}
        {custom && <button type="button" role="option" aria-selected={false} onClick={() => choose(custom)}><span>Usar <span className="pc-mono">{custom}</span></span></button>}
        {!catalog && !failure && <p role="status">Leyendo modelos…</p>}
        {failure && <p role="alert">{failure}. Puedes escribir el nombre del modelo.</p>}
        {catalog && !items.length && !custom && <p>Ningún modelo coincide.</p>}
        {catalog?.note && <p>{catalog.note}</p>}
      </div>
    </div>}
  </div>;
}

// How much of the model's window the conversation occupies, as read from the
// provider. Without a known window only the occupied tokens are stated.
function ReasoningPicker({ node, workspace, api, notify, provider, disabled }) {
  const selected = node.data.chat.reasoning?.[provider] || '';
  const [value, setValue] = useState(selected);
  useEffect(() => { setValue(selected); }, [selected, provider]);
  const save = async next => {
    if (next === selected) return;
    try { await api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, reasoning: next || null }); }
    catch (error) { setValue(selected); notify?.(error.message, 'error'); }
  };
  const label = provider === 'opencode' ? 'Variant' : 'Effort';
  return <label className="pc-reasoning"><span>{label}</span>{provider === 'opencode'
    ? <input key={provider} aria-label="Variant de OpenCode" title="Variant del modelo; depende del proveedor. Vacío usa el predeterminado." placeholder="predeterminado" value={value} maxLength={64} disabled={disabled} onChange={e => setValue(e.target.value)} onBlur={() => save(value.trim())} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); save(value.trim()); } }} />
    : <select aria-label={`Effort de ${provider}`} value={selected} disabled={disabled} onChange={e => save(e.target.value)}><option value="">predeterminado</option>{(EFFORTS[provider] || []).map(effort => <option key={effort} value={effort}>{effort}</option>)}</select>}</label>;
}

function ContextMeter({ meta }) {
  const use = contextUse(meta);
  if (!use) return <span className="pc-context is-empty" title="El uso de contexto se conoce tras la primera respuesta">contexto —</span>;
  const level = use.ratio >= .9 ? 'is-full' : use.ratio >= .7 ? 'is-high' : '';
  return <span className={`pc-context ${level}`} title={use.window ? `${use.tokens.toLocaleString()} de ${use.window.toLocaleString()} tokens de contexto en uso` : `${use.tokens.toLocaleString()} tokens de contexto en uso; este proveedor no informa el tamaño de la ventana`}>
    {use.window && <span className="pc-context-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, use.ratio * 100))}%` }} /></span>}
    <span>{formatTokens(use.tokens)}{use.window ? ` / ${formatTokens(use.window)}` : ' tokens'}</span>
    {use.window && <span className="pc-context-share">{use.ratio < .01 ? '<1' : Math.round(use.ratio * 100)}%</span>}
  </span>;
}

export default function ChatCard({ node, workspace, api, notify, overview = false, focused = false, connected = true }) {
  const provider = node.data.chat.provider, label = CARD_MODES.find(mode => mode.id === provider)?.label || provider;
  const { chat, error, send, stop, clear, answer } = useChat({ workspaceId: workspace.id, nodeId: node.id, provider, api, connected });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const thread = useRef(null), input = useRef(null), pinned = useRef(true);
  const running = !!chat?.running, messages = chat?.messages || [], meta = chat?.meta || {};
  // Mirrors the host: inside its own worktree the card works on its own by default.
  const autoApprove = node.data.chat.autoApprove ?? (provider === 'claude' && !!node.data.worktree);
  const waiting = messages.some(message => message.parts?.some(part => part.type === 'permission' && part.status === 'pending'));
  const { cwd, folder, branch } = locationOf(node, workspace);
  const last = messages.at(-1);
  const elapsed = useElapsed(last?.createdAt, running);
  // Follow the reply while the reader is at the end; never yank them back up.
  useLayoutEffect(() => { const el = thread.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [messages, overview, focused]);
  useEffect(() => { pinned.current = true; }, [provider]);
  useEffect(() => { if (focused) input.current?.focus({ preventScroll: true }); }, [focused, provider]);
  useLayoutEffect(() => {
    const el = input.current; if (!el) return;
    el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, focused ? 220 : 120)}px`;
  }, [draft, focused, overview]);
  const submit = async () => {
    const text = draft.trim();
    if (!text || running || sending || !connected) return;
    setSending(true); pinned.current = true;
    try { await send(text); setDraft(''); } catch { /* Shown inline by the hook. */ }
    finally { setSending(false); }
  };
  const model = meta.model, cost = Number.isFinite(meta.costUsd) && meta.costUsd > 0 ? formatCost(meta.costUsd) : '';
  if (overview) {
    const lastText = last?.parts.findLast?.(part => part.type === 'text')?.text;
    return <div className="pt-card pc is-overview" data-agent={running ? 'working' : 'idle'}>
      <div className="pt-card-identity">
        <span className="pt-provider is-agent"><ProviderTile provider={provider} /><span>{label}</span></span>
        {running && <span className="pt-state is-working"><i aria-hidden="true" />{waiting ? 'Espera tu permiso' : 'Respondiendo'}</span>}
        {lastText && <p className="pt-card-step">{lastText.slice(-240)}</p>}
      </div>
    </div>;
  }
  const Shield = autoApprove ? ShieldCheck : ShieldOff;
  return <div className={`pt-card pc ${focused ? 'is-focused' : ''}`} data-provider={provider} data-agent={running ? 'working' : 'idle'}>
    <div className="pc-bar">
      <ModeSwitch node={node} workspace={workspace} api={api} notify={notify} disabled={running} />
      {running && <span className="pt-state is-working" role="status"><i aria-hidden="true" />{waiting ? 'Espera tu permiso' : 'Respondiendo'}<span className="pc-num">{formatElapsed(elapsed)}</span></span>}
      <span className="pc-bar-space" />
      <button type="button" className="pc-icon" title="Conversación nueva" aria-label="Empezar una conversación nueva" disabled={running || !messages.length} onClick={() => clear().catch(() => {})}><MessageSquarePlus size={16} /></button>
    </div>
    <div className="pc-session-bar" aria-label="Contexto de la conversación">
      <span className="pc-location" title={cwd}>{branch ? <GitBranch size={12} aria-hidden="true" /> : <Folder size={12} aria-hidden="true" />}<span>{branch ? `${branch} · ${folder}` : folder}</span></span>
      <button type="button" className="pc-permission" aria-pressed={autoApprove} title={AUTO_APPROVE[provider]?.[autoApprove ? 'on' : 'off']} onClick={() => api('chat.configure', { workspaceId: workspace.id, nodeId: node.id, autoApprove: !autoApprove }).catch(e => notify?.(e.message, 'error'))}><Shield size={13} aria-hidden="true" /><span>{autoApprove ? (provider === 'claude' ? 'Autónomo' : 'Puede editar') : (provider === 'claude' ? 'Pregunta todo' : 'Solo lectura')}</span></button>
    </div>
    <div ref={thread} className="pc-thread" role="log" aria-label={`Conversación con ${label}`} aria-live="off" onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
      <div className="pc-column">
        {!messages.length && <div className="pc-empty">
          <h3>{chat && <ProviderTile provider={provider} />}{chat ? `Conversación nueva con ${label}` : connected ? 'Cargando la conversación…' : 'Sin conexión con el host'}</h3>
          {chat && <dl>
            <div><dt>Carpeta</dt><dd title={cwd}>{cwd}</dd></div>
            {branch && <div><dt>Rama</dt><dd>{branch}</dd></div>}
            <div><dt>Permisos</dt><dd className="is-prose">{AUTO_APPROVE[provider]?.[autoApprove ? 'on' : 'off']}</dd></div>
            <div><dt>Modelo</dt><dd className="is-prose">{node.data.chat.models?.[provider] || `El predeterminado de ${label}`}; cámbialo en la barra de abajo</dd></div>
          </dl>}
        </div>}
        {messages.map(message => <Message key={message.id} message={message} label={label} provider={provider} model={model} onAnswer={answer} />)}
      </div>
    </div>
    {error && <p className="pc-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{error}</span></p>}
    <form className="pc-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="pc-field" onPointerDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
        <textarea ref={input} rows={1} value={draft} disabled={!connected} aria-label={`Mensaje para ${label}`} placeholder={running ? `${label} está respondiendo…` : `Escribe a ${label}…`} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        <div className="pc-status">
          <ModelPicker node={node} workspace={workspace} api={api} notify={notify} provider={provider} label={label} observed={model} disabled={running} />
          <ReasoningPicker node={node} workspace={workspace} api={api} notify={notify} provider={provider} disabled={running} />
          <ContextMeter meta={meta} />
          {cost && <span className="pc-cost" title={`Costo acumulado de esta conversación · ${meta.turns || 0} ${meta.turns === 1 ? 'turno' : 'turnos'}`}>{cost}</span>}
          <span className="pc-bar-space" />
          <kbd className="pc-hint">{running ? 'respondiendo' : '↵ enviar · ⇧↵ línea'}</kbd>
          {running
            ? <button type="button" className="pc-send is-stop" title="Detener respuesta" aria-label="Detener respuesta" onClick={() => stop().catch(() => {})}><Square size={11} /></button>
            : <button type="submit" className="pc-send" title="Enviar · Enter" aria-label="Enviar mensaje" disabled={!draft.trim() || sending || !connected}><ArrowUp size={15} /></button>}
        </div>
      </div>
    </form>
  </div>;
}
