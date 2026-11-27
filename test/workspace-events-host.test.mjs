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

const tmpDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-events-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const card = (entityId, status, extra = {}) => ({ workspaceId: 'w1', kind: 'card', entityId, status, ...extra });

test('journal: with dataDir the bus survives a restart and old cursors still work', (t) => {
  const dir = tmpDir(t);
  const a = make({ dataDir: dir });
  a.host.ingest(card('T1', 'working'));
  const mid = a.host.snapshot().cursor;
  a.host.ingest(card('T1', 'failed'));
  a.host.close();
  const b = make({ dataDir: dir });
  assert.equal(b.host.snapshot().seq, 2);
  const r = b.host.query({ cursor: mid, principal: { sessionId: 's-w1' } }, world());
  assert.deepEqual(r.events.map((e) => e.status), ['failed']);
  assert.equal(r.truncated, false);
  b.host.close();
});

test('journal: missing or corrupt file starts empty without throwing; no dataDir writes nothing', (t) => {
  const dir = tmpDir(t);
  const fresh = make({ dataDir: dir });
  assert.equal(fresh.host.snapshot().seq, 0);
  fresh.host.close();
  const file = path.join(dir, 'workspace-events.json');
  fs.writeFileSync(file, '{not json');
  const bad = make({ dataDir: dir });
  assert.equal(bad.host.snapshot().seq, 0);
  bad.host.ingest(card('T1', 'working'));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).seq, 1);
  assert.deepEqual(fs.readdirSync(dir), ['workspace-events.json']);
  bad.host.close();
  const none = make();
  none.host.ingest(card('T1', 'working'));
  assert.equal(none.host.snapshot().subscribers, 0);
  none.host.close();
});

test('subscribe: delivers in process what since() would let through and unsubscribes', () => {
  const m = make();
  const all = [];
  const owner = [];
  const wsOnly = [];
  const off = m.host.subscribe({ workspaceIds: ['w1'], ownerNodeIds: ['wk1'], audiences: ['workspace', 'owner'] }, (e) => all.push(e));
  m.host.subscribe({ ownerNodeIds: ['wk2'], audiences: ['owner'] }, (e) => owner.push(e));
  m.host.subscribe({ audiences: ['workspace'] }, (e) => wsOnly.push(e));
  m.host.subscribe({}, () => { throw new Error('boom'); });
  assert.equal(m.host.snapshot().subscribers, 4);
  m.host.ingest(card('P', 'working', { ownerNodeId: 'wk1' }));
  m.host.ingest(card('K', 'working', { parentId: 'P' }));
  m.host.ingest({ ...card('X', 'working'), workspaceId: 'w2' });
  assert.deepEqual(all.map((e) => `${e.entityId}:${e.audience}`), ['P:workspace', 'K:owner']);
  assert.deepEqual(owner, []);
  assert.deepEqual(wsOnly.map((e) => e.entityId), ['P', 'X']);
  off();
  m.host.ingest(card('P', 'failed', { ownerNodeId: 'wk1' }));
  assert.equal(all.length, 2);
  assert.equal(m.host.snapshot().subscribers, 3);
  m.host.close();
});

test('subscribe: an orphan child card reaches workspace subscribers and unsubscribing twice is harmless', () => {
  const m = make();
  const seen = [];
  const off = m.host.subscribe({ audiences: ['workspace'] }, (e) => seen.push(e));
  m.host.ingest(card('K', 'working', { parentId: 'unknown' }));
  assert.deepEqual(seen.map((e) => `${e.entityId}:${e.audience}:${e.parentId}`), ['K:workspace:unknown']);
  off();
  off();
  assert.equal(m.host.snapshot().subscribers, 0);
  m.host.close();
});

test('journal: the persisted file keeps cancelled cards and integrations after a restart', (t) => {
  const dir = tmpDir(t);
  const a = make({ dataDir: dir });
  a.host.ingest(card('T1', 'cancelled', { phase: 'agent', round: 2 }));
  a.host.ingest({ workspaceId: 'w1', kind: 'integration', entityId: 'r1', status: 'queued', branch: 'feat/x' });
  a.host.close();
  const b = make({ dataDir: dir });
  assert.equal(b.host.snapshot().seq, 2);
  const ents = b.host.snapshot().entities;
  assert.ok(JSON.stringify(ents).includes('cancelled'));
  assert.ok(JSON.stringify(ents).includes('integration'));
  b.host.close();
});

