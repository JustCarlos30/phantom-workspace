import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { Chats } from '../host/chats.mjs';
import { SNAPSHOT_LIMITS } from '../host/mobile-project.mjs';

fs.mkdirSync('/tmp/opencode', { recursive: true });
const TASK = 'task_0000aaaa';
const RPC = 'workspace.mobile.snapshot';

async function fixture(t) {
  const root = fs.mkdtempSync('/tmp/opencode/phantom-mobile-project-'), dataDir = path.join(root, 'state');
  const project = path.join(root, 'proyecto'), other = path.join(root, 'ajeno');
  fs.mkdirSync(project); fs.mkdirSync(other);
  const handleIntegration = async (method, p) => {
    if (method === 'phantom.detail') {
      if (p.id !== TASK) throw new Error('Phantom task belongs to another workspace');
      return { handled: true, result: { id: p.id, kind: 'task', status: 'ready', contract: { goal: 'Tarea vinculada' } } };
    }
    return { handled: false };
  };
  const host = await createHost({ dataDir, handleIntegration });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const w = await host.invoke('workspace.open', { path: project });
  const foreign = await host.invoke('workspace.open', { path: other });
  const a = await host.invoke('terminal.create', { workspaceId: w.id, shell: '/bin/sh' });
  const b = await host.invoke('terminal.create', { workspaceId: w.id, shell: '/bin/sh' });
  const f = await host.invoke('terminal.create', { workspaceId: foreign.id, shell: '/bin/sh' });
  const snap = nodeIds => host.invoke(RPC, { workspaceId: w.id, nodeIds });
  return { host, root, project, w, foreign, a, b, f, snap };
}

const until = async (check, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('timeout'); };

test('valida la petición: nodeIds explícito, sin campos extra y acotado', async t => {
  const { host, w, a } = await fixture(t);
  await assert.rejects(host.invoke(RPC, { workspaceId: w.id }), /nodeIds debe ser un array/);
  await assert.rejects(host.invoke(RPC, { workspaceId: w.id, nodeIds: 'all' }), /nodeIds debe ser un array/);
  await assert.rejects(host.invoke(RPC, { workspaceId: w.id, nodeIds: [a.node.id], state: { nodes: [] } }), /Campo no admitido: state/);
  await assert.rejects(host.invoke(RPC, { workspaceId: w.id, nodeIds: [a.node.id, 7] }), /identificadores de texto/);
  await assert.rejects(host.invoke(RPC, { workspaceId: w.id, nodeIds: Array.from({ length: SNAPSHOT_LIMITS.nodeIds + 1 }, (_, i) => `n${i}`) }), /como máximo/);
  await assert.rejects(host.invoke(RPC, { workspaceId: 'no-existe', nodeIds: [] }), /Workspace not found/);
});

test('nodeIds vacío no significa todos: no devuelve sesiones ni atención', async t => {
  const { host, w, a, snap } = await fixture(t);
  await host.invoke('attention.create', { workspaceId: w.id, title: 'Aviso', sessionId: a.session.id });
  const result = await snap([]);
  assert.deepEqual(result.sessions, []);
  assert.deepEqual(result.attention, []);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.project, { id: w.id, name: result.project.name });
});

test('host real: sesión autorizada con versión, observedAt, destino y estado honesto', async t => {
  const { host, w, a, b, snap } = await fixture(t);
  const before = Date.now();
  const result = await snap([a.node.id]);
  assert.equal(result.version, 1);
  assert.ok(Date.parse(result.observedAt) >= before - 1000 && Date.parse(result.observedAt) <= Date.now() + 1000);
  assert.equal(result.project.id, w.id);
  assert.equal(result.sessions.length, 1);
  const [s] = result.sessions;
  assert.equal(s.nodeId, a.node.id);
  assert.equal(s.kind, 'terminal');
  assert.deepEqual(s.target, { workspaceId: w.id, nodeId: a.node.id, sessionId: a.session.id });
  assert.equal(s.process.state, 'running');
  assert.equal(s.agent.state, 'idle');
  assert.equal(s.agent.reportedStatus, null);
  assert.ok(!JSON.stringify(result).includes(b.node.id));
  assert.ok(!JSON.stringify(result).includes(b.session.id));
});

