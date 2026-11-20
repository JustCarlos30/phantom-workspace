import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createHost } from '../host/server.mjs';
import { driveOpenCode, loopbackRequest } from '../host/opencode-chat.mjs';
import { applyOpenCodeEvent } from '../host/chats.mjs';

test('OpenCode context is the latest root step total, never a sum or incomplete fallback', () => {
  const turn = { message: { parts: [] } };
  const apply = (tokens, sessionID = 'root') => applyOpenCodeEvent(turn, { type: 'step_finish', sessionID: 'root', part: { sessionID, tokens } });
  apply({ total: 80000, output: 10, reasoning: 5 });
  assert.equal(turn.contextTokens, 80000);
  apply({ total: 999999 }, 'child');
  assert.equal(turn.contextTokens, 80000);
  apply({ total: 60000 });
  assert.equal(turn.contextTokens, 60000);
  assert.equal(turn.contextSource, 'opencode:request-v1');
  apply({ input: 100, output: 5, reasoning: 1, cache: { read: 10, write: 0 } });
  assert.equal(turn.contextTokens, 116);
  for (const tokens of [undefined, {}, ...[NaN, Infinity, -1, null].map(total => ({ total }))]) {
    apply({ total: 80000 }); apply(tokens);
    assert.equal(turn.contextTokens, 80000);
    assert.equal(turn.contextSource, 'opencode:request-v1');
  }
  applyOpenCodeEvent(turn, { type: 'model', sessionID: 'root', model: 'openai/test', contextWindow: 258400 });
  assert.equal(turn.model, 'openai/test');
  assert.equal(turn.contextWindow, 258400);
});

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
  const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal', data: { cwd: root } });
  const ref = { workspaceId: workspace.id, nodeId: node.id };
  const get = () => host.invoke('chat.get', ref);
  return { root, host, ref, get,
    send: text => host.invoke('chat.send', { ...ref, text }),
    ask: () => until(async () => (await get()).messages.at(-1)?.parts.find(p => p.type === 'permission' && p.status === 'pending')),
    answer: (part, decision) => host.invoke('chat.permission.answer', { ...ref, requestId: part.id, decision }),
    idle: () => until(async () => { const chat = await get(); return !chat.running && chat; }),
  };
}

// Claude-only policy: a stored OpenCode chat stays readable but can no longer execute. The driveOpenCode
// protocol tests below remain as historical-parser coverage; the host refuses to start OpenCode.
test('Claude-only: OpenCode cannot be chosen for a chat and no OpenCode process ever starts', async t => {
  const f = await setup(t);
  assert.deepEqual((await f.get()).messages, []);
  await assert.rejects(f.host.invoke('chat.configure', { ...f.ref, provider: 'opencode' }), /Claude Code/);
  await assert.rejects(f.send('twice'));
  assert.equal(fs.existsSync(path.join(f.root, 'transport.json')), false, 'the OpenCode binary was never spawned');
  assert.equal((await f.get()).messages.length, 0, 'the refused message is not recorded');
});

test('Claude-only: the main Phantom chat also refuses OpenCode', async t => {
  const f = await setup(t), ref = { ...f.ref, nodeId: `phantom:${f.ref.workspaceId}` };
  await assert.rejects(f.host.invoke('chat.configure', { ...ref, provider: 'opencode' }), /Claude Code/);
  assert.equal(fs.existsSync(path.join(f.root, 'transport.json')), false);
});

