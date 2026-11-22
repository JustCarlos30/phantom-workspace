import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { Chats, applyClaudeEvent, applyOpenCodeEvent, applyCodexEvent, openCodeModels, providerArgs, toolDetail, toolDiff, toolOutput, validateChat } from '../host/chats.mjs';
import { mergeChat } from '../src/hooks/chatState.js';

const until = async fn => { const end = Date.now() + 5000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('Timed out'); };
const turn = () => ({ message: { parts: [] }, sessionId: null, streamed: new Set(), freshText: true, cwd: '/repo', error: '' });
test('Codex aggregate usage never becomes occupied context', () => {
  const t = turn();
  t.contextTokens = 164000;
  applyCodexEvent(t, { type: 'turn.completed', usage: { input_tokens: 160000, cached_input_tokens: 100000, output_tokens: 4000 } });
  assert.equal(t.contextTokens, 164000);
  assert.equal(t.contextSource, undefined);
  assert.equal(t.usage.outputTokens, 4000);
});

test('Claude keeps only complete latest root request readings', () => {
  const t = turn(), usage = { input_tokens: 80000, cache_read_input_tokens: 20000, cache_creation_input_tokens: 100, output_tokens: 50 };
  const apply = usage => applyClaudeEvent(t, { type: 'assistant', message: { usage } });
  apply(usage);
  assert.equal(t.contextTokens, 100150);
  applyClaudeEvent(t, { type: 'assistant', parent_tool_use_id: 'child', message: { usage: { ...usage, input_tokens: 999999 } } });
  assert.equal(t.contextTokens, 100150);
  apply({ ...usage, input_tokens: 1 });
  assert.equal(t.contextTokens, 20151);
  for (const invalid of [undefined, {}, { input_tokens: 1, output_tokens: 2 }, ...[NaN, Infinity, -1, null].map(output_tokens => ({ ...usage, output_tokens }))]) {
    apply(usage); apply(invalid);
    assert.equal(t.contextTokens, 100150);
    assert.equal(t.contextSource, 'claude:request-v1');
  }
  applyClaudeEvent(t, { type: 'stream_event', event: { type: 'message_start', message: { usage: { ...usage, input_tokens: 4 } } } });
  assert.equal(t.contextTokens, 20154);
  t.model = 'claude-x';
  applyClaudeEvent(t, { type: 'result', modelUsage: { 'claude-x[1m]': { contextWindow: 1000000 } } });
  assert.equal(t.contextWindow, 1000000);
});

test('Reload invalidates legacy metadata and clear removes measured context', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-context-'));
  let chats;
  t.after(() => { clearInterval(chats.timer); fs.rmSync(root, { recursive: true, force: true }); });
  const node = { id: 'n', data: { cwd: root, chat: { provider: 'codex' } } };
  fs.writeFileSync(path.join(root, 'chats.json'), JSON.stringify({ n: { threads: { codex: { messages: [], meta: { contextTokens: 164000, contextWindow: 200000, costUsd: 1 } }, claude: { messages: [], meta: { contextSource: 'claude:request-v1', contextTokens: 84000, contextWindow: 200000 } } } } }));
  chats = new Chats({ dir: root }, () => {});
  assert.deepEqual(chats.get(node).meta, { costUsd: 1 });
  node.data.chat.provider = 'claude';
  assert.equal(chats.get(node).meta.contextTokens, 84000);
  chats.clear({ id: 'w' }, node);
  assert.deepEqual(chats.get(node).meta, {});
  chats.save(); clearInterval(chats.timer);
  chats = new Chats({ dir: root }, () => {});
  assert.deepEqual(chats.get(node).meta, {});
  node.data.chat.provider = 'codex';
  assert.deepEqual(chats.get(node).meta, { costUsd: 1 });
  chats.thread(node.id, 'codex').meta = { contextSource: 'codex:request-v1', contextTokens: 144871, contextWindow: 258400 };
  chats.save(); clearInterval(chats.timer);
  chats = new Chats({ dir: root }, () => {});
  assert.equal(chats.get(node).meta.contextTokens, 144871);
});
test('Codex folds lifecycle events without duplicating updates and reports failures', () => {
  const t = turn();
  applyCodexEvent(t, { type: 'thread.started', thread_id: 'thread-1' });
  applyCodexEvent(t, { type: 'item.started', item: { id: 'c', type: 'command_execution', command: 'npm test' } });
  applyCodexEvent(t, { type: 'item.completed', item: { id: 'c', type: 'command_execution', command: 'npm test', exit_code: 1, aggregated_output: 'failed' } });
  for (const type of ['item.updated', 'item.completed']) applyCodexEvent(t, { type, item: { id: 'a', type: 'agent_message', text: 'Listo' } });
  applyCodexEvent(t, { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } });
  assert.equal(t.sessionId, 'thread-1'); assert.equal(t.message.parts.length, 2); assert.equal(t.message.parts[0].status, 'error'); assert.equal(t.message.parts[1].text, 'Listo'); assert.equal(t.contextTokens, undefined);
  applyCodexEvent(t, { type: 'turn.failed', error: { message: 'sin crédito' } }); assert.equal(t.error, 'sin crédito');
});