test('close stops the timer', () => {
  const { host } = make({ tickMs: 5 });
  host.close();
});

// --- Observabilidad de agentes con el host real (socket, PTY /bin/sh, stores en dataDir temporal) -----------------
// Los proveedores son fixtures: eventos con la forma real de Claude stream-json / hooks, sin ejecutar ningún proveedor.
// El resumidor del supervisor es un callback falso; ningún test activa el supervisor real ni toca proyectos del usuario.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createHost } from '../host/server.mjs';
import { adaptHookTrace, adaptTraceEvent, adaptTurnTrace, createTraceState, traceRootId } from '../host/agent-trace-adapters.mjs';
import { serve } from '../scripts/phantom-mcp.mjs';

const T1 = 'task_11111111-1111-4111-8111-111111111111';
const T2 = 'task_22222222-2222-4222-8222-222222222222';
const until = async (check, ms = 4000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('Condición no cumplida a tiempo');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

async function observed(t, { summarize, tasks = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-observability-'));
  const dataDir = path.join(root, 'state');
  const calls = { summaries: [] };
  const handleIntegration = async (method) => (method === 'phantom.list' ? { handled: true, result: { available: true, items: tasks } } : { handled: false });
  const supervisorOptions = { summarize: async (request) => { calls.summaries.push(request); return summarize ? summarize(request) : { summary: 'Sin novedades', proposals: [] }; } };
  let host = await createHost({ dataDir, handleIntegration, supervisorOptions });
  t.after(async () => { await host.close().catch(() => {}); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: root });
  const terminal = async () => host.invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' });
  return {
    root, dataDir, workspace, calls, terminal,
    get host() { return host; },
    restart: async () => { await host.close(); host = await createHost({ dataDir, handleIntegration, supervisorOptions }); },
  };
}

// One Claude turn: a root that delegates to two sub-agents whose events interleave, the second one using the Phantom MCP tool.
function interleavedTurn(f, node) {
  const state = createTraceState(), base = { workspaceId: f.workspace.id, nodeId: node.id, provider: 'claude', state, turnId: 'turn1', model: 'claude-sonnet-5-5' };
  const trace = (records) => f.host.chats.trace(() => records);
  const event = (value) => trace(adaptTraceEvent({ ...base, event: value }));
  trace(adaptTurnTrace({ ...base, phase: 'start', message: 'Revisa el proyecto con dos ayudantes', instructions: 'Eres el agente del proyecto' }));
  event({ type: 'system', subtype: 'init', session_id: 'sess1', model: 'claude-sonnet-5-5' });
  event({ type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 20 }, content: [
    { type: 'tool_use', id: 'toolu_A1', name: 'Agent', input: { description: 'Explorar', prompt: 'Lee a.txt', subagent_type: 'Explore' } },
    { type: 'tool_use', id: 'toolu_A2', name: 'Agent', input: { description: 'Probar', prompt: 'Registra la tarea' } }] } });
  event({ type: 'assistant', parent_tool_use_id: 'toolu_A1', message: { id: 'mc1', content: [{ type: 'tool_use', id: 'toolu_C1', name: 'Read', input: { file_path: 'a.txt' } }] } });
  event({ type: 'assistant', parent_tool_use_id: 'toolu_A2', message: { id: 'mc2', content: [{ type: 'tool_use', id: 'toolu_C2', name: 'mcp__phantom_workspace__phantom', input: { cli: 'agent', args: ['bind', T1] } }] } });
  event({ type: 'user', parent_tool_use_id: 'toolu_A1', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_C1', content: 'contenido de a.txt' }] } });
  event({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_A1', content: 'Explorado' }] } });
  return { finish: () => trace(adaptTurnTrace({ ...base, phase: 'end', status: 'done' })) };
}
const root = (f, node) => traceRootId({ nodeId: node.id, provider: 'claude' });
const detailOf = (f, id, extra = {}) => f.host.invoke('agent.traces.detail', { workspaceId: f.workspace.id, id, ...extra });

test('real host: root and two interleaved sub-agents keep separate histories, parents and context', async (t) => {
  const f = await observed(t);
  const { node } = await f.terminal();
  interleavedTurn(f, node).finish();
  const rootId = root(f, node);
  const { items } = await f.host.invoke('agent.traces.list', { workspaceId: f.workspace.id });
  assert.deepEqual(items.map((agent) => agent.id).sort(), [rootId, 'toolu_A1', 'toolu_A2'].sort());
  const by = Object.fromEntries(items.map((agent) => [agent.id, agent]));
  assert.equal(by[rootId].parentId, null);
  assert.equal(by.toolu_A1.parentId, rootId);
  assert.equal(by.toolu_A2.parentId, rootId);
  assert.equal(by.toolu_A1.status, 'done');
  assert.equal(by.toolu_A2.status, 'unknown', 'a child left open by the turn is not invented as done');
  assert.ok(items.every((agent) => agent.nodeId === node.id && agent.workspaceId === f.workspace.id));
  const first = await detailOf(f, 'toolu_A1'), second = await detailOf(f, 'toolu_A2'), main = await detailOf(f, rootId);
  const callIds = (detail) => detail.events.map((event) => event.id);
  assert.ok(callIds(first).includes('toolu_C1:start') && callIds(first).includes('toolu_C1:end'));
  assert.ok(!callIds(first).includes('toolu_C2:start') && !callIds(second).includes('toolu_C1:start'), 'each history holds only its own tools');
  assert.ok(!callIds(main).some((id) => id.startsWith('toolu_C')), 'the root never receives the children tools');
  assert.ok(callIds(main).includes('toolu_A1:start') && callIds(main).includes('toolu_A2:start'));
  // Context never inherits: the child has its assignment, the root has instructions; tokens only where the provider measured them.
  assert.equal(first.agent.context.assignment.text, 'Lee a.txt');
  assert.equal(first.agent.context.instructions.available, false);
  assert.equal(first.agent.context.tokens.available, false);
  assert.equal(main.agent.context.instructions.text, 'Eres el agente del proyecto');
  assert.equal(main.agent.context.tokens.total, 120, 'the UI reads the measured total, never an estimate');
  assert.equal(main.agent.context.tokens.window, undefined);
});

test('MCP tool calls are identified by the agent that made them, with their structured input', async (t) => {
  const f = await observed(t);
  const { node } = await f.terminal();
  interleavedTurn(f, node);
  const second = await detailOf(f, 'toolu_A2');
  const call = second.events.find((event) => event.id === 'toolu_C2:start');
  assert.equal(call.tool, 'mcp__phantom_workspace__phantom');
  assert.deepEqual(JSON.parse(call.input), { cli: 'agent', args: ['bind', T1] });
  assert.equal(call.status, 'running');
  assert.equal(second.agent.currentActivity.tool, 'mcp__phantom_workspace__phantom');
  assert.equal(second.agent.currentActivity.callId, 'toolu_C2');
  // The MCP provider names its caller explicitly; the result lands on that agent only.
  const state = createTraceState();
  f.host.chats.trace(() => adaptTraceEvent({ workspaceId: f.workspace.id, nodeId: node.id, provider: 'mcp', agentId: 'toolu_A2', state, event: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'phantom', arguments: { cli: 'agent', args: ['run', T1] } } } }));
  f.host.chats.trace(() => adaptTraceEvent({ workspaceId: f.workspace.id, nodeId: node.id, provider: 'mcp', agentId: 'toolu_A2', state, event: { jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: 'iniciado' }] } } }));
  const after = await detailOf(f, 'toolu_A2'), other = await detailOf(f, 'toolu_A1');
  assert.ok(after.events.some((event) => event.id === 'mcp:7:end' && event.status === 'done' && event.output === 'iniciado'));
  assert.ok(!other.events.some((event) => event.id.startsWith('mcp:')));
  assert.equal(f.host.chats.traceFailures.count, 0);
});

