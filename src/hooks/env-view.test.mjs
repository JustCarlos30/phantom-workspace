import test from 'node:test';
import assert from 'node:assert/strict';
import { envView, envRow, ageLabel } from './env-view.mjs';

const now = Date.parse('2026-11-20T12:00:00Z');
const owner = (startedAt = '2026-11-20T11:30:00Z') => ({ ownerSessionId: 's1', ownerNodeId: 'n1', startedAt });
const data = { compose: true, services: [
  { name: 'api', lifecycle: 'persistent', purpose: 'Gateway', card: 'card_1', status: 'running', url: 'http://127.0.0.1:8080', owner: null },
  { name: 'web', lifecycle: 'ephemeral', purpose: 'Preview', card: '', status: 'running', url: null, urls: ['http://127.0.0.1:5173'], owner: owner() },
  { name: 'e2e', lifecycle: 'ephemeral', status: '', owner: null },
] };

test('agrupa por proyecto, terminal y sin dueño', () => {
  const view = envView({ data, nodes: [{ id: 'n1', title: 'Terminal API' }], now });
  assert.equal(view.state, 'ready');
  assert.deepEqual(view.groups.map(g => [g.key, g.rows.map(r => r.name)]), [['project', ['api']], ['terminal', ['web']], ['free', ['e2e']]]);
  const web = view.groups[1].rows[0];
  assert.equal(web.owner, 'Terminal API');
  assert.equal(web.age, 'hace 30 min');
  assert.equal(web.url, 'http://127.0.0.1:5173');
  assert.equal(web.canOpen, true);
  assert.equal(view.groups[0].rows[0].owner, 'Proyecto');
  assert.equal(view.groups[0].rows[0].lifecycleLabel, 'Persistente');
});

test('etiquetas de servicios detenidos o sin datos', () => {
  const row = envRow({ name: 'e2e', status: '' }, { now });
  assert.equal(row.lifecycleLabel, 'Efímero');
  assert.equal(row.status, 'Detenido');
  assert.equal(row.canOpen, false);
  assert.equal(row.canDown, false);
  assert.equal(envRow({ name: 'x', lifecycle: 'raro' }).lifecycle, 'ephemeral');
});

test('estados cargando, error, no disponible y vacío', () => {
  assert.equal(envView({ loading: true }).state, 'loading');
  assert.deepEqual([envView({ error: new Error('boom') }).state, envView({ error: new Error('boom') }).message], ['error', 'boom']);
  const off = envView({ data: { available: false, reason: 'Docker no responde' } });
  assert.deepEqual([off.state, off.message], ['unavailable', 'Docker no responde']);
  assert.equal(envView({ data: null }).state, 'unavailable');
  assert.equal(envView({ data: { compose: false, services: [] } }).state, 'empty');
  assert.equal(envView({ data: { compose: true, services: [] } }).state, 'empty');
});

test('antigüedad', () => {
  assert.equal(ageLabel('2026-11-20T11:59:50Z', now), 'hace menos de 1 min');
  assert.equal(ageLabel('2026-11-20T09:00:00Z', now), 'hace 3 h');
  assert.equal(ageLabel('2026-11-10T12:00:00Z', now), 'hace 10 d');
  assert.equal(ageLabel('nope', now), '');
});
