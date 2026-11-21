import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, ArrowUpRight, Check, Mic, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { VoiceActivity, VoiceTranscript, dictationPreview } from './VoiceActivity';
import { canSubmit, mergeDictation, sendAction } from '../hooks/voice-send.mjs';
import { useComposerSize } from '../hooks/useComposerSize';
import { useVoiceDraft } from './VoiceProvider';
import Incorporaciones from './Incorporaciones';
import { preferredCardMode } from './ChatCard';
import { ErrorNotice, useResource } from './PluginPrimitives';
import { buildCola } from '../hooks/incorporaciones-model.mjs';
import { buildDelegation, withCardPlans, withChatSubagents } from '../hooks/delegation-model.mjs';
import { useChatSubagents } from '../hooks/useChatSubagents';
import { statusLabel } from '../hooks/phantom-desk.mjs';
import '../incorporaciones.css';

const AGENT = { working: 'Trabajando', blocked: 'Bloqueado', review: 'En espera', idle: 'En espera' };

function CardPlan({ plan }) {
  return <div className="pd-deleg-plan-block">
    <small>Plan · {plan.done} de {plan.total} completadas</small>
    <ul className="pd-deleg-plan" aria-label="Plan de la card">{plan.children.map(child => <li key={child.key} className="pd-deleg-child" data-status={child.status}><small>{child.status === 'sin registrar' ? 'Sin registrar' : statusLabel(child.status)}</small><span>{child.goal}</span></li>)}</ul>
  </div>;
}

// The dock's Orquestador tab: the orchestrator at a glance, a line to talk to
// it (typed or dictated) when it runs as a chat, and where the queue stands.
// The full queue lives in Git › Cola; without a way to open it, it is shown here.
export default function PhantomOrchestrator({ workspace, api, notify, connected, status, onOpenPanel }) {
  const orchestrator = status.orchestrator;
  const tasks = useResource(api, 'phantom.list', { workspaceId: workspace.id, topic: 'tasks' });
  const [lastTasks, setLastTasks] = useState(null);
  useEffect(() => {
    if (tasks.data != null) setLastTasks({ workspaceId: workspace.id, data: tasks.data });
  }, [tasks.data, workspace.id]);
  useEffect(() => {
    const interval = setInterval(tasks.reload, 20_000);
    return () => clearInterval(interval);
  }, [tasks.reload]);
  const taskData = tasks.data ?? (lastTasks?.workspaceId === workspace.id ? lastTasks.data : null);
  const chatSubagents = useChatSubagents(workspace, api, connected);
  const delegation = useMemo(() => withChatSubagents(withCardPlans(buildDelegation(workspace), taskData), chatSubagents), [workspace, taskData, chatSubagents]);
  const delegates = delegation.rows.filter(row => row.role !== 'orchestrator' && !row.hidden);
  const working = delegates.filter(row => row.status === 'working').length;
  const blocked = delegates.filter(row => row.status === 'blocked').length;
  const unassigned = delegates.filter(row => row.purpose === 'none').length;
  const subagents = delegates.reduce((total, row) => total + row.subagents.length, 0);
  const summary = [
    working && `${working} trabajando`,
    blocked && `${blocked} ${blocked === 1 ? 'bloqueada' : 'bloqueadas'}`,
    unassigned && `${unassigned} sin encargo`,
    subagents && `${subagents} ${subagents === 1 ? 'subagente' : 'subagentes'}`,
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
    {(delegates.length > 0 || delegation.cards.length > 0) && <section className="pd-deleg" aria-label="Delegación">
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
          {row.plan && <CardPlan plan={row.plan} />}
          {row.subagents.length > 0 && <ul className="pd-deleg-subs" aria-label="Subagentes">{row.subagents.map(subagent => <li key={subagent.id} className="pd-deleg-sub"><span>Subagente{subagent.type ? ` · ${subagent.type}` : ''}</span>{subagent.description && <span>{subagent.description}</span>}{subagent.background && <span>en segundo plano</span>}</li>)}</ul>}
        </li>;
      })}</ul>
      {delegation.cards.length > 0 && <div className="pd-deleg-cards">
        <strong>Cards sin terminal</strong>
        {delegation.cards.map(card => <div key={card.id}><strong>{card.goal}</strong><small>{statusLabel(card.status)}</small><CardPlan plan={card.plan} /></div>)}
      </div>}
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
  const [armed, setArmed] = useState(false);
  const input = useRef(null), armedRef = useRef(false), draftRef = useRef(draft), submitRef = useRef(null);
  draftRef.current = draft;
  const arm = value => { armedRef.current = value; setArmed(value); };
  const recorderVoice = useVoiceRecorder({ api, workspaceId: workspace.id, scopeId: `phantom:${workspace.id}:orchestrator:${nodeId}`, enabled: connected, onText: text => {
    const merged = mergeDictation(draftRef.current, text), pendingSend = armedRef.current;
    arm(false); draftRef.current = merged; setDraft(merged);
    if (pendingSend) submitRef.current(merged, true);
  } });
  const voice = { ...recorderVoice, cancel: () => { arm(false); recorderVoice.cancel(); } };
  const dictating = voice.status === 'recording' || voice.status === 'transcribing', running = !!chat?.running;
  useLayoutEffect(() => { if (voice.status === 'idle' || !connected) arm(false); }, [voice.status, connected]);
  useLayoutEffect(() => { arm(false); }, [workspace.id, nodeId]);
  const preview = dictationPreview(voice, draft);
  useComposerSize(input, preview);
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
    setSending(true);
    try { await send(text); setDraft(''); } catch { /* Shown inline by the hook. */ }
    finally { setSending(false); }
  };
  submitRef.current = submit;
  return <form className="pd-composer pc-composer" data-dictating={voice.status !== 'idle' || undefined} onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Escape' && voice.status !== 'idle') { e.preventDefault(); e.stopPropagation(); voice.cancel(); } }}>
    {error && <p className="pc-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{error}</span></p>}
    {voice.error && <p className="pc-error" role="alert"><AlertCircle size={13} aria-hidden="true" /><span>{voice.error}</span><button type="button" className="pc-icon" aria-label="Descartar aviso de voz" onClick={voice.clearError}><X size={13} /></button></p>}
    <div className="pd-field pc-field">
      <div className="pc-input" data-preview={voice.status !== 'idle' || undefined}><VoiceTranscript voice={voice} draft={draft} /><textarea ref={input} rows={1} value={preview} readOnly={voice.status !== 'idle'} disabled={!connected} aria-label={`Mensaje para ${title}`} placeholder={running ? `${title} está trabajando · lo que envíes queda en espera` : `Indica algo a ${title}…`} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} /></div>
      <div className="pc-controls"><VoiceActivity voice={voice} hint="Esc descarta · Enter envía" />
        {voice.status === 'idle' && <button type="button" className="phantom-chat-mic" disabled={!connected || voice.busyElsewhere} title={voice.busyElsewhere ? 'Otro dictado en curso: detén o cancela su audio' : 'Dictar al orquestador'} aria-label="Dictar al orquestador" onClick={voice.start}><Mic size={18} /></button>}
        <button type="submit" className="pc-send" title={dictating ? 'Terminar dictado y enviar · Enter' : 'Enviar · Enter'} aria-label={dictating ? 'Terminar dictado' : `Enviar mensaje a ${title}`} aria-busy={armed} disabled={!canSubmit({ status: voice.status, draft, armed, sending, connected, ready: !!chat })}>{dictating ? <Check size={18} /> : <ArrowUp size={18} />}</button>
      </div>
    </div>
  </form>;
}