test('OpenCode habilitado: el chat usa el transporte real con su modelo; deshabilitado se rechaza sin arrancar', async t => {
  const f = await setup(t);
  await f.host.invoke('providers.configure', { providers: { opencode: { enabled: true } } });
  await assert.rejects(f.host.invoke('chat.configure', { ...f.ref, provider: 'opencode', model: 'anthropic/claude-sonnet-4' }), /solo con Claude Code/);
  await f.host.invoke('chat.configure', { ...f.ref, provider: 'opencode' });
  await f.host.invoke('chat.configure', { ...f.ref, model: 'openai/gpt-5' });
  await f.send('main-recovered');
  const chat = await f.idle();
  assert.equal(chat.messages.at(-1).parts.find(p => p.type === 'text').text, 'Respuesta final del agente principal');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'transport.json'), 'utf8')).body.model, { providerID: 'openai', modelID: 'gpt-5' });
  fs.rmSync(path.join(f.root, 'transport.json'));
  await f.host.invoke('providers.configure', { providers: { opencode: { enabled: false } } });
  await assert.rejects(f.send('otra'), /Habilita OpenCode/);
  assert.equal(fs.existsSync(path.join(f.root, 'transport.json')), false);
  assert.equal((await f.get()).messages.length, 2);
});

async function localServer(t, handler) {
  const server = http.createServer(handler);
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('driveOpenCode informa el modelo principal y consulta su ventana una sola vez', async t => {
  let stream, queries = 0;
  const info = { role: 'assistant', sessionID: 'root', providerID: 'openai', modelID: 'test' };
  const base = await localServer(t, async (req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/session') return res.end(JSON.stringify({ id: 'root' }));
    if (route === '/event') {
      stream = res;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"server.connected"}\n\n');
      return;
    }
    if (route === '/config/providers') {
      queries++;
      return res.end(JSON.stringify({ providers: [{ id: 'openai', models: { test: { limit: { context: 258400, output: 1000 } } } }] }));
    }
    if (route === '/session/root/message') {
      for await (const chunk of req) { /* Consume the prompt. */ }
      const send = info => stream.write(`data: ${JSON.stringify({ type: 'message.updated', properties: { info } })}\n\n`);
      send({ ...info, sessionID: 'child', modelID: 'child' });
      send(info); send(info);
      return res.end(JSON.stringify({ info, parts: [] }));
    }
    res.writeHead(404); res.end();
  });
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  let closed = false;
  child.kill = () => { if (!closed) { closed = true; child.emit('close', 0); } };
  const events = [];
  const driving = driveOpenCode(child, { cwd: '/tmp', message: 'hola', password: 'secret', onEvent: event => events.push(event) });
  child.stdout.write(`opencode server listening on ${base}\n`);
  await driving;
  assert.equal(queries, 1);
  assert.deepEqual(events.filter(event => event.type === 'model'), [{ type: 'model', sessionID: 'root', model: 'openai/test', contextWindow: 258400 }]);
});

test('loopback message and live SSE requests work when global fetch throws', { timeout: 5000 }, async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('fetch must not handle long requests'); });
  const directory = '/tmp/espacio con ñ', authorization = `Basic ${Buffer.from('opencode:secret').toString('base64')}`;
  const headers = { authorization, 'content-type': 'application/json' };
  let received, closeStream;
  const streamClosed = new Promise(resolve => { closeStream = resolve; });
  const base = await localServer(t, async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    assert.equal(url.searchParams.get('directory'), directory);
    assert.equal(req.headers.authorization, authorization);
    assert.equal(req.headers['content-type'], 'application/json');
    if (url.pathname === '/event') {
      assert.equal(req.method, 'GET');
      res.on('close', closeStream);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"server.connected"}\r\n\r\n');
      return;
    }
    assert.equal(url.pathname, '/session/ses_test/message');
    assert.equal(req.method, 'POST');
    let raw = ''; for await (const chunk of req) raw += chunk;
    received = JSON.parse(raw);
    res.end(JSON.stringify({ parts: [{ text: 'listo ✓' }] }));
  });
  const query = `?directory=${encodeURIComponent(directory)}`;
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await loopbackRequest(`${base}/event${query}`, { headers, signal: controller.signal });
  assert.equal(stream.ok, true); assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  let frame = '';
  while (!frame.endsWith('\r\n\r\n')) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    frame += new TextDecoder().decode(value);
  }
  assert.equal(frame, 'data: {"type":"server.connected"}\r\n\r\n');
  const body = { parts: [{ type: 'text', text: 'hola' }] };
  const response = await loopbackRequest(`${base}/session/ses_test/message${query}`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
  });
  assert.deepEqual(await response.json(), { parts: [{ text: 'listo ✓' }] });
  assert.deepEqual(received, body);
  await reader.cancel();
  await streamClosed;
});

