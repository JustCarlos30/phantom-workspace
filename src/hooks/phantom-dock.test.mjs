import test from 'node:test';
import assert from 'node:assert/strict';
import { dockStatus, orchestratorNode } from './phantom-dock.mjs';

const terminal = (id, data = {}, title = 'Terminal') => ({ id, type: 'terminal', title, data });
const workspace = ({ enabled = true, queue = [], nodes = [] } = {}) => ({ nodes, integration: { enabled, plan: '', queue } });

test('finds only the terminal marked as orchestrator', () => {
  assert.equal(orchestratorNode(workspace({ nodes: [terminal('a'), { id: 'n', type: 'note', data: { role: 'orchestrator' } }] })), null);
  assert.equal(orchestratorNode(workspace({ nodes: [terminal('a'), terminal('o', { role: 'orchestrator' })] })).id, 'o');
  assert.equal(orchestratorNode(null), null);
});

test('reports off while Incorporaciones is disabled', () => {
  const status = dockStatus(workspace({ enabled: false, queue: [{ status: 'queued' }], nodes: [terminal('o', { role: 'orchestrator' })] }));
  assert.equal(status.tone, 'off');
  assert.equal(status.integration, false);
  assert.equal(status.queued, 1);
});

test('queued requests without an orchestrator are waiting', () => {
  const status = dockStatus(workspace({ queue: [{ status: 'queued' }, { status: 'merged' }, { status: 'conflict' }] }));
  assert.equal(status.tone, 'waiting');
  assert.equal(status.queued, 1);
  assert.equal(status.orchestrator, null);
  assert.match(status.label, /1 solicitud espera sin sesión orquestadora/);
  assert.equal(dockStatus(workspace()).tone, 'idle');
});

test('orchestrator state follows its agent and the merge in progress', () => {
  const orchestrator = agent => terminal('o', { role: 'orchestrator', chat: { provider: 'claude' }, ...(agent ? { agent: { status: agent, step: 'Ordenando' } } : {}) }, 'Orquestador');
  const idle = dockStatus(workspace({ nodes: [orchestrator()], queue: [{ status: 'queued' }, { status: 'queued' }] }));
  assert.equal(idle.tone, 'idle');
  assert.deepEqual(idle.orchestrator, { id: 'o', title: 'Orquestador', chat: true, agent: null, step: '' });
  assert.match(idle.label, /2 solicitudes en cola/);
  assert.equal(dockStatus(workspace({ nodes: [orchestrator('working')] })).tone, 'working');
  assert.equal(dockStatus(workspace({ nodes: [orchestrator()], queue: [{ status: 'merging' }] })).tone, 'working');
  const blocked = dockStatus(workspace({ nodes: [orchestrator('blocked')] }));
  assert.equal(blocked.tone, 'attention');
  assert.equal(blocked.orchestrator.step, 'Ordenando');
});