test('listing and detail respect workspace and node, bound their params and refuse foreign ids', async (t) => {
  const f = await observed(t);
  const { node } = await f.terminal();
  interleavedTurn(f, node);
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-observability-other-'));
  t.after(() => fs.rmSync(otherDir, { recursive: true, force: true }));
  const other = await f.host.invoke('workspace.open', { path: otherDir });
  assert.deepEqual((await f.host.invoke('agent.traces.list', { workspaceId: other.id })).items, []);
  const foreign = await f.host.invoke('agent.traces.detail', { workspaceId: other.id, id: 'toolu_A1' });
  assert.equal(foreign.agent, null);
  assert.equal(foreign.availability.available, false);
  assert.equal((await f.host.invoke('agent.traces.list', { workspaceId: f.workspace.id, nodeId: node.id })).items.length, 3);
  assert.equal((await f.host.invoke('agent.traces.list', { workspaceId: f.workspace.id, nodeId: 'otro-nodo' })).items.length, 0);
  // Pagination: bounded pages with a continuable cursor.
  const page = await detailOf(f, root(f, node), { limit: 2 });
  assert.equal(page.events.length, 2);
  assert.equal(page.hasMore, true);
  const next = await detailOf(f, root(f, node), { limit: 2, cursor: page.cursor });
  assert.ok(next.events.length >= 1 && next.events[0].seq > page.events[1].seq);
  const bad = [
    ['agent.traces.list', { workspaceId: 'no-existe' }],
    ['agent.traces.list', { workspaceId: f.workspace.id, path: '/etc' }],
    ['agent.traces.detail', { workspaceId: f.workspace.id, id: '../../etc/passwd' }],
    ['agent.traces.detail', { workspaceId: f.workspace.id, id: 'toolu_A1', limit: 201 }],
    ['agent.traces.detail', { workspaceId: f.workspace.id, id: 'toolu_A1', limit: 0 }],
    ['agent.traces.detail', { workspaceId: f.workspace.id, id: 'toolu_A1', cursor: 'abc' }],
    ['agent.traces.detail', { workspaceId: f.workspace.id }],
    ['supervisor.read', { workspaceId: f.workspace.id, sessionId: 'x' }],
    ['supervisor.configure', { workspaceId: f.workspace.id, patch: 'enabled' }],
  ];
  for (const [method, payload] of bad) await assert.rejects(f.host.invoke(method, payload), undefined, method);
  for (const dir of fs.readdirSync(path.join(f.dataDir, 'agent-traces'))) assert.match(dir, /^[0-9a-f]{32}$/, 'ids are data, never path segments');
});

