import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUp, ArrowUpRight, Mic, Square, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { VoiceActivity } from './VoiceActivity';
import { useVoiceDraft } from './VoiceProvider';
import Incorporaciones from './Incorporaciones';
import { preferredCardMode } from './ChatCard';
import { ErrorNotice, useResource } from './PluginPrimitives';
import { buildCola } from '../hooks/incorporaciones-model.mjs';
import { buildDelegation } from '../hooks/delegation-model.mjs';
import '../incorporaciones.css';

const AGENT = { working: 'Trabajando', blocked: 'Bloqueado', review: 'En espera', idle: 'En espera' };

// The dock's Orquestador tab: the orchestrator at a glance, a line to talk to
// it (typed or dictated) when it runs as a chat, and where the queue stands.
// The full queue lives in Git › Cola; without a way to open it, it is shown here.
export default function PhantomOrchestrator({ workspace, api, notify, connected, status, onOpenPanel }) {
  const orchestrator = status.orchestrator;
  const delegation = useMemo(() => buildDelegation(workspace), [workspace]);
  const delegates = delegation.rows.filter(row => row.role !== 'orchestrator' && !row.hidden);
  const working = delegates.filter(row => row.status === 'working').length;
  const blocked = delegates.filter(row => row.status === 'blocked').length;
  const unassigned = delegates.filter(row => row.purpose === 'none').length;
  const summary = [
    working && `${working} trabajando`,
    blocked && `${blocked} ${blocked === 1 ? 'bloqueada' : 'bloqueadas'}`,
    unassigned && `${unassigned} sin encargo`,
  ].filter(Boolean).join(' · ');
  return <div className="pd-orchestrator">
    {orchestrator && <section className="pd-session" data-tone={status.tone} aria-label="Orquestador">
      <div className="pd-session-head">
        <span className="pd-dot" aria-hidden="true" />
        <div className="pd-session-title"><strong>{orchestrator.title}</strong><small>{AGENT[orchestrator.agent] || AGENT.idle}{orchestrator.step ? ` · ${orchestrator.step}` : ''}</small></div>
        <button type="button" className="pd-open-session" onClick={() => onOpenPanel?.('terminal', { focusNodeId: orchestrator.id })}><ArrowUpRight size={15} aria-hidden="true" />Ir a la sesión</button>
      </div>
      {orchestrator.chat
        ? <OrchestratorComposer key={orchestrator.id} workspace={workspace} api={api} connected={connected} nodeId={orchestrator.id} title={orchestrator.title} />
        : null}
    </section>}
    {delegates.length > 0 && <section className="pd-deleg" aria-label="Delegación">
      <div className="pd-deleg-head"><strong>Quién tiene qué</strong>{summary && <small>{summary}</small>}</div>
      <ul className="pd-deleg-list">{delegates.map(row => {
        const content = <>
          <span className="pd-deleg-dot" aria-hidden="true" />
          <span className="pd-deleg-content">
            <strong>{row.title}</strong>
            <small>{{ working: 'Trabajando', blocked: 'Bloqueado', review: 'Lista para revisión', idle: 'En espera' }[row.status]}{row.step ? ` · ${row.step}` : ''}</small>
            {(row.purpose === 'none' || (row.what && !row.title.endsWith(row.what))) && <span className="pd-deleg-what">{row.purpose === 'none' ? 'Sin tarea ni encargo' : row.what}</span>}
            {row.why && <small>{row.why}</small>}
            {row.from && <small>Pedido por {row.from.title}{row.from.external ? ` · ${row.from.workspaceName}` : ''}</small>}
            {row.branch && <code>{row.branch}</code>}
          </span>
        </>;
        return <li key={row.id} className="pd-deleg-row" data-purpose={row.purpose} data-status={row.status} style={{ '--deleg-depth': row.depth }}>
          {onOpenPanel
            ? <button type="button" className="pd-deleg-item" aria-label={`Ir a ${row.title}`} onClick={() => onOpenPanel('terminal', { focusNodeId: row.id })}>{content}</button>
            : <div className="pd-deleg-item">{content}</div>}
        </li>;
      })}</ul>
    </section>}
    {onOpenPanel
      ? <QueueSummary workspace={workspace} api={api} onOpenPanel={onOpenPanel} hasOrchestrator={Boolean(orchestrator)} />
      : <Incorporaciones workspace={workspace} api={api} notify={notify} sessionVisible={Boolean(orchestrator)} />}
  </div>;
}

// One line about the queue and the way into it.
function QueueSummary({ workspace, api, onOpenPanel, hasOrchestrator }) {
  const { data, error, reload } = useResource(api, 'merge.status', { workspaceId: workspace.id });
  const queueKey = JSON.stringify(workspace.integration ?? null);
  useEffect(() => { reload(); }, [queueKey, reload]);
  if (!data) return error ? <ErrorNotice error={error} retry={reload} /> : <p className="tw-muted" role="status">Leyendo la cola…</p>;
  const cola = buildCola(data), { now, next, returned } = cola.counts;
  const parts = [next && `${next} en cola`, returned && `${returned} ${returned === 1 ? 'devuelta' : 'devueltas'}`].filter(Boolean);
  const title = !data.available ? data.reason || 'La cola no está disponible en esta carpeta.' : !data.enabled ? 'Integración automática apagada' : now ? cola.orchestrator : parts.length ? parts.join(' · ') : 'Nada en cola';
  return <ul className="inc-group">
    <li className="inc-item"><div className="inc-line is-setting">
      <div className="inc-main"><span className="inc-title" role="status">{title}</span>{data.available && data.enabled && now > 0 && parts.length > 0 && <span className="inc-sub">{parts.join(' · ')}</span>}</div>
      <button type="button" className="inc-button" onClick={() => onOpenPanel('incorporaciones')}>Abrir Cola</button>
    </div></li>
    {data.available && data.enabled && !hasOrchestrator && !data.orchestrator && <li className="inc-item"><div className="inc-line is-setting">
      <div className="inc-main"><span className="inc-title">Sin orquestador abierto</span></div>
      <button type="button" className="inc-button is-primary" onClick={() => onOpenPanel('terminal', { role: 'orchestrator', chat: { provider: preferredCardMode() } }, 'Orquestador')}>Abrir orquestador</button>
    </div></li>}
  </ul>;
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
  </form>;
}
