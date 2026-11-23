import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptHostEvent, authorize, createHostEvents, FORBIDDEN_CODE } from '../host/workspace-events.mjs';

const node = (id, role, sessionId) => ({ id, type: 'terminal', data: { role, sessionId } });
const world = () => {
  const workspaces = [
    { id: 'w1', integration: { enabled: true }, nodes: [node('orch', 'orchestrator', 's-orch'), node('wk1', 'worker', 's-w1'), node('wk2', 'worker', 's-w2')] },
    { id: 'w2', integration: { enabled: true }, nodes: [node('other', 'worker', 's-other')] },
    { id: 'w3', integration: { enabled: false }, nodes: [] },
  ];
  const sessions = [
    { id: 's-orch', workspaceId: 'w1', nodeId: 'orch', status: 'running' },
    { id: 's-w1', workspaceId: 'w1', nodeId: 'wk1', status: 'running' },
    { id: 's-w2', workspaceId: 'w1', nodeId: 'wk2', status: 'running' },
    { id: 's-other', workspaceId: 'w2', nodeId: 'other', status: 'running' },
  ];
  return { session: (id) => sessions.find((s) => s.id === id), workspaces: () => workspaces, sessions };
};
const tool = (status, taskId, extra = {}) => ({
  type: 'tool.status', workspaceId: 'w1', status,
  result: { source: 'phantom', taskId, title: taskId, origin: { nodeId: 'wk1' }, ...extra },
});
const make = (opts = {}) => {
  let t = 1_000_000;
  const sent = [];
  const host = createHostEvents({ stallMs: 60000, unattendedMs: 600000, tickMs: 3600000, now: () => t, broadcast: (m) => sent.push(m), ...opts });
  return { host, sent, advance: (ms) => { t += ms; }, nodeOf: (id) => ({ 's-w1': 'wk1' })[id] };
};

test('maps tool.status of Phantom tasks to card statuses', () => {
  const m = (status) => adaptHostEvent(tool(status, 'T1')).raws[0];
  assert.equal(m('running').status, 'working');
  assert.equal(m('completed').status, 'review');
  assert.equal(m('failed').status, 'failed');
  assert.equal(m('running').entityId, 'T1');
  assert.equal(m('running').ownerNodeId, 'wk1');
  assert.equal(m('running').parentId, undefined);
  assert.equal(adaptHostEvent(tool('running', 'T2', { parentTaskId: 'T1' })).raws[0].parentId, 'T1');
  assert.deepEqual(adaptHostEvent({ type: 'tool.status', workspaceId: 'w1', status: 'running', result: { source: 'other' } }).raws, []);
});

test('maps terminal.exit to idle and output to activity', () => {
  const nodeOf = () => 'wk1';
  const exit = adaptHostEvent({ type: 'terminal.exit', workspaceId: 'w1', sessionId: 's-w1' }, nodeOf);
  assert.deepEqual(exit.raws[0], { workspaceId: 'w1', kind: 'terminal', entityId: 'wk1', status: 'idle' });
  const out = adaptHostEvent({ type: 'terminal.output', workspaceId: 'w1', sessionId: 's-w1' }, nodeOf);
  assert.deepEqual(out.activities, [{ workspaceId: 'w1', kind: 'terminal', entityId: 'wk1' }]);
});

