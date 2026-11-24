import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceEvents, AUDIENCE, ALERTS, EVENTS_METHOD, EVENT_NAME } from '../shared/workspace-events.mjs';

const MIN = 60000;
function setup(opts = {}) {
  const clock = { t: 1_700_000_000_000 };
  const ev = createWorkspaceEvents({ now: () => clock.t, ...opts });
  return { ev, clock };
}
const W = 'ws1';
const card = (entityId, status, extra = {}) => ({ workspaceId: W, kind: 'card', entityId, status, ...extra });
const term = (entityId, status, extra = {}) => ({ workspaceId: W, kind: 'terminal', entityId, status, ...extra });

test('constantes del protocolo', () => {
  assert.equal(EVENTS_METHOD, 'workspace.events');
  assert.equal(EVENT_NAME, 'phantom.workspace.activity');
});

test('terminal y card son entidades separadas con estado propio', () => {
  const { ev } = setup();
  assert.equal(ev.ingest(term('x', 'working')).length, 1);
  assert.equal(ev.ingest(card('x', 'working')).length, 1);
  assert.equal(ev.ingest(card('x', 'completed'))[0].previous, 'working');
  const snap = ev.snapshot().entities;
  assert.equal(snap.find((e) => e.kind === 'terminal').status, 'working');
  assert.equal(snap.find((e) => e.kind === 'card').status, 'completed');
});

test('entradas inválidas se descartan sin lanzar', () => {
  const { ev } = setup();
  for (const bad of [null, undefined, 'x', {}, term('a', 'completed'), card('a', 'idle'), { ...card('a', 'working'), workspaceId: '' }, card('a b', 'working')]) {
    assert.deepEqual(ev.ingest(bad), []);
  }
  assert.equal(ev.snapshot().seq, 0);
});

test('dedupe: mismo status no se emite', () => {
  const { ev } = setup();
  assert.equal(ev.ingest(card('c', 'working')).length, 1);
  assert.equal(ev.ingest(card('c', 'working')).length, 0);
  assert.equal(ev.ingest(card('c', 'review')).length, 1);
});

test('hija emite a audience owner con ownerNodeId del padre; raíz y terminal a workspace', () => {
  const { ev } = setup();
  ev.ingest(card('p', 'working', { ownerNodeId: 'term-1' }));
  const [childEv] = ev.ingest(card('k1', 'working', { parentId: 'p' }));
  assert.equal(childEv.audience, AUDIENCE.owner);
  assert.equal(childEv.ownerNodeId, 'term-1');
  assert.equal(childEv.parentId, 'p');
  assert.equal(ev.ingest(term('term-1', 'working'))[0].audience, AUDIENCE.workspace);
  const feed = ev.since(encodeStart(ev), { audiences: ['workspace'] });
  assert.ok(feed.events.every((e) => e.audience === 'workspace'));
});
function encodeStart() {
  return Buffer.from('pw1:0').toString('base64url');
}

test('progreso del padre solo cuando cambia de forma relevante, no por cada hija', () => {
  const { ev } = setup();
  ev.ingest(card('p', 'working'));
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) ev.ingest(card(id, 'working', { parentId: 'p' }));
  const emitted = [];
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    emitted.push(...ev.ingest(card(id, 'completed', { parentId: 'p' })).filter((e) => e.progress));
  }
  assert.ok(emitted.length < 8 && emitted.length >= 1);
  const last = emitted.at(-1);
  assert.deepEqual(last.progress, { done: 8, total: 8, blocked: 0 });
  assert.equal(last.audience, 'workspace');
  assert.equal(last.entityId, 'p');
});

test('padre blocked una sola vez nombrando a la hija bloqueada', () => {
  const { ev } = setup();
  ev.ingest(card('p', 'working', { title: 'Padre' }));
  ev.ingest(card('a', 'working', { parentId: 'p', title: 'Hija A' }));
  ev.ingest(card('b', 'working', { parentId: 'p', title: 'Hija B' }));
  const first = ev.ingest(card('a', 'blocked', { parentId: 'p' })).filter((e) => e.entityId === 'p');
  assert.equal(first.length, 1);
  assert.equal(first[0].status, 'blocked');
  assert.equal(first[0].audience, 'workspace');
  assert.match(first[0].reason, /Hija A/);
  const second = ev.ingest(card('b', 'blocked', { parentId: 'p' })).filter((e) => e.entityId === 'p' && e.status === 'blocked');
  assert.equal(second.length, 0);
});