test('un terminal detenido se reporta como exited, nunca como completed', async t => {
  const { host, w, a, snap } = await fixture(t);
  await host.invoke('terminal.stop', { sessionId: a.session.id });
  await until(() => host.terminals.sessions.find(s => s.id === a.session.id)?.status === 'exited');
  const result = await snap([a.node.id]);
  assert.equal(result.sessions[0].agent.state, 'exited');
  assert.equal(result.sessions[0].process.state, 'exited');
  assert.ok(!JSON.stringify(result).includes('completed'));
  const exit = result.attention.find(item => item.sessionId === a.session.id);
  assert.ok(exit, 'la salida del terminal autorizado aparece en la atención');
  assert.equal(exit.nodeId, a.node.id);
  assert.equal(result.attention.every(item => item.nodeId === a.node.id), true);
});

test('nodos ajenos o no pedidos se rechazan o se omiten sin filtrar su existencia', async t => {
  const { host, w, f, a, b, snap } = await fixture(t);
  const foreignError = await snap([f.node.id]).catch(e => e.message);
  const missingError = await snap(['no-existe']).catch(e => e.message);
  assert.match(foreignError, /no autorizado/);
  assert.equal(foreignError, missingError);
  assert.ok(!foreignError.includes(f.node.id));
  await assert.rejects(snap([a.node.id, f.node.id]), /no autorizado/);
  const browser = await host.invoke('node.create', { workspaceId: w.id, type: 'browser', title: 'Web' });
  await assert.rejects(snap([browser.id]), /no autorizado/);
  const only = await snap([b.node.id]);
  assert.deepEqual(only.sessions.map(s => s.nodeId), [b.node.id]);
});

test('la atención se filtra por nodo autorizado y se omite la no atribuible', async t => {
  const { host, w, a, b, snap } = await fixture(t);
  await host.invoke('attention.create', { workspaceId: w.id, title: 'De A', sessionId: a.session.id });
  await host.invoke('attention.create', { workspaceId: w.id, title: 'De B', sessionId: b.session.id });
  await host.invoke('attention.create', { workspaceId: w.id, title: 'Por nodo B', nodeId: b.node.id });
  await host.invoke('attention.create', { workspaceId: w.id, title: 'Sin atribución' });
  const result = await snap([a.node.id]);
  assert.deepEqual(result.attention.map(item => item.title), ['De A']);
  const both = await snap([a.node.id, b.node.id]);
  assert.deepEqual(both.attention.map(item => item.title).sort(), ['De A', 'De B', 'Por nodo B']);
});

test('chat principal: permisos y preguntas pendientes con identidad y resumen mínimo', async t => {
  const { host, w, a, snap } = await fixture(t);
  const mainId = Chats.mainId(w);
  host.chats.turns.set(mainId, { pending: new Map([
    ['perm-1', { part: { type: 'permission', id: 'perm-1', tool: 'Bash', detail: `rm -rf ${w.canonicalPath}/secreto`, reason: 'peligroso', key: 'k', status: 'pending', danger: true } }],
    ['ask-1', { part: { type: 'question', id: 'ask-1', status: 'pending', questions: [{ question: `¿Usar ${w.canonicalPath}/src o /home/otro/dir?`, options: [] }] } }],
    ['old-1', { part: { type: 'permission', id: 'old-1', tool: 'Read', status: 'allowed' } }],
  ]) });
  t.after(() => host.chats.turns.delete(mainId));
  const result = await snap([mainId, a.node.id]);
  const main = result.sessions[0];
  assert.equal(main.kind, 'main');
  assert.equal(main.agent.state, 'awaiting_approval');
  assert.equal(main.pendingCount, 2);
  assert.deepEqual(main.target, { workspaceId: w.id, nodeId: mainId, sessionId: null });
  assert.deepEqual(result.pending.map(p => [p.kind, p.id, p.nodeId]), [['permission', 'perm-1', mainId], ['question', 'ask-1', mainId]]);
  assert.equal(result.pending[0].summary, 'Permiso: Bash');
  assert.equal(result.pending[0].danger, true);
  assert.equal(result.pending[1].questionCount, 1);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('rm -rf') && !serialized.includes(w.canonicalPath) && !serialized.includes('/home/otro'));
  assert.equal(result.sessions[1].pendingCount, 0);
});

