import React from 'react';
import { phaseState, planSummary } from '../hooks/plan-view.mjs';

const MARK = { done: '✓', running: '●', blocked: '!', pending: '○' };

// An agent's plan (node.data.plan): one line when compact, the ordered phases otherwise.
export default function PlanPhases({ plan, compact = false }) {
  const summary = planSummary(plan);
  if (!summary) return null;
  if (compact) {
    return <div className="plan-phases plan-phases-compact" data-tone={summary.tone}>
      <span className="plan-phases-label">{summary.label}</span>
      <small className="plan-phases-progress" aria-label={`${summary.done} de ${summary.total} fases hechas`}>{summary.done}/{summary.total}</small>
    </div>;
  }
  return <div className="plan-phases pd-deleg-plan-block" data-tone={summary.tone}>
    <small>{plan.title || 'Plan'} · {summary.done} de {summary.total} hechas</small>
    <ol className="pd-deleg-plan plan-phases-list" aria-label="Fases del plan">
      {plan.phases.map(phase => <li key={phase.key} className="pd-deleg-child plan-phase" data-status={phase.status} aria-current={phase === summary.current && phase.status === 'running' ? 'step' : undefined}>
        <span className="plan-phase-head"><span className="plan-phase-mark" aria-hidden="true">{MARK[phase.status] || MARK.pending}</span><span>{phase.title}</span></span>
        <small>{phaseState(phase)}{phase.taskId ? <> · <code className="plan-phase-task">{String(phase.taskId).slice(0, 8)}</code></> : null}</small>
        {phase.status === 'blocked' && phase.note ? <small className="plan-phase-note">{phase.note}</small> : null}
      </li>)}
    </ol>
  </div>;
}