test('history survives a host restart: finished agents keep their outcome, open ones become interrupted', async (t) => {
  const f = await observed(t);
  const { node } = await f.terminal();
  interleavedTurn(f, node).finish();
  const before = await detailOf(f, 'toolu_A2');
  await f.restart();
  const items = (await f.host.invoke('agent.traces.list', { workspaceId: f.workspace.id })).items;
  const by = Object.fromEntries(items.map((agent) => [agent.id, agent]));
  assert.equal(by.toolu_A1.status, 'done');
  assert.equal(by[root(f, node)].status, 'done');
  assert.equal(by.toolu_A2.status, 'interrupted');
  assert.equal(by.toolu_A2.availability.outcome.available, false);
  const after = await detailOf(f, 'toolu_A2');
  assert.deepEqual(after.events.slice(0, before.events.length), before.events, 'nothing already recorded is rewritten');
  assert.equal(after.events.at(-1).kind, 'interrupted');
  assert.equal(by.toolu_A1.parentId, root(f, node), 'ownership is persisted as explicit data');
});

test('hook records come only from a live session: workspace and node are imposed, claims are dropped, replays are idempotent', async (t) => {
  const f = await observed(t);
  const { session, node } = await f.terminal();
  const pre = { hook_event_name: 'PreToolUse', session_id: 'sess1', tool_name: 'Agent', tool_use_id: 'toolu_H1', tool_input: { description: 'Revisar', prompt: 'Lee el README', subagent_type: 'Explore' } };
  const forge = (record) => ({ ...record, workspaceId: 'forged-workspace', nodeId: 'forged-node', taskId: T2, runId: 'run_forged' });
  const records = adaptHookTrace(pre, { provider: 'claude' }).map(forge);
  const first = await f.host.invoke('terminal.agent.trace', { sessionId: session.id, records });
  assert.equal(first.rejected.length, 0);
  assert.ok(first.recorded >= 2);
  const again = await f.host.invoke('terminal.agent.trace', { sessionId: session.id, records });
  assert.equal(again.recorded, 0, 'a replay appends nothing');
  assert.equal(again.duplicates, first.recorded);
  const { items } = await f.host.invoke('agent.traces.list', { workspaceId: f.workspace.id });
  assert.deepEqual(items.map((agent) => agent.id).sort(), ['session:sess1', 'toolu_H1']);
  for (const agent of items) {
    assert.equal(agent.workspaceId, f.workspace.id);
    assert.equal(agent.nodeId, node.id);
    assert.equal(agent.runId, null, 'a run id the agent cannot prove is dropped');
    assert.equal(agent.taskId, null, 'a task the card is not bound to is dropped');
  }
  assert.equal(items.find((agent) => agent.id === 'toolu_H1').parentId, 'session:sess1');
  assert.equal((await detailOf(f, 'toolu_H1')).events.filter((event) => event.id === 'toolu_H1:delegated').length, 1);
  for (const payload of [{ sessionId: session.id, records: [] }, { sessionId: session.id, records: 'x' }, { sessionId: session.id, records: [{ id: 'a', extra: 1 }] },
    { sessionId: session.id, records: [{ id: '../x' }] }, { sessionId: session.id, records: [{ id: 'a', provider: 'phantom' }] }, { sessionId: session.id, records: [{ id: 'a' }], workspaceId: 'x' },
    { sessionId: session.id, records: Array.from({ length: 51 }, (_, index) => ({ id: `a${index}` })) }]) {
    await assert.rejects(f.host.invoke('terminal.agent.trace', payload));
  }
  await assert.rejects(f.host.invoke('terminal.agent.trace', { sessionId: 'no-existe', records: [{ id: 'a' }] }));
});

