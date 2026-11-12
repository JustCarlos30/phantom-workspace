import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost } from '../host/server.mjs';

const until = async fn => {
  const end = Date.now() + 8000;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Timed out waiting for OpenCode');
};
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-opencode-chat-'));
  const bin = path.join(root, 'opencode');
  const fixture = fileURLToPath(new URL('./fixtures/opencode-chat-server.mjs', import.meta.url));
  fs.writeFileSync(bin, `#!${process.execPath}\nimport ${JSON.stringify(fixture)};\n`, { mode: 0o700 });
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await host.invoke('settings.update', { patch: { opencodePath: bin } });
  const workspace = await host.invoke('workspace.open', { path: root });
  const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal', data: { cwd: root, chat: { provider: 'opencode', models: { opencode: 'openai/gpt-test' }, reasoning: { opencode: 'high' } } } });
  const ref = { workspaceId: workspace.id, nodeId: node.id };
  const get = () => host.invoke('chat.get', ref);
  return { root, host, ref, get,
    send: text => host.invoke('chat.send', { ...ref, text }),
    ask: () => until(async () => (await get()).messages.at(-1)?.parts.find(p => p.type === 'permission' && p.status === 'pending')),
    answer: (part, decision) => host.invoke('chat.permission.answer', { ...ref, requestId: part.id, decision }),
    idle: () => until(async () => { const chat = await get(); return !chat.running && chat; }),
  };
}

test('OpenCode external read waits for approval, resumes, and remembers only the exact grant', async t => {
  const f = await setup(t);
  await f.send('twice');
  const ask = await f.ask();
  assert.equal(ask.tool, 'external_directory'); assert.match(ask.detail, /phantom-visual-card/);
  assert.equal((await f.get()).running, true);
  assert.equal((await f.get()).messages.at(-1).parts.filter(p => p.type === 'permission').length, 1);
  await f.answer(ask, 'always');
  let chat = await f.idle(), reply = chat.messages.at(-1);
  assert.equal(reply.status, 'done'); assert.equal(chat.sessionId, 'ses_fixture');
  assert.deepEqual(JSON.parse(reply.parts.find(p => p.type === 'text').text), [{ reply: 'once' }, { reply: 'once' }]);
  assert.equal(reply.parts.filter(p => p.type === 'text').length, 1); assert.equal(reply.usage.costUsd, .01);
  const transport = JSON.parse(fs.readFileSync(path.join(f.root, 'transport.json')));
  assert.deepEqual(transport.body.model, { providerID: 'openai', modelID: 'gpt-test' }); assert.equal(transport.body.variant, 'high');
  assert.throws(() => process.kill(transport.pid, 0), /ESRCH/);
  // Resume the same provider session; a different path still asks.
  await f.send('different'); const other = await f.ask(); assert.match(other.detail, /other.json/);
  await f.answer(other, 'deny'); chat = await f.idle();
  assert.deepEqual(JSON.parse(chat.messages.at(-1).parts.find(p => p.type === 'text').text), [{ reply: 'reject', message: 'El usuario rechazó este permiso en Phantom Workspace.' }]);
});

test('OpenCode allow once asks again; stopping cancels pending permissions and closes its server', async t => {
  const f = await setup(t);
  await f.send('twice'); await f.answer(await f.ask(), 'allow');
  const pending = await f.ask();
  const { pid } = JSON.parse(fs.readFileSync(path.join(f.root, 'transport.json')));
  await f.host.invoke('chat.stop', f.ref);
  const chat = await f.idle(); assert.equal(chat.messages.at(-1).status, 'stopped');
  assert.equal(chat.messages.at(-1).parts.find(p => p.id === pending.id).status, 'cancelled');
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await assert.rejects(f.answer(pending, 'allow'), /pendiente/);
});

test('OpenCode explicit automatic mode replies without an approval row; server failures finish the turn', async t => {
  const f = await setup(t);
  for (const setting of [{ autoApprove: true }, { permissionMode: 'auto' }, { permissionMode: 'full' }]) {
    await f.host.invoke('chat.configure', { ...f.ref, ...setting });
    await f.send('hello'); const chat = await f.idle();
    assert.equal(chat.messages.at(-1).status, 'done');
    assert.ok(!chat.messages.at(-1).parts.some(p => p.type === 'permission'));
  }
  await f.send('crash'); const chat = await f.idle();
  assert.equal(chat.messages.at(-1).status, 'error');
  assert.match(chat.messages.at(-1).error, /OpenCode/);
});

test('the main Phantom chat also approves OpenCode requests, and questions wait for the actual answer', async t => {
  const f = await setup(t), ref = { ...f.ref, nodeId: `phantom:${f.ref.workspaceId}` };
  await f.host.invoke('chat.configure', { ...ref, provider: 'opencode' });
  await f.host.invoke('chat.send', { ...ref, text: 'main' });
  const get = () => f.host.invoke('chat.get', ref);
  const ask = await until(async () => (await get()).messages.at(-1)?.parts.find(p => p.type === 'permission' && p.status === 'pending'));
  await f.host.invoke('chat.permission.answer', { ...ref, requestId: ask.id, decision: 'allow' });
  await until(async () => !(await get()).running);
  assert.equal((await get()).messages.at(-1).status, 'done');
  await f.send('question');
  const question = await until(async () => (await f.get()).messages.at(-1)?.parts.find(p => p.type === 'question' && p.status === 'pending'));
  await f.host.invoke('chat.question.answer', { ...f.ref, requestId: question.id, answers: { '¿Cómo continuar?': 'Revisar' } });
  const chat = await f.idle();
  assert.deepEqual(JSON.parse(chat.messages.at(-1).parts.find(p => p.type === 'text').text), [{ answers: [['Revisar']] }]);
  await f.send('question');
  const skipped = await until(async () => (await f.get()).messages.at(-1)?.parts.find(p => p.type === 'question' && p.status === 'pending'));
  await f.host.invoke('chat.question.answer', { ...f.ref, requestId: skipped.id, answers: null });
  const finished = await f.idle();
  assert.deepEqual(JSON.parse(finished.messages.at(-1).parts.find(p => p.type === 'text').text), [{ rejected: true }]);
});
