import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInbox, routeTarget, supervisorLine } from './orchestrator-inbox.mjs';
import { buildActivity } from './activityModel.mjs';

const now = Date.parse('2026-11-26T12:00:00Z');
const node = (id, sessionId) => ({ id, type: 'terminal', title: `T ${id}`, data: { sessionId } });
const ws = (id, name, nodes = []) => ({ id, name, nodes });
const asking = (id, at) => ({ id, status: 'running', screenState: 'awaiting_approval', screenStateAt: at });

const A = ws('a', 'Alfa', [node('n1', 's1')]);
const B = ws('b', 'Beta', [node('n2', 's2')]);
const C = ws('c', 'Gamma', []);
const per = {
  a: { sessions: [asking('s1', now - 60000)] },
  b: {
    sessions: [], merges: { available: true, queue: [{ id: 'm1', status: 'conflict', title: 'rama-x', nodeId: 'n2' }], active: [] },
    tasks: [{ id: 'k1', status: 'failed', raw: { reason: 'checks fallaron', contract: { goal: 'Arreglar login' } }, updatedAt: now - 1000 }],
  },
  c: { sessions: [], tasks: [{ id: 'k9', status: 'running', title: 'Algo', updatedAt: now }] },
};

test('agrupa por proyecto y ordena por urgencia', () => {
  const inbox = buildInbox({ workspaces: [C, A, B], perWorkspace: per, connected: true, now });
  assert.deepEqual(inbox.projects.map(p => p.workspaceId), ['b', 'a', 'c']);
  assert.equal(inbox.projects[0].broken.length, 2);
  assert.equal(inbox.projects[1].needsYou.length, 1);
  assert.equal(inbox.updatedAt, new Date(now).toISOString());
});

test('sesión perdida no suma al badge ni a rotos', () => {
  const inbox = buildInbox({ workspaces: [A], perWorkspace: { a: { sessions: [{ id: 's1', status: 'lost' }] } }, connected: true, now });
  assert.equal(inbox.projects[0].needsYou.length, 0);
  assert.equal(inbox.projects[0].broken.length, 0);
});

test('fila de sesión con permiso: acción y motivo', () => {
  const row = buildInbox({ workspaces: [A], perWorkspace: per, now }).projects[0].needsYou[0];
  assert.equal(row.kind, 'session');
  assert.equal(row.workspaceId, 'a');
  assert.equal(row.action.kind, 'open-session');
  assert.equal(row.action.target, 'n1');
  assert.ok(row.reason);
});

test('integración en conflicto va a rotos con review-integration', () => {
  const row = buildInbox({ workspaces: [B], perWorkspace: per, now }).projects[0].broken.find(r => r.kind === 'integration');
  assert.equal(row.action.kind, 'review-integration');
  assert.match(row.title, /rama-x/);
});

test('cards sin terminal entran como fila card con motivo y ubicación', () => {
  const perCards = { b: { cards: [{ id: 'c1', status: 'blocked', raw: { reason: 'Conflicto en la rama', contract: { goal: 'Migrar datos' } }, location: { path: '/w/x', branch: 'feat/y' } }] } };
  const row = buildInbox({ workspaces: [B], perWorkspace: perCards, now }).projects[0].broken[0];
  assert.equal(row.kind, 'card');
  assert.equal(row.title, 'Migrar datos');
  assert.equal(row.action.kind, 'open-card');
  assert.match(row.reason, /feat\/y/);
});

test('card fallida ofrece reintentar y las resueltas no aparecen', () => {
  const cards = [{ id: 'f', status: 'failed', raw: { reason: 'x' } }, { id: 'r', status: 'failed', resolution: { landed: 2 } }];
  const rows = buildInbox({ workspaces: [C], perWorkspace: { c: { cards } }, now }).projects[0].broken;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action.kind, 'retry');
});

test('proyecto sin pendientes se colapsa en una línea', () => {
  const p = buildInbox({ workspaces: [C], perWorkspace: per, now }).projects[0];
  assert.deepEqual([p.broken.length, p.needsYou.length], [0, 0]);
  assert.equal(p.fine.count, 1);
  assert.match(p.fine.line, /nada que revisar/);
});

