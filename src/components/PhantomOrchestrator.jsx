import React, { useState } from 'react';
import { AlertCircle, ArrowUp, ArrowUpRight, Mic, Square, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { VoiceActivity } from './VoiceActivity';
import { useVoiceDraft } from './VoiceProvider';
import Incorporaciones from './Incorporaciones';

const AGENT = { working: 'Trabajando', blocked: 'Bloqueado', review: 'Listo para revisión', idle: 'En espera' };

// The dock's Orquestador tab: the orchestrator session at a glance, a line to
// talk to it (typed or dictated) when it runs as a chat, and the integration
// queue it works on. The canvas card stays the place for its full conversation.
export default function PhantomOrchestrator({ workspace, api, notify, connected, status, onOpenPanel }) {
  const orchestrator = status.orchestrator;
  return <div className="pd-orchestrator">
    {orchestrator && <section className="pd-session" data-tone={status.tone} aria-label="Sesión orquestadora">
      <div className="pd-session-head">
        <span className="pd-dot" aria-hidden="true" />
        <div className="pd-session-title"><strong>{orchestrator.title}</strong><small>{AGENT[orchestrator.agent] || AGENT.idle}{orchestrator.step ? ` · ${orchestrator.step}` : ''}</small></div>
        <button type="button" className="pc-icon" title="Ver en el canvas" aria-label={`Ver ${orchestrator.title} en el canvas`} onClick={() => onOpenPanel?.('terminal', { focusNodeId: orchestrator.id })}><ArrowUpRight size={15} /></button>
      </div>
      {orchestrator.chat
        ? <OrchestratorComposer key={orchestrator.id} workspace={workspace} api={api} connected={connected} nodeId={orchestrator.id} title={orchestrator.title} />
        : <p className="pd-muted">Esta sesión es una terminal: escríbele desde su tarjeta en el canvas.</p>}
    </section>}
    <Incorporaciones workspace={workspace} api={api} notify={notify} onOpenPanel={onOpenPanel} />
  </div>;
}

function OrchestratorComposer({ workspace, api, connected, nodeId, title }) {
  const { chat, error, send } = useChat({ workspaceId: workspace.id, nodeId, provider: 'orchestrator', api, connected });
  const [draft, setDraft] = useVoiceDraft(`${workspace.id}:${nodeId}:orchestrator`);
  const [sending, setSending] = useState(false);
  const voice = useVoiceRecorder({ api, workspaceId: workspace.id, scopeId: `phantom:${workspace.id}:orchestrator:${nodeId}`, enabled: connected, onText: text => setDraft(value => value.trim() ? `${value.trimEnd()} ${text}` : text) });
  const listening = voice.status === 'recording', running = !!chat?.running;
  const submit = async () => {
    const text = draft.trim();
    if (!text || sending || !connected || !chat) return;
    if (voice.status !== 'idle') voice.cancel();
    setSending(true);
    try { await send(text); setDraft(''); } catch { /* Shown inline by the hook. */ }
    finally { setSending(false); }
  };
  return <form className="pd-composer" onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Escape' && voice.status !== 'idle') { e.preventDefault(); e.stopPropagation(); voice.cancel(); } }}>
    {error && <p className="pc-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{error}</span></p>}
    {voice.error && <p className="pc-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{voice.error}</span><button type="button" className="pc-icon" aria-label="Descartar aviso de voz" onClick={voice.clearError}><X size={13} /></button></p>}
    <VoiceActivity voice={voice} />
    <div className={`pd-field ${listening ? 'is-listening' : ''}`}>
      <textarea rows={2} value={draft} disabled={!connected} aria-label={`Mensaje para ${title}`} placeholder={running ? `${title} está trabajando · lo que envíes queda en espera` : `Indica algo a ${title}…`} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
      <button type="button" className={`phantom-chat-mic ${listening ? 'is-live' : ''}`} aria-pressed={listening} disabled={!connected || voice.busyElsewhere || ['requesting', 'transcribing'].includes(voice.status)} title={voice.busyElsewhere ? 'Otro dictado en curso: detén o cancela su audio' : listening ? 'Detener y transcribir' : 'Dictar al orquestador'} aria-label={listening ? 'Detener y transcribir' : 'Dictar al orquestador'} onClick={() => { voice.clearError(); if (listening) voice.stop(); else voice.start(); }}>{listening ? <Square size={11} /> : <Mic size={15} />}</button>
      <button type="submit" className="pc-send" title="Enviar · Enter" aria-label={`Enviar mensaje a ${title}`} disabled={!draft.trim() || sending || !connected || !chat}><ArrowUp size={15} /></button>
    </div>
    <p className="pd-muted">{running ? 'Respondiendo en su tarjeta del canvas.' : 'La respuesta aparece en su tarjeta del canvas.'}</p>
  </form>;
}