test('Claude-only policy: new Codex/OpenCode chats are refused, a stored legacy chat stays readable but cannot run', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-codex-'));
  const ran = path.join(root, 'ran');
  const bin = fixture(root, 'codex', `require('fs').writeFileSync(${JSON.stringify(ran)},'x');`);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await host.invoke('settings.update', { patch: { codexPath: bin } });
  const w = await host.invoke('workspace.open', { path: root });
  for (const provider of ['codex', 'opencode']) await assert.rejects(host.invoke('node.create', { workspaceId: w.id, type: 'terminal', data: { chat: { provider } } }), /Claude Code/);
  await assert.rejects(host.invoke('node.create', { workspaceId: w.id, type: 'terminal', data: { chat: { provider: 'claude', models: { claude: 'gpt-test' } } } }), /no es Claude Code/);
  // A legacy node already stored with Codex: history is readable, new execution is blocked, nothing spawns.
  const legacy = { id: 'legacy', type: 'terminal', title: 'old', x: 0, y: 0, width: 640, height: 640, groupId: null, data: { cwd: root, chat: { provider: 'codex' } } };
  host.store.getWorkspace(w.id).nodes.push(legacy);
  host.chats.thread('legacy', 'codex').messages.push({ id: 'm', role: 'user', parts: [{ type: 'text', text: 'antes' }], status: 'done' });
  assert.equal((await host.invoke('chat.get', { workspaceId: w.id, nodeId: 'legacy' })).messages[0].parts[0].text, 'antes');
  await assert.rejects(host.invoke('chat.send', { workspaceId: w.id, nodeId: 'legacy', text: 'hola' }), /Claude Code/);
  await assert.rejects(host.invoke('chat.models', { workspaceId: w.id, nodeId: 'legacy' }), /Claude Code/);
  assert.equal(fs.existsSync(ran), false, 'no legacy engine process was started');
  assert.equal((await host.invoke('chat.get', { workspaceId: w.id, nodeId: 'legacy' })).messages.length, 1, 'history kept after the refusal');
  assert.ok(providerArgs('claude', { message: 'x', reasoning: 'max' }).includes('--effort'));
});
test('chat turns get the canvas browser bridge: stable per card, live only while the turn runs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-chat-browser-'));
  const bin = fixture(root, 'claude', `const fs=require('fs'),path=require('path');process.stdin.resume();process.stdin.on('end',()=>{const e=process.env,cred=path.join(path.dirname(e.PHANTOM_BROWSER_ENDPOINT||'/x'),'browser-terminals',(e.PHANTOM_BROWSER_SESSION||'x')+'.json');const out=o=>console.log(JSON.stringify(o));out({type:'system',subtype:'init',session_id:'sid-b'});out({type:'assistant',message:{id:'m1',content:[{type:'text',text:JSON.stringify({cli:e.PHANTOM_BROWSER_CLI,session:e.PHANTOM_BROWSER_SESSION,workspace:e.PHANTOM_BROWSER_WORKSPACE,token:Boolean(e.PHANTOM_BROWSER_TOKEN),shims:(e.PATH||'').split(':')[0]===e.PHANTOM_BROWSER_SHIMS,credential:fs.existsSync(cred),cred})}]}});setTimeout(()=>out({type:'result',subtype:'success',is_error:false,result:'ok',session_id:'sid-b',usage:{output_tokens:1}}),300);});`);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await host.invoke('settings.update', { patch: { claudePath: bin } });
  const w = await host.invoke('workspace.open', { path: root });
  const node = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', data: { chat: { provider: 'claude' } } });
  const ref = { workspaceId: w.id, nodeId: node.id };
  const sessions = [];
  for (let i = 0; i < 2; i++) {
    await host.invoke('chat.send', { ...ref, text: 'hola' });
    let reply;
    await until(async () => { const part = (await host.invoke('chat.get', ref)).messages.at(-1).parts[0]; reply = part?.text && JSON.parse(part.text); return reply; });
    assert.ok(reply.cli && reply.token && reply.shims && reply.credential, 'bridge env and capability present during the turn');
    assert.equal(reply.workspace, w.id);
    assert.equal((await host.invoke('chat.browser.active', { ...ref, sessionId: reply.session })).active, true);
    assert.equal((await host.invoke('chat.browser.active', { ...ref, sessionId: 'other' })).active, false);
    await until(async () => !(await host.invoke('chat.get', ref)).running);
    assert.equal((await host.invoke('chat.browser.active', { ...ref, sessionId: reply.session })).active, false);
    assert.equal(fs.existsSync(reply.cred), false, 'capability revoked when the turn ends');
    sessions.push(reply.session);
  }
  assert.equal(sessions[0], sessions[1], 'one browser identity per card, so its panels are reused');
});

// Stand-in agent CLIs: executables that print a recorded event stream.
test('Codex ya no arranca: la medición del rollout no se alcanza por una ejecución nueva', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-codex-context-'));
  const home = path.join(root, 'codex-home'), dir = path.join(home, 'sessions', '2025', '02', '03');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout-date-session-12345678.jsonl');
  const bin = fixture(root, 'codex', `const fs=require('fs');process.stdin.resume();process.stdin.on('end',()=>{const out=o=>console.log(JSON.stringify(o));out({type:'thread.started',thread_id:'session-12345678'});fs.writeFileSync(${JSON.stringify(file)},JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{last_token_usage:{total_tokens:144871},model_context_window:258400}}})+'\\n');out({type:'turn.completed',usage:{input_tokens:999999,output_tokens:9}});});`);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  host.chats.codexHome = home;
  await host.invoke('settings.update', { patch: { codexPath: bin } });
  const workspace = await host.invoke('workspace.open', { path: root });
  // Claude-only policy: new Codex chats are refused before any process starts.
  await assert.rejects(host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal', data: { chat: { provider: 'codex' } } }), /Claude Code/);
  assert.equal(fs.existsSync(file), false, 'the Codex executable never ran');
});

test('Codex habilitado: el chat arranca y mide el rollout; al deshabilitarlo el hilo queda legible pero bloqueado', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-codex-enabled-'));
  const home = path.join(root, 'codex-home'), dir = path.join(home, 'sessions', '2025', '02', '03');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout-date-session-12345678.jsonl');
  const bin = fixture(root, 'codex', `const fs=require('fs');process.stdin.resume();process.stdin.on('end',()=>{const out=o=>console.log(JSON.stringify(o));out({type:'thread.started',thread_id:'session-12345678'});out({type:'item.completed',item:{id:'a',type:'agent_message',text:'Hola desde Codex'}});fs.writeFileSync(${JSON.stringify(file)},JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{last_token_usage:{total_tokens:144871},model_context_window:258400}}})+'\\n');out({type:'turn.completed',usage:{input_tokens:999999,output_tokens:9}});});`);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  host.chats.codexHome = home;
  await host.invoke('settings.update', { patch: { codexPath: bin } });
  const w = await host.invoke('workspace.open', { path: root });
  await host.invoke('providers.configure', { providers: { codex: { enabled: true } } });
  const node = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', data: { cwd: root, chat: { provider: 'codex' } } });
  const ref = { workspaceId: w.id, nodeId: node.id };
  await assert.rejects(host.invoke('chat.configure', { ...ref, model: 'claude-sonnet-4' }), /solo con Claude Code/);
  await host.invoke('chat.send', { ...ref, text: 'hola' });
  await until(async () => !(await host.invoke('chat.get', ref)).running);
  let chat = await host.invoke('chat.get', ref);
  assert.equal(chat.sessionId, 'session-12345678'); assert.equal(chat.messages.at(-1).parts[0].text, 'Hola desde Codex');
  assert.equal(chat.meta.contextTokens, 144871);
  await host.invoke('providers.configure', { providers: { codex: { enabled: false } } });
  await assert.rejects(host.invoke('chat.send', { ...ref, text: 'otra' }), /Habilita Codex/);
  await assert.rejects(host.invoke('chat.models', ref), /Habilita Codex/);
  chat = await host.invoke('chat.get', ref);
  assert.equal(chat.messages.length, 2, 'history stays readable and the refused message is not recorded');
});

