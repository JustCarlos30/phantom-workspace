import React, { useState } from 'react';
import ActivityNotch, { ActivityTray, TerminalActivityStatus } from '../components/ActivityNotch';
import ActivityTrace from '../components/ActivityTrace';
import { activity, noop } from './fixtures';
import { demo } from './decorators';

export default { title: 'Actividad' };
export const Resumen = { render: () => <div className="catalog-page"><ActivityNotch activity={activity} onToggle={noop} /><div className="catalog-row">{['working', 'attention', 'success', 'danger', 'unknown'].map(tone => <TerminalActivityStatus key={tone} session={{ tone, label: { working: 'Trabajando', attention: 'Pide permiso', success: 'Terminó', danger: 'Falló', unknown: 'Sin datos' }[tone] }} />)}</div></div> };
export const Bandeja = { render: () => { const [filter, setFilter] = useState('needs'); return <ActivityTray {...demo} activity={activity} filter={filter} onFilter={setFilter} onTerminal={noop} onInspector={noop} onPanel={noop} onCard={noop} onRead={noop} />; } };
export const Trazas = { render: () => <div className="catalog-page"><p>Atención y turno conservan el contorno apagado por diseño; trabajo, éxito y error usan sus trazas de producción.</p><div className="catalog-grid">{[['working', 'Trabajando'], ['attention', 'Pide permiso'], ['turn', 'Tu turno'], ['success', 'Éxito'], ['error', 'Error']].map(([state, label]) => <article className={`catalog-sample canvas-node pulse-${state}`} style={{ position: 'relative', height: 140 }} key={state}><ActivityTrace state={`pulse-${state}`} /><p>{label}</p></article>)}</div></div> };
