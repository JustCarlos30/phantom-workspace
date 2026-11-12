import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { handleAutomation, shutdownAutomation } from '../integrations/automation.mjs';
import { stateDirectory } from '../integrations/run-manager.mjs';
import { executableOnPath } from '../integrations/run-manager.mjs';

const temporary = [];
after(async () => { await shutdownAutomation(); await Promise.all(temporary.map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture(settings = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-automation-'));
  temporary.push(root);
  const cwd = path.join(root, 'workspace');
  const other = path.join(root, 'other');
  const dataDir = path.join(root, 'appdata');
  await Promise.all([mkdir(cwd), mkdir(other)]);
  const workspaces = [cwd, other].map(canonicalPath => ({ id: randomUUID(), path: canonicalPath, canonicalPath }));
  const events = [];
  const context = { dataDir, state: { settings, workspaces }, getWorkspace: id => workspaces.find(w => w.id === id), emit: event => events.push(event) };
  const invoke = async (method, payload = {}) => (await handleAutomation(method, { workspaceId: workspaces[0].id, ...payload }, context)).result;
  return { root, cwd, dataDir, workspaces, context, events, invoke };
}

async function waitFor(invoke, kind, id, predicate = record => ['completed', 'failed', 'stopped'].includes(record.status), timeout = 15_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const record = (await invoke(`${kind}.list`)).items.find(record => record.id === id);
    if (record && predicate(record)) return record;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${kind} ${id}`);
}

test('node executes with canonical cwd, real source/log/version and workspace-scoped events', async () => {
  const f = await fixture();
  const run = await f.invoke('playground.run', { runtime: 'node', code: 'console.log("hello-owned"); console.log(process.cwd());' });
  assert.match(run.id, /^[a-f0-9-]{36}$/);
  assert.equal(run.status, 'starting');
  assert.equal(run.owned, true);
  assert.ok(run.artifactDir.startsWith(f.dataDir));
  const record = await waitFor(f.invoke, 'playground', run.id, record => record.status === 'completed' && !record.owned);
  assert.equal(record.exitCode, 0);
  assert.match(record.runtimeVersion, /^v\d/);
  assert.match(record.output, /hello-owned/);
  assert.ok(record.output.includes(f.cwd));
  assert.match(await readFile(record.sourcePath, 'utf8'), /hello-owned/);
  assert.match(await readFile(path.join(record.artifactDir, 'output.log'), 'utf8'), /hello-owned/);
  const saved = JSON.parse(await readFile(path.join(record.artifactDir, 'run.json'), 'utf8'));
  assert.equal(saved.workspaceId, f.workspaces[0].id);
  assert.ok(f.events.some(event => event.type === 'tool.output' && event.id === run.id));
  assert.ok(f.events.some(event => event.type === 'tool.status' && event.status === 'completed'));
  assert.deepEqual(await readdir(f.cwd), []);
});

test('exit failure, timeout, stop and output cap are truthful', async () => {
  const f = await fixture();
  const bad = await f.invoke('playground.run', { runtime: 'node', code: 'console.error("failed fixture"); process.exit(7)' });
  const failed = await waitFor(f.invoke, 'playground', bad.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 7);
  const slow = await f.invoke('playground.run', { runtime: 'node', code: 'setInterval(() => {}, 1000)', timeoutMs: 100 });
  const timedOut = await waitFor(f.invoke, 'playground', slow.id);
  assert.equal(timedOut.status, 'failed');
  assert.match(timedOut.error, /Tiempo límite/);
  const stopped = await f.invoke('playground.run', { runtime: 'node', code: 'setInterval(() => {}, 1000)' });
  await waitFor(f.invoke, 'playground', stopped.id, record => Boolean(record.pid));
  const result = await f.invoke('playground.stop', { id: stopped.id });
  assert.equal(result.status, 'stopped');
  assert.equal(result.owned, false);
  const flood = await f.invoke('playground.run', { runtime: 'node', code: 'process.stdout.write("x".repeat(200000)); setInterval(() => {}, 1000)' });
  const limited = await waitFor(f.invoke, 'playground', flood.id);
  assert.equal(limited.status, 'failed');
  assert.match(limited.error, /Salida excede/);
  assert.ok(Buffer.byteLength(limited.output) <= 65536);
});

test('explicit shell/python source runs without interpolating the script path', async () => {
  const f = await fixture();
  for (const [runtime, executable, code, expected] of [
    ['shell', 'bash', 'printf "%s\\n" "literal shell fixture"', 'literal shell fixture'],
    ['python', 'python3', 'print("literal python fixture")', 'literal python fixture'],
  ]) {
    if (!await executableOnPath(executable)) continue;
    const run = await f.invoke('playground.run', { runtime, code });
    const record = await waitFor(f.invoke, 'playground', run.id);
    assert.equal(record.status, 'completed', record.error);
    assert.match(record.output, new RegExp(expected));
    assert.ok(record.runtimeVersion);
  }
});

test('concurrent requests cannot exceed the live controller limit', async () => {
  const f = await fixture();
  const requests = await Promise.allSettled(Array.from({ length: 12 }, () => f.invoke('playground.run', { runtime: 'node', code: 'setInterval(() => {}, 1000)' })));
  const runs = requests.filter(result => result.status === 'fulfilled').map(result => result.value);
  assert.equal(runs.length, 8);
  for (const result of requests.filter(result => result.status === 'rejected')) assert.match(result.reason.message, /máximo 8/);
  await Promise.all(runs.map(run => f.invoke('playground.stop', { id: run.id })));
});

test('process-group cleanup stops background descendants on Stop and on normal exit', async () => {
  const f = await fixture();
  const markers = [path.join(f.root, 'stop-marker'), path.join(f.root, 'exit-marker')];
  for (const [index, marker] of markers.entries()) {
    const childSource = `setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'escaped'); }, 700)`;
    const code = `import {spawn} from 'node:child_process'; const child = spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], {stdio:'ignore'}); child.unref(); console.log('child-started'); ${index === 0 ? 'setInterval(() => {},1000)' : ''}`;
    const run = await f.invoke('playground.run', { runtime: 'node', code });
    if (index === 0) {
      await waitFor(f.invoke, 'playground', run.id, record => record.output.includes('child-started'));
      await f.invoke('playground.stop', { id: run.id });
    } else await waitFor(f.invoke, 'playground', run.id, record => record.status === 'completed' && !record.owned);
  }
  await new Promise(resolve => setTimeout(resolve, 850));
  for (const marker of markers) await assert.rejects(access(marker), /ENOENT/);
});

test('workspace membership, kind, IDs, cwd and appdata are enforced before execution', async () => {
  const f = await fixture();
  assert.deepEqual(await handleAutomation('unknown.method', {}, f.context), { handled: false });
  await assert.rejects(f.invoke('playground.list', { workspaceId: '../../tmp' }), /UUID/);
  await assert.rejects(f.invoke('playground.list', { workspaceId: randomUUID() }), /Workspace/);
  const run = await f.invoke('playground.run', { runtime: 'node', code: 'setInterval(() => {}, 1000)' });
  await assert.rejects(f.invoke('playground.stop', { workspaceId: f.workspaces[1].id, id: run.id }), /workspace/);
  await assert.rejects(f.invoke('automation.stop', { id: run.id }), /workspace/);
  await assert.rejects(f.invoke('playground.stop', { id: '../anything' }), /UUID/);
  await f.invoke('playground.stop', { id: run.id });
  await assert.rejects(f.invoke('playground.stop', { id: run.id }), /controlador propio/);
  await assert.rejects(handleAutomation('playground.list', { workspaceId: f.workspaces[0].id }, { ...f.context, dataDir: path.join(f.cwd, 'state') }), /fuera del workspace/);
  const alias = path.join(f.root, 'workspace-alias');
  await symlink(f.cwd, alias, 'dir');
  await assert.rejects(handleAutomation('playground.list', { workspaceId: f.workspaces[0].id }, { ...f.context, dataDir: path.join(alias, 'state') }), /fuera del workspace/);
  assert.deepEqual(await readdir(f.cwd), []);
  await assert.rejects(f.invoke('automation.start', { url: 'file:///etc/passwd' }), /http/);
  await assert.rejects(f.invoke('automation.start', { url: 'http://localhost', actions: [{ type: 'evaluate', value: '1' }] }), /no permitido/);
  f.workspaces[0].canonicalPath = path.join(f.root, 'deleted');
  await assert.rejects(f.invoke('playground.run', { runtime: 'node', code: 'console.log(1)' }), /ENOENT/);
});

test('cold recovery marks active descriptors lost and never trusts saved PIDs or artifact paths', async () => {
  const f = await fixture();
  const id = randomUUID();
  const dir = path.join(f.dataDir, 'automation', f.workspaces[0].id, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'run.json'), JSON.stringify({ id, workspaceId: f.workspaces[0].id, kind: 'playground', runtime: 'shell', status: 'running', pid: process.pid, code: 'touch NEVER', artifactDir: '/bad', createdAt: new Date().toISOString() }));
  const list = await f.invoke('playground.list');
  assert.equal(list.items[0].status, 'lost');
  assert.equal(list.items[0].owned, false);
  assert.equal(list.items[0].artifactDir, dir);
  assert.equal(list.items[0].pid, undefined);
  await assert.rejects(f.invoke('playground.stop', { id }), /controlador propio/);
  assert.deepEqual(await readdir(f.cwd), []);
  assert.equal(stateDirectory({ dataDir: f.dataDir }), f.dataDir);
});

test('voice intents are editable literal bilingual drafts and retain workspace identity', async () => {
  const f = await fixture();
  for (const [text, action, body] of [
    ['Crea una tarea: revisar PR', 'task', 'revisar PR'],
    ['Record a decision: ship it', 'decision', 'ship it'],
    ['Decisión: usar SQLite', 'decision', 'usar SQLite'],
    ['Abre https://example.com', 'open', 'https://example.com'],
    ['search for unit tests', 'search', 'unit tests'],
    ['tarea: $(touch /tmp/PWNED); rm -rf /', 'task', '$(touch /tmp/PWNED); rm -rf /'],
  ]) {
    const result = await f.invoke('voice.intent', { text });
    assert.equal(result.workspaceId, f.workspaces[0].id);
    assert.equal(result.action, action);
    assert.equal(result.text, body);
  }
  await assert.rejects(f.invoke('voice.intent', { text: '  ' }), /vacío/);
  await assert.rejects(f.invoke('voice.intent', { text: 'open' }), /contenido/);
  assert.deepEqual(await readdir(f.cwd), []);
});

test('voice validates base64/mime/size and executes local argv without shell expansion; temps removed', async () => {
  const f = await fixture({ voiceProvider: 'local' });
  const script = path.join(f.root, 'fake-whisper.mjs');
  await writeFile(script, 'import {writeFile} from "node:fs/promises"; import path from "node:path"; await writeFile(path.join(process.argv[3], "audio.txt"), "transcripción literal " + process.argv[4]);');
  f.context.state.settings.localWhisperCommand = JSON.stringify([process.execPath, script, '{input}', '{outputDir}', '$(touch NEVER)']);
  const audio = { audioBase64: Buffer.from('fixture wav bytes').toString('base64'), mimeType: 'audio/wav' };
  const result = await f.invoke('voice.transcribe', audio);
  assert.equal(result.text, 'transcripción literal $(touch NEVER)');
  assert.equal(result.provider, 'local');
  assert.equal(result.workspaceId, f.workspaces[0].id);
  assert.deepEqual(await readdir(path.join(f.dataDir, 'automation', f.workspaces[0].id)), []);
  for (const bad of ['!@#$', 'data:audio/wav;base64,YQ==', 'YQ=', 'YR==', '']) await assert.rejects(f.invoke('voice.transcribe', { ...audio, audioBase64: bad }), /Audio|audioBase64/);
  await assert.rejects(f.invoke('voice.transcribe', { ...audio, mimeType: 'text/html' }), /audio no admitido/);
  await assert.rejects(f.invoke('voice.transcribe', { ...audio, audioBase64: 'A'.repeat(14_000_000) }), /10 MiB/);
  f.context.state.settings.localWhisperCommand = 'whisper {input}; touch NEVER';
  await assert.rejects(f.invoke('voice.transcribe', audio), /array JSON/);
  f.context.state.settings.localWhisperCommand = JSON.stringify(['/definitely/missing/whisper', '{input}']);
  await assert.rejects(f.invoke('voice.transcribe', audio), /no disponible/);
  assert.deepEqual(await readdir(f.cwd), []);
});

test('OpenAI-compatible multipart is host-only, bounded, nonredirecting, and never uses the network in tests', async t => {
  const f = await fixture({ voiceProvider: 'openai', voiceBaseURL: 'https://asr.example.test/v1' });
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  t.after(() => { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; });
  const audio = { mimeType: 'audio/webm;codecs=opus', audioBase64: Buffer.from('fixture').toString('base64') };
  let count = 0;
  const mocked = t.mock.method(globalThis, 'fetch', async (url, options) => {
    count++;
    assert.equal(url.href, 'https://asr.example.test/v1/audio/transcriptions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-key');
    assert.equal(options.body.get('model'), 'whisper-1');
    assert.equal(options.body.get('file').type, 'audio/webm');
    return Response.json({ text: 'texto de fixture' });
  });
  const result = await f.invoke('voice.transcribe', audio);
  assert.equal(result.text, 'texto de fixture');
  assert.equal(result.provider, 'openai');
  assert.equal(count, 1);
  assert.ok(!JSON.stringify(f.events).includes('synthetic-test-key'));
  assert.ok(!JSON.stringify(f.events).includes('texto de fixture'));
  f.context.state.settings.voiceBaseURL = 'http://nonloopback.example/v1';
  await assert.rejects(f.invoke('voice.transcribe', audio), /HTTPS/);
  assert.equal(count, 1);
  f.context.state.settings.voiceBaseURL = 'https://asr.example.test/v1';
  mocked.mock.mockImplementation(async () => new Response('x'.repeat(140000)));
  await assert.rejects(f.invoke('voice.transcribe', audio), /demasiado grande/);
  mocked.mock.mockImplementation(async () => new Response('synthetic-test-key', { status: 401 }));
  await assert.rejects(f.invoke('voice.transcribe', audio), error => error.message.includes('401') && !error.message.includes('synthetic-test-key'));
});

test('real Playwright local fixture produces genuine screenshot/trace and owned loopback viewer', async t => {
  const { chromium } = await import('playwright');
  try { await access(chromium.executablePath()); } catch {
    const f = await fixture();
    await assert.rejects(f.invoke('automation.start', { mode: 'isolated', url: 'http://127.0.0.1', headed: false }), /Chromium.*no está descargado/);
    t.skip('Chromium executable absent: actionable failure verified; no downloads performed');
    return;
  }
  const f = await fixture();
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<input id="name"><button onclick="document.querySelector(\'h1\').textContent=document.querySelector(\'input\').value">Go</button><h1>fixture</h1>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const run = await f.invoke('automation.start', { mode: 'isolated', url, headed: false, actions: [{ type: 'fill', selector: '#name', value: 'real owned fixture' }, { type: 'click', selector: 'button' }, { type: 'screenshot' }] });
  const finished = await waitFor(f.invoke, 'automation', run.id, record => ['failed', 'completed'].includes(record.status) && !record.owned, 30_000);
  assert.equal(finished.status, 'completed', finished.error);
  assert.equal(finished.browserOpen, false);
  const png = await readFile(finished.screenshotPath);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const trace = await f.invoke('automation.trace', { id: run.id });
  const zip = await readFile(trace.path);
  assert.equal(zip.subarray(0, 2).toString(), 'PK');
  assert.ok(zip.length > 1000);
  // Canvas-only: show-trace must never reach the system browser via xdg-open.
  // Playwright skips xdg-open under coding agents, so clear those markers for a real check.
  const spyBin = path.join(f.root, 'spy-bin'), opened = path.join(f.root, 'xdg-open-called');
  await mkdir(spyBin);
  await writeFile(path.join(spyBin, 'xdg-open'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(opened)}\n`, { mode: 0o755 });
  const savedEnv = { PATH: process.env.PATH, CLAUDECODE: process.env.CLAUDECODE, COPILOT_CLI: process.env.COPILOT_CLI };
  process.env.PATH = `${spyBin}${path.delimiter}${process.env.PATH}`;
  delete process.env.CLAUDECODE; delete process.env.COPILOT_CLI;
  let viewer;
  try { viewer = await f.invoke('automation.trace', { id: run.id, openViewer: true }); }
  finally { for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  assert.match(viewer.url, /^http:\/\/127\.0\.0\.1:\d+\/?$/);
  assert.equal((await fetch(viewer.url)).status, 200);
  await new Promise(resolve => setTimeout(resolve, 750));
  await assert.rejects(access(opened), /ENOENT/, 'el visor de trace abrió el navegador del sistema');
  await f.invoke('automation.stop', { id: run.id });
  await assert.rejects(fetch(viewer.url));
  const waiting = await f.invoke('automation.start', { mode: 'isolated', url, headed: false, actions: [{ type: 'wait', milliseconds: 10_000 }] });
  await waitFor(f.invoke, 'automation', waiting.id, record => record.output.includes('Paso 1'), 30_000);
  const stopped = await f.invoke('automation.stop', { id: waiting.id });
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.browserOpen, false);
  await access((await f.invoke('automation.trace', { id: waiting.id })).path);
});

