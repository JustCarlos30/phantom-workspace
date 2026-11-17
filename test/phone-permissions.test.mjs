import test from 'node:test';
import assert from 'node:assert/strict';
import { standardGrants, grantsFromSelection, selectionFromGrants, needsAcknowledgement } from '../src/phone-permissions.mjs';

const workspaces = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Uno', nodes: [{ id: 'terminal', type: 'terminal', role: null }, { id: 'orchestrator', type: 'chat', role: 'orchestrator' }] },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Dos', nodes: [{ id: 'chat', type: 'chat', role: null }] },
];
const grant = (index, nodeId, capabilities) => ({ workspaceId: workspaces[index].id, nodeId, capabilities });

test('un host sin workspaces no concede permisos ni exige reconocimiento', () => {
  const device = { grants: standardGrants(workspaces), acknowledgeAgentAuthority: true };
  assert.deepEqual(standardGrants(undefined), []);
  assert.deepEqual(grantsFromSelection(device, undefined), []);
  assert.deepEqual(selectionFromGrants(device, undefined), { grants: [], acknowledgeAgentAuthority: true });
  assert.equal(needsAcknowledgement(device, undefined), false);
});

test('dispositivos sin grants o capabilities no conceden permisos', () => {
  for (const device of [{}, { grants: [grant(0, 'orchestrator', undefined), grant(0, null, undefined)] }]) {
    assert.deepEqual(selectionFromGrants(device, workspaces), { grants: [], acknowledgeAgentAuthority: false });
    assert.deepEqual(grantsFromSelection(device, workspaces), []);
    assert.equal(needsAcknowledgement(device, workspaces), false);
    assert.deepEqual(selectionFromGrants(device, undefined), { grants: [], acknowledgeAgentAuthority: false });
  }
});

test('estándar concede chat y herramientas en todos los proyectos', () => {
  assert.deepEqual(standardGrants(workspaces), workspaces.flatMap(({ id }) => [
    { workspaceId: id, nodeId: `phantom:${id}`, capabilities: ['read', 'chat.send', 'chat.stop'] },
    { workspaceId: id, nodeId: null, capabilities: ['workspace.read'] },
  ]));
  assert.deepEqual(standardGrants([]), []);
});

test('ida y vuelta conserva grants de varios proyectos, métodos adicionales y reconocimiento', () => {
  const device = { grants: [...standardGrants(workspaces), grant(0, 'terminal', ['read', 'terminal.write']), grant(1, 'chat', ['read', 'chat.send', 'chat.stop']), grant(0, 'orchestrator', ['read'])], acknowledgeAgentAuthority: true };
  const selection = selectionFromGrants(device, workspaces);
  assert.equal(selection.acknowledgeAgentAuthority, true);
  assert.deepEqual(grantsFromSelection(selection, workspaces), device.grants);
  selection.grants[0].capabilities.push('chat.extra');
  assert.equal(device.grants[0].capabilities.includes('chat.extra'), false);
});

test('hidrata herramientas y reconocimiento existentes sin activarlos por defecto', () => {
  assert.deepEqual(selectionFromGrants({}, workspaces), { grants: [], acknowledgeAgentAuthority: false });
  const device = { grants: [grant(0, null, ['workspace.read', 'cards.list'])], acknowledgeAgentAuthority: true };
  assert.deepEqual(selectionFromGrants(device, workspaces), device);
});

test('quitar lectura descarta acciones dependientes de nodo y proyecto', () => {
  const selection = { grants: [grant(0, 'terminal', ['terminal.write']), grant(1, 'chat', ['chat.send']), grant(0, null, ['cards.list'])] };
  assert.deepEqual(grantsFromSelection(selection, workspaces), []);
  selection.grants[0].capabilities.unshift('read');
  assert.deepEqual(grantsFromSelection(selection, workspaces), [grant(0, 'terminal', ['read', 'terminal.write'])]);
});

test('chat principal y orquestador de cualquier proyecto requieren reconocimiento', () => {
  for (const grants of [standardGrants(workspaces), [grant(0, 'orchestrator', ['read'])], [grant(1, `phantom:${workspaces[1].id}`, ['read'])]]) {
    assert.equal(needsAcknowledgement({ grants }, workspaces), true);
  }
  assert.equal(needsAcknowledgement({ grants: [grant(0, 'terminal', ['read', 'terminal.write']), grant(1, 'chat', ['read']), grant(0, null, ['workspace.read'])] }, workspaces), false);
  assert.equal(needsAcknowledgement({ grants: [grant(0, 'orchestrator', ['chat.send'])] }, workspaces), false);
});

test('proyecto eliminado o nodo ajeno no se envían ni exigen reconocimiento', () => {
  const device = { grants: [...standardGrants(workspaces), grant(1, 'terminal', ['read']), grant(0, 'desaparecido', ['read'])], acknowledgeAgentAuthority: true };
  const remaining = [workspaces[1]];
  assert.deepEqual(grantsFromSelection(device, remaining), standardGrants(remaining));
  assert.deepEqual(selectionFromGrants(device, []), { grants: [], acknowledgeAgentAuthority: true });
  assert.equal(needsAcknowledgement(device, []), false);
});