test('a worker never reads or writes its neighbour; an ended session loses access immediately', async (t) => {
  const f = await observed(t);
  const a = await f.terminal(), b = await f.terminal();
  const record = (session, record) => f.host.invoke('terminal.agent.trace', { sessionId: session.id, records: [record] });
  await record(a.session, { id: 'root-a', provider: 'claude', name: 'Raíz A', status: 'running', event: { id: 'a-start', kind: 'session.start', text: 'inicio' } });
  await record(b.session, { id: 'root-b', provider: 'claude', name: 'Raíz B', status: 'running', event: { id: 'b-start', kind: 'session.start', text: 'inicio' } });
  // Foreign agent, parent and actor are rejected before anything is written.
  await assert.rejects(record(b.session, { id: 'root-a', event: { id: 'b-intrusion', kind: 'message', text: 'x' } }), /otro nodo/);
  await assert.rejects(record(b.session, { id: 'b-child', parentId: 'root-a', status: 'running' }), /otro nodo/);
  await assert.rejects(record(b.session, { id: 'b-child', event: { id: 'b-spoof', kind: 'message', actorId: 'root-a' } }), /otro nodo/);
  assert.equal((await detailOf(f, 'root-a')).events.length, 1);
  assert.equal((await detailOf(f, 'b-child')).agent, null);
  // Reading: the worker sees its node only, and cannot name another workspace or node.
  const mine = await f.host.invoke('terminal.agent.traces', { sessionId: b.session.id });
  assert.deepEqual(mine.items.map((agent) => agent.id), ['root-b']);
  const hidden = await f.host.invoke('terminal.agent.traces', { sessionId: b.session.id, id: 'root-a' });
  assert.equal(hidden.agent, null);
  assert.deepEqual(hidden.availability, (await f.host.invoke('terminal.agent.traces', { sessionId: b.session.id, id: 'no-existe' })).availability, 'a neighbour is indistinguishable from a missing agent');
  assert.equal((await f.host.invoke('terminal.agent.traces', { sessionId: a.session.id, id: 'root-a' })).agent.id, 'root-a');
  for (const extra of [{ workspaceId: f.workspace.id }, { nodeId: a.node.id }, { principal: { sessionId: a.session.id } }]) await assert.rejects(f.host.invoke('terminal.agent.traces', { sessionId: b.session.id, ...extra }));
  // The MCP tool forwards only its own session; the host answers with the same restricted view.
  const input = new PassThrough(), output = new PassThrough(), lines = [];
  output.setEncoding('utf8'); output.on('data', (chunk) => lines.push(...chunk.split('\n').filter(Boolean).map((row) => JSON.parse(row))));
  serve({ input, output, env: { PHANTOM_TERMINAL_SESSION_ID: b.session.id, PHANTOM_WORKSPACE_SOCKET: f.host.socketPath } });
  const rpc = async (id, method, params) => { input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); return (await until(() => lines.find((line) => line.id === id))).result; };
  assert.ok((await rpc(1, 'tools/list')).tools.some((tool) => tool.name === 'traces'));
  const listed = await rpc(2, 'tools/call', { name: 'traces', arguments: {} });
  assert.equal(listed.isError, false);
  assert.deepEqual(JSON.parse(listed.content[0].text).items.map((agent) => agent.id), ['root-b']);
  assert.equal((await rpc(3, 'tools/call', { name: 'traces', arguments: { workspaceId: f.workspace.id } })).isError, true);
  assert.equal(JSON.parse((await rpc(4, 'tools/call', { name: 'traces', arguments: { id: 'root-a' } })).content[0].text).agent, null);
  input.end();
  // Revocation: the moment the session is no longer the panel's live one, reads and writes fail.
  await f.host.invoke('terminal.stop', { sessionId: a.session.id });
  await until(() => f.host.terminals.get(a.session.id).status !== 'running');
  await assert.rejects(f.host.invoke('terminal.agent.traces', { sessionId: a.session.id }), { message: 'Forbidden' });
  await assert.rejects(record(a.session, { id: 'root-a', event: { id: 'a-late', kind: 'message', text: 'tarde' } }), /sesión viva/);
});

