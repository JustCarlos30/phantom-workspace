import React from 'react';
import TerminalJourney, { TerminalDelegates } from '../components/TerminalJourney';
import { terminalJourney } from '../hooks/terminal-journey.mjs';

// SYNTHETIC: todos los datos son inventados para el catálogo; en producción llegan de node.data, los mensajes y los controllers.
export default { title: 'Actividad/Recorrido', id: 'actividad', tags: ['!autodocs'], parameters: { docs: { description: { component: 'Recorrido de terminal con datos sintéticos (SYNTHETIC). Solo presentación: sin controles propios ni sockets.' } } } };

const NOW = Date.parse('2026-11-26T12:00:00Z');
const at = seconds => new Date(NOW - seconds * 1000).toISOString();
const run = (phase, extra = {}) => ({ taskId: 'synthetic-0002', phase, activity: 'edit · src/synthetic.css', startedAt: at(300), lastEventAt: at(12), elapsedMs: 300_000, idleMs: 12_000, round: 0, children: { done: 0, total: 0, items: [] }, stalled: false, looping: false, log: [], blocker: null, observedAt: at(12), ...extra });
const node = (agent = {}, extra = {}) => ({ id: 'synthetic-terminal', data: { agent, ...extra } });
const plan = { title: 'SYNTHETIC · Plan', phases: [{ key: 'discovery', title: 'Descubrimiento', status: 'done', taskId: 'synthetic-0001' }, { key: 'develop', title: 'Desarrollo', status: 'running', taskId: 'synthetic-0002' }, { key: 'judge', title: 'Juez', status: 'pending' }] };
const turn = (parts, status = 'streaming') => ({ role: 'assistant', status, createdAt: at(8), parts });
const journey = props => terminalJourney({ now: NOW, ...props });

function Frame({ view, width = 440 }) {
  return <div className="catalog-page" style={{ width, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
    <TerminalJourney view={view} />
    <TerminalJourney view={view} compact />
    <TerminalDelegates view={view} />
  </div>;
}

const working = journey({
  node: node({ status: 'working', run: run('agent') }, { plan }),
  messages: [turn([
    { type: 'tool', id: 'tool-1', name: 'Bash', detail: 'node "$PHANTOM_AGENT_CLI" show task_synthetic', status: 'running' },
    { type: 'tool', id: 'sub-1', name: 'Agent', detail: 'Revisar estilos sintéticos', status: 'running', agent: { type: 'Explore', steps: [{ id: 1, name: 'Read', detail: 'src/synthetic.css', status: 'running' }] } },
  ])],
  controllers: [{ id: 'ctl-1', taskId: 'synthetic-0009', status: 'running', origin: { nodeId: 'synthetic-terminal' }, title: 'Encargo sintético' }],
  running: true,
});

export const Trabajando = { render: () => <Frame view={working} /> };
export const DecisionPendienteEnReposo = { render: () => <Frame view={journey({ node: node({ status: 'idle' }, { plan }), messages: [turn([{ type: 'question', id: 'q-1', status: 'pending', questions: [{ question: '¿Mantengo la duración adaptativa?' }] }], 'done')] })} /> };
export const EsperaAutonoma = { render: () => <Frame view={journey({ node: node({ status: 'working', run: run('blocked', { activity: '', blocker: { category: 'rate_limit', autonomy: 'auto', summary: 'El proveedor limitó el uso.', remedy: 'Reintenta cuando se libere el límite.', commands: [], retryAt: at(-600) } }) }) })} /> };
export const Juez = { render: () => <Frame view={journey({ node: node({ status: 'working', run: run('judge', { round: 1, activity: 'check · tests' }) }) })} /> };
export const Cancelado = { render: () => <Frame view={journey({ node: node({ status: 'idle', run: run('cancelled', { elapsedMs: 120_000 }) }) })} /> };
export const CompletadoSinIntegracion = { render: () => <Frame view={journey({ node: node({ status: 'review', run: run('completed', { elapsedMs: 420_000 }) }) })} /> };
export const AnchoEstrecho = { render: () => <div className="catalog-row" style={{ alignItems: 'flex-start' }}>{[260, 320].map(width => <div key={width} style={{ width }}><Frame view={working} width={width} /></div>)}</div> };