function fixture(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${body}`, { mode: 0o755 });
  return file;
}

async function codexContinuation(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-codex-continuation-'));
  const bin = fixture(root, 'codex', `
const fs = require('fs');
const mode = fs.existsSync('scenario.json') ? JSON.parse(fs.readFileSync('scenario.json')) : 'success';
if (process.argv.includes('--help')) {
  if (mode === 'help-fail') process.exit(2);
  console.log('Usage: codex exec [OPTIONS]\\nCommands:\\n resume');
} else {
  let prompt = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => prompt += chunk);
  process.stdin.on('end', () => {
    fs.writeFileSync('continuation.json', JSON.stringify({ argv: process.argv.slice(2), prompt, pid: process.pid }));
    const out = event => console.log(JSON.stringify(event));
    if (mode !== 'no-session') out({ type: 'thread.started', thread_id: mode === 'same-session' ? 'old-session-12345678' : 'new-session-12345678' });
    if (mode === 'hold') { setInterval(() => {}, 1000); return; }
    if (mode === 'truncated') return;
    if (mode === 'fail') { out({ type: 'turn.failed', error: { message: 'fixture failure' } }); process.exitCode = 1; return; }
    out({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'Resumen recibido' } });
    out({ type: 'turn.completed', usage: { output_tokens: 2 } });
  });
}
`);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  host.chats.codexHome = path.join(root, 'no-user-rollouts');
  await host.invoke('settings.update', { patch: { codexPath: bin } });
  await host.invoke('providers.configure', { providers: { codex: { enabled: true } } });
  const workspace = await host.invoke('workspace.open', { path: root });
  const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal', data: { cwd: root, chat: { provider: 'codex' } } });
  const ref = { workspaceId: workspace.id, nodeId: node.id }, thread = host.chats.thread(node.id, 'codex');
  thread.sessionId = 'old-session-12345678';
  thread.meta = { model: 'gpt-test', contextTokens: 190000, contextSource: 'codex:request-v1' };
  thread.grants = ['exact-existing-grant'];
  thread.messages = Array.from({ length: 402 }, (_, i) => ({ id: `old-${i}`, role: 'user', parts: [{ type: 'text', text: `historial ${i}` }], status: 'done' }));
  return { root, host, ref, thread,
    scenario: value => fs.writeFileSync(path.join(root, 'scenario.json'), JSON.stringify(value)),
    get: () => host.invoke('chat.get', ref),
    proceed: () => host.invoke('chat.continue', { ...ref, summary: 'Objetivo, decisiones y pendientes revisados.' }),
    idle: () => until(() => !host.chats.running(node.id)),
    transport: () => JSON.parse(fs.readFileSync(path.join(root, 'continuation.json'))) };
}

test('Codex: continuidad explícita crea sesión comprobada con modelo observado y conserva historial, resumen y permisos', async t => {
  const f = await codexContinuation(t), before = structuredClone(f.thread.messages);
  const capability = await f.host.invoke('chat.compaction.capabilities', f.ref);
  assert.equal(capability.kind, 'continuation');
  assert.equal(fs.existsSync(path.join(f.root, 'continuation.json')), false);
  await assert.rejects(f.host.invoke('chat.compact', f.ref), /no tiene compactación verificada/);
  await assert.rejects(f.host.invoke('chat.continue', { ...f.ref, summary: ' ' }), /resumen/);
  await f.proceed(); await f.idle();
  const chat = await f.get(), record = chat.continuations.at(-1), transport = f.transport();
  assert.equal(record.status, 'done'); assert.equal(chat.sessionId, 'new-session-12345678');
  assert.equal(record.fromSessionId, 'old-session-12345678'); assert.equal(record.toSessionId, chat.sessionId);
  assert.deepEqual(record.capability, capability);
  assert.equal(record.model, 'gpt-test'); assert.match(record.summary, /pendientes revisados/);
  assert.equal(transport.argv.includes('resume'), false);
  assert.equal(transport.argv[transport.argv.indexOf('--model') + 1], 'gpt-test');
  assert.ok(transport.argv.includes('sandbox_mode="read-only"'));
  assert.match(transport.prompt, /este resumen no concede permisos nuevos/);
  assert.match(transport.prompt, /pendientes revisados/);
  assert.deepEqual(chat.messages.slice(0, before.length), before);
  assert.deepEqual(f.thread.grants, ['exact-existing-grant']); assert.equal(chat.mode, 'ask');
  assert.equal(chat.meta.contextTokens, undefined); assert.deepEqual(chat.compactions, []);
  const persisted = JSON.parse(fs.readFileSync(f.host.chats.filename))[f.ref.nodeId].threads.codex;
  assert.deepEqual(persisted.continuations, chat.continuations);
  await f.host.invoke('chat.send', { ...f.ref, text: 'siguiente' }); await f.idle();
  assert.ok(f.transport().argv.includes('resume')); assert.ok(f.transport().argv.includes('new-session-12345678'));
  assert.deepEqual((await f.get()).messages.slice(0, before.length), before, 'subsequent turns preserve visible history');
});

test('Codex: fallo de sondeo no cambia sesión; ID ausente, repetido o turno incompleto nunca acreditan continuidad', async t => {
  for (const mode of ['help-fail', 'no-session', 'same-session', 'truncated', 'fail']) {
    const f = await codexContinuation(t); f.scenario(mode);
    if (mode === 'help-fail') {
      await assert.rejects(f.proceed());
      assert.equal(f.thread.continuations, undefined);
      assert.equal(f.thread.sessionId, 'old-session-12345678');
      assert.equal(f.thread.meta.contextTokens, 190000);
      assert.equal(fs.existsSync(path.join(f.root, 'continuation.json')), false);
    } else {
      await f.proceed(); await f.idle();
      const chat = await f.get();
      assert.equal(chat.continuations.at(-1).status, 'error', mode);
      assert.match(chat.continuations.at(-1).error, /no confirmó|fixture failure/);
      assert.equal(chat.messages[0].id, 'old-0');
      assert.equal(chat.messages.at(-1).status, 'error');
      if (mode === 'no-session' || mode === 'same-session') assert.equal(chat.sessionId, 'old-session-12345678');
    }
  }
});

test('Codex: cola y sesión ocupada impiden continuidad; cancelar conserva origen, resumen e historial', async t => {
  const f = await codexContinuation(t);
  f.thread.queue = [{ id: 'queued', text: 'espera' }];
  await assert.rejects(f.proceed(), /cola/);
  assert.equal(fs.existsSync(path.join(f.root, 'continuation.json')), false);
  f.thread.queue = []; f.scenario('hold');
  await f.proceed();
  await until(() => fs.existsSync(path.join(f.root, 'continuation.json')));
  await assert.rejects(f.proceed(), /ocupada/);
  await f.host.invoke('chat.stop', f.ref); await f.idle();
  const chat = await f.get(), record = chat.continuations.at(-1);
  assert.equal(record.status, 'stopped'); assert.match(record.summary, /revisados/);
  assert.equal(record.fromSessionId, 'old-session-12345678');
  assert.equal(chat.messages[0].id, 'old-0'); assert.equal(chat.messages.at(-1).status, 'stopped');
  assert.throws(() => process.kill(f.transport().pid, 0), /ESRCH/);
});

test('Reinicio marca operaciones interrumpidas sin éxito y recupera el origen de continuidad', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-compaction-restart-'));
  const original = { id: 'old', parts: [{ type: 'text', text: 'historial' }], status: 'done' };
  fs.writeFileSync(path.join(root, 'chats.json'), JSON.stringify({ n: { threads: {
    opencode: { sessionId: 'native', messages: [original], compactions: [{ id: 'c', status: 'running' }] },
    codex: { sessionId: null, messages: [original], continuations: [{ id: 's', status: 'running', fromSessionId: 'source', summary: 'resumen preservado' }] },
  } } }));
  const chats = new Chats({ dir: root }, () => {});
  t.after(async () => { await chats.close(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal(chats.thread('n', 'opencode').compactions[0].status, 'interrupted');
  const codex = chats.thread('n', 'codex');
  assert.equal(codex.continuations[0].status, 'interrupted'); assert.equal(codex.sessionId, 'source');
  assert.equal(codex.continuations[0].summary, 'resumen preservado');
  assert.deepEqual(codex.messages, [original]);
});

test('Claude stream folds partial text, tool calls and results into one reply', () => {
  const t = turn(), stream = event => ({ type: 'stream_event', event });
  applyClaudeEvent(t, { type: 'system', subtype: 'init', session_id: 'abc', model: 'claude-x' });
  applyClaudeEvent(t, stream({ type: 'message_start', message: { id: 'm1' } }));
  applyClaudeEvent(t, stream({ type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'Read' } }));
  applyClaudeEvent(t, { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/src/a.txt' } }] } });
  applyClaudeEvent(t, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'hola' }] } });
  applyClaudeEvent(t, stream({ type: 'message_start', message: { id: 'm2' } }));
  applyClaudeEvent(t, stream({ type: 'content_block_start', content_block: { type: 'text', text: '' } }));
  for (const text of ['Dice ', 'hola']) applyClaudeEvent(t, stream({ type: 'content_block_delta', delta: { type: 'text_delta', text } }));
  // The full message repeats what was streamed and must not duplicate it.
  applyClaudeEvent(t, { type: 'assistant', message: { id: 'm2', model: 'claude-x', usage: { input_tokens: 2, cache_read_input_tokens: 30000, cache_creation_input_tokens: 100, output_tokens: 14 }, content: [{ type: 'text', text: 'Dice hola' }] } });
  assert.equal(applyClaudeEvent(t, { type: 'assistant', parent_tool_use_id: 't9', message: { id: 'm3', content: [{ type: 'text', text: 'subagente' }] } }), false);
  applyClaudeEvent(t, { type: 'result', subtype: 'success', is_error: false, result: 'Dice hola', session_id: 'abc', duration_ms: 6198, total_cost_usd: .33, num_turns: 2, usage: { output_tokens: 140 }, modelUsage: { 'claude-x': { contextWindow: 1000000 } } });
  assert.deepEqual(t.message.parts, [{ type: 'tool', id: 't1', name: 'Read', detail: 'src/a.txt', status: 'done', output: 'hola' }, { type: 'text', text: 'Dice hola' }]);
  assert.equal(t.sessionId, 'abc'); assert.equal(t.error, '');
  // Model, occupied context and turn cost are read from the stream, never guessed.
  assert.deepEqual([t.model, t.contextTokens, t.contextWindow], ['claude-x', 30116, 1000000]);
  assert.deepEqual(t.usage, { durationMs: 6198, costUsd: .33, outputTokens: 140, steps: 2 });
  const thinking = turn(); for (const text of ['Primero ', 'leo']) applyClaudeEvent(thinking, stream({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: text } }));
  assert.deepEqual(thinking.message.parts, [{ type: 'thinking', text: 'Primero leo' }]);
  assert.deepEqual(toolDiff('Edit', { old_string: 'a\nb', new_string: 'c' }), { added: 1, removed: 2 }); assert.deepEqual(toolDiff('Write', { content: 'a\nb\nc' }), { added: 3, removed: 0 }); assert.equal(toolDiff('Read', { file_path: 'x' }), undefined);
  assert.equal(toolOutput([{ type: 'text', text: 'uno' }, { type: 'image' }, { type: 'text', text: 'dos' }]), 'uno\ndos'); assert.match(toolOutput('x'.repeat(7000)), /1000 caracteres más/);
  const failed = turn(); applyClaudeEvent(failed, { type: 'result', is_error: true, result: 'Sin crédito', session_id: 'x' });
  assert.equal(failed.error, 'Sin crédito');
});

test('Sub-agent work nests under the call that delegated it, for every provider', () => {
  // Claude: events with parent_tool_use_id fold into the Agent call.
  const c = turn();
  applyClaudeEvent(c, { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'Buscar tests', prompt: 'Encuentra los tests de chats', subagent_type: 'Explore' } }] } });
  assert.equal(applyClaudeEvent(c, { type: 'assistant', parent_tool_use_id: 'a1', message: { id: 's1', model: 'claude-haiku', content: [{ type: 'text', text: 'Busco…' }, { type: 'tool_use', id: 's-t1', name: 'Grep', input: { pattern: 'applyClaudeEvent' } }] } }), true);
  applyClaudeEvent(c, { type: 'user', parent_tool_use_id: 'a1', message: { content: [{ type: 'tool_result', tool_use_id: 's-t1', content: 'x' }] } });
  applyClaudeEvent(c, { type: 'assistant', parent_tool_use_id: 'a1', message: { id: 's2', content: [{ type: 'tool_use', id: 's-t2', name: 'Read', input: { file_path: '/repo/test/chats.test.mjs' } }] } });
  let [agent] = c.message.parts;
  assert.equal(agent.detail, 'Buscar tests'); assert.equal(agent.status, 'running');
  assert.deepEqual({ ...agent.agent }, { type: 'Explore', prompt: 'Encuentra los tests de chats', model: 'claude-haiku', text: 'Busco…', total: 2, steps: [{ id: 's-t1', name: 'Grep', detail: 'applyClaudeEvent', status: 'done' }, { id: 's-t2', name: 'Read', detail: 'test/chats.test.mjs', status: 'running' }] });
  // The sub-agent's chatter never leaks into the main reply.
  assert.equal(c.message.parts.length, 1);
  applyClaudeEvent(c, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: [{ type: 'text', text: 'Están en test/' }] }] } });
  [agent] = c.message.parts;
  assert.equal(agent.status, 'done'); assert.equal(agent.output, 'Están en test/'); assert.equal(agent.agent.steps[1].status, 'done');
  // Only the latest steps are kept, but the total still counts every one.
  for (let i = 0; i < 50; i++) applyClaudeEvent(c, { type: 'assistant', parent_tool_use_id: 'a1', message: { id: `x${i}`, content: [{ type: 'tool_use', id: `x${i}`, name: 'Read', input: {} }] } });
  assert.equal(c.message.parts[0].agent.steps.length, 40); assert.equal(c.message.parts[0].agent.total, 52);

  // OpenCode: parts of the child session belong to the running task call.
  const o = turn(), root = { sessionID: 'root' };
  applyOpenCodeEvent(o, { type: 'tool_use', ...root, part: { sessionID: 'root', callID: 'k1', tool: 'task', state: { status: 'running', input: { description: 'Revisar CSS', prompt: 'Mira chat.css', subagent_type: 'general' } } } });
  applyOpenCodeEvent(o, { type: 'tool_use', ...root, part: { sessionID: 'child', callID: 'k1-a', tool: 'read', state: { status: 'completed', input: { filePath: '/repo/src/chat.css' } } } });
  applyOpenCodeEvent(o, { type: 'text', ...root, part: { sessionID: 'child', text: 'Hecho' } });
  applyOpenCodeEvent(o, { type: 'step_finish', ...root, part: { sessionID: 'child', tokens: { total: 999999 } } });
  assert.equal(o.contextTokens, undefined, 'a child step never stands for the main context');
  applyOpenCodeEvent(o, { type: 'tool_use', ...root, part: { sessionID: 'root', callID: 'k1', tool: 'task', state: { status: 'completed', input: { description: 'Revisar CSS' }, output: 'ok', metadata: { sessionId: 'child', summary: [{ id: 'k1-a', tool: 'read', state: { status: 'completed', title: 'chat.css' } }, { id: 'k1-b', tool: 'grep', state: { status: 'running', title: '.pc-tool' } }] } } } });
  assert.equal(o.message.parts.length, 1);
  const task = o.message.parts[0];
  assert.equal(task.status, 'done'); assert.equal(task.agent.type, 'general'); assert.equal(task.agent.sessionId, 'child'); assert.equal(task.agent.text, 'Hecho');
  assert.deepEqual(task.agent.steps.map(s => [s.name, s.detail, s.status]), [['read', 'src/chat.css', 'done'], ['grep', '.pc-tool', 'done']]);

  // Codex: spawn_agent reports its child threads' state on the call itself.
  const x = turn();
  applyCodexEvent(x, { type: 'item.started', item: { id: 'sp', type: 'collab_tool_call', tool: 'spawn_agent', prompt: 'Revisa la UI\ncon detalle', receiver_thread_ids: ['t-123'], status: 'in_progress' } });
  applyCodexEvent(x, { type: 'item.completed', item: { id: 'sp', type: 'collab_tool_call', tool: 'spawn_agent', prompt: 'Revisa la UI\ncon detalle', receiver_thread_ids: ['t-123'], agents_states: { 't-123': { status: 'completed', message: 'UI revisada' } }, status: 'completed' } });
  assert.deepEqual(x.message.parts.map(p => [p.name, p.detail, p.status, p.agent.text]), [['spawn_agent', 'Revisa la UI', 'done', 'UI revisada']]);
});

test('OpenCode events become text and tool parts; arguments resume the right session', () => {
  const t = turn();
  applyOpenCodeEvent(t, { type: 'step_start', sessionID: 'ses_1', part: { type: 'step-start' } });
  applyOpenCodeEvent(t, { type: 'tool_use', sessionID: 'ses_1', part: { tool: 'glob', callID: 'c1', state: { status: 'completed', input: { pattern: 'a.txt' }, output: '/repo/a.txt' } } });
  applyOpenCodeEvent(t, { type: 'step_finish', sessionID: 'ses_1', part: { sessionID: 'ses_1', tokens: { total: 14915, output: 13, reasoning: 28 }, cost: .01 } });
  applyOpenCodeEvent(t, { type: 'text', sessionID: 'ses_1', part: { text: 'Listo.' } });
  applyOpenCodeEvent(t, { type: 'error', error: { name: 'APIError', data: { message: 'Límite alcanzado' } } });
  assert.deepEqual(t.message.parts, [{ type: 'tool', id: 'c1', name: 'glob', detail: 'a.txt', status: 'done', output: '/repo/a.txt' }, { type: 'text', text: 'Listo.' }]);
  assert.equal(t.contextTokens, 14915); assert.deepEqual(t.usage, { costUsd: .01, outputTokens: 41, steps: 1 });
  assert.equal(t.sessionId, 'ses_1'); assert.equal(t.error, 'Límite alcanzado');
  assert.deepEqual(providerArgs('opencode', { sessionId: 'ses_1', autoApprove: true, message: '-v', cwd: '/repo' }), ['serve', '--hostname', '127.0.0.1', '--port', '0']);
  assert.deepEqual(providerArgs('claude', { sessionId: 'abc', mode: 'auto', message: 'hola' }).slice(-4), ['--resume', 'abc', '--permission-mode', 'acceptEdits']);
  assert.ok(!providerArgs('claude', { mode: 'ask', message: 'x' }).includes('--permission-mode'));
  assert.ok(!providerArgs('opencode', { mode: 'auto', message: 'x' }).includes('--auto'), 'the host owns permission replies');
  // Total: Claude keeps the gate (never bypassPermissions), Codex drops its sandbox, OpenCode keeps its approval transport.
  const full = providerArgs('claude', { mode: 'full', message: 'x', gate: { token: 't', socketPath: '/s' } });
  assert.deepEqual(full.slice(full.indexOf('--permission-mode'), full.indexOf('--permission-mode') + 2), ['--permission-mode', 'acceptEdits']);
  assert.ok(full.includes('--permission-prompt-tool') && !full.includes('bypassPermissions') && !full.includes('--dangerously-skip-permissions'));
  assert.ok(providerArgs('codex', { access: 'full', message: 'x' }).includes('sandbox_mode="danger-full-access"'));
  assert.ok(providerArgs('codex', { access: 'auto', message: 'x' }).includes('sandbox_mode="workspace-write"'));
  assert.ok(providerArgs('codex', { autoApprove: true, message: 'x' }).includes('sandbox_mode="workspace-write"'));
  assert.ok(providerArgs('codex', { message: 'x' }).includes('sandbox_mode="read-only"'));
  assert.deepEqual(providerArgs('opencode', { access: 'full', message: 'x' }), ['serve', '--hostname', '127.0.0.1', '--port', '0']);
  assert.doesNotThrow(() => validateChat({ permissionMode: 'full' })); assert.throws(() => validateChat({ permissionMode: 'yolo' }), /permisos/);
  assert.ok(!providerArgs('claude', { message: 'secreto' }).includes('secreto'));
  assert.deepEqual(providerArgs('claude', { model: 'opus', message: 'x' }).slice(-2), ['--model', 'opus']);
  // A stored harness-qualified model reaches the CLI as a bare name; a non-Claude one is refused before any spawn.
  assert.deepEqual(providerArgs('claude', { model: 'claude-code/haiku', message: 'x' }).slice(-2), ['--model', 'haiku']);
  for (const bad of ['openai/gpt-5', 'opencode/free', 'provider/legacy']) assert.throws(() => providerArgs('claude', { model: bad, message: 'x' }), /no es Claude Code/);
  assert.throws(() => validateChat({ models: { claude: '--dangerously-skip-permissions' } }), /Modelo/); assert.throws(() => validateChat({ models: { gpt: 'x' } }), /provider/);
  assert.equal(toolDetail({ command: 'npm   test\n--watch' }), 'npm test --watch');
  assert.throws(() => validateChat({ provider: 'gpt' }), /provider/); assert.throws(() => validateChat({ shell: true }), /Unknown/);
});

test('renderer merge upserts streamed messages and ignores other providers', () => {
  const chat = { provider: 'claude', running: true, messages: [{ id: 'u' }, { id: 'a', parts: [] }] };
  const next = mergeChat(chat, { provider: 'claude', running: false, messages: [{ id: 'a', parts: [1] }, { id: 'b' }] });
  assert.deepEqual(next.messages.map(m => m.id), ['u', 'a', 'b']); assert.deepEqual(next.messages[1].parts, [1]); assert.equal(next.running, false);
  assert.equal(mergeChat(chat, { provider: 'opencode', messages: [{ id: 'z' }] }), chat);
});

test('chat card: configure, streamed turn, resume, stop, per-provider threads, persistence', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-chat-')), events = [];
  const out = 'const out=o=>process.stdout.write(JSON.stringify(o)+"\\n");';
  const claude = fixture(root, 'claude', `${out}let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{
    const resume=process.argv.indexOf('--resume');
    if(input==='cuelga'){out({type:'system',subtype:'init',session_id:'sid-1'});setInterval(()=>{},1000);return;}
    out({type:'system',subtype:'init',session_id:'sid-1'});
    out({type:'assistant',message:{id:'m1',model:'claude-x',usage:{input_tokens:5000,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:9},content:[{type:'text',text:'eco:'+input+' resume:'+(resume<0?'no':process.argv[resume+1])+(process.argv.includes('--model')?' modelo:'+process.argv[process.argv.indexOf('--model')+1]:'')+' modo:'+(process.argv.includes('acceptEdits')?'editar':'preguntar')+' cwd:'+process.cwd()}]}});
    out({type:'result',subtype:'success',is_error:false,result:'ok',session_id:'sid-1',duration_ms:1200,total_cost_usd:.25,usage:{output_tokens:9},modelUsage:{'claude-x':{contextWindow:200000}}});});`);
  const opencode = fixture(root, 'opencode', `${out}if(process.argv[2]==='models'){console.log('openai/gpt-x\\nopencode/free-y\\nruido sin barra');process.exit(0);}out({type:'text',sessionID:'ses_9',part:{text:'oc:'+process.argv.at(-1)+' pwd:'+(process.env.PWD===process.cwd())}});console.error('fallo del proveedor');process.exit(3);`);
  let host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const emit = host.chats.emit; host.chats.emit = event => { events.push(event); emit(event); };
  await host.invoke('settings.update', { patch: { claudePath: claude, opencodePath: opencode } });
  const w = await host.invoke('workspace.open', { path: root });
  const node = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', data: { chat: { provider: 'claude' } } });
  const ref = { workspaceId: w.id, nodeId: node.id }, idle = () => until(async () => !(await host.invoke('chat.get', ref)).running);
  await assert.rejects(host.invoke('node.create', { workspaceId: w.id, type: 'note', data: { chat: { provider: 'claude' } } }), /terminal/);
  await assert.rejects(host.invoke('chat.configure', { ...ref, provider: 'gpt' }), /provider/);
  await assert.rejects(host.invoke('chat.send', { ...ref, text: '   ' }), /mensaje/);

  await host.invoke('chat.send', { ...ref, text: 'hola' });
  await idle();
  let chat = await host.invoke('chat.get', ref);
  assert.equal(chat.sessionId, 'sid-1'); assert.deepEqual(chat.messages.map(m => [m.role, m.status]), [['user', 'done'], ['assistant', 'done']]);
  assert.equal(chat.messages[1].parts[0].text, `eco:hola resume:no modelo:sonnet modo:preguntar cwd:${fs.realpathSync(root)}`);
  // The rest of the test covers the CLI default path.
  await host.invoke('settings.update', { patch: { routing: { enabled: false } } });
  assert.ok(events.some(e => e.type === 'chat.update' && e.running === false && e.messages[0].status === 'done'));

  // Layout saves must not drop the chat selection; permission is per card.
  await host.invoke('node.update', { workspaceId: w.id, id: node.id, patch: { data: { fontSize: 14 } } });
  await host.invoke('chat.configure', { ...ref, autoApprove: true });
   const secondStart = events.length;
   await host.invoke('chat.send', { ...ref, text: 'sigue' }); await idle();
   assert.ok(events.slice(secondStart).filter(e => e.type === 'chat.update').every(e => e.meta.contextTokens === 5009 && e.meta.contextWindow === 200000));
  chat = await host.invoke('chat.get', ref);
  assert.match(chat.messages[3].parts[0].text, /^eco:sigue resume:sid-1 modo:editar/);
  assert.deepEqual(chat.meta, { model: 'claude-x', contextSource: 'claude:request-v1', contextTokens: 5009, contextWindow: 200000, costUsd: .5, turns: 2 });
  assert.deepEqual([chat.messages[3].model, chat.messages[3].usage], ['claude-x', { durationMs: 1200, costUsd: .25, outputTokens: 9 }]);

  // The model is chosen per provider and returns to the default with null.
  await assert.rejects(host.invoke('chat.configure', { ...ref, model: '-x' }), /Modelo/);
  await host.invoke('chat.configure', { ...ref, model: 'opus' });
  assert.equal((await host.invoke('chat.get', ref)).model, 'opus'); assert.deepEqual((await host.invoke('chat.models', ref)).items.map(m => m.id), ['fable', 'opus', 'sonnet', 'haiku']);
   const changedStart = events.length;
   await host.invoke('chat.send', { ...ref, text: 'con modelo' }); await idle();
   assert.equal(events.slice(changedStart).find(e => e.type === 'chat.update').meta.contextWindow, undefined);
  assert.match((await host.invoke('chat.get', ref)).messages.at(-1).parts[0].text, /resume:sid-1 modelo:opus modo:editar/);
  await host.invoke('chat.configure', { ...ref, model: null }); assert.equal((await host.invoke('chat.get', ref)).model, null);
  await host.invoke('chat.send', { ...ref, text: 'cuelga' });
  await assert.rejects(host.invoke('chat.configure', { ...ref, model: 'sonnet' }), /Detén/);
  await host.invoke('chat.stop', ref); await idle();
  assert.equal((await host.invoke('chat.get', ref)).messages.at(-1).status, 'stopped');

  // Claude-only policy: switching a card to another engine is refused with an actionable error and nothing changes.
  for (const provider of ['opencode', 'codex']) await assert.rejects(host.invoke('chat.configure', { ...ref, provider }), /Claude Code/);
  assert.equal((await host.invoke('chat.get', ref)).provider, 'claude');
  assert.equal((await host.invoke('chat.get', ref)).messages.length, 8);

  await host.close(); host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  await host.invoke('chat.configure', { ...ref, provider: 'claude' });
  chat = await host.invoke('chat.get', ref);
  assert.equal(chat.messages.length, 8); assert.equal(chat.sessionId, 'sid-1'); assert.equal(chat.autoApprove, true);
  // Canvas cards take the three-way switch too; permissionMode wins over the boolean.
  await host.invoke('chat.configure', { ...ref, permissionMode: 'full' });
  assert.deepEqual(host.store.getWorkspace(w.id).nodes.find(n => n.id === node.id).data.chat.permissionMode, 'full');
  assert.equal((await host.invoke('chat.get', ref)).mode, 'full');
  await assert.rejects(host.invoke('chat.configure', { ...ref, permissionMode: 'yolo' }), /permisos/);
  await host.invoke('chat.configure', { ...ref, autoApprove: false });
  assert.equal(host.store.getWorkspace(w.id).nodes.find(n => n.id === node.id).data.chat.permissionMode, undefined);
  assert.equal((await host.invoke('chat.get', ref)).mode, 'ask');
  await host.invoke('settings.update', { patch: { claudePath: path.join(root, 'missing') } });
  await host.invoke('chat.send', { ...ref, text: 'hola' }); await until(async () => !(await host.invoke('chat.get', ref)).running);
  assert.match((await host.invoke('chat.get', ref)).messages.at(-1).error, /No se encontró/);
  await host.invoke('chat.configure', { ...ref, provider: null });
  assert.equal((await host.invoke('chat.get', ref)).provider, null);
  await host.invoke('node.remove', { workspaceId: w.id, id: node.id });
  assert.equal(host.chats.nodes[node.id], undefined);
});

test('status line readings are compact and never invent a context window', async () => {
  const { contextUse, formatCost, formatDuration, formatTokens } = await import('../src/hooks/chatState.js');
  assert.deepEqual([30116, 1000000, 200000, 999, 1500000].map(formatTokens), ['30.1k', '1M', '200k', '999', '1.5M']);
  assert.deepEqual([6198, 42000, 72500].map(formatDuration), ['6.2 s', '42 s', '1 min 13 s']);
  assert.deepEqual([.3277, .004].map(formatCost), ['$0.33', '<$0.01']);
  assert.deepEqual(contextUse({ contextSource: 'claude:request-v1', contextTokens: 50000, contextWindow: 200000 }), { tokens: 50000, window: 200000, ratio: .25 });
  assert.deepEqual(contextUse({ contextSource: 'opencode:request-v1', contextTokens: 14915 }), { tokens: 14915, window: null, ratio: null });
  assert.equal(contextUse({}), null);
});

test('the project\'s Phantom chat runs in the project folder with its identity, without a canvas card', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-main-chat-'));
  // Echoes its prompt, its system prompt and the flags that matter here.
  const claude = fixture(root, 'claude', `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const a=process.argv,i=a.indexOf('--append-system-prompt'),out=e=>console.log(JSON.stringify(e));
    out({type:'system',subtype:'init',session_id:'main-1',model:'claude-x'});
    out({type:'assistant',message:{id:'m1',content:[{type:'text',text:'eco:'+input+' phantom:'+(i>=0&&a[i+1].includes('You are Phantom'))+' panel:'+(i>=0&&a[i+1].includes('Notas de misión'))+' modelo:'+(a.includes('--model')?a[a.indexOf('--model')+1]:'-')+' cwd:'+process.cwd()}]}});
    out({type:'result',subtype:'success',is_error:false,result:'ok',session_id:'main-1',duration_ms:10,usage:{output_tokens:1}});});`);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await host.invoke('settings.update', { patch: { claudePath: claude } });
  const w = await host.invoke('workspace.open', { path: root });
  await host.invoke('node.create', { workspaceId: w.id, type: 'note', title: 'Notas de misión', data: {} });
  const ref = { workspaceId: w.id, nodeId: `phantom:${w.id}` };
  let chat = await host.invoke('chat.get', ref);
  assert.deepEqual([chat.provider, chat.mode, chat.messages.length], ['claude', 'ask', 0]);
  await assert.rejects(host.invoke('chat.configure', { ...ref, provider: null }), /Phantom/);
  await host.invoke('chat.configure', { ...ref, model: 'opus' });
  await host.invoke('chat.send', { ...ref, text: 'hola' });
  await until(async () => !(await host.invoke('chat.get', ref)).running);
  chat = await host.invoke('chat.get', ref);
  assert.equal(chat.messages[1].parts[0].text, `eco:hola phantom:true panel:true modelo:opus cwd:${fs.realpathSync(root)}`);
  assert.equal(chat.sessionId, 'main-1');
  // It is never a node of the canvas, and another project has its own thread.
  assert.equal((await host.invoke('state.get')).workspaces.find(x => x.id === w.id).nodes.some(n => n.id === ref.nodeId), false);
  await assert.rejects(host.invoke('chat.get', { workspaceId: w.id, nodeId: 'phantom:otro' }), /not found/);
  // The main conversation shares provider and reasoning settings with chat cards.
  await host.invoke('chat.configure', { ...ref, reasoning: 'high' });
  assert.equal((await host.invoke('chat.get', ref)).reasoning.claude, 'high');
  await assert.rejects(host.invoke('chat.configure', { ...ref, reasoning: 'invalid' }), /Effort/);
  await assert.rejects(host.invoke('chat.configure', { ...ref, provider: 'codex', model: 'gpt-test', reasoning: 'xhigh' }), /Claude Code/);
  await assert.rejects(host.invoke('chat.configure', { ...ref, model: 'gpt-test' }), /no es Claude Code/);
  chat = await host.invoke('chat.get', ref);
  assert.equal(chat.provider, 'claude'); assert.notEqual(chat.model, 'gpt-test');
  await host.invoke('chat.configure', { ...ref, reasoning: null });
  assert.equal((await host.invoke('chat.get', ref)).reasoning.claude, undefined);
  await host.invoke('chat.configure', { ...ref, provider: 'claude' });
  // The permission switch is stored with the thread.
  await host.invoke('chat.configure', { ...ref, autoApprove: true });
  assert.equal((await host.invoke('chat.get', ref)).autoApprove, true);
  // The three-way switch: permissionMode wins and keeps the boolean in step; a bare boolean drops it.
  await host.invoke('chat.configure', { ...ref, permissionMode: 'full' });
  chat = await host.invoke('chat.get', ref);
  assert.deepEqual([chat.permissionMode, chat.mode, chat.autoApprove], ['full', 'full', true]);
  await assert.rejects(host.invoke('chat.configure', { ...ref, permissionMode: 'yolo' }), /permisos/);
  await host.invoke('chat.configure', { ...ref, permissionMode: 'ask' });
  chat = await host.invoke('chat.get', ref);
  assert.deepEqual([chat.permissionMode, chat.mode, chat.autoApprove], ['ask', 'ask', false]);
  await host.invoke('chat.configure', { ...ref, autoApprove: true });
  chat = await host.invoke('chat.get', ref);
  assert.deepEqual([chat.permissionMode, chat.mode], ['auto', 'auto']);
  assert.equal(host.chats.nodes[ref.nodeId].settings.permissionMode, undefined);
});

test('messages written while the agent works wait their turn; a stop pauses the line', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-queue-'));
  const claude = fixture(root, 'claude', `const out=o=>process.stdout.write(JSON.stringify(o)+"\\n");let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{
    out({type:'system',subtype:'init',session_id:'sid-q'});
    if(input.startsWith('cuelga')){setInterval(()=>{},1000);return;}
    setTimeout(()=>{out({type:'assistant',message:{id:'m-'+input,content:[{type:'text',text:'eco:'+input}]}});out({type:'result',subtype:'success',is_error:false,result:'ok',session_id:'sid-q'});},150);});`);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await host.invoke('settings.update', { patch: { claudePath: claude } });
  const w = await host.invoke('workspace.open', { path: root });
  const node = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', data: { chat: { provider: 'claude' } } });
  const ref = { workspaceId: w.id, nodeId: node.id }, get = () => host.invoke('chat.get', ref);
  const replies = async () => (await get()).messages.filter(m => m.role === 'assistant').map(m => m.parts[0]?.text);

  assert.equal((await host.invoke('chat.send', { ...ref, text: 'uno' })).queued, undefined);
  assert.equal((await host.invoke('chat.send', { ...ref, text: 'dos' })).queued, true);
  const { id: dropped } = await host.invoke('chat.send', { ...ref, text: 'sobra' });
  await host.invoke('chat.send', { ...ref, text: 'tres' });
  assert.deepEqual((await get()).queue.map(item => item.text), ['dos', 'sobra', 'tres']);
  assert.equal((await host.invoke('chat.queue.remove', { ...ref, id: dropped })).text, 'sobra');
  await until(async () => { const chat = await get(); return !chat.running && !chat.queue.length; });
  assert.deepEqual(await replies(), ['eco:uno', 'eco:dos', 'eco:tres']);

  // Stopping pauses whatever waits; resuming can pick which one goes first.
  await host.invoke('chat.send', { ...ref, text: 'cuelga' });
  await host.invoke('chat.send', { ...ref, text: 'cuatro' });
  const { id: first } = await host.invoke('chat.send', { ...ref, text: 'cinco' });
  await host.invoke('chat.stop', ref);
  await until(async () => !(await get()).running);
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual((await get()).queue.map(item => item.text), ['cuatro', 'cinco']);
  await host.invoke('chat.queue.send', { ...ref, id: first });
  await until(async () => { const chat = await get(); return !chat.running && !chat.queue.length; });
  assert.deepEqual((await replies()).slice(-2), ['eco:cinco', 'eco:cuatro']);
});

test('OpenCode catalog reads the variants each model accepts from verbose output', () => {
  const out = [
    'openai/gpt-x', JSON.stringify({ id: 'gpt-x', variants: { none: {}, low: {}, high: { reasoningEffort: 'high' }, 'bad variant': {} } }, null, 2),
    '\x1b[2mopencode/plain\x1b[0m', JSON.stringify({ id: 'plain', limit: { context: 1 } }, null, 2),
    'acme/broken', '{ not json',
    'openai/gpt-x', '{}',
    'ruido sin barra',
  ].join('\n');
  assert.deepEqual(openCodeModels(out), [
    { id: 'openai/gpt-x', group: 'openai', variants: ['none', 'low', 'high'] },
    { id: 'opencode/plain', group: 'opencode' },
    { id: 'acme/broken', group: 'acme' },
  ]);
  assert.deepEqual(openCodeModels('a/one\nb/two\n'), [{ id: 'a/one', group: 'a' }, { id: 'b/two', group: 'b' }]);
});
