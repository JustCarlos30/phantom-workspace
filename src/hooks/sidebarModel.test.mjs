import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionRows, providerOf, sessionTitle } from './sidebarModel.mjs';

const terminal = (id, provider = 'claude', title = 'Terminal', data = {}) => ({
  id, type: 'terminal', title, data: { chat: { provider }, ...data },
});
const browser = (id, agentTerminal) => ({ id, type: 'browser', title: id, data: { agentTerminal } });

test('providers are recognized explicitly and everything else is terminal', () => {
  for (const provider of ['claude', 'opencode', 'codex']) {
    assert.equal(providerOf(terminal('a', provider)), provider);
  }
  for (const provider of ['other', 'Claude', '', null]) {
    assert.equal(providerOf(terminal('a', provider)), 'terminal');
  }
  assert.equal(providerOf({}), 'terminal');
});

test('empty and default titles use the agent label', () => {
  for (const [provider, label] of [['claude', 'Claude'], ['opencode', 'OpenCode'], ['codex', 'Codex'], ['other', 'Terminal']]) {
    for (const title of ['', 'Terminal', '   ']) assert.equal(sessionTitle(terminal('a', provider, title)), label);
  }
});

test('short titles remain intact, including balanced parentheses', () => {
  assert.equal(sessionTitle({ title: 'Revisar sidebar' }), 'Revisar sidebar');
  assert.equal(sessionTitle({ title: 'Revisar (sidebar)' }), 'Revisar (sidebar)');
});

test('titles drop trailing ellipsis and dangling punctuation and stop at the first sentence', () => {
  assert.equal(sessionTitle({ title: 'Revisar sidebar (…' }), 'Revisar sidebar');
  assert.equal(sessionTitle({ title: 'Revisar sidebar )…' }), 'Revisar sidebar');
  assert.equal(sessionTitle({ title: 'Primera frase. Segunda frase. Tercera' }), 'Primera frase');
  assert.equal(
    sessionTitle({ title: 'Corregir el listado de modelos de OpenCode y Codex en las cards de chat. El usu…' }),
    'Corregir el listado de modelos de OpenCode y Codex en las cards de chat',
  );
});

test('long titles truncate at a word boundary, with a fallback for single words', () => {
  const prefix = 'Una conversación sobre los recursos del proyecto';
  assert.equal(sessionTitle({ title: `${prefix} y sesiones adicionales` }), `${prefix} y sesiones…`);
  assert.equal(sessionTitle({ title: 'a'.repeat(61) }), `${'a'.repeat(60)}…`);
  assert.equal(sessionTitle({ title: 'a'.repeat(60) }), 'a'.repeat(60));
});

test('rows expose defaults, original node and title, status and model basename', () => {
  const node = terminal('a', 'opencode', 'Una tarea. Detalle', {
    chat: { provider: 'opencode', models: { opencode: 'vendor/family/model', claude: 'different' } },
  });
  const { rows, resources } = buildSessionRows([node]);
  assert.deepEqual(rows, [{
    id: 'a', node, provider: 'opencode', providerLabel: 'OpenCode', title: 'Una tarea',
    fullTitle: 'Una tarea. Detalle', tone: 'unknown', statusLabel: 'Estado desconocido',
    needsYou: false, time: '', model: 'model', resources: [],
  }]);
  assert.deepEqual(resources, []);
  const row = buildSessionRows([node], { a: { tone: 'warning', label: 'Necesita permiso', needsYou: true } }).rows[0];
  assert.equal(row.tone, 'warning');
  assert.equal(row.statusLabel, 'Necesita permiso');
  assert.equal(row.needsYou, true);
  assert.equal(buildSessionRows([terminal('b')]).rows[0].model, '');
  const now = Date.parse('2026-11-21T12:00:00Z');
  for (const [timestamp, expected] of [[now - 120000, 'hace 2 min'], ['2026-11-21T10:00:00Z', 'hace 2 h'], ['invalid', ''], [undefined, ''], [null, '']]) {
    const sessions = { a: { tone: 'working', label: 'Trabajando', updatedAt: timestamp } };
    const timed = buildSessionRows([node], sessions, now).rows[0];
    assert.equal(timed.time, expected);
    assert.equal(timed.node, node);
    assert.equal(timed.statusLabel, 'Trabajando');
  }
  assert.equal(buildSessionRows([node], { a: { updatedAt: 'invalid', createdAt: now - 60000 } }, now).rows[0].time, 'hace 1 min');
  assert.equal(buildSessionRows([{ ...node, createdAt: now - 60000 }], {}, now).rows[0].time, '', 'Node age is not session activity');
});

test('duplicates are numbered in source order before stable priority sorting', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => terminal(id));
  nodes.push(terminal('unique', 'codex'));
  const { rows } = buildSessionRows(nodes, {
    b: { tone: 'working', updatedAt: 1000 }, c: { needsYou: true }, d: { tone: 'working', updatedAt: 2000 },
    e: { needsYou: true, tone: 'working' },
  });
  assert.deepEqual(rows.map(row => row.id), ['c', 'e', 'b', 'd', 'a', 'f', 'unique']);
  assert.deepEqual(rows.map(row => row.title), ['Claude 3', 'Claude 5', 'Claude 2', 'Claude 4', 'Claude 1', 'Claude 6', 'Codex']);
});

test('browsers attach by session id with data fallback regardless of source position', () => {
  const first = browser('first', 'live');
  const second = browser('second', 'fallback');
  const third = browser('third', 'live');
  const stale = browser('stale', 'old');
  const byNode = browser('node-id', 'a');
  const note = { id: 'note', type: 'note', data: { agentTerminal: 'live' } };
  const nodes = [first, stale, terminal('a', 'claude', 'Terminal', { sessionId: 'old' }), second,
    note, terminal('b', 'codex', 'Terminal', { sessionId: 'fallback' }), third, byNode];
  const { rows, resources } = buildSessionRows(nodes, { a: { id: 'live' }, b: {} });
  assert.deepEqual(rows[0].resources, [first, third]);
  assert.deepEqual(rows[1].resources, [second]);
  assert.deepEqual(resources, [stale, note, byNode]);
});

test('hidden nodes are excluded from counts, numbering and resource ownership', () => {
  const hidden = terminal('hidden', 'claude', 'Terminal', { hidden: true, sessionId: 'hidden-session' });
  const orphan = browser('orphan', 'hidden-session');
  const hiddenBrowser = { ...browser('hidden-browser', 'visible-session'), data: { hidden: true, agentTerminal: 'visible-session' } };
  const { rows, resources } = buildSessionRows([hidden, terminal('visible'), orphan, hiddenBrowser], { visible: { id: 'visible-session' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Claude');
  assert.deepEqual(rows[0].resources, []);
  assert.deepEqual(resources, [orphan]);
  assert.deepEqual(buildSessionRows(), { rows: [], resources: [] });
});

test('building rows does not mutate inputs', () => {
  const nodes = [terminal('a'), terminal('b'), browser('resource', 'session')];
  const sessions = { a: { id: 'session' }, b: { needsYou: true } };
  const before = structuredClone({ nodes, sessions });
  buildSessionRows(nodes, sessions);
  assert.deepEqual({ nodes, sessions }, before);
});