test('ending a terminal or a Phantom run keeps the history and states only what is known', async (t) => {
  const f = await observed(t);
  const { session, node } = await f.terminal();
  await f.host.invoke('terminal.agent.trace', { sessionId: session.id, records: adaptHookTrace({ hook_event_name: 'SessionStart', session_id: 'sess9', source: 'startup', model: 'claude-sonnet-5-5' }, { provider: 'claude' }) });
  await f.host.invoke('terminal.agent.trace', { sessionId: session.id, records: adaptHookTrace({ hook_event_name: 'PreToolUse', session_id: 'sess9', tool_name: 'Read', tool_use_id: 'toolu_R1', tool_input: { file_path: 'x.txt' } }, { provider: 'claude' }) });
  const before = (await detailOf(f, 'session:sess9')).events.length;
  assert.ok(before >= 2);
  // A Phantom run with a verified origin node is attributed to it; one naming an unknown owner is not recorded at all.
  const run = (status, extra = {}) => ({ type: 'tool.status', workspaceId: f.workspace.id, status, result: { source: 'phantom', action: 'run', id: 'ctrl-1', taskId: T1, title: 'Encargo de prueba', requestedModel: 'claude-sonnet-5-5', origin: { nodeId: node.id }, ...extra } });
  f.host.emit(run('running'));
  f.host.emit({ ...run('running'), result: { ...run('running').result, id: 'ctrl-2', origin: { nodeId: 'nodo-inexistente' } } });
  const runAgent = (await detailOf(f, 'run:ctrl-1')).agent;
  assert.equal(runAgent.taskId, T1);
  assert.equal(runAgent.runId, 'ctrl-1');
  assert.equal(runAgent.nodeId, node.id);
  assert.equal(runAgent.parentId, null);
  assert.equal(runAgent.availability.parent.available, false, 'a PTY origin is not guessed to be a particular agent');
  assert.equal((await detailOf(f, 'run:ctrl-2')).agent, null);
  f.host.emit(run('completed'));
  assert.equal((await detailOf(f, 'run:ctrl-1')).agent.status, 'done');
  // The PTY ends: its open agents stop (never "done"), the Phantom run keeps its own outcome, nothing recorded disappears.
  await f.host.invoke('terminal.stop', { sessionId: session.id });
  await until(async () => (await detailOf(f, 'session:sess9')).agent.status === 'stopped');
  const ended = await detailOf(f, 'session:sess9');
  assert.equal(ended.events.length, before + 1);
  assert.equal(ended.events.at(-1).kind, 'session.end');
  assert.equal((await detailOf(f, 'toolu_R1')).agent, null, 'tool calls are events of their agent, not agents');
  assert.equal((await detailOf(f, 'run:ctrl-1')).agent.status, 'done');
});

