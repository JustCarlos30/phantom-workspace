import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useComposerSize } from '../hooks/useComposerSize';
import { Activity, AlertCircle, ArrowUp, Compass, GitBranch, GitMerge, ListChecks, ListPlus, MessageSquare, Mic, MessageSquarePlus, Square, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { canSubmit, mergeDictation, sendAction } from '../hooks/voice-send.mjs';
import { VoiceTranscript, dictationPreview } from './VoiceActivity';
import { useVoiceDraft } from './VoiceProvider';
import { ComposerControls, ContextMeter, Message, ModelPicker, PermissionRow, PermissionSwitch, ProviderChoices, QueuedMessages, ReasoningPicker, SessionChip, SessionContext, configurePermission, useCompaction, useEnabledProviders, withEdited } from './ChatCard';
import PhantomOrchestrator from './PhantomOrchestrator';

const PROVIDERS = [{ id: 'claude', label: 'Claude', hint: 'Claude Code en la carpeta del proyecto' }, { id: 'opencode', label: 'OpenCode', hint: 'OpenCode en la carpeta del proyecto' }, { id: 'codex', label: 'Codex', hint: 'Codex en la carpeta del proyecto' }];
const SUGGESTIONS = [
  { icon: Activity, text: '¿En qué estado está este proyecto?' },
  { icon: GitBranch, text: 'Resume los cambios de Git sin confirmar' },
  { icon: ListChecks, text: '¿Qué tareas y cards de Phantom siguen abiertas?' },
  { icon: Compass, text: 'Propón el siguiente paso para la misión actual' },
];
const PERMISSIONS = {
  claude: { auto: 'Trabaja solo en la carpeta del proyecto. Te pide permiso para tocar algo fuera.', ask: 'Te pide permiso antes de cada cambio.', full: 'Hace todo sin preguntar, salvo acciones peligrosas: sudo, borrar fuera de la carpeta, git push --force, ~/.ssh o /etc y curl | sh.' },
  codex: { auto: 'Edita dentro del proyecto.', ask: 'Solo lee.', full: 'Hace todo sin preguntar, también fuera del proyecto.' },
  opencode: { auto: 'Trabaja solo, según la configuración de OpenCode.', ask: 'Te pide permiso antes de cada cambio.', full: 'Hace todo sin preguntar, según la configuración de OpenCode.' },
};

// Phantom's dock, beside the canvas, with two tabs. Chat is the project's main
// conversation: not a panel on the canvas; the host keeps one thread per
// project and runs it in the project folder. Typed or dictated text is sent only
// by explicit Send, and a dictation can become a task instead. Orquestador shows
// the session that integrates the terminals' work and its queue.
export default function PhantomChat({ workspace, api, notify, connected, onClose, focusRequest, onFocusOwnership, tab = 'chat', onTab, status, onOpenPanel, onTask, agentRequest, onAgentRequestConsumed, onOpenOrchestrator }) {
  const nodeId = `phantom:${workspace.id}`;
  // The host owns the provider; `pending` only shows a switch in flight.
  const { chat, error, send, stop, clear, answer, reply, unqueue, resume, capabilities, compact, continueSession } = useChat({ workspaceId: workspace.id, nodeId, provider: 'phantom', api, connected });
  const [pending, setPending] = useState(null);
  // A sub-agent clicked here, or in a canvas card (App hands it down as agentRequest), opens its detail in the
  // Orquestador tab; the tab consumes the request once.
  const [agentFocus, setAgentFocus] = useState(null);
  const openAgent = useCallback(id => { setAgentFocus({ id, workspaceId: workspace.id }); onTab?.('orchestrator'); }, [onTab, workspace.id]);
  const consumeAgentFocus = useCallback(() => { setAgentFocus(null); onAgentRequestConsumed?.(); }, [onAgentRequestConsumed]);
  const focusedAgent = agentRequest ?? agentFocus;
  const [draft, setDraft] = useVoiceDraft(`${workspace.id}:${nodeId}`);
  const [sending, setSending] = useState(false);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false), draftRef = useRef(draft), submitRef = useRef(null);
  draftRef.current = draft;
  const arm = value => { armedRef.current = value; setArmed(value); };
  const [switching, setSwitching] = useState(false);
  const thread = useRef(null), input = useRef(null), pinned = useRef(true);
  useEffect(() => { setPending(null); }, [chat?.provider]);
  const running = !!chat?.running, messages = chat?.messages || [], meta = chat?.meta || {};
  const active = pending || chat?.provider || 'claude';
  const { enabled } = useEnabledProviders(api);
  const label = PROVIDERS.find(p => p.id === active)?.label || active;
  const permissionMode = chat?.permissionMode || (chat?.autoApprove ? 'auto' : 'ask');
  const waiting = messages.some(message => message.parts?.some(part => ['permission', 'question'].includes(part.type) && part.status === 'pending'));
  // Message hides pending permissions; they are answered in the dock above the composer.
  const pendingAsks = messages.flatMap(message => (message.parts || []).filter(part => part.type === 'permission' && part.status === 'pending'));
  const recorderVoice = useVoiceRecorder({
    api, workspaceId: workspace.id, scopeId: `${nodeId}:${active}:${tab}`, enabled: connected && tab === 'chat',
    onText: text => {
      const merged = mergeDictation(draftRef.current, text), pendingSend = armedRef.current;
      arm(false); draftRef.current = merged; setDraft(merged);
      if (pendingSend) submitRef.current(merged, true);
      requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    },
  });
  const voice = { ...recorderVoice, cancel: () => { arm(false); recorderVoice.cancel(); } };
  const listening = voice.status === 'recording';
  const dictating = listening || voice.status === 'transcribing';
  useLayoutEffect(() => { if (voice.status === 'idle' || !connected || tab !== 'chat') arm(false); }, [voice.status, connected, tab]);
  useLayoutEffect(() => { arm(false); }, [workspace.id, nodeId, active, tab]);
  useLayoutEffect(() => { const el = thread.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [messages, pendingAsks.length, tab]);
  useEffect(() => { if (focusRequest && tab === 'chat') input.current?.focus({ preventScroll: true }); }, [focusRequest, tab]);
  const preview = dictationPreview(voice, draft);
  useComposerSize(input, preview, tab === 'chat');
  const chooseProvider = async id => {
    if (id === active || running || switching) return;
    setSwitching(true); setPending(id);
    try { await api('chat.configure', { workspaceId: workspace.id, nodeId, provider: id }); }
    catch (e) { setPending(null); notify?.(e.message, 'error'); }
    finally { setSwitching(false); }
  };
  const submit = async (value = draftRef.current, fromVoice = false) => {
    if (sending || !connected || !chat) return;
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
    finally { setSending(false); requestAnimationFrame(() => input.current?.focus({ preventScroll: true })); }
  };
  submitRef.current = submit;
  const toggleVoice = () => { voice.clearError(); if (listening) voice.stop(); else voice.start(); };
  const pickerNode = { id: nodeId, data: { chat: { provider: active, models: chat?.models || {}, reasoning: chat?.reasoning || {} } } };
  const compaction = useCompaction({ chat, connected, capabilities, compact, continueSession });
  const context = <SessionContext node={pickerNode} workspace={workspace} api={api} notify={notify} provider={active} label={label} model={meta.model} permissionMode={permissionMode} descriptions={PERMISSIONS} running={running} ready={!!chat} />;

  return <aside className="phantom-chat pc" onFocusCapture={() => onFocusOwnership?.(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) onFocusOwnership?.(false); }} data-provider={active} data-agent={running ? 'working' : 'idle'} aria-label="Phantom"
    onKeyDown={e => { if (e.key === 'Escape' && voice.status !== 'idle') { e.preventDefault(); e.stopPropagation(); voice.cancel(); } }}>
    <header className="phantom-chat-head">
      <span className="phantom-chat-mark" aria-hidden="true"><MessageSquare size={20} /></span>
      <h2 className="phantom-chat-title">Phantom</h2>
      {running && tab === 'chat'
        ? <span className={`phantom-chat-live ${waiting ? 'is-waiting' : ''}`} role="status">{waiting ? 'Te necesita' : 'Respondiendo'}</span>
        : <span className="phantom-chat-where" title={workspace.canonicalPath}>{workspace.name}</span>}
      <span className="pc-bar-space" />
      {tab === 'chat' && <button type="button" className="pc-icon" title="Conversación nueva" aria-label="Empezar una conversación nueva con Phantom" disabled={running || !messages.length} onClick={() => clear().catch(() => {})}><MessageSquarePlus size={16} /></button>}
      <button type="button" className="pc-icon" title="Cerrar Phantom (Ctrl ⇧ Espacio)" aria-label="Cerrar Phantom" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="pd-tabs control-segmented" role="tablist" aria-label="Vistas de Phantom">
      <button type="button" role="tab" id="pd-tab-chat" aria-controls="pd-panel" aria-selected={tab === 'chat'} onClick={() => onTab?.('chat')}><MessageSquare size={14} aria-hidden="true" /><span className="pd-tab-label">Chat</span>{running && <i className="pd-tab-live" aria-label="respondiendo" />}</button>
      <button type="button" role="tab" id="pd-tab-orchestrator" aria-controls="pd-panel" aria-selected={tab === 'orchestrator'} data-tone={status?.tone} onClick={() => onTab?.('orchestrator')}><GitMerge size={14} aria-hidden="true" /><span className="pd-tab-label">Agentes</span>{status?.integration && status.queued > 0 && <b aria-label={`${status.queued} en cola`}>{status.queued}</b>}{status?.integration && !status.queued && status.tone !== 'idle' && <i className="pd-tab-dot" aria-hidden="true" />}</button>
    </div>
    {tab === 'orchestrator' ? <div className="pd-panel" id="pd-panel" role="tabpanel" aria-labelledby="pd-tab-orchestrator">{onOpenOrchestrator && <button type="button" className="pd-open-orchestrator button" onClick={onOpenOrchestrator}>Abrir orquestador</button>}<PhantomOrchestrator workspace={workspace} api={api} notify={notify} connected={connected} status={status} onOpenPanel={onOpenPanel} agentFocus={focusedAgent} onAgentFocusConsumed={consumeAgentFocus} /></div> : <>
    <div ref={thread} className="pc-thread phantom-chat-thread" role="log" aria-label="Conversación con Phantom" aria-live="off" onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
      <div className="pc-column">
        {!messages.length && (!connected || !chat) && <p role="status">{!connected ? 'Sin conexión con el host' : 'Cargando la conversación…'}</p>}
        {!messages.length && connected && chat && <div className="pc-session-new"><ProviderChoices active={active} enabled={enabled} disabled={running || switching} onChoose={chooseProvider} />{context}<details className="phantom-chat-starters"><summary>Ideas para empezar</summary><div className="phantom-chat-suggestions">{SUGGESTIONS.map(({ icon: Icon, text }) => <button key={text} type="button" disabled={running || sending} onClick={() => submit(text)}><Icon size={16} aria-hidden="true" /><span>{text}</span></button>)}</div></details></div>}
        {messages.map(message => <Message key={message.id} message={message} label="Phantom" provider={active} model={meta.model} onAnswer={answer} onReply={reply} api={api} workspaceId={workspace.id} onOpenPanel={onOpenPanel} onOpenAgent={openAgent} />)}
      </div>
    </div>
    {error && <p className="pc-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{error}</span></p>}
    {pendingAsks.length > 0 && <div className="pc-dock">{pendingAsks.map(part => <PermissionRow key={part.id} part={part} onAnswer={answer} />)}</div>}
    {voice.error && <p className="pc-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{voice.error}</span><button type="button" className="pc-icon" aria-label="Descartar aviso de voz" onClick={voice.clearError}><X size={14} /></button></p>}
    <form className="pc-composer phantom-chat-composer" data-dictating={voice.status !== 'idle' || undefined} onSubmit={e => { e.preventDefault(); submit(); }}>
      <QueuedMessages queue={chat?.queue} running={running} connected={connected} unqueue={unqueue} resume={resume} notify={notify} onEdit={text => { setDraft(withEdited(text)); input.current?.focus({ preventScroll: true }); }} />
      {compaction.status}
      <div className="pc-field" onPointerDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
        <div className="pc-input" data-preview={voice.status !== 'idle' || undefined}>
          <VoiceTranscript voice={voice} draft={draft} />
          <textarea ref={input} rows={1} value={preview} readOnly={voice.status !== 'idle'} disabled={!connected} aria-label="Mensaje para Phantom" placeholder={running ? 'Phantom está respondiendo · lo que envíes queda en espera' : 'Pregunta o da una instrucción a Phantom…'} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        </div>
        <ComposerControls voice={voice} onFinish={() => submit()} finishLabel="Terminar dictado y enviar · Enter" selectors={<>
          <SessionChip cwd={workspace.canonicalPath || workspace.name} workspaceName={workspace.name}>{context}</SessionChip>
          <PermissionSwitch mode={permissionMode} provider={active} descriptions={PERMISSIONS} disabled={!chat} onChange={configurePermission(api, workspace, pickerNode, notify)} />
          <ModelPicker node={pickerNode} workspace={workspace} api={api} notify={notify} provider={active} label={label} observed={meta.model} disabled={!chat || running} />
          <ReasoningPicker node={pickerNode} workspace={workspace} api={api} notify={notify} provider={active} observed={meta.model} disabled={!chat || running} />
        </>} leading={onTask && <button type="button" className="pc-icon phantom-chat-task" title="Convertir en tarea" aria-label="Convertir el texto en una tarea" disabled={!draft.trim() || voice.status !== 'idle'} onClick={() => onTask(draft.trim())}><ListPlus size={18} /></button>}
          meter={<ContextMeter meta={meta} {...compaction.meter} onNew={messages.length ? () => clear().catch(() => {}) : undefined} />}>
          {voice.status === 'idle' && <button type="button" className="phantom-chat-mic" disabled={!connected || voice.busyElsewhere} title={voice.busyElsewhere ? 'Otro dictado en curso: detén o cancela su audio' : 'Dictar por voz'} aria-label="Dictar por voz" onClick={toggleVoice}><Mic size={18} /></button>}
          {running && <button type="button" className="pc-send is-stop" title="Detener respuesta" aria-label="Detener respuesta" onClick={() => stop().catch(() => {})}><Square size={14} /></button>}
          {(!running || draft.trim() || dictating || armed) && <button type="submit" className="pc-send" title={armed ? 'Se enviará al terminar la transcripción' : dictating ? 'Terminar dictado y enviar · Enter' : running ? 'Poner en espera · ↵' : 'Enviar · ↵ enviar · ⇧↵ línea'} aria-label={armed ? 'Se enviará al terminar la transcripción' : dictating ? 'Terminar dictado y enviar' : running ? 'Poner mensaje en espera' : 'Enviar mensaje'} aria-busy={armed} disabled={!canSubmit({ status: voice.status, draft, armed, sending, connected, ready: !!chat })}><ArrowUp size={18} /></button>}
        </ComposerControls>
      </div>
      {compaction.form}
    </form>
    </>}
  </aside>;
}