test('loopback requests wait for delayed response headers', { timeout: 5000 }, async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('fetch must not handle long requests'); });
  const base = await localServer(t, (req, res) => {
    const timer = setTimeout(() => res.end('{"delayed":true}'), 1500);
    res.on('close', () => clearTimeout(timer));
  });
  const response = await loopbackRequest(`${base}/session/ses_test/message`, { method: 'POST', body: '{}' });
  assert.deepEqual(await response.json(), { delayed: true });
});

test('aborting a loopback request closes the connection before response headers', { timeout: 5000 }, async t => {
  let arrived, closed;
  const requestArrived = new Promise(resolve => { arrived = resolve; });
  const connectionClosed = new Promise(resolve => { closed = resolve; });
  const base = await localServer(t, (req, res) => { res.on('close', closed); arrived(); });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const pending = loopbackRequest(`${base}/session/ses_test/message`, { method: 'POST', body: '{}', signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await requestArrived;
  controller.abort();
  await rejected;
  await connectionClosed;
});

test('aborting a loopback SSE stream rejects its reader and closes the connection', { timeout: 5000 }, async t => {
  let closed;
  const connectionClosed = new Promise(resolve => { closed = resolve; });
  const base = await localServer(t, (req, res) => {
    res.on('close', closed);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.flushHeaders();
  });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await loopbackRequest(`${base}/event`, { signal: controller.signal });
  const reader = response.body.getReader();
  // IncomingMessage can surface a destroyed response as ECONNRESET rather
  // than forwarding the ClientRequest's AbortError to the web reader.
  const rejected = assert.rejects(reader.read(), error => error.code === 'ABORT_ERR' || error.code === 'ECONNRESET');
  controller.abort();
  await rejected;
  await connectionClosed;
  await reader.cancel().catch(() => {});
});

// Transport coverage: the protocol fixture is spawned directly and driven by driveOpenCode. The Claude-only
// host is deliberately not involved, so no production bypass exists; these tests keep the historical
// transport (retries, SSE reconnection, cancellation) verified without making OpenCode executable from a chat.
function drive(t, message, { onPermission = async () => ({ behavior: 'allow' }), onQuestion = async () => ({ behavior: 'allow', answers: [['Revisar']] }), signal } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-opencode-transport-')));
  const fixture = fileURLToPath(new URL('./fixtures/opencode-chat-server.mjs', import.meta.url));
  const password = 'fixture-secret';
  const child = spawn(process.execPath, [fixture, 'serve'], { cwd: root, env: { ...process.env, PWD: root, OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: password }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ } fs.rmSync(root, { recursive: true, force: true }); });
  const events = [];
  const run = driveOpenCode(child, { cwd: root, message, password, signal, onEvent: event => events.push(event), onPermission, onQuestion });
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name)));
  return { root, events, run, counts: () => read('control.json'), transport: () => read('transport.json') };
}
const finalText = events => events.find(e => e.type === 'text')?.part.text;
const gone = pid => assert.throws(() => process.kill(pid, 0), /ESRCH/);

test('OpenCode routes only bounded requests through fetch', async t => {
  const originalFetch = globalThis.fetch, boundedRoutes = [];
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const route = new URL(url).pathname;
    assert.ok(route !== '/event' && !route.endsWith('/message'), `Unexpected long fetch: ${route}`);
    boundedRoutes.push(route);
    return originalFetch(url, options);
  });
  const d = drive(t, 'hello');
  await d.run;
  assert.ok(boundedRoutes.includes('/session'));
  assert.ok(boundedRoutes.some(route => route.startsWith('/permission/')));
});