async function integratedFixture() {
  const f = await fixture();
  const calls = [];
  const sessionId = randomUUID(), panelId = randomUUID();
  const capturePath = path.join(f.root, 'bridge-capture.png');
  const captureBytes = Buffer.from('synthetic bridge transport capture');
  await writeFile(capturePath, captureBytes, { mode: 0o600 });
  f.context.browserClient = { invoke: async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'context') return { available: true, workspaceId: f.workspaces[0].id, sessionId };
    if (command === 'screenshot') return { id: panelId, path: capturePath };
    if (command === 'console') return { messages: [{ seq: 1, level: 'info', message: 'bridge console fixture' }] };
    return { id: panelId, ready: true, reused: true, visible: true };
  } };
  return { ...f, calls, sessionId, panelId, captureBytes };
}

test('default integrated route uses the injected bridge, same preview key and durable captures, never Chromium', async t => {
  const { chromium } = await import('playwright');
  t.mock.method(chromium, 'launch', () => { throw new Error('Unexpected isolated launch'); });
  const f = await integratedFixture();
  const url = 'http://127.0.0.1:4321/';
  const run = await f.invoke('automation.start', { url, actions: [
    { type: 'fill', selector: '#name', value: 'same session' }, { type: 'click', selector: 'button' },
    { type: 'goto', url: `${url}next` }, { type: 'wait', milliseconds: 0 }, { type: 'screenshot' },
  ] });
  const record = await waitFor(f.invoke, 'automation', run.id, r => r.status === 'completed' && !r.owned);
  assert.equal(record.mode, 'integrated');
  assert.equal(record.sessionId, f.sessionId);
  assert.equal(record.panelId, f.panelId);
  assert.equal(record.panelRetained, true);
  assert.equal(record.traceSupported, false);
  assert.equal(record.tracePath, undefined);
  assert.deepEqual(f.calls.map(call => call.command), ['context', 'preview', 'fill', 'click', 'open', 'screenshot', 'screenshot', 'console']);
  assert.ok(f.calls.slice(1).every(call => call.payload.key === 'preview'));
  assert.equal(f.calls[1].payload.url, url);
  assert.equal(f.calls[2].payload.value, 'same session');
  assert.deepEqual(await readFile(record.screenshotPath), f.captureBytes);
  assert.deepEqual(await readFile(path.join(record.artifactDir, 'step-5.png')), f.captureBytes);
  assert.match(record.output, /bridge console fixture/);
  await assert.rejects(f.invoke('automation.trace', { id: run.id, openViewer: true }), /no soporta trace.*isolated/);
  await assert.rejects(access(path.join(record.artifactDir, 'trace.zip')), /ENOENT/);
});