test('agent report becomes a terminal event broadcast to the renderer', () => {
  const { host, sent } = make();
  host.report({ workspaceId: 'w1', nodeId: 'wk1', agent: { status: 'blocked', step: 'Esperando credenciales' } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'workspace.event');
  assert.equal(sent[0].event.kind, 'terminal');
  assert.equal(sent[0].event.status, 'blocked');
  assert.equal(sent[0].event.title, 'Esperando credenciales');
  assert.deepEqual(host.report({ workspaceId: 'w1', nodeId: 'wk1', agent: {} }), []);
});

test('child cards are visible only to the owner terminal', () => {
  const { host, nodeOf } = make();
  const lookup = world();
  host.feed(tool('running', 'P'), nodeOf);
  host.feed(tool('running', 'C1', { parentTaskId: 'P' }), nodeOf);
  host.feed(tool('failed', 'C1', { parentTaskId: 'P' }), nodeOf);
  const cursorless = host.query({ principal: { sessionId: 's-w1' } }, lookup).cursor;
  assert.ok(cursorless);
  const probe = (sessionId) => host.query({ principal: { sessionId }, cursor: 'cHcxOjA' }, lookup).events;
  const owner = probe('s-w1').filter((e) => e.audience === 'owner');
  const stranger = probe('s-w2').filter((e) => e.audience === 'owner');
  const orch = probe('s-orch').filter((e) => e.audience === 'owner');
  assert.ok(owner.some((e) => e.entityId === 'C1' && e.status === 'failed'));
  assert.equal(stranger.length, 0);
  assert.equal(orch.length, 0);
});

test('worker cannot see another workspace nor request it', () => {
  const { host, nodeOf } = make();
  const lookup = world();
  host.feed({ ...tool('running', 'X'), workspaceId: 'w2' }, nodeOf);
  const events = host.query({ principal: { sessionId: 's-w1' }, cursor: 'cHcxOjA' }, lookup).events;
  assert.equal(events.filter((e) => e.workspaceId === 'w2').length, 0);
  assert.throws(() => host.query({ principal: { sessionId: 's-w1' }, workspaceId: 'w2' }, lookup), { message: 'Forbidden' });
});

test('unknown or dead session is Forbidden', () => {
  const lookup = world();
  for (const principal of [{ sessionId: 'nope' }, {}, { sessionId: 5 }, null]) {
    assert.throws(() => authorize(principal, {}, lookup), (e) => e.message === 'Forbidden' && e.code === FORBIDDEN_CODE);
  }
  lookup.sessions[1].status = 'exited';
  assert.throws(() => authorize({ sessionId: 's-w1' }, {}, lookup), { message: 'Forbidden' });
});

test('orchestrator sees several integrated workspaces; permissions are not cached', () => {
  const lookup = world();
  const grant = authorize({ sessionId: 's-orch' }, {}, lookup);
  assert.deepEqual(grant.workspaceIds.sort(), ['w1', 'w2']);
  assert.deepEqual(grant.ownerNodeIds, ['orch']);
  lookup.workspaces()[1].integration.enabled = false;
  assert.deepEqual(authorize({ sessionId: 's-orch' }, {}, lookup).workspaceIds, ['w1']);
  const worker = authorize({ sessionId: 's-w1' }, {}, lookup);
  assert.deepEqual(worker.workspaceIds, ['w1']);
  assert.deepEqual(worker.ownerNodeIds, ['wk1']);
});

test('stalled alert fires for lack of activity and terminal output rearms it', () => {
  const { host, sent, advance, nodeOf } = make();
  host.feed(tool('running', 'T1'), nodeOf);
  sent.length = 0;
  advance(50000);
  host.feed({ type: 'terminal.output', workspaceId: 'w1', sessionId: 's-w1' }, nodeOf);
  advance(50000);
  assert.deepEqual(host.tick(), []);
  advance(70000);
  const alerts = host.tick();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alert, 'stalled');
  assert.equal(alerts[0].entityId, 'T1');
  assert.equal(sent.at(-1).event.alert, 'stalled');
  assert.deepEqual(host.tick(), []);
});

test('rate limit per principal and bounded response', () => {
  const { host, advance, nodeOf } = make();
  const lookup = world();
  for (let i = 0; i < 10; i++) host.query({ principal: { sessionId: 's-w1' } }, lookup);
  assert.throws(() => host.query({ principal: { sessionId: 's-w1' } }, lookup), /Demasiadas/);
  host.query({ principal: { sessionId: 's-w2' } }, lookup);
  advance(1100);
  host.query({ principal: { sessionId: 's-w1' } }, lookup);
  for (let i = 0; i < 150; i++) host.feed(tool(i % 2 ? 'completed' : 'running', `R${i}`), nodeOf);
  advance(1100);
  const res = host.query({ principal: { sessionId: 's-orch' }, cursor: 'cHcxOjA' }, lookup);
  assert.ok(res.events.length <= 100);
});

test('query takes the principal from payload.principal.sessionId', () => {
  const { host, nodeOf } = make();
  const lookup = world();
  host.feed(tool('running', 'P1'), nodeOf);
  const res = host.query({ principal: { sessionId: 's-w1' }, cursor: 'cHcxOjA' }, lookup);
  assert.ok(res.events.some((e) => e.entityId === 'P1'));
});

test('query without a valid principal session is Forbidden', () => {
  const { host } = make();
  const lookup = world();
  const bad = [
    { cursor: 'cHcxOjA' },
    { principal: null, sessionId: 's-w1' },
    { principal: {}, sessionId: 's-w1' },
    { principal: { sessionId: 5 }, sessionId: 's-w1' },
    { principal: { sessionId: 'nope' } },
  ];
  for (const payload of bad) {
    assert.throws(() => host.query(payload, lookup), (e) => e.message === 'Forbidden' && e.code === FORBIDDEN_CODE);
  }
});

test('close stops the timer', () => {
  const { host } = make({ tickMs: 5 });
  host.close();
});
