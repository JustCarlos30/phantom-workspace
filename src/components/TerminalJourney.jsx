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
  const Icon = phase.kind === 'end' ? END_ICON[phase.status] || CircleHelp : phase.status === 'unknown' ? CircleHelp : KIND_ICON[phase.kind] || CircleDot;
  return <Icon size={14} strokeWidth={1.75} aria-hidden="true" />;
}

export default function TerminalJourney({ view, compact = false }) {
  if (!view) return null;
  const { tone, statusLabel, activity, phases = [], blocker } = view;
  const detailed = phases.filter(phase => phase.detail);
  const technical = activity?.detail && activity.detail !== activity.label;
  const hasMore = Boolean(technical || blocker || (compact && detailed.length));
  return <section className="tj" data-tone={tone} data-compact={compact ? 'true' : undefined} aria-label="Recorrido de la terminal">
    <div className="tj-head">
      <strong className="tj-status" role="status">{statusLabel}</strong>
      {activity && <p className="tj-now" title={activity.detail ? `${activity.label} · ${activity.detail}` : activity.label}>
        <span className="tj-now-label">{activity.label}</span>
        {activity.age && <span className="tj-age">hace {activity.age}</span>}
      </p>}
    </div>
    {activity?.warning && <p className="tj-warning">{activity.warning}</p>}
    {phases.length > 0 && <ol className="tj-strip" aria-label="Fases">
      {phases.map(phase => <li key={phase.key} className="tj-phase" data-status={phase.status} data-kind={phase.kind} aria-current={phase.current ? 'step' : undefined}>
        <span className="tj-mark"><PhaseIcon phase={phase} /></span>
        <span className="tj-phase-label" title={phase.label}>{phase.label}</span>
        {!compact && phase.detail && <span className="tj-phase-detail" title={phase.detail}>{phase.detail}</span>}
        <span className="tj-sr">{STATUS_TEXT[phase.status] || STATUS_TEXT.unknown}{phase.detail ? `: ${phase.detail}` : ''}</span>
      </li>)}
    </ol>}
    {blocker && !compact && blocker.summary && <p className="tj-blocker-summary">{blocker.summary}</p>}
    {hasMore && <details className="tj-more">
      <summary><ChevronRight size={14} aria-hidden="true" />Detalles</summary>
      <div className="tj-more-body">
        {technical && <p className="tj-code" title="Texto técnico original">{activity.detail}</p>}
        {compact && detailed.length > 0 && <ul className="tj-detail-list">{detailed.map(phase => <li key={phase.key}><span>{phase.label}</span><span>{phase.detail}</span></li>)}</ul>}
        {blocker && <div className="tj-blocker">
          <strong>{blocker.title}</strong>
          {compact && blocker.summary && <p>{blocker.summary}</p>}
          {blocker.remedy && <p>{blocker.remedy}</p>}
          {blocker.retryAt && <p>Reintento: {blocker.retryAt}</p>}
          {blocker.commands.map(command => <code key={command} className="tj-code">{command}</code>)}
        </div>}
      </div>
    </details>}
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