test('pending coincide con activityModel', () => {
  const inbox = buildInbox({ workspaces: [A, B, C], perWorkspace: per, now });
  const expected = [A, B, C].reduce((n, w) => n + buildActivity({ workspace: w, sessions: per[w.id].sessions || [], tasks: per[w.id].tasks || [], merges: per[w.id].merges || null, now }).count, 0);
  assert.equal(inbox.pending, expected);
  assert.equal(inbox.pending, 2);
  assert.equal(inbox.broken, 2);
});

test('filas ordenadas: rotos antes y más antiguas primero', () => {
  const w = ws('o', 'O', [node('x1', 'q1'), node('x2', 'q2')]);
  const p = { o: { sessions: [asking('q1', now - 1000), asking('q2', now - 90000)] } };
  const rows = buildInbox({ workspaces: [w], perWorkspace: p, now }).projects[0].needsYou;
  assert.deepEqual(rows.map(r => r.action.target), ['x2', 'x1']);
});

test('supervisor: etiquetas de todos los estados', () => {
  const labels = { disabled: 'Desactivado', idle: 'En espera', pending: 'Esperando para resumir', running: 'Resumiendo', error: 'Con error', unavailable: 'No disponible', 'rate-limited': 'Límite por hora alcanzado' };
  for (const [status, label] of Object.entries(labels)) assert.equal(supervisorLine({ status }, now).state, label);
});

test('supervisor: resumen, summaryAt, llamadas y alertas', () => {
  const at = now - 5 * 60000;
  const line = supervisorLine({ status: 'idle', summary: 'Todo bien', summaryAt: new Date(at).toISOString(), usage: { callsLastHour: 3, maxCallsPerHour: 10 }, alerts: ['Aviso'] }, now);
  assert.equal(line.calls, '3 de 10 llamadas en la última hora');
  assert.equal(line.ago, 'hace 5 min');
  assert.deepEqual(line.summary, { text: 'Todo bien', at: new Date(at).toISOString() });
  assert.deepEqual(line.alerts, ['Aviso']);
  assert.equal(supervisorLine({ status: 'idle' }, now).calls, null);
  assert.equal(supervisorLine({ status: 'idle' }, now).summary, null);
});

test('supervisor nunca devuelve coste', () => {
  const line = supervisorLine({ status: 'running', cost: 4, usage: { callsLastHour: 1, maxCallsPerHour: 2, cost: 9, costUsd: 1 } }, now);
  assert.doesNotMatch(JSON.stringify(line), /cost|coste|usd/i);
});

test('routeTarget: fila, seleccionado, más urgente, vacío', () => {
  const inbox = buildInbox({ workspaces: [A, B, C], perWorkspace: per, now });
  assert.equal(routeTarget(inbox, { selectedWorkspaceId: 'a', rowWorkspaceId: 'c' }).workspaceId, 'c');
  assert.equal(routeTarget(inbox, { selectedWorkspaceId: 'a' }).workspaceId, 'a');
  assert.equal(routeTarget(inbox, { selectedWorkspaceId: 'zz', rowWorkspaceId: 'yy' }).workspaceId, 'b');
  assert.equal(routeTarget({ projects: [] }, {}).workspaceId, null);
});

test('entradas vacías o malformadas no lanzan', () => {
  assert.doesNotThrow(() => buildInbox());
  assert.doesNotThrow(() => buildInbox({ workspaces: [null, 3, {}, { id: 'z' }], perWorkspace: { z: { sessions: 'x', tasks: [null, 5], cards: {}, merges: 7, chats: null } }, now }));
  assert.deepEqual(buildInbox({}).projects, []);
  assert.doesNotThrow(() => supervisorLine(null));
  assert.doesNotThrow(() => supervisorLine({ status: 'idle', alerts: [null, 3], usage: 'x', summaryAt: 'nope' }));
  assert.doesNotThrow(() => routeTarget(null, null));
});
