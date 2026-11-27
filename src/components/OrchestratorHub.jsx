import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, ChevronDown, ChevronRight, ClipboardList, GitMerge, Inbox, LoaderCircle, Mic, RefreshCw, SquareTerminal, X } from 'lucide-react';
import { Message, PermissionRow } from './ChatCard';
import { useChat } from '../hooks/useChat';
import { orchestratorNode } from '../hooks/phantom-dock.mjs';
import { useComposerSize } from '../hooks/useComposerSize';
import { useOrchestratorInbox } from '../hooks/useOrchestratorInbox';
import { routeTarget, supervisorLine } from '../hooks/orchestrator-inbox.mjs';
import { ago } from '../hooks/activityModel.mjs';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { VoiceActivity, VoiceTranscript, dictationPreview } from './VoiceActivity';
import { canSubmit, mergeDictation, sendAction } from '../hooks/voice-send.mjs';
import { useVoiceDraft } from './VoiceProvider';
import '../orchestrator-hub.css';

const DRAFT_KEY = 'orchestrator-hub';
const KIND = { session: 'Sesión', task: 'Encargo', card: 'Card', integration: 'Incorporación' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clock = iso => { const at = Date.parse(iso); return Number.isFinite(at) ? new Date(at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : ''; };

function countLabel(pending, broken) {
  const parts = [broken > 0 && plural(broken, 'cosa rota', 'cosas rotas'), pending > 0 && plural(pending, 'te necesita', 'te necesitan')].filter(Boolean);
  return parts.length ? parts.join(', ') : 'nada pendiente';
}

function Counts({ pending, broken }) {
  return <>
    {broken > 0 && <span className="oh-count" data-tone="danger" aria-hidden="true">{broken}</span>}
    {pending > 0 && <span className="oh-count" data-tone="attention" aria-hidden="true">{pending}</span>}
  </>;
}

export function OrchestratorHubButton({ pending = 0, broken = 0, active = false, onClick }) {
  return <button type="button" className="oh-button" aria-pressed={active} aria-label={`Orquestador: ${countLabel(pending, broken)}`} title="Orquestador" onClick={onClick}>
    <Inbox size={16} aria-hidden="true" /><span className="oh-button-label">Orquestador</span><Counts pending={pending} broken={broken} />
  </button>;
}

export function OrchestratorRailEntry({ pending = 0, broken = 0, active = false, onClick }) {
  return <button type="button" className="oh-rail" aria-current={active ? 'page' : undefined} aria-label={`Orquestador: ${countLabel(pending, broken)}`} onClick={onClick}>
    <Inbox size={18} aria-hidden="true" /><span className="oh-rail-label">Orquestador</span><Counts pending={pending} broken={broken} />
  </button>;
}

// Where each row's single action leads. Sessions and permissions only bring the
// project and its node forward; cards and incorporations open their panel.
function openRow(row, { onOpenPanel, onSelectWorkspace }) {
  const { kind, target } = row.action;
  if (kind === 'open-session' || kind === 'answer-permission') { onSelectWorkspace?.(row.workspaceId, { nodeId: target }); return; }
  onSelectWorkspace?.(row.workspaceId);
  if (kind === 'review-integration') onOpenPanel?.('incorporaciones', { requestId: target }, 'Incorporaciones', row.workspaceId);
  else onOpenPanel?.('phantom-cards', { pluginId: 'phantom', panelId: 'cards', cardId: target, ...(kind === 'retry' ? { resolve: true } : {}) }, row.title, row.workspaceId);
}

const KIND_ICON = { session: SquareTerminal, task: ClipboardList, card: ClipboardList, integration: GitMerge };

function Row({ row, tone, now, handlers, primary }) {
  const when = row.at ? ago(Date.parse(row.at), now) : '';
  const label = row.action?.label || 'Abrir';
  const Icon = KIND_ICON[row.kind] || ClipboardList;
  return <li className="oh-row" data-tone={tone}>
    <span className="oh-disc" aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span>
    <div className="oh-row-main">
      <p className="oh-row-title">{row.title}</p>
      <p className="oh-row-head"><span className="oh-kind">{KIND[row.kind] || 'Elemento'}</span> · <span className="oh-state">{row.state}</span>{when && <> · <time className="oh-when" dateTime={row.at}>{when}</time></>}</p>
      {row.reason && <p className="oh-row-reason">{row.reason}</p>}
    </div>
    {row.action && <button type="button" className={`oh-action${primary ? ' is-primary' : ''}`} data-oh-nav="" aria-label={`${label}: ${row.title}`} onClick={() => openRow(row, handlers)}>{label}</button>}
  </li>;
}

function Group({ id, title, tone, projects, pick, now, handlers, primary = false }) {
  const withRows = projects.filter(project => pick(project).length > 0);
  const total = withRows.reduce((n, project) => n + pick(project).length, 0);
  if (!total) return null;
  return <section className="oh-group" data-tone={tone} aria-labelledby={id}>
    <h3 id={id} className="oh-group-title">{title}<span className="oh-group-count">{total}</span></h3>
    {withRows.map((project, at) => <div key={project.workspaceId} className="oh-project">
      <h4 className="oh-project-name">{project.name}</h4>
      <ul className="oh-rows" aria-label={`${title} · ${project.name}`}>{pick(project).map((row, index) => <Row key={row.id} row={row} tone={tone} now={now} handlers={handlers} primary={primary && at === 0 && index === 0} />)}</ul>
    </div>)}
  </section>;
}

function SupervisorLine({ data, now }) {
  const line = supervisorLine(data, now);
  const rest = [line.calls, line.ago && `resumen ${line.ago}`].filter(Boolean).map(part => ` · ${part}`).join('');
  return <div className="oh-sup" data-tone={line.tone}>
    <p className="oh-sup-summary">{line.summary ? <>{line.summary.text}{line.summary.at && <time className="oh-when" dateTime={line.summary.at}> · {clock(line.summary.at)}</time>}</> : <span className="oh-muted">Aún sin resumen.</span>}</p>
    <p className="oh-sup-meta">Supervisor: <span className="oh-sup-state">{line.state}</span>{rest}</p>
    {line.alerts.length > 0 && <ul className="oh-sup-alerts" aria-label="Avisos del supervisor">{line.alerts.map((alert, index) => <li key={index}>{alert}</li>)}</ul>}
  </div>;
}

function Projects({ projects, now, handlers }) {
  return <section className="oh-group" aria-labelledby="oh-projects">
    <h3 id="oh-projects" className="oh-group-title">Por proyecto</h3>
    <ul className="oh-fine" aria-label="Estado por proyecto">{projects.map(project => {
      const open = project.broken.length + project.needsYou.length;
      return <li key={project.workspaceId} className="oh-fine-item">
        <div className="oh-fine-line">
          <span className="oh-project-name">{project.name}</span>
          <span className="oh-fine-text">{open ? countLabel(project.needsYou.length, project.broken.length) : project.fine.line}</span>
          <button type="button" className="oh-link" data-oh-nav="" aria-label={`Ir a ${project.name}`} onClick={() => handlers.onSelectWorkspace?.(project.workspaceId)}>Ir</button>
        </div>
        {project.readErrors.length > 0 && <p className="oh-fine-error" role="status">No se pudo leer todo: {project.readErrors[0]}</p>}
        <SupervisorLine data={project.supervisor} now={now} />
      </li>;
    })}</ul>
  </section>;
}

const THREAD_LIMIT = 20;

// The conversation with the target project's orchestrator, read in place. Chat
// orchestrators show their thread; a terminal one points to its session.
function Thread({ name, workspaceId, node, chat, error, connected, answer, reply, api, onOpenPanel, onSelectWorkspace }) {
  const [choice, setChoice] = useState(null);
  const thread = useRef(null), pinned = useRef(true);
  const messages = chat?.messages || [];
  const shown = messages.slice(-THREAD_LIMIT);
  const asks = shown.flatMap(message => (message.parts || []).filter(part => part.type === 'permission' && part.status === 'pending'));
  const expanded = choice ?? messages.length > 0;
  useLayoutEffect(() => { const el = thread.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [messages, asks.length, expanded]);
  const bodyId = `oh-thread-${workspaceId}`;
  return <section className="oh-thread" aria-label={`Conversación con el orquestador de ${name}`}>
    <button type="button" className="oh-thread-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setChoice(!expanded)}>
      {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      <span>Conversación</span>{messages.length > 0 && <span className="oh-thread-count">{plural(messages.length, 'mensaje', 'mensajes')}</span>}
      {chat?.running && <span className="oh-thread-state">Trabajando…</span>}
    </button>
    {expanded && <div id={bodyId} ref={thread} className="pc-thread phantom-chat-thread" role="log" aria-label={`Mensajes del orquestador de ${name}`} aria-live="off" onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
      <div className="pc-column">
        {!messages.length && !error && <p className="oh-muted" role="status">{chat ? 'Aún no hay mensajes. Escribe abajo para empezar.' : connected ? 'Cargando la conversación…' : 'Sin conexión con el host'}</p>}
        {shown.map(message => <Message key={message.id} message={message} label="Orquestador" provider={chat.provider} onAnswer={answer} onReply={reply} api={api} workspaceId={workspaceId} onOpenPanel={onOpenPanel} />)}
        {chat?.running && <p className="pc-working" role="status"><LoaderCircle size={16} aria-hidden="true" />Trabajando…</p>}
        {asks.length > 0 && <div className="pc-dock">{asks.map(part => <PermissionRow key={part.id} part={part} onAnswer={answer} />)}</div>}
      </div>
    </div>}
    {error && <p className="pc-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{error}</span></p>}
  </section>;
}

function ThreadLine({ name, workspaceId, node, onSelectWorkspace }) {
  if (!node) return <p className="oh-thread-line oh-muted">Aún no hay orquestador en {name}. Tu primer mensaje lo crea.</p>;
  return <div className="oh-thread-line"><p>El orquestador de {name} corre como terminal</p>
    <button type="button" className="oh-link" onClick={() => onSelectWorkspace?.(workspaceId, { nodeId: node.id })}>Abrir sesión</button></div>;
}

function Composer({ inbox, target, name, onPick, send, api, connected, notify }) {
  const [draft, setDraft] = useVoiceDraft(DRAFT_KEY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [armed, setArmed] = useState(false);
  // Sent log: only when the project's orchestrator has no chat thread to show the message in.
  const [log, setLog] = useState([]);
  const seq = useRef(0), thread = useRef(null);
  useEffect(() => { const el = thread.current; if (el) el.scrollTop = el.scrollHeight; }, [log]);
  const input = useRef(null), armedRef = useRef(false), draftRef = useRef(draft), submitRef = useRef(null);
  draftRef.current = draft;
  const arm = value => { armedRef.current = value; setArmed(value); };
  const recorderVoice = useVoiceRecorder({ api, workspaceId: target.workspaceId || '', scopeId: DRAFT_KEY, enabled: connected && !!target.workspaceId, onText: text => {
    const merged = mergeDictation(draftRef.current, text), pendingSend = armedRef.current;
    arm(false); draftRef.current = merged; setDraft(merged);
    if (pendingSend) submitRef.current(merged, true);
  } });
  const voice = { ...recorderVoice, cancel: () => { arm(false); recorderVoice.cancel(); } };
  const dictating = voice.status === 'recording' || voice.status === 'transcribing';
  useLayoutEffect(() => { if (voice.status === 'idle' || !connected) arm(false); }, [voice.status, connected]);
  const preview = dictationPreview(voice, draft);
  useComposerSize(input, preview);
  const submit = async (value = draftRef.current, fromVoice = false) => {
    if (sending || !connected || !target.workspaceId) return;
    if (!fromVoice) {
      const action = sendAction({ status: voice.status, draft: value, armed: armedRef.current });
      if (action === 'none') return;
      if (action === 'stop-and-send' || action === 'await-voice') { arm(true); if (action === 'stop-and-send') voice.stop(); return; }
      if (voice.status !== 'idle') voice.cancel();
    }
    const text = value.trim();
    if (!text) return;
    setSending(true); setError('');
    const id = ++seq.current;
    const entry = { id, text, workspaceId: target.workspaceId, project: name, at: new Date().toISOString(), status: 'sending' };
    setLog(list => [...list, entry]);
    const patch = fields => setLog(list => list.map(item => item.id === id ? { ...item, ...fields } : item));
    try {
      if (send) await send(text); else await api('orchestrator.send', { workspaceId: target.workspaceId, text });
      setDraft('');
      patch({ status: 'sent' });
    } catch (err) { const message = err?.message || String(err); setError(message); patch({ status: 'error', error: message }); }
    finally { setSending(false); }
  };
  submitRef.current = submit;
  const retry = async entry => {
    if (sending || !connected) return;
    setSending(true); setError('');
    const patch = fields => setLog(list => list.map(item => item.id === entry.id ? { ...item, ...fields } : item));
    patch({ status: 'sending', error: '' });
    try { await api('orchestrator.send', { workspaceId: entry.workspaceId, text: entry.text }); patch({ status: 'sent' }); }
    catch (err) { const message = err?.message || String(err); setError(message); patch({ status: 'error', error: message }); }
    finally { setSending(false); }
  };
  return <div className="oh-dock">
    {!send && log.length > 0 && <div className="oh-sent" role="log" aria-live="polite" aria-label="Mensajes enviados al orquestador" ref={thread}>
      {log.map(item => <div key={item.id} className="oh-msg" data-status={item.status}>
        <p className="oh-msg-meta"><span className="oh-msg-to">Para {item.project}</span><time dateTime={item.at}>{clock(item.at)}</time><span className="oh-msg-state">{item.status === 'sending' ? 'Enviando…' : item.status === 'sent' ? 'Enviado' : 'No se envió'}</span></p>
        <p className="oh-msg-text">{item.text}</p>
        {item.status === 'error' && <p className="oh-msg-error">{item.error}<button type="button" className="oh-link" disabled={sending || !connected} onClick={() => retry(item)}>Reintentar</button></p>}
      </div>)}
    </div>}
    <form className="oh-composer" aria-label="Hablar con el orquestador" data-dictating={voice.status !== 'idle' || undefined} onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Escape' && voice.status !== 'idle') { e.preventDefault(); e.stopPropagation(); voice.cancel(); } }}>
    {error && <p className="oh-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{error}</span></p>}
    {voice.error && <p className="oh-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{voice.error}</span><button type="button" className="oh-icon" aria-label="Descartar aviso de voz" onClick={voice.clearError}><X size={13} /></button></p>}
    <div className="oh-field">
      <div className="oh-input" data-preview={voice.status !== 'idle' || undefined}><VoiceTranscript voice={voice} draft={draft} /><textarea ref={input} rows={1} value={preview} readOnly={voice.status !== 'idle'} disabled={!connected} aria-label={`Mensaje para el orquestador de ${name}`} placeholder={connected ? `Indica algo al orquestador de ${name}…` : 'Sin conexión con el host'} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} /></div>
      <div className="oh-tools">
      <label className="oh-target"><span>Para</span>
        <select value={target.workspaceId || ''} disabled={!inbox.projects.length} aria-label="Proyecto destino" onChange={e => onPick(e.target.value)}>
          {!inbox.projects.length && <option value="">Sin proyectos</option>}
          {inbox.projects.map(p => <option key={p.workspaceId} value={p.workspaceId}>{p.name}</option>)}
        </select>
      </label>
      <div className="oh-controls"><VoiceActivity voice={voice} onFinish={() => submit()} finishLabel="Terminar dictado y enviar · Enter" />
        {voice.status === 'idle' && <button type="button" className="oh-icon" disabled={!connected || !target.workspaceId || voice.busyElsewhere} title={voice.busyElsewhere ? 'Otro dictado en curso: detén o cancela su audio' : 'Dictar al orquestador'} aria-label="Dictar al orquestador" onClick={voice.start}><Mic size={18} /></button>}
        <button type="submit" className="oh-send" title={dictating ? 'Terminar dictado y enviar · Enter' : 'Enviar · Enter'} aria-label={dictating ? 'Terminar dictado' : `Enviar al orquestador de ${name}`} aria-busy={armed} disabled={!canSubmit({ status: voice.status, draft, armed, sending, connected, ready: !!target.workspaceId })}><ArrowUp size={18} /></button>
      </div>
      </div>
    </div>
    </form>
  </div>;
}

// The global Orquestador section: what broke and what needs you, grouped by
// project, one action per row, and a box to talk to it that is always there.
export default function OrchestratorHub({ workspaces, selectedWorkspaceId, api, connected, notify, onOpenPanel, onSelectWorkspace, onClose }) {
  const { inbox, status, error, reload } = useOrchestratorInbox({ workspaces, api, connected });
  const body = useRef(null);
  const [picked, setPicked] = useState(null);
  useEffect(() => { setPicked(null); }, [selectedWorkspaceId]);
  const target = routeTarget(inbox, { selectedWorkspaceId: picked || selectedWorkspaceId });
  const targetName = inbox.projects.find(p => p.workspaceId === target.workspaceId)?.name || 'un proyecto';
  const node = orchestratorNode((workspaces || []).find(w => w.id === target.workspaceId));
  const provider = node?.data?.chat?.provider;
  const thread = useChat({ workspaceId: target.workspaceId, nodeId: node?.id, provider, api, connected });
  // useChat drops its reading when the connection goes; keep the last one per thread.
  const threadKey = provider ? `${target.workspaceId}:${node.id}` : '';
  const last = useRef({ key: '', chat: null });
  if (thread.chat) last.current = { key: threadKey, chat: thread.chat };
  const chat = thread.chat || (last.current.key === threadKey ? last.current.chat : null);
  const now = inbox.updatedAt ? Date.parse(inbox.updatedAt) : Date.now();
  const handlers = { onOpenPanel, onSelectWorkspace };
  const projects = inbox.projects;
  const open = inbox.broken + projects.reduce((n, p) => n + p.needsYou.length, 0);
  const onKeyDown = event => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); onClose?.(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !event.target.matches?.('[data-oh-nav]')) return;
    const items = [...body.current.querySelectorAll('[data-oh-nav]')];
    const index = items.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1);
    if (items[next]) { event.preventDefault(); items[next].focus(); }
  };
  const summary = status === 'loading' ? 'Leyendo proyectos…' : !projects.length ? 'Sin proyectos' : open ? countLabel(projects.reduce((n, p) => n + p.needsYou.length, 0), inbox.broken) : 'Nada se rompió y nada te necesita';
  return <section className="oh" aria-label="Orquestador" onKeyDown={onKeyDown}>
    <header className="oh-head">
      <div className="oh-head-text"><h2 className="oh-title">Orquestador</h2><p className="oh-summary" role="status">{summary}</p></div>
      <div className="oh-head-counts" aria-hidden="true"><Counts pending={projects.reduce((n, p) => n + p.needsYou.length, 0)} broken={inbox.broken} /></div>
      <button type="button" className="oh-icon" aria-label="Actualizar" title="Actualizar" disabled={!connected} onClick={reload}><RefreshCw size={16} /></button>
      {onClose && <button type="button" className="oh-icon" aria-label="Cerrar orquestador" title="Cerrar · Esc" onClick={onClose}><X size={16} /></button>}
    </header>
    <div className="oh-body" ref={body}>
      {status === 'offline' && <p className="oh-banner" role="status"><AlertCircle size={14} aria-hidden="true" /><span>Sin conexión con el host. Se muestra la última lectura; no se puede enviar.</span></p>}
      {status === 'error' && <p className="oh-banner" data-tone="danger" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>No se pudo leer: {error}</span><button type="button" className="oh-link" onClick={reload}>Reintentar</button></p>}
      {status === 'loading' && !projects.some(p => p.broken.length || p.needsYou.length) && <p className="oh-empty" aria-busy="true">Leyendo qué se rompió y qué te necesita en cada proyecto…</p>}
      {status !== 'loading' && !projects.length && <p className="oh-empty">No hay proyectos abiertos. Abre uno para que el orquestador lo vigile.</p>}
      {status === 'ready' && projects.length > 0 && !open && <p className="oh-empty">Nada se rompió y nada te necesita ahora mismo.</p>}
      <Group id="oh-broken" title="Se rompió" tone="danger" projects={projects} pick={p => p.broken} now={now} handlers={handlers} primary />
      <Group id="oh-needs" title="Te necesita" tone="attention" projects={projects} pick={p => p.needsYou} now={now} handlers={handlers} primary={inbox.broken === 0 && !projects.some(p => p.broken.length)} />
      {projects.length > 0 && <Projects projects={projects} now={now} handlers={handlers} />}
    </div>
    {target.workspaceId && (provider
      ? <Thread key={threadKey} name={targetName} workspaceId={target.workspaceId} node={node} chat={chat} error={connected ? thread.error : ''} connected={connected} answer={thread.answer} reply={thread.reply} api={api} onOpenPanel={onOpenPanel} onSelectWorkspace={onSelectWorkspace} />
      : <ThreadLine name={targetName} workspaceId={target.workspaceId} node={node} onSelectWorkspace={onSelectWorkspace} />)}
    <Composer inbox={inbox} target={target} name={targetName} onPick={setPicked} send={provider ? thread.send : null} api={api} connected={connected} notify={notify} />
  </section>;
}