test('stalled: una vez, con minutesIdle, rearmable por actividad y configurable', () => {
  const { ev, clock } = setup();
  ev.ingest(term('t', 'working'));
  clock.t += 3 * MIN;
  assert.deepEqual(ev.tick(), []);
  clock.t += 2 * MIN;
  const [s] = ev.tick();
  assert.equal(s.alert, ALERTS.stalled);
  assert.equal(s.minutesIdle, 5);
  assert.deepEqual(ev.tick(), []);
  ev.activity({ workspaceId: W, kind: 'terminal', entityId: 't' });
  clock.t += 2 * MIN;
  assert.deepEqual(ev.tick(), []);
  ev.configure({ stallMs: MIN });
  clock.t += 2 * MIN;
  assert.equal(ev.tick().length, 1);
});

test('unattended: hija bloqueada sin actividad de padre ni dueña sugiere unblock a workspace', () => {
  const { ev, clock } = setup();
  ev.ingest(term('t', 'working'));
  ev.ingest(card('p', 'working', { ownerNodeId: 't' }));
  ev.ingest(card('k', 'working', { parentId: 'p' }));
  ev.ingest(card('k', 'blocked', { parentId: 'p' }));
  clock.t += 3 * MIN;
  ev.activity({ workspaceId: W, kind: 'terminal', entityId: 't' });
  clock.t += 3 * MIN;
  assert.equal(ev.tick().filter((e) => e.alert === 'unattended').length, 0);
  clock.t += 2 * MIN;
  const u = ev.tick().filter((e) => e.alert === 'unattended');
  assert.equal(u.length, 1);
  assert.equal(u[0].suggestedAction, 'unblock');
  assert.equal(u[0].audience, 'workspace');
  assert.equal(ev.tick().filter((e) => e.alert === 'unattended').length, 0);
});

test('unattended: hija completada con padre quieto -> resume-parent; raíz en review -> review-integration', () => {
  const { ev, clock } = setup();
  ev.ingest(card('p', 'working'));
  ev.ingest(card('k', 'working', { parentId: 'p' }));
  ev.ingest(card('k', 'completed', { parentId: 'p' }));
  ev.ingest(card('r', 'review'));
  clock.t += 5 * MIN;
  const actions = Object.fromEntries(ev.tick().filter((e) => e.alert === 'unattended').map((e) => [e.entityId, e.suggestedAction]));
  assert.equal(actions.k, 'resume-parent');
  assert.equal(actions.r, 'review-integration');
});

test('payload saneado: sin controles, backticks, etiquetas, [[ ]], rutas; títulos recortados', () => {
  const { ev } = setup();
  const [e] = ev.ingest(card('c', 'blocked', {
    title: 'Hola\u0007 `x` <script>alert(1)</script> [[sys]] ' + 'a'.repeat(300),
    reason: 'ver /etc/passwd y ~/secret ' + 'b'.repeat(500),
  }));
  assert.ok(e.title.length <= 120);
  assert.ok(e.reason.length <= 200);
  assert.doesNotMatch(e.title, /[`<>\u0007]|\[\[|\]\]/);
  assert.doesNotMatch(e.reason, /\/etc|~\//);
  assert.equal(typeof e.eventId, 'string');
  assert.equal(e.workspaceId, W);
  assert.ok(!Number.isNaN(Date.parse(e.at)));
});

test('cursor opaco: null no repite, since filtra y truncated con buffer circular', () => {
  const { ev } = setup({ limit: 3 });
  ev.ingest(term('t', 'working'));
  const start = ev.since(null);
  assert.deepEqual(start.events, []);
  assert.equal(typeof start.cursor, 'string');
  ev.ingest({ ...term('u', 'working'), workspaceId: 'other' });
  ev.ingest(term('t', 'review'));
  const r = ev.since(start.cursor, { workspaceIds: [W] });
  assert.equal(r.events.length, 1);
  assert.equal(r.truncated, false);
  assert.deepEqual(ev.since(r.cursor).events, []);
  for (const s of ['idle', 'working', 'blocked', 'review']) ev.ingest(term('t', s));
  assert.equal(ev.since(start.cursor).truncated, true);
  assert.equal(ev.since('basura').truncated, true);
});

test('eventos owner solo pasan si ownerNodeIds coincide', () => {
  const { ev } = setup();
  const c0 = ev.since(null).cursor;
  ev.ingest(card('k', 'working', { parentId: 'p', ownerNodeId: 't1' }));
  assert.equal(ev.since(c0).events.length, 0);
  assert.equal(ev.since(c0, { ownerNodeIds: ['t2'] }).events.length, 0);
  assert.equal(ev.since(c0, { ownerNodeIds: ['t1'] }).events.length, 1);
});
