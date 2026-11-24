import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronRight, Cpu, FileText, Globe, ListChecks, LoaderCircle, MessageCircleQuestion, Pencil, Search, SquareTerminal, Wrench, X } from 'lucide-react';
import ToolOutput from '../ToolOutput';
import { PhantomGlyph } from '../Glyphs';
import { phantomRunIds, summarizePhantomRun, summarizePhantomActivity } from '../../hooks/phantom-run-link.mjs';
import { itemsOf } from '../../hooks/plugin-model.mjs';

const TOOL_KINDS = [[/^(read|view|cat|notebookread)/, FileText, 'read'], [/^(edit|multiedit|write|patch|apply|notebookedit)/, Pencil, 'edit'], [/^(bash|shell|exec|run)/, SquareTerminal, 'shell'], [/^(grep|glob|search|list|ls|find|toolsearch)/, Search, 'search'], [/^(web|fetch)/, Globe, 'web'], [/^(task|agent)/, Cpu, 'agent'], [/^(check|verify)$/, ListChecks, 'check'], [/^todo/, ListChecks, 'todo']];
const toolKind = name => TOOL_KINDS.find(([pattern]) => pattern.test(String(name).toLowerCase())) || [null, Wrench, 'other'];
// Codex-style: each action is a sentence. The verb's tense carries the state
// (gerund while it runs, past once done); only failures and stops add a word.
const TOOL_VERBS = { read: ['Leyendo', 'Leyó'], edit: ['Editando', 'Editó'], shell: ['Ejecutando', 'Ejecutó'], search: ['Buscando', 'Buscó'], web: ['Consultando', 'Consultó'], agent: ['Delegando', 'Delegó'], todo: ['Actualizando el plan', 'Actualizó el plan'] };
const TOOL_STATES = { error: 'Falló', stopped: 'Detenida' };

// One action, one quiet line: a dot, what was done, and on what. The dot and the verb's tense say whether it is still running.
export const ToolRow = React.memo(function ToolRow({ part }) {
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
  const open = chosen ?? false;
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
    <p className="pc-subagent-goal">{state.title}</p>
    {state.goal && state.goal !== state.title && <details className="pc-subagent-more"><summary><ChevronRight size={14} aria-hidden="true" />Descripción completa</summary><pre className="pc-subagent-prompt">{state.goal}</pre></details>}
    <ol className="pc-phantom-phases" aria-label="Fases del encargo">{state.phases.map(phase => <li key={phase.key} className={`is-${phase.state}`} title={phase.detail}><span>{phase.label}</span><b>{phase.text}</b>{phase.detail && <i>{phase.detail}</i>}</li>)}</ol>
    {state.blocker && <div className="pc-phantom-blocker" role="alert"><strong>{state.blocker.label}</strong><span>{state.blocker.meaning}</span>
      {onOpenPanel ? <button type="button" className="pc-phantom-open" onClick={() => onOpenPanel('phantom-cards', { pluginId: 'phantom', panelId: 'cards', cardId: id, resolve: true }, state.title)}>Resolver bloqueo</button> : <span className="pc-quiet">Resolver bloqueo no está disponible: este chat no puede abrir el panel Phantom.</span>}</div>}
    {state.activity.runs.length <= 1 && state.activity.reason && <p className="pc-phantom-reason" role="alert">{state.activity.reason}</p>}
    {state.activity.runs.length === 1 && state.activity.runs[0].reasonRaw && state.activity.runs[0].reasonRaw !== state.activity.runs[0].reason && <details className="pc-subagent-more"><summary>Detalle técnico</summary><pre className="pc-phantom-reason">{state.activity.runs[0].reasonRaw}</pre></details>}
    {state.live && state.activity.current && <p className="pc-subagent-now" role="status" aria-label="Actividad actual"><LoaderCircle className="spinning" size={14} aria-hidden="true" /><span className="pc-tool-name">{state.activity.current.label}</span><span className="pc-tool-detail" title={state.activity.current.detail}>{state.activity.current.detail}</span></p>}
    <p className="pc-phantom-meta"><span>{state.phase}</span>{state.duration && <span>· {state.duration}</span>}{state.turns !== undefined && <span>· {state.turns} turnos</span>}{state.tools !== undefined && <span>· {state.tools} herramientas</span>}</p>
    {state.activity.runs.length > 1 ? <div className="pc-phantom-attempts">{state.activity.runs.map((run, index) => <details className="pc-subagent-more" key={run.runId}>
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
    {onOpenPanel && <button type="button" className="pc-phantom-open" onClick={() => onOpenPanel('phantom-cards', { pluginId: 'phantom', panelId: 'cards', cardId: id }, state.title)}>Abrir en Phantom</button>}
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
export const ToolGroup = React.memo(function ToolGroup({ items }) {
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

const OTHER = '\u0000other';
const QUESTION_STATUS = { skipped: 'Sin responder · el agente sigue con su criterio', cancelled: 'La respuesta terminó antes de contestar' };
// AskUserQuestion: the agent is waiting on a choice. Each question is a
// native radio/checkbox group plus a free answer; the turn resumes on submit.
export function QuestionCard({ part, onReply }) {
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
