// Contrato fijo de la tarea: modelo del sidebar de sesiones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
let loaded;
const model = async () => loaded ??= await import("../src/hooks/sidebarModel.mjs");

const term = (id, title, data = {}) => ({ id, type: 'terminal', title, data });
const browser = (id, title, agentTerminal) => ({ id, type: 'browser', title, data: { agentTerminal, url: 'http://x' } });

test('providerOf lee data.chat.provider y cae a terminal', async () => {
  const { providerOf, sessionTitle, buildSessionRows } = await model();
  assert.equal(providerOf(term('a', 'T', { chat: { provider: 'claude' } })), 'claude');
  assert.equal(providerOf(term('a', 'T', { chat: { provider: 'opencode' } })), 'opencode');
  assert.equal(providerOf(term('a', 'T', { chat: { provider: 'codex' } })), 'codex');
  assert.equal(providerOf(term('a', 'T', {})), 'terminal');
  assert.equal(providerOf(term('a', 'T', { chat: { provider: 'raro' } })), 'terminal');
});

test('sessionTitle usa el agente para títulos genéricos', async () => {
  const { providerOf, sessionTitle, buildSessionRows } = await model();
  assert.equal(sessionTitle(term('a', 'Terminal', { chat: { provider: 'claude' } })), 'Claude');
  assert.equal(sessionTitle(term('a', '', { chat: { provider: 'opencode' } })), 'OpenCode');
  assert.equal(sessionTitle(term('a', 'Terminal', { chat: { provider: 'codex' } })), 'Codex');
  assert.equal(sessionTitle(term('a', 'Terminal', {})), 'Terminal');
});

test('sessionTitle acorta un prompt largo a su primera frase', async () => {
  const { providerOf, sessionTitle, buildSessionRows } = await model();
  const t = sessionTitle(term('a', 'Corregir el listado de modelos de OpenCode y Codex en las cards de chat. El usu…'));
  assert.equal(t, 'Corregir el listado de modelos de OpenCode y Codex en las cards de chat');
  const long = sessionTitle(term('a', 'Pulido de acabado de la UI de Phantom Workspace sin cambiar el estilo vigente (…'));
  assert.ok(long.length <= 60, `demasiado largo: ${long}`);
  assert.ok(!long.endsWith('(…') && !long.endsWith('('), long);
  assert.equal(sessionTitle(term('a', 'Revisar navegación')), 'Revisar navegación');
});

test('numera sesiones con el mismo título visible', async () => {
  const { providerOf, sessionTitle, buildSessionRows } = await model();
  const rows = buildSessionRows([
    term('1', 'Terminal', { chat: { provider: 'claude' } }),
    term('2', 'Terminal', { chat: { provider: 'opencode' } }),
    term('3', 'Terminal', { chat: { provider: 'claude' } }),
    term('4', 'Revisar navegación'),
  ], {}).rows;
  const titles = Object.fromEntries(rows.map(r => [r.id, r.title]));
  assert.equal(titles['1'], 'Claude 1');
  assert.equal(titles['3'], 'Claude 2');
  assert.equal(titles['2'], 'OpenCode');
  assert.equal(titles['4'], 'Revisar navegación');
});

test('cada fila expone agente, estado, modelo y título completo', async () => {
  const { providerOf, sessionTitle, buildSessionRows } = await model();
  const sessions = { '1': { id: 's1', tone: 'working', label: 'Trabajando', needsYou: false } };
  const [row] = buildSessionRows([term('1', 'Terminal', { chat: { provider: 'opencode', models: { opencode: 'openai/gpt-6-astra' } } })], sessions).rows;
  assert.equal(row.provider, 'opencode');
  assert.equal(row.providerLabel, 'OpenCode');
  assert.equal(row.tone, 'working');
  assert.equal(row.statusLabel, 'Trabajando');
  assert.equal(row.model, 'gpt-6-astra');
  assert.equal(row.fullTitle, 'Terminal');
  assert.equal(row.needsYou, false);
  const [unknown] = buildSessionRows([term('9', 'Terminal')], {}).rows;
  assert.equal(unknown.tone, 'unknown');
  assert.equal(unknown.model, '');
});

test('las que necesitan de ti suben, luego las que trabajan, sin romper el orden', async () => {
  const { providerOf, sessionTitle, buildSessionRows } = await model();
  const sessions = {
    b: { id: 'sb', tone: 'working', label: 'Trabajando', needsYou: false },
    c: { id: 'sc', tone: 'warning', label: 'Pide tu aprobación', needsYou: true },
    e: { id: 'se', tone: 'warning', label: 'Terminó · tu turno', needsYou: true },
  };
  const rows = buildSessionRows(['a', 'b', 'c', 'd', 'e'].map(id => term(id, `S ${id}`)), sessions).rows;
  assert.deepEqual(rows.map(r => r.id), ['c', 'e', 'b', 'a', 'd']);
});

test('anida los browsers bajo su agente y deja sueltos los demás recursos', async () => {
  const { providerOf, sessionTitle, buildSessionRows } = await model();
  const nodes = [
    term('t1', 'Terminal', { chat: { provider: 'claude' }, sessionId: 'sess-1' }),
    term('t2', 'Terminal', { chat: { provider: 'claude' } }),
    browser('b1', 'Preview · uno', 'sess-1'),
    browser('b2', 'Preview · dos', 'sess-2'),
    browser('b3', 'Preview · huérfano', 'sess-zz'),
    { id: 'n1', type: 'note', title: 'Notas', data: {} },
  ];
  const sessions = { t2: { id: 'sess-2', tone: 'neutral', label: 'Listo', needsYou: false } };
  const { rows, resources } = buildSessionRows(nodes, sessions);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual(byId.t1.resources.map(n => n.id), ['b1']);
  assert.deepEqual(byId.t2.resources.map(n => n.id), ['b2']);
  assert.deepEqual(resources.map(n => n.id), ['b3', 'n1']);
});

test('ignora nodos ocultos', async () => {
  const { providerOf, sessionTitle, buildSessionRows } = await model();
  const { rows, resources } = buildSessionRows([
    term('t1', 'Terminal', { hidden: true }),
    { id: 'n1', type: 'note', title: 'Oculta', data: { hidden: true } },
  ], {});
  assert.equal(rows.length, 0);
  assert.equal(resources.length, 0);
});
