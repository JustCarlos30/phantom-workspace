import test from 'node:test';
import assert from 'node:assert/strict';
import { standardGrants, grantsFromSelection, selectionFromGrants, needsAcknowledgement, nodeActions, projectActions, chatActions } from '../src/phone-permissions.mjs';
import { AndroidGateway } from '../host/android-gateway.mjs';

const ws = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Uno', nodes: [
  { id: 'term', type: 'terminal' },
  { id: 'termchat', type: 'terminal', data: { chat: { provider: 'claude' } } },
  { id: 'chat', type: 'chat' },
  { id: 'note', type: 'note' },
] }];
const caps = node => nodeActions(node).map(action => action.capability);

test('catálogo de proyecto expone las tres operaciones con labels', () => {
  assert.deepEqual(projectActions().map(a => a.capability), ['terminal.create', 'terminal.agent.handoff', 'limits.read']);
  assert.ok(projectActions().every(a => a.label.length > 3));
});

test('terminal ofrece write/stop y no chat', () => {
  assert.deepEqual(caps(ws[0].nodes[0]), ['terminal.write', 'terminal.stop']);
});

test('chat ofrece las cuatro acciones de chat', () => {
  assert.deepEqual(caps(ws[0].nodes[2]), ['chat.send', 'chat.stop', 'chat.question.answer', 'chat.permission.answer']);
});

test('terminal con data.chat suma acciones de chat; nodo desconocido no ofrece nada', () => {
  assert.deepEqual(caps(ws[0].nodes[1]), ['terminal.write', 'terminal.stop', 'chat.send', 'chat.stop', 'chat.question.answer', 'chat.permission.answer']);
  assert.deepEqual(caps(ws[0].nodes[3]), []);
  assert.deepEqual(caps(undefined), []);
});

test('selección explícita de acciones de proyecto y nodo se conserva', () => {
  const id = ws[0].id;
  const selection = { grants: [
    { workspaceId: id, nodeId: null, capabilities: ['workspace.read', 'terminal.create', 'limits.read'] },
    { workspaceId: id, nodeId: 'termchat', capabilities: ['read', 'terminal.stop', 'chat.question.answer'] },
  ] };
  assert.deepEqual(grantsFromSelection(selection, ws), selection.grants);
});

test('quitar lectura elimina acciones de proyecto y nodo dependientes', () => {
  const id = ws[0].id;
  const selection = { grants: [
    { workspaceId: id, nodeId: null, capabilities: ['terminal.create', 'terminal.agent.handoff'] },
    { workspaceId: id, nodeId: 'chat', capabilities: ['chat.permission.answer'] },
  ] };
  assert.deepEqual(grantsFromSelection(selection, ws), []);
});

const statusFor = async nodes => {
  const gateway = new AndroidGateway({ hostDataDir: '/phantom-controls-sin-datos', gatewayDataDir: '/phantom-controls-gateway',
    repoPath: '/phantom-controls-sin-repo', listWorkspaces: () => [{ id: ws[0].id, name: 'Uno', nodes }],
    execFile: (bin, args, options, callback) => callback(null, 'v26.0.0', '') });
  return (await gateway.status()).workspaces[0].nodes;
};

test('status del host conectado a nodeActions: terminal y chat con hasChat, sin configuración de chat', async () => {
  const nodes = await statusFor([
    { id: 'termchat', title: 'Agente', type: 'terminal', data: { chat: { provider: 'claude', secret: 'no-exponer' } } },
    { id: 'term', title: 'Shell', type: 'terminal', data: {} },
    { id: 'chat', title: 'Chat', type: 'chat', data: {} },
    { id: 'note', title: 'Nota', type: 'note', data: {} },
  ]);
  assert.deepEqual(nodes.map(node => node.hasChat), [true, false, true]);
  assert.ok(!JSON.stringify(nodes).includes('no-exponer') && !JSON.stringify(nodes).includes('provider'));
  assert.deepEqual(nodes.map(node => Object.keys(node).sort()), [
    ['hasChat', 'id', 'role', 'title', 'type'], ['hasChat', 'id', 'role', 'title', 'type'], ['hasChat', 'id', 'role', 'title', 'type']]);
  assert.deepEqual(caps(nodes[0]), ['terminal.write', 'terminal.stop', 'chat.send', 'chat.stop', 'chat.question.answer', 'chat.permission.answer']);
  assert.deepEqual(caps(nodes[1]), ['terminal.write', 'terminal.stop']);
  assert.deepEqual(caps(nodes[2]), ['chat.send', 'chat.stop', 'chat.question.answer', 'chat.permission.answer']);
});

test('status→nodeActions: nota con data.chat conserva hasChat true sin exponer configuración', async () => {
  const nodes = await statusFor([
    { id: 'note', title: 'Nota chat', type: 'note', data: { chat: { provider: 'claude', secret: 'no-exponer' } } },
    { id: 'plain', title: 'Nota', type: 'note', data: {} },
  ]);
  assert.deepEqual(nodes.map(node => node.id), ['note']);
  assert.equal(nodes[0].hasChat, true);
  assert.deepEqual(Object.keys(nodes[0]).sort(), ['hasChat', 'id', 'role', 'title', 'type']);
  assert.ok(!JSON.stringify(nodes).includes('no-exponer'));
  assert.deepEqual(caps(nodes[0]), ['chat.send', 'chat.stop', 'chat.question.answer', 'chat.permission.answer']);
});

test('chat principal de la UI usa el catálogo de chat completo, igual que un nodo chat', () => {
  assert.deepEqual(chatActions().map(a => a.capability), ['chat.send', 'chat.stop', 'chat.question.answer', 'chat.permission.answer']);
  assert.deepEqual(chatActions().map(a => a.capability), caps({ type: 'chat' }));
  assert.ok(chatActions().every(a => a.label.length > 3));
});

test('el estándar del chat principal no se amplía con respuestas de agente', () => {
  const main = standardGrants(ws).find(grant => grant.nodeId === `phantom:${ws[0].id}`);
  assert.deepEqual(main.capabilities, ['read', 'chat.send', 'chat.stop']);
});

test('un grant de respuesta de agente en el chat principal se conserva al editar', () => {
  const id = ws[0].id;
  const selection = { grants: [{ workspaceId: id, nodeId: `phantom:${id}`, capabilities: ['read', 'chat.question.answer', 'chat.permission.answer'] }] };
  assert.deepEqual(grantsFromSelection(selection, ws), selection.grants);
});

test('grants desconocidos existentes se preservan y estándar no se amplía', () => {
  const id = ws[0].id;
  const device = { grants: [{ workspaceId: id, nodeId: 'term', capabilities: ['read', 'futuro.cap'] }] };
  assert.deepEqual(selectionFromGrants(device, ws).grants, device.grants);
  for (const grant of standardGrants(ws)) assert.ok(!grant.capabilities.some(c => c.startsWith('terminal.') || c === 'limits.read' || c.startsWith('chat.question') || c.startsWith('chat.permission')));
  assert.equal(needsAcknowledgement(device, ws), false);
});
