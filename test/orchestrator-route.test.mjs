import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverToOrchestrator, validateOrchestratorSend } from '../host/orchestrator-route.mjs';

function harness({ nodes = [], sessions = [] } = {}) {
  const w = { id: 'w1', nodes };
  const calls = [], writes = [];
  const store = { getWorkspace(id) { if (id !== w.id) throw new Error('Workspace not found'); return w; } };
  const terminals = { sessions, write: (id, data) => writes.push([id, data]) };
  const invoke = async (method, p) => {
    calls.push([method, p]);
    if (method === 'node.create') { const node = { id: 'n-new', type: 'terminal', title: p.title, data: p.data }; w.nodes.push(node); return node; }
    return {};
  };
  return { deps: { store, terminals, chats: {}, invoke }, calls, writes, w };
}

test('modo chat: entrega por chat.send', async () => {
  const h = harness({ nodes: [{ id: 'o1', type: 'terminal', data: { role: 'orchestrator', chat: { provider: 'claude' } } }] });
  const r = await deliverToOrchestrator(h.deps, { workspaceId: 'w1', text: 'hola' });
  assert.deepEqual(r, { workspaceId: 'w1', nodeId: 'o1', mode: 'chat', created: false });
  assert.deepEqual(h.calls, [['chat.send', { workspaceId: 'w1', nodeId: 'o1', text: 'hola' }]]);
  assert.equal(h.writes.length, 0);
});

test('modo PTY: escribe el texto con Enter en la sesión viva', async () => {
  const h = harness({
    nodes: [{ id: 'o1', type: 'terminal', data: { role: 'orchestrator', sessionId: 's1' } }],
    sessions: [{ id: 's1', nodeId: 'o1', workspaceId: 'w1', status: 'running' }],
  });
  const r = await deliverToOrchestrator(h.deps, { workspaceId: 'w1', text: 'incorpora x' });
  assert.deepEqual(r, { workspaceId: 'w1', nodeId: 'o1', mode: 'pty', created: false });
  assert.deepEqual(h.writes, [['s1', 'incorpora x\r']]);
  assert.equal(h.calls.length, 0);
});

test('PTY sin sesión viva falla sin escribir', async () => {
  const h = harness({ nodes: [{ id: 'o1', type: 'terminal', data: { role: 'orchestrator', sessionId: 's1' } }] });
  await assert.rejects(deliverToOrchestrator(h.deps, { workspaceId: 'w1', text: 'x' }));
  assert.equal(h.writes.length, 0);
});

test('crea el orquestador en modo chat si no existe y entrega', async () => {
  const h = harness();
  const r = await deliverToOrchestrator(h.deps, { workspaceId: 'w1', text: 'hola' });
  assert.deepEqual(r, { workspaceId: 'w1', nodeId: 'n-new', mode: 'chat', created: true });
  assert.deepEqual(h.calls.map(c => c[0]), ['node.create', 'terminal.create', 'chat.send']);
  assert.equal(h.calls[0][1].data.role, 'orchestrator');
  assert.ok(h.calls[0][1].data.chat.provider);
});

test('validación de entrada', async () => {
  const h = harness();
  const bad = [null, [], { workspaceId: 'w1' }, { workspaceId: 'w1', text: '' }, { workspaceId: 'w1', text: 'x'.repeat(8001) },
    { workspaceId: 'w1', text: 'a\u0007b' }, { workspaceId: 'w1', text: 'a\rb' }, { workspaceId: 'w1', text: 'x', extra: 1 }, { text: 'x' }, { workspaceId: 5, text: 'x' }];
  for (const p of bad) await assert.rejects(deliverToOrchestrator(h.deps, p), undefined, JSON.stringify(p));
  assert.doesNotThrow(() => validateOrchestratorSend({ workspaceId: 'w1', text: 'línea 1\nlínea 2' }));
  assert.doesNotThrow(() => validateOrchestratorSend({ workspaceId: 'w1', text: 'x'.repeat(8000) }));
  assert.equal(h.calls.length, 0);
});

test('workspace inexistente', async () => {
  const h = harness();
  await assert.rejects(deliverToOrchestrator(h.deps, { workspaceId: 'nope', text: 'x' }), /not found/);
  assert.equal(h.calls.length, 0);
});