test('integrated stop drains pending RPC before acknowledgment and prevents subsequent actions', async () => {
  const f = await integratedFixture();
  const original = f.context.browserClient.invoke;
  let releaseRPC, entered;
  const pending = new Promise(resolve => { entered = resolve; });
  f.context.browserClient.invoke = async (command, payload) => {
    const result = await original(command, payload);
    if (command === 'fill') { entered(); await new Promise(resolve => { releaseRPC = resolve; }); }
    return result;
  };
  const run = await f.invoke('automation.start', { url: 'http://localhost:4321', actions: [
    { type: 'fill', selector: 'input', value: 'pending' }, { type: 'click', selector: 'button' },
  ] });
  await pending;
  await assert.rejects(f.invoke('automation.start', { url: 'http://localhost:4321' }), /automatización integrada activa/);
  let stopped = false;
  const stopping = f.invoke('automation.stop', { id: run.id }).then(result => { stopped = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(stopped, false);
  releaseRPC();
  const record = await stopping;
  assert.equal(record.status, 'stopped');
  assert.equal(record.owned, false);
  assert.equal(record.panelRetained, true);
  assert.ok(!f.calls.some(call => call.command === 'click' || call.command === 'screenshot'));
});

test('integrated keepOpen owns control until stop; timeouts and desktop errors remain truthful', async () => {
  const f = await integratedFixture();
  const run = await f.invoke('automation.start', { url: 'http://localhost:4321', keepOpen: true });
  const completed = await waitFor(f.invoke, 'automation', run.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.owned, true);
  assert.equal((await f.invoke('automation.stop', { id: run.id })).owned, false);
  const slow = await f.invoke('automation.start', { url: 'http://localhost:4321', timeoutMs: 100, actions: [{ type: 'wait', milliseconds: 10_000 }] });
  const timedOut = await waitFor(f.invoke, 'automation', slow.id);
  assert.equal(timedOut.status, 'failed');
  assert.equal(timedOut.owned, false);
  assert.match(timedOut.error, /Tiempo límite/);
  const disconnected = await integratedFixture();
  disconnected.context.browserClient.invoke = async () => { throw new Error('Ventana Electron no disponible'); };
  await assert.rejects(disconnected.invoke('automation.start', { url: 'http://localhost' }), /abre la ventana de Phantom/);
  assert.deepEqual((await disconnected.invoke('automation.list')).items, []);
  const absent = await fixture();
  await assert.rejects(absent.invoke('automation.start', { url: 'http://localhost' }), /terminal activa|terminal nueva/);
  await assert.rejects(absent.invoke('automation.start', { url: 'http://localhost', headed: false }), /isolated/);
  await assert.rejects(absent.invoke('automation.start', { url: 'http://localhost', mode: 'external' }), /integrated o isolated/);
  await assert.rejects(absent.invoke('automation.start', { url: 'http://localhost', mode: 'isolated', headed: true }), /Ventana externa de Chromium deshabilitada/);
});