test('supervisor with an injected summarizer: snapshot from real data, validated proposals, no side effects, no LLM on read', async (t) => {
  const tasks = [{ id: T1, kind: 'task', raw: { id: T1, contract: { dependencies: [] } } }, { id: T2, kind: 'task', raw: { id: T2, contract: { dependencies: [T1] } } }];
  const dependency = `task:${T2}:${T1}`;
  const f = await observed(t, { tasks, summarize: async () => ({
    summary: 'Dos agentes activos y una dependencia declarada.',
    proposals: [
      { kind: 'unblock', title: 'Revisar el bloqueo', reason: 'Un agente quedó sin resultado.', evidenceIds: ['toolu_A2'] },
      { kind: 'dependency', title: 'Revisar dependencia', reason: 'T2 espera a T1.', evidenceIds: [dependency] },
      { kind: 'unblock', title: 'Inventado', reason: 'Cita algo que no existe.', evidenceIds: ['no-existe'] },
      { kind: 'review-integration', title: 'Integrar', reason: 'No hay cola lista.', evidenceIds: ['toolu_A1'], requestIds: ['req-falso'] },
      { kind: 'dependency', title: 'Sin dependencia', reason: 'Cita un agente, no una dependencia.', evidenceIds: ['toolu_A1'] },
      { kind: 'unblock', title: 'Ejecutar', reason: 'Corre git push origin main ahora.', evidenceIds: ['toolu_A1'] },
    ] }) });
  const { node } = await f.terminal();
  interleavedTurn(f, node).finish();
  const read = () => f.host.invoke('supervisor.read', { workspaceId: f.workspace.id });
  const idle = await read();
  assert.equal(idle.config.enabled, false);
  assert.equal(idle.config.model, 'haiku');
  assert.equal(idle.config.batchThreshold, 20);
  assert.equal(idle.status, 'disabled');
  assert.equal(f.calls.summaries.length, 0, 'reading never calls the model');
  const state = JSON.stringify([f.host.store.getWorkspace(f.workspace.id).integration ?? null, f.host.store.getWorkspace(f.workspace.id).nodes.map((n) => n.id)]);
  await f.host.invoke('supervisor.configure', { workspaceId: f.workspace.id, patch: { enabled: true } });
  const refreshed = await f.host.invoke('supervisor.refresh', { workspaceId: f.workspace.id });
  assert.equal(f.calls.summaries.length, 1);
  const request = f.calls.summaries[0];
  assert.equal(request.workspaceId, f.workspace.id);
  assert.equal(request.model, 'haiku');
  assert.ok(request.signal instanceof AbortSignal);
  const agents = request.input.agents.items;
  assert.deepEqual(agents.map((agent) => agent.id).sort(), [root(f, node), 'toolu_A1', 'toolu_A2'].sort());
  assert.equal(agents.find((agent) => agent.id === 'toolu_A1').parentId, root(f, node));
  assert.ok(agents.every((agent) => agent.available === true));
  assert.equal(request.input.merges.available, false, 'a queue that cannot be read is reported unavailable, not empty');
  assert.ok(request.input.merges.reason);
  assert.deepEqual(request.input.dependencies.items.map((item) => [item.id, item.source, item.from, item.to]), [[dependency, 'declared', T2, T1]], 'task dependencies are distinguished from software ones');
  assert.equal(refreshed.status, 'idle');
  assert.equal(refreshed.summary, 'Dos agentes activos y una dependencia declarada.');
  assert.deepEqual(refreshed.proposals.map((proposal) => proposal.title).sort(), ['Revisar dependencia', 'Revisar el bloqueo']);
  assert.equal(refreshed.usage.rejectedProposals, 4);
  for (const proposal of refreshed.proposals) assert.ok(['review-integration', 'unblock', 'resume-parent', 'dependency'].includes(proposal.kind));
  assert.equal(f.calls.summaries.length, 1, 'a second read does not call the model');
  await read();
  assert.equal(f.calls.summaries.length, 1);
  assert.equal(JSON.stringify([f.host.store.getWorkspace(f.workspace.id).integration ?? null, f.host.store.getWorkspace(f.workspace.id).nodes.map((n) => n.id)]), state, 'proposals execute nothing');
  await f.restart();
  assert.equal((await f.host.invoke('supervisor.read', { workspaceId: f.workspace.id })).config.enabled, true, 'configuration persists under dataDir');
});

