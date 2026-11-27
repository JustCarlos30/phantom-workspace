import React from 'react';
import { AlertCircle, Ban, Check, ChevronRight, CircleDot, CircleHelp, Clock, Compass, Cpu, GitMerge, ListChecks, Network, Pencil, Search, ShieldCheck, Wrench } from 'lucide-react';
import '../terminal-journey.css';

// Recorrido de una terminal a partir de terminalJourney(): franja de fases, actividad con antigüedad y detalle plegable.
// Presentación pura; no hay botones propios: los controles existentes de la tarjeta se conservan en sus consumidores.
const KIND_ICON = { discovery: Search, planning: Compass, develop: Pencil, checks: ListChecks, judge: ShieldCheck, repair: Wrench, children: Network, integration: GitMerge, wait: Clock, step: CircleDot };
const END_ICON = { done: Check, blocked: AlertCircle, stopped: Ban };
const STATUS_TEXT = { done: 'Hecha', current: 'En curso', blocked: 'Bloqueada', pending: 'Pendiente', stopped: 'Detenida', unknown: 'Sin estado' };
const SOURCE_LABEL = { subagent: 'Subagente', child: 'Hijo', task: 'Encargo' };

function PhaseIcon({ phase }) {
  const Icon = phase.status === 'done' ? Check : phase.kind === 'end' ? END_ICON[phase.status] || CircleHelp : phase.status === 'unknown' ? CircleHelp : KIND_ICON[phase.kind] || CircleDot;
  return <Icon size={12} strokeWidth={1.75} aria-hidden="true" />;
}

// Una sola vez: si el estado solo repite la fase actual no se muestra (queda para lectores); si la antecede, solo el resto.
function statusText(statusLabel, phases, blocker) {
  let label = statusLabel || '';
  if (blocker?.kind === 'unknown' && blocker.title && label.endsWith(` · ${blocker.title}`)) label = label.slice(0, -(blocker.title.length + 3));
  const current = phases.find(phase => phase.current)?.label;
  if (!current) return label;
  if (label === current || (label.startsWith(current) && /^\s*\d*$/.test(label.slice(current.length)))) return '';
  return label.startsWith(`${current} · `) ? label.slice(current.length + 3) : label;
}

export default function TerminalJourney({ view, compact = false }) {
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  if (!view) return null;
  const { tone, statusLabel, activity, phases = [], blocker } = view;
  const shown = statusText(statusLabel, phases, blocker);
  const technical = activity?.detail && activity.detail !== activity.label ? activity.detail : '';
  const rows = [];
  if (compact) for (const phase of phases) if (phase.detail) rows.push([phase.label, phase.detail]);
  if (compact && blocker?.summary) rows.push(['Motivo', blocker.summary]);
  if (blocker?.remedy) rows.push(['Remedio', blocker.remedy]);
  if (blocker?.retryAt) rows.push(['Reintento', blocker.retryAt]);
  if (blocker?.commands?.length) rows.push([blocker.commands.length === 1 ? 'Comando' : 'Comandos', blocker.commands, true]);
  if (technical) rows.push(['Técnico', technical, true]);
  return <section className="tj" data-tone={tone} data-compact={compact ? 'true' : undefined} aria-label="Recorrido de la terminal">
    <div className="tj-line">
      <strong className={shown ? 'tj-status' : 'tj-status tj-sr'} role="status">{shown || statusLabel}</strong>
      {phases.length > 0 && <ol className="tj-strip" aria-label="Fases">
        {phases.map(phase => <li key={phase.key} className="tj-phase" data-status={phase.status} data-kind={phase.kind} aria-current={phase.current ? 'step' : undefined} title={phase.detail ? `${phase.label} · ${phase.detail}` : phase.label}>
          <span className="tj-mark"><PhaseIcon phase={phase} /></span>
          <span className="tj-phase-label">{phase.label}{!compact && phase.detail && <span className="tj-phase-detail"> · {phase.detail}</span>}</span>
          <span className="tj-sr">{STATUS_TEXT[phase.status] || STATUS_TEXT.unknown}{phase.detail ? `: ${phase.detail}` : ''}</span>
        </li>)}
      </ol>}
      {activity && <p className="tj-now" title={activity.detail ? `${activity.label} · ${activity.detail}` : activity.label}>
        <span className="tj-now-label">{activity.label}</span>
        {activity.age && <span className="tj-age">· hace {activity.age}</span>}
      </p>}
      {rows.length > 0 && <button type="button" className="tj-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}>Detalles<ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /></button>}
    </div>
    {activity?.warning && <p className="tj-warning">{activity.warning}</p>}
    {blocker && !compact && blocker.summary && <p className="tj-blocker-summary">{blocker.summary}</p>}
    {rows.length > 0 && open && <dl className="tj-facts" id={bodyId}>
      {rows.map(([name, value, mono]) => <div key={name} className="tj-fact">
        <dt>{name}</dt>
        <dd>{Array.isArray(value) ? value.map(command => <code key={command} className="tj-code">{command}</code>) : mono ? <code className="tj-code">{value}</code> : value}</dd>
      </div>)}
    </dl>}
  </section>;
}

// Delegaciones de la terminal para el pie: una línea resumen que se despliega en la lista.
export function TerminalDelegates({ view }) {
  const delegates = view?.delegates;
  if (!delegates || !delegates.total) return null;
  const { total, running, items } = delegates;
  const summary = `${total === 1 ? '1 delegación' : `${total} delegaciones`}${running ? ` · ${running} en curso` : ''}`;
  return <details className="tj-delegates" data-running={running > 0 ? 'true' : undefined}>
    <summary><Cpu size={14} strokeWidth={1.75} aria-hidden="true" /><span className="tj-delegates-summary">{summary}</span><ChevronRight className="tj-caret" size={14} aria-hidden="true" /></summary>
    <ul className="tj-delegate-list" aria-label="Delegaciones">
      {items.map(item => <li key={item.key} className="tj-delegate" data-status={item.status}>
        <i className="tj-delegate-dot" aria-hidden="true" />
        <span className="tj-delegate-main"><strong title={item.label}>{item.label}</strong><em>{item.type || SOURCE_LABEL[item.source]}</em></span>
        <span className="tj-delegate-state">{item.statusLabel}</span>
        {item.activity && <small className="tj-delegate-activity" title={item.activity}>{item.activity}</small>}
      </li>)}
    </ul>
  </details>;
}
