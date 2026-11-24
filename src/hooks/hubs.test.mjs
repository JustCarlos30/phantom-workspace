import test from 'node:test';
import assert from 'node:assert/strict';
import { HUBS, HUB_ALIAS, HUB_ORDER, HUB_DOCK, HUB_MORE, hubTab, resolveHub } from './hubs.mjs';

test('every alias lands on an existing hub tab', () => {
  for (const [from, [hub, tab]] of Object.entries(HUB_ALIAS)) {
    assert.ok(HUBS[hub], `${from} → ${hub}`);
    assert.ok(HUBS[hub].tabs.some(item => item[0] === tab), `${from} → ${hub}/${tab}`);
    assert.ok(!HUBS[from], `${from} cannot be both a hub and an alias`);
  }
});

test('the command order lists every hub exactly once', () => {
  assert.deepEqual([...HUB_ORDER].sort(), Object.keys(HUBS).sort());
});

test('the dock and more menu partition every hub', () => {
  assert.ok(HUB_DOCK.every(id => !HUB_MORE.includes(id)));
  assert.deepEqual([...HUB_DOCK, ...HUB_MORE].sort(), Object.keys(HUBS).sort());
});

test('Entorno tabs are Este proyecto, Docker and Todos los proyectos; processes opens Este proyecto', () => {
  assert.deepEqual(HUBS.services.tabs.map(tab => tab[1]), ['Este proyecto', 'Docker', 'Todos los proyectos']);
  assert.deepEqual(resolveHub('processes'), { type: 'services', tab: 'services' });
  assert.equal(hubTab('services', 'processes')[0], 'services');
});

test('legacy panel types open their hub on the matching tab', () => {
  assert.deepEqual(resolveHub('branches'), { type: 'repo', tab: 'branches' });
  assert.deepEqual(resolveHub('incorporaciones'), { type: 'repo', tab: 'incorporaciones' });
  assert.deepEqual(resolveHub('docker'), { type: 'services', tab: 'docker' });
  assert.deepEqual(resolveHub('terminal'), { type: 'terminal', tab: null });
});

test('a request for one card or reference keeps its own panel', () => {
  assert.deepEqual(resolveHub('phantom-cards', { cardId: 'task_1' }), { type: 'phantom-cards', tab: null });
  assert.deepEqual(resolveHub('phantom-cards'), { type: 'tasks', tab: 'cards' });
});

test('Trabajo routes local pendientes independently of native cards and missions', () => {
  assert.deepEqual(hubTab('tasks', 'tasks'), ['tasks', 'Pendientes', 'tasks']);
  assert.deepEqual(resolveHub('phantom-cards'), { type: 'tasks', tab: 'cards' });
  assert.deepEqual(resolveHub('mission'), { type: 'tasks', tab: 'mission' });
});

test('an unknown tab falls back to the first one', () => {
  assert.equal(hubTab('repo', 'nope')[0], 'branches');
  assert.equal(hubTab('repo', 'incorporaciones')[2], 'incorporaciones');
  assert.equal(hubTab('terminal', 'x'), null);
});