test('the workspace feed reaches the supervisor, failures are shown honestly and shutdown cancels the summary in flight', async (t) => {
  let aborted = null, started;
  const running = new Promise((resolve) => { started = resolve; });
  const f = await observed(t, { summarize: ({ signal }) => new Promise((resolve, reject) => { started(); signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelado')); }, { once: true }); }) });
  const { node } = await f.terminal();
  f.host.emit({ type: 'tool.status', workspaceId: f.workspace.id, status: 'running', result: { source: 'phantom', action: 'run', id: 'ctrl-7', taskId: T1, title: 'Encargo visible', origin: { nodeId: node.id } } });
  const feed = (await f.host.invoke('supervisor.read', { workspaceId: f.workspace.id })).events;
  assert.ok(feed.some((event) => event.kind === 'card' && event.entityId === T1 && event.status === 'working' && event.taskId === T1), 'the existing workspace events feed the supervisor');
  assert.equal(f.calls.summaries.length, 0);
  await f.host.invoke('supervisor.configure', { workspaceId: f.workspace.id, patch: { enabled: true } });
  const pending = f.host.invoke('supervisor.refresh', { workspaceId: f.workspace.id }).catch(() => null);
  await running;
  assert.equal(f.calls.summaries.length, 1);
  await f.host.close();
  assert.equal(aborted, true, 'closing the host aborts the provider call');
  await pending;
  await assert.rejects(f.host.invoke('supervisor.read', { workspaceId: f.workspace.id }), /shutting down/);
  // A summarizer that fails keeps the local feed and the error visible.
  const g = await observed(t, { summarize: async () => { throw new Error('Proveedor sin sesión'); } });
  await g.host.invoke('supervisor.configure', { workspaceId: g.workspace.id, patch: { enabled: true } });
  g.host.emit({ type: 'tool.status', workspaceId: g.workspace.id, status: 'failed', result: { source: 'phantom', action: 'run', id: 'ctrl-8', taskId: T2, title: 'Falló', origin: { nodeId: 'nodo' } } });
  const failed = await g.host.invoke('supervisor.refresh', { workspaceId: g.workspace.id });
  assert.equal(failed.status, 'error');
  assert.match(failed.error, /Proveedor sin sesión/);
  assert.ok(failed.events.some((event) => event.kind === 'card' && event.entityId === T2 && event.status === 'failed'), 'the local feed is kept');
  assert.equal(failed.summary, null);
});

test('hosts announce trace and supervisor changes with the workspace id only', async (t) => {
  const f = await observed(t);
  const { node } = await f.terminal();
  const seen = [];
  const socket = net.createConnection(f.host.socketPath);
  t.after(() => socket.destroy());
  socket.setEncoding('utf8');
  let buffer = '';
  socket.on('data', (chunk) => { buffer += chunk; let index; while ((index = buffer.indexOf('\n')) >= 0) { const row = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1); if (row.event) seen.push(row.event); } });
  await until(() => seen.some((event) => event.type === 'connection'));
  interleavedTurn(f, node);
  await until(() => seen.some((event) => event.type === 'agent.traces.changed'));
  await f.host.invoke('supervisor.configure', { workspaceId: f.workspace.id, patch: { enabled: false } });
  await until(() => seen.some((event) => event.type === 'supervisor.changed'));
  const changes = seen.filter((event) => ['agent.traces.changed', 'supervisor.changed'].includes(event.type));
  for (const event of changes) {
    assert.deepEqual(Object.keys(event).sort(), ['type', 'workspaceId'], 'no transcript travels in the event');
    assert.equal(event.workspaceId, f.workspace.id);
  }
});
