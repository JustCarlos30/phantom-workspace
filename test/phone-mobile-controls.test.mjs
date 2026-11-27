import test from 'node:test';
import assert from 'node:assert/strict';
import { standardGrants, grantsFromSelection, selectionFromGrants, needsAcknowledgement, nodeActions, projectActions } from '../src/phone-permissions.mjs';

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

test('grants desconocidos existentes se preservan y estándar no se amplía', () => {
  const id = ws[0].id;
  const device = { grants: [{ workspaceId: id, nodeId: 'term', capabilities: ['read', 'futuro.cap'] }] };
  assert.deepEqual(selectionFromGrants(device, ws).grants, device.grants);
  for (const grant of standardGrants(ws)) assert.ok(!grant.capabilities.some(c => c.startsWith('terminal.') || c === 'limits.read' || c.startsWith('chat.question') || c.startsWith('chat.permission')));
  assert.equal(needsAcknowledgement(device, ws), false);
});