test('OpenCode subtask failures and tentative main errors leave successful parent replies done', async t => {
  for (const message of ['subtask-fail', 'child-abort', 'main-recovered', 'main-failed', 'main-transport-failed']) {
    const d = drive(t, message);
    if (message === 'main-transport-failed') { await assert.rejects(d.run, /Bad Gateway/); continue; }
    await d.run;
    const error = d.events.find(e => e.type === 'error');
    assert.match(finalText(d.events), /Respuesta final/);
    if (message === 'main-failed') { assert.match(error.error.message, /Bad Gateway/); assert.match(error.error.message, /Final failure/); }
    else assert.equal(error, undefined);
    if (message === 'subtask-fail' || message === 'child-abort') {
      const tool = d.events.find(e => e.type === 'tool_use');
      assert.equal(tool.part.state.status, 'error'); assert.match(tool.part.state.error, /Subagent failed/);
    }
  }
});

test('OpenCode control replies retry transient failures only, with a bounded attempt count', async t => {
  for (const message of ['transient', 'network-transient', 'persistent', 'gone', 'question-transient', 'question-reject-transient']) {
    const d = drive(t, message, { onQuestion: async () => message.includes('reject') ? { behavior: 'deny' } : { behavior: 'allow', answers: [['Revisar']] } });
    if (message === 'persistent') await assert.rejects(d.run, /OpenCode.*HTTP 503/); else await d.run;
    const counts = d.counts();
    assert.equal(counts.attempts, message === 'persistent' || message === 'network-transient' ? 3 : message === 'gone' ? 1 : 2);
    assert.equal(counts.delivered, message === 'persistent' ? 0 : 1);
  }
});

test('OpenCode reconnects SSE and catches pending requests exactly once', async t => {
  for (const message of ['sse-drop', 'sse-drop-question']) {
    let asked = 0;
    const d = drive(t, message, {
      onPermission: async () => { asked++; return { behavior: 'allow' }; },
      onQuestion: async () => { asked++; return { behavior: 'allow', answers: [['Revisar']] }; },
    });
    await d.run;
    const counts = d.counts();
    assert.equal(counts.connections, 2);
    assert.equal(counts.delivered, 1); assert.equal(counts.attempts, 1);
    assert.equal(asked, 1);
  }
});

test('OpenCode fails after bounded SSE reconnections and closes its server', async t => {
  const d = drive(t, 'sse-exhausted');
  await assert.rejects(d.run, /OpenCode/);
  assert.equal(d.counts().connections, 4);
  gone(d.transport().pid);
});

test('OpenCode transport keeps serving sequential turns after a recovered subtask', async t => {
  for (const message of ['subtask-fail', 'main-recovered']) {
    const d = drive(t, message);
    await d.run;
    assert.equal(d.events.find(e => e.type === 'error'), undefined);
    gone(d.transport().pid);
  }
});

test('OpenCode transport rejects denied permissions and sends children no feedback', async t => {
  const feedback = 'El usuario rechazó este permiso en Phantom Workspace.';
  for (const message of ['child-denied', 'main-denied']) {
    const asked = [];
    const d = drive(t, message, { onPermission: async request => { asked.push(request); return { behavior: 'deny', ...(request.child ? {} : { message: feedback }) }; } });
    await d.run;
    assert.equal(asked.length, 2);
    assert.ok(asked.every(request => request.child === (message === 'child-denied')));
    const verdict = message === 'child-denied' ? { reply: 'reject' } : { reply: 'reject', message: feedback };
    assert.deepEqual(JSON.parse(finalText(d.events)), [verdict, verdict]);
  }
});

test('OpenCode cancellation interrupts retry backoff and leaves no server or later attempts', async t => {
  const controller = new AbortController();
  const d = drive(t, 'cancel-backoff', { signal: controller.signal });
  const outcome = assert.rejects(d.run);
  await until(() => { try { return d.counts().attempts === 1; } catch { return false; } });
  const { pid } = d.transport();
  controller.abort(new Error('detenido'));
  await outcome;
  gone(pid);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(d.counts().attempts, 1);
});