test('un turno de chat sin pendientes se reporta working y sin turno idle', async t => {
  const { host, w, snap } = await fixture(t);
  const mainId = Chats.mainId(w);
  assert.equal((await snap([mainId])).sessions[0].agent.state, 'idle');
  host.chats.turns.set(mainId, { pending: new Map() });
  t.after(() => host.chats.turns.delete(mainId));
  assert.equal((await snap([mainId])).sessions[0].agent.state, 'working');
});

test('tareas vinculadas solo se incluyen si se atribuyen a un nodo autorizado', async t => {
  const { host, w, a, b, snap } = await fixture(t);
  await host.invoke('terminal.agent.update', { workspaceId: w.id, nodeId: a.node.id, patch: { cardId: TASK, status: 'working', step: 'Paso uno' } });
  const mine = await snap([a.node.id]);
  assert.deepEqual(mine.tasks, [{ id: TASK, title: 'Tarea vinculada', nodeId: a.node.id, via: 'agent.cardId' }]);
  assert.equal(mine.sessions[0].agent.reportedStatus, 'working');
  const unrelated = await snap([b.node.id]);
  assert.deepEqual(unrelated.tasks, []);
});

test('no copia state, settings, env, tokens ni rutas, y no muta el host al leer', async t => {
  const { host, root, project, w, a, snap } = await fixture(t);
  host.store.state.settings.apiToken = 'SECRET-TOKEN-123';
  await host.invoke('node.update', { workspaceId: w.id, id: a.node.id, patch: { title: `Trabajo en ${project}`, data: { ...a.node.data, env: { API_KEY: 'SECRET-ENV-456' } } } });
  const stateBefore = JSON.stringify(host.store.state), sessionsBefore = host.terminals.sessions.length, chatsBefore = JSON.stringify(host.chats.nodes);
  const result = await snap([a.node.id, Chats.mainId(w)]);
  const serialized = JSON.stringify(result);
  for (const leak of ['SECRET-TOKEN-123', 'SECRET-ENV-456', root, project, '/tmp/opencode'])assert.ok(!serialized.includes(leak), `filtra ${leak}`);
  for (const key of ['"cwd"', '"env"', '"settings"', '"shell"', '"pid"', '"snapshot"', '"worktree"']) assert.ok(!serialized.includes(key), `incluye ${key}`);
  assert.equal(result.sessions[0].title, 'Trabajo en [ruta]');
  assert.equal(JSON.stringify(host.store.state), stateBefore);
  assert.equal(host.terminals.sessions.length, sessionsBefore);
  assert.equal(JSON.stringify(host.chats.nodes), chatsBefore);
});

test('la atención se acota y declara el truncamiento', async t => {
  const { host, w, a, snap } = await fixture(t);
  for (let i = 0; i < SNAPSHOT_LIMITS.attention + 10; i++) await host.invoke('attention.create', { workspaceId: w.id, title: `Aviso ${i}`, nodeId: a.node.id });
  const result = await snap([a.node.id]);
  assert.equal(result.attention.length, SNAPSHOT_LIMITS.attention);
  assert.equal(result.truncated.attention, true);
  assert.equal(result.truncated.pending, false);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 64 * 1024);
});

test('el método está cableado en el socket local del host', async t => {
  const { host, w, a } = await fixture(t);
  const reply = await new Promise((resolve, reject) => {
    const socket = net.createConnection(host.socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ id: 'x1', method: RPC, payload: { workspaceId: w.id, nodeIds: [a.node.id] } }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      for (const line of buffer.split('\n').filter(Boolean)) { try { const message = JSON.parse(line); if (message.id === 'x1') { socket.destroy(); resolve(message); } } catch { /* partial line */ } }
    });
  });
  assert.equal(reply.error, undefined);
  assert.equal(reply.result.sessions[0].target.sessionId, a.session.id);
});
