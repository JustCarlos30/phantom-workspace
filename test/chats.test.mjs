import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { applyClaudeEvent, applyOpenCodeEvent, applyCodexEvent, openCodeModels, providerArgs, toolDetail, toolDiff, toolOutput, validateChat } from '../host/chats.mjs';
import { mergeChat } from '../src/hooks/chatState.js';

const until = async fn => { const end = Date.now() + 5000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('Timed out'); };
const turn = () => ({ message: { parts: [] }, sessionId: null, streamed: new Set(), freshText: true, cwd: '/repo', error: '' });
test('Codex folds lifecycle events without duplicating updates and reports failures', () => {
  const t = turn();
  applyCodexEvent(t, { type: 'thread.started', thread_id: 'thread-1' });
  applyCodexEvent(t, { type: 'item.started', item: { id: 'c', type: 'command_execution', command: 'npm test' } });
  applyCodexEvent(t, { type: 'item.completed', item: { id: 'c', type: 'command_execution', command: 'npm test', exit_code: 1, aggregated_output: 'failed' } });
  for (const type of ['item.updated', 'item.completed']) applyCodexEvent(t, { type, item: { id: 'a', type: 'agent_message', text: 'Listo' } });
  applyCodexEvent(t, { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } });
  assert.equal(t.sessionId, 'thread-1'); assert.equal(t.message.parts.length, 2); assert.equal(t.message.parts[0].status, 'error'); assert.equal(t.message.parts[1].text, 'Listo'); assert.equal(t.contextTokens, 120);
  applyCodexEvent(t, { type: 'turn.failed', error: { message: 'sin crédito' } }); assert.equal(t.error, 'sin crédito');
});

test('Codex launches, resumes and persists independent effort settings through host API', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-codex-'));
  const bin = fixture(root, 'codex', `let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{const out=o=>console.log(JSON.stringify(o));out({type:'thread.started',thread_id:'thread-1'});out({type:'item.completed',item:{id:'a',type:'agent_message',text:JSON.stringify({input,args:process.argv.slice(2)})}});out({type:'turn.completed',usage:{input_tokens:10,output_tokens:2}});});`);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await host.invoke('settings.update', { patch: { codexPath: bin } });
  const w = await host.invoke('workspace.open', { path: root });
  const node = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', data: { chat: { provider: 'codex' } } });
  const ref = { workspaceId: w.id, nodeId: node.id };
  await host.invoke('chat.configure', { ...ref, reasoning: 'high', model: 'gpt-test' });
  await assert.rejects(host.invoke('chat.configure', { ...ref, reasoning: '--bad' }), /inválido/);
  for (let i = 0; i < 2; i++) {
    await host.invoke('chat.send', { ...ref, text: '-hello' });
    await until(async () => !(await host.invoke('chat.get', ref)).running);
    const chat = await host.invoke('chat.get', ref), reply = JSON.parse(chat.messages.at(-1).parts[0].text);
    assert.equal(chat.sessionId, 'thread-1'); assert.equal(reply.input, '-hello');
    assert.ok(reply.args.includes('model_reasoning_effort="high"')); assert.equal(reply.args.includes('resume'), i === 1);
    assert.ok(reply.args.includes('sandbox_mode="read-only"'));
  }
  await host.invoke('chat.configure', { ...ref, provider: 'opencode', reasoning: 'custom-variant' });
  await host.invoke('chat.configure', { ...ref, provider: 'codex' });
  const state = await host.invoke('state.get');
  assert.equal(state.workspaces.find(item => item.id === w.id).nodes.find(item => item.id === node.id).data.chat.reasoning.codex, 'high');
  assert.ok(providerArgs('claude', { message: 'x', reasoning: 'max' }).includes('--effort'));
  assert.equal(providerArgs('opencode', { message: 'x', reasoning: 'custom-variant' })[0], 'serve');
});
test('chat turns get the canvas browser bridge: stable per card, live only while the turn runs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-chat-browser-'));
  const bin = fixture(root, 'codex', `const fs=require('fs'),path=require('path');process.stdin.resume();process.stdin.on('end',()=>{const e=process.env,cred=path.join(path.dirname(e.PHANTOM_BROWSER_ENDPOINT||'/x'),'browser-terminals',(e.PHANTOM_BROWSER_SESSION||'x')+'.json');const out=o=>console.log(JSON.stringify(o));out({type:'thread.started',thread_id:'thread-1'});out({type:'item.completed',item:{id:'a',type:'agent_message',text:JSON.stringify({cli:e.PHANTOM_BROWSER_CLI,session:e.PHANTOM_BROWSER_SESSION,workspace:e.PHANTOM_BROWSER_WORKSPACE,token:Boolean(e.PHANTOM_BROWSER_TOKEN),shims:(e.PATH||'').split(':')[0]===e.PHANTOM_BROWSER_SHIMS,credential:fs.existsSync(cred),cred})}});setTimeout(()=>out({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}),300);});`);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await host.invoke('settings.update', { patch: { codexPath: bin } });
  const w = await host.invoke('workspace.open', { path: root });
  const node = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', data: { chat: { provider: 'codex' } } });
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
  applyOpenCodeEvent(t, { type: 'step_finish', sessionID: 'ses_1', part: { tokens: { total: 14915, output: 13, reasoning: 28 }, cost: .01 } });
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
  assert.equal(chat.messages[1].parts.length, 0); assert.equal(chat.messages[1].status, 'error'); assert.match(chat.messages[1].error, /fallo del proveedor/);
  await host.invoke('chat.clear', ref);
  assert.deepEqual((await host.invoke('chat.get', ref)).messages, []);

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
  assert.deepEqual(contextUse({ contextTokens: 50000, contextWindow: 200000 }), { tokens: 50000, window: 200000, ratio: .25 });
  assert.deepEqual(contextUse({ contextTokens: 14915 }), { tokens: 14915, window: null, ratio: null });
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
  await host.invoke('chat.configure', { ...ref, provider: 'codex', model: 'gpt-test', reasoning: 'xhigh' });
  chat = await host.invoke('chat.get', ref);
  assert.equal(chat.provider, 'codex'); assert.equal(chat.model, 'gpt-test');
  assert.equal(chat.reasoning.codex, 'xhigh');
  await host.invoke('chat.configure', { ...ref, reasoning: null });
  assert.equal((await host.invoke('chat.get', ref)).reasoning.codex, undefined);
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
