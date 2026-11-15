import test from 'node:test';
import assert from 'node:assert/strict';
import { HUBS, HUB_ALIAS, HUB_ORDER, hubTab, resolveHub } from './hubs.mjs';

test('every alias lands on an existing hub tab', () => {
  for (const [from, [hub, tab]] of Object.entries(HUB_ALIAS)) {
    assert.ok(HUBS[hub], `${from} → ${hub}`);
    assert.ok(HUBS[hub].tabs.some(item => item[0] === tab), `${from} → ${hub}/${tab}`);
    assert.ok(!HUBS[from], `${from} cannot be both a hub and an alias`);
  }
});

test('the dock lists every hub exactly once', () => {
  assert.deepEqual([...HUB_ORDER].sort(), Object.keys(HUBS).sort());
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

test('an unknown tab falls back to the first one', () => {
  assert.equal(hubTab('repo', 'nope')[0], 'branches');
  assert.equal(hubTab('repo', 'incorporaciones')[2], 'incorporaciones');
  assert.equal(hubTab('terminal', 'x'), null);
});
