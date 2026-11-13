import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useComposerSize } from '../hooks/useComposerSize';
import { AlertCircle, ArrowUp, Mic, MessageSquarePlus, Square, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { formatCost, formatElapsed } from '../hooks/chatState';
import { ContextMeter, Message, ModelPicker, PermissionRow, PermissionSwitch, QueuedMessages, ReasoningPicker, useElapsed, withEdited } from './ChatCard';
import { PhantomGlyph, ProviderGlyph } from './Glyphs';

const PROVIDERS = [{ id: 'claude', label: 'Claude' }, { id: 'opencode', label: 'OpenCode' }, { id: 'codex', label: 'Codex' }];
const SUGGESTIONS = [
  '¿En qué estado está este proyecto?',
  'Resume los cambios de Git sin confirmar',
  '¿Qué tareas y cards de Phantom siguen abiertas?',
  'Propón el siguiente paso para la misión actual',
];
const PERMISSIONS = {
  claude: { auto: 'Trabaja libremente dentro de la carpeta del proyecto y te pide permiso aquí antes de tocar algo fuera.', ask: 'Puede leer todo, pero te pide permiso aquí antes de cada cambio.', full: 'Hace todo sin preguntar, salvo una lista corta de acciones peligrosas (sudo, borrar fuera de la carpeta, git push --force, ~/.ssh o /etc, curl | sh). Git queda protegido por el guardián de Incorporaciones.' },
  codex: { auto: 'Codex puede editar dentro del proyecto.', ask: 'Codex trabaja en modo de solo lectura.', full: 'Codex trabaja sin sandbox (danger-full-access). Git queda protegido por el guardián de Incorporaciones.' },
  opencode: { auto: 'OpenCode aprueba todo permiso que no esté denegado en su configuración.', ask: 'Los permisos que OpenCode solicite aparecen aquí para que puedas aprobarlos o rechazarlos.', full: 'OpenCode aprueba todo permiso que no esté denegado en su configuración. Git queda protegido por el guardián de Incorporaciones.' },
};

// The project's main conversation: Phantom, docked beside the canvas. It is
// not a panel on the canvas; the host keeps one thread per project and runs
// it in the project folder. Text is typed or dictated, never sent by itself.
export default function PhantomChat({ workspace, api, notify, connected, onClose, focusRequest, onFocusOwnership }) {
  const nodeId = `phantom:${workspace.id}`;
  // The host owns the provider; `pending` only shows a switch in flight.
  const { chat, error, send, stop, clear, answer, reply, unqueue, resume } = useChat({ workspaceId: workspace.id, nodeId, provider: 'phantom', api, connected });
  const [pending, setPending] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [switching, setSwitching] = useState(false);
  const thread = useRef(null), input = useRef(null), pinned = useRef(true);
  useEffect(() => { setPending(null); }, [chat?.provider]);
  useEffect(() => { setDraft(''); }, [workspace.id]);
  const running = !!chat?.running, messages = chat?.messages || [], meta = chat?.meta || {};
  const active = pending || chat?.provider || 'claude';
  const label = PROVIDERS.find(p => p.id === active)?.label || active;
  const permissionMode = chat?.permissionMode || (chat?.autoApprove ? 'auto' : 'ask');
  const waiting = messages.some(message => message.parts?.some(part => ['permission', 'question'].includes(part.type) && part.status === 'pending'));
  // Message hides pending permissions; they are answered in the dock above the composer.
  const pendingAsks = messages.flatMap(message => (message.parts || []).filter(part => part.type === 'permission' && part.status === 'pending'));
  const elapsed = useElapsed(messages.at(-1)?.createdAt, running);
  const voice = useVoiceRecorder({
    api, workspaceId: workspace.id,
    onText: text => { setDraft(value => value.trim() ? `${value.trimEnd()} ${text}` : text); requestAnimationFrame(() => input.current?.focus({ preventScroll: true })); },
  });
  const listening = voice.status === 'recording';
  useLayoutEffect(() => { const el = thread.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [messages, pendingAsks.length]);
  useEffect(() => { if (focusRequest) input.current?.focus({ preventScroll: true }); }, [focusRequest]);
  useComposerSize(input, draft);
  const configure = async change => {
    try { await api('chat.configure', { workspaceId: workspace.id, nodeId, ...change }); }
    catch (e) { notify?.(e.message, 'error'); }
  };
  const chooseProvider = async id => {
    if (id === active || running || switching) return;
    setSwitching(true); setPending(id);
    try { await api('chat.configure', { workspaceId: workspace.id, nodeId, provider: id }); }
    catch (e) { setPending(null); notify?.(e.message, 'error'); }
    finally { setSwitching(false); }
  };
  const submit = async (value = draft) => {
    const text = value.trim();
    if (!text || sending || !connected || !chat) return;
    if (listening) voice.cancel();
    setSending(true); pinned.current = true;
    try { await send(text); setDraft(''); } catch { /* Shown inline by the hook. */ }
    finally { setSending(false); requestAnimationFrame(() => input.current?.focus({ preventScroll: true })); }
  };
  const toggleVoice = () => { voice.clearError(); if (listening) voice.stop(); else voice.start(); };
  const cost = Number.isFinite(meta.costUsd) && meta.costUsd > 0 ? formatCost(meta.costUsd) : '';
  const pickerNode = { id: nodeId, data: { chat: { provider: active, models: chat?.models || {}, reasoning: chat?.reasoning || {} } } };
  const voiceLabel = { requesting: 'Esperando el micrófono…', recording: 'Escuchando · pulsa para transcribir', transcribing: 'Transcribiendo…' }[voice.status];

  return <aside className="phantom-chat pc" onFocusCapture={() => onFocusOwnership?.(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) onFocusOwnership?.(false); }} data-provider={active} data-agent={running ? 'working' : 'idle'} aria-label="Chat con Phantom"
    onKeyDown={e => { if (e.key === 'Escape' && listening) { e.preventDefault(); e.stopPropagation(); voice.cancel(); } }}>
    <header className="phantom-chat-head">
      <span className="phantom-chat-mark" aria-hidden="true"><PhantomGlyph size={16} /></span>
      <div className="phantom-chat-title">
        <strong>Phantom</strong>
        <small>{running ? <span className="phantom-chat-live" role="status">{waiting ? 'Espera tu respuesta' : 'Respondiendo'} · {formatElapsed(elapsed)}</span> : <span title={workspace.canonicalPath}>{workspace.name}</span>}</small>
      </div>
      <button type="button" className="pc-icon" title="Conversación nueva" aria-label="Empezar una conversación nueva con Phantom" disabled={running || !messages.length} onClick={() => clear().catch(() => {})}><MessageSquarePlus size={16} /></button>
      <button type="button" className="pc-icon" title="Cerrar chat (Ctrl ⇧ Espacio)" aria-label="Cerrar chat con Phantom" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="phantom-chat-settings">
      <div className="phantom-chat-providers" role="radiogroup" aria-label="Agente que responde como Phantom">
        {PROVIDERS.map(p => <button key={p.id} type="button" role="radio" aria-checked={active === p.id} data-provider={p.id} disabled={(running || switching) && active !== p.id} onClick={() => chooseProvider(p.id)}><ProviderGlyph provider={p.id} size={13} /><span>{p.label}</span></button>)}
      </div>
      <span className="pc-bar-space" />
      <PermissionSwitch mode={permissionMode} provider={active} descriptions={PERMISSIONS} disabled={!chat} onChange={next => configure({ permissionMode: next })} />
    </div>
    <div ref={thread} className="pc-thread phantom-chat-thread" role="log" aria-label="Conversación con Phantom" aria-live="off" onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
      <div className="pc-column">
        {!messages.length && (!connected || !chat) && <p role="status">{!connected ? 'Sin conexión con el host' : 'Cargando la conversación…'}</p>}
        {!messages.length && connected && chat && <EmptyState className="phantom-chat-empty" icon={PhantomGlyph} title="Pregúntale a Phantom" description={<>Da instrucciones, pregunta por el proyecto o dicta con el micrófono. Phantom trabaja en <span className="pc-mono" title={workspace.canonicalPath}>{workspace.name}</span> con {label}.</>} actions={<div className="phantom-chat-suggestions">{SUGGESTIONS.map(text => <button key={text} type="button" disabled={running || sending} onClick={() => submit(text)}>{text}</button>)}</div>} />}
        {messages.map(message => <Message key={message.id} message={message} label="Phantom" provider={active} model={meta.model} onAnswer={answer} onReply={reply} />)}
      </div>
    </div>
    {error && <p className="pc-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{error}</span></p>}
    {pendingAsks.length > 0 && <div className="pc-dock">{pendingAsks.map(part => <PermissionRow key={part.id} part={part} onAnswer={answer} />)}</div>}
    {voice.error && <p className="pc-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{voice.error}</span><button type="button" className="pc-icon" aria-label="Descartar aviso de voz" onClick={voice.clearError}><X size={13} /></button></p>}
    <form className="pc-composer phantom-chat-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
      <QueuedMessages queue={chat?.queue} running={running} connected={connected} unqueue={unqueue} resume={resume} notify={notify} onEdit={text => { setDraft(withEdited(text)); input.current?.focus({ preventScroll: true }); }} />
      <div className={`pc-field ${listening ? 'is-listening' : ''}`} style={{ '--voice-level': voice.level }} onPointerDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
        {voiceLabel && <p className="phantom-chat-voice" role="status"><span className="phantom-chat-wave" aria-hidden="true"><i /><i /><i /><i /></span>{voiceLabel}{listening && <button type="button" onClick={voice.cancel}>Descartar</button>}</p>}
        <textarea ref={input} rows={1} value={draft} disabled={!connected} aria-label="Mensaje para Phantom" placeholder={running ? 'Phantom está respondiendo · lo que envíes queda en espera' : 'Pregunta o da una instrucción a Phantom…'} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        <div className="pc-controls">
          <div className="pc-settings">
            {chat && <ModelPicker node={pickerNode} workspace={workspace} api={api} notify={notify} provider={active} label={label} observed={meta.model} disabled={running} />}
            {chat && <ReasoningPicker node={pickerNode} workspace={workspace} api={api} notify={notify} provider={active} disabled={running} />}
          </div>
          <button type="button" className={`phantom-chat-mic ${listening ? 'is-live' : ''}`} aria-pressed={listening} disabled={!connected || ['requesting', 'transcribing'].includes(voice.status)} title={listening ? 'Detener y transcribir' : 'Dictar por voz'} aria-label={listening ? 'Detener y transcribir' : 'Dictar por voz'} onClick={toggleVoice}>{listening ? <Square size={11} /> : <Mic size={15} />}</button>
          {running && <button type="button" className="pc-send is-stop" title="Detener respuesta" aria-label="Detener respuesta" onClick={() => stop().catch(() => {})}><Square size={11} /></button>}
          {(!running || draft.trim()) && <button type="submit" className="pc-send" title={running ? 'Poner en espera · Enter' : 'Enviar · Enter'} aria-label={running ? 'Poner mensaje en espera' : 'Enviar mensaje'} disabled={!draft.trim() || sending || !connected || !chat}><ArrowUp size={15} /></button>}
        </div>
      </div>
      <div className="pc-meta">
        <ContextMeter meta={meta} />
        {cost && <span className="pc-cost" title={`Costo acumulado · ${meta.turns || 0} ${meta.turns === 1 ? 'turno' : 'turnos'}`}>{cost}</span>}
        <span className="pc-bar-space" />
        <kbd className="pc-hint">{running ? '↵ poner en espera' : '↵ enviar · ⇧↵ línea'}</kbd>
      </div>
    </form>
  </aside>;
}
import EmptyState from './EmptyState.jsx';
