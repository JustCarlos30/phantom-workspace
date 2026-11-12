import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { applyClaudeEvent, applyOpenCodeEvent, providerArgs, toolDetail, toolDiff, toolOutput, validateChat } from '../host/chats.mjs';
import { mergeChat } from '../src/hooks/chatState.js';

const until = async fn => { const end = Date.now() + 5000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('Timed out'); };
const turn = () => ({ message: { parts: [] }, sessionId: null, streamed: new Set(), freshText: true, cwd: '/repo', error: '' });
// Stand-in agent CLIs: executables that print a recorded event stream.
function fixture(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${body}`, { mode: 0o755 });
  return file;
}

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

test('OpenCode events become text and tool parts; arguments resume the right session', () => {
  const t = turn();
  applyOpenCodeEvent(t, { type: 'step_start', sessionID: 'ses_1', part: { type: 'step-start' } });
  applyOpenCodeEvent(t, { type: 'tool_use', sessionID: 'ses_1', part: { tool: 'glob', callID: 'c1', state: { status: 'completed', input: { pattern: 'a.txt' }, output: '/repo/a.txt' } } });
  applyOpenCodeEvent(t, { type: 'step_finish', sessionID: 'ses_1', part: { tokens: { total: 14915, output: 13, reasoning: 28 }, cost: .01 } });
  applyOpenCodeEvent(t, { type: 'text', sessionID: 'ses_1', part: { text: 'Listo.' } });
  applyOpenCodeEvent(t, { type: 'error', error: { name: 'APIError', data: { message: 'Límite alcanzado' } } });
  assert.deepEqual(t.message.parts, [{ type: 'tool', id: 'c1', name: 'glob', detail: 'a.txt', status: 'done', output: '/repo/a.txt' }, { type: 'text', text: 'Listo.' }]);
  assert.equal(t.contextTokens, 14915); assert.deepEqual(t.usage, { costUsd: .01, outputTokens: 41, steps: 1 });
  assert.equal(t.sessionId, 'ses_1'); assert.equal(t.error, 'Límite alcanzado');
  assert.deepEqual(providerArgs('opencode', { sessionId: 'ses_1', autoApprove: true, message: '-v', cwd: '/repo' }), ['run', '--format', 'json', '--dir', '/repo', '--session', 'ses_1', '--auto', ' -v']);
  assert.deepEqual(providerArgs('claude', { sessionId: 'abc', mode: 'auto', message: 'hola' }).slice(-4), ['--resume', 'abc', '--permission-mode', 'acceptEdits']);
  assert.ok(!providerArgs('claude', { mode: 'ask', message: 'x' }).includes('--permission-mode'));
  assert.ok(!providerArgs('opencode', { mode: 'auto', message: 'x' }).includes('--auto'), 'OpenCode keeps its explicit switch');
  assert.ok(!providerArgs('claude', { message: 'secreto' }).includes('secreto'));
  assert.deepEqual(providerArgs('claude', { model: 'opus', message: 'x' }).slice(-2), ['--model', 'opus']); assert.deepEqual(providerArgs('opencode', { model: 'openai/gpt-x', message: 'x' }).slice(3, 5), ['--model', 'openai/gpt-x']);
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
    out({type:'assistant',message:{id:'m1',model:'claude-x',usage:{input_tokens:5000,output_tokens:9},content:[{type:'text',text:'eco:'+input+' resume:'+(resume<0?'no':process.argv[resume+1])+(process.argv.includes('--model')?' modelo:'+process.argv[process.argv.indexOf('--model')+1]:'')+' modo:'+(process.argv.includes('acceptEdits')?'editar':'preguntar')+' cwd:'+process.cwd()}]}});
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
  await assert.rejects(host.invoke('chat.send', { ...ref, text: 'otra' }), /respondiendo/);
  await idle();
  let chat = await host.invoke('chat.get', ref);
  assert.equal(chat.sessionId, 'sid-1'); assert.deepEqual(chat.messages.map(m => [m.role, m.status]), [['user', 'done'], ['assistant', 'done']]);
  assert.equal(chat.messages[1].parts[0].text, `eco:hola resume:no modo:preguntar cwd:${fs.realpathSync(root)}`);
  assert.ok(events.some(e => e.type === 'chat.update' && e.running === false && e.messages[0].status === 'done'));

  // Layout saves must not drop the chat selection; permission is per card.
  await host.invoke('node.update', { workspaceId: w.id, id: node.id, patch: { data: { fontSize: 14 } } });
  await host.invoke('chat.configure', { ...ref, autoApprove: true });
  await host.invoke('chat.send', { ...ref, text: 'sigue' }); await idle();
  chat = await host.invoke('chat.get', ref);
  assert.match(chat.messages[3].parts[0].text, /^eco:sigue resume:sid-1 modo:editar/);
  assert.deepEqual(chat.meta, { model: 'claude-x', contextTokens: 5009, contextWindow: 200000, costUsd: .5, turns: 2 });
  assert.deepEqual([chat.messages[3].model, chat.messages[3].usage], ['claude-x', { durationMs: 1200, costUsd: .25, outputTokens: 9 }]);

  // The model is chosen per provider and returns to the default with null.
  await assert.rejects(host.invoke('chat.configure', { ...ref, model: '-x' }), /Modelo/);
  await host.invoke('chat.configure', { ...ref, model: 'opus' });
  assert.equal((await host.invoke('chat.get', ref)).model, 'opus'); assert.deepEqual((await host.invoke('chat.models', ref)).items.map(m => m.id), ['fable', 'opus', 'sonnet', 'haiku']);
  await host.invoke('chat.send', { ...ref, text: 'con modelo' }); await idle();
  assert.match((await host.invoke('chat.get', ref)).messages.at(-1).parts[0].text, /resume:sid-1 modelo:opus modo:editar/);
  await host.invoke('chat.configure', { ...ref, model: null }); assert.equal((await host.invoke('chat.get', ref)).model, null);
  await host.invoke('chat.send', { ...ref, text: 'cuelga' });
  await assert.rejects(host.invoke('chat.configure', { ...ref, provider: 'opencode' }), /Detén/);
  await host.invoke('chat.stop', ref); await idle();
  assert.equal((await host.invoke('chat.get', ref)).messages.at(-1).status, 'stopped');

  // Each provider keeps its own thread; a failed turn reports the CLI's stderr.
  await host.invoke('chat.configure', { ...ref, provider: 'opencode' });
  assert.deepEqual((await host.invoke('chat.get', ref)).messages, []);
  assert.deepEqual((await host.invoke('chat.models', ref)).items, [{ id: 'openai/gpt-x', group: 'openai' }, { id: 'opencode/free-y', group: 'opencode' }]);
  assert.equal((await host.invoke('chat.get', ref)).model, null);
  await host.invoke('chat.send', { ...ref, text: 'ping' }); await idle();
  chat = await host.invoke('chat.get', ref);
  assert.equal(chat.messages[1].parts[0].text, 'oc:ping pwd:true'); assert.equal(chat.messages[1].status, 'error'); assert.match(chat.messages[1].error, /fallo del proveedor/);
  await host.invoke('chat.clear', ref);
  assert.deepEqual((await host.invoke('chat.get', ref)).messages, []);

  await host.close(); host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  await host.invoke('chat.configure', { ...ref, provider: 'claude' });
  chat = await host.invoke('chat.get', ref);
  assert.equal(chat.messages.length, 8); assert.equal(chat.sessionId, 'sid-1'); assert.equal(chat.autoApprove, true);
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
  assert.deepEqual(contextUse({ contextTokens: 50000, contextWindow: 200000 }), { tokens: 50000, window: 200000, ratio: .25 });
  assert.deepEqual(contextUse({ contextTokens: 14915 }), { tokens: 14915, window: null, ratio: null });
  assert.equal(contextUse({}), null);
});
