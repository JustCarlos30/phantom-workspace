import React, { useState } from 'react';
import ActivityNotch, { ActivityTray, TerminalActivityStatus } from '../components/ActivityNotch';
import ActivityTrace from '../components/ActivityTrace';
import PlanPhases from '../components/PlanPhases';
import { activity, noop } from './fixtures';
import { demo } from './decorators';

export default { title: 'Actividad' };
export const Resumen = { render: () => <div className="catalog-page"><ActivityNotch activity={activity} onToggle={noop} /><div className="catalog-row">{['working', 'attention', 'success', 'danger', 'unknown'].map(tone => <TerminalActivityStatus key={tone} session={{ tone, label: { working: 'Trabajando', attention: 'Pide permiso', success: 'Terminó', danger: 'Falló', unknown: 'Sin datos' }[tone] }} />)}</div></div> };
export const Bandeja = { render: () => { const [filter, setFilter] = useState('needs'); return <ActivityTray {...demo} activity={activity} filter={filter} onFilter={setFilter} onTerminal={noop} onInspector={noop} onPanel={noop} onCard={noop} onRead={noop} />; } };
// SYNTHETIC: plan inventado para el catálogo; en producción llega de node.data.plan.
const syntheticPlan = { title: 'SYNTHETIC · Plan de ejemplo', chain: 'synthetic', source: 'SYNTHETIC', updatedAt: '2026-11-23T00:00:00Z', phases: [
  { key: 'a', title: 'Explorar', status: 'done', taskId: 'synthetic-0001' },
  { key: 'b', title: 'Implementar', status: 'running', taskId: 'synthetic-0002' },
  { key: 'c', title: 'Revisar', status: 'blocked', taskId: 'synthetic-0003', note: 'Espera decisión de diseño' },
  { key: 'd', title: 'Integrar', status: 'pending' },
] };
export const Plan = { render: () => <div className="catalog-page"><PlanPhases plan={syntheticPlan} compact /><PlanPhases plan={syntheticPlan} /></div> };
export const Trazas = { render: () => <div className="catalog-page"><p>Atención y turno conservan el contorno apagado por diseño; trabajo, éxito y error usan sus trazas de producción.</p><div className="catalog-grid">{[['working', 'Trabajando'], ['attention', 'Pide permiso'], ['turn', 'Tu turno'], ['success', 'Éxito'], ['error', 'Error']].map(([state, label]) => <article className={`catalog-sample canvas-node pulse-${state}`} style={{ position: 'relative', height: 140 }} key={state}><ActivityTrace state={`pulse-${state}`} /><p>{label}</p></article>)}</div></div> };
