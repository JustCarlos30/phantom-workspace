import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, readFile, rename, stat, utimes, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { killElectronGroup } from './support/electron-process.mjs';
import {
  authorizedPath, browserNode, browserURL, clampBounds, contentSecurityPolicy, createReviewMedia,
  isHostTransportError, isLocalUIURL, isTrustedSender, isWithin, nativeUIBounds, validateCloseReady, validateInvocation, validateJSON,
} from '../desktop/security.mjs';

const workspaceId = 'e080ca45-0510-41c0-a861-c735db9ca2a5';
const id = '8955a666-b72a-410d-bf23-02740ac48212';
const ui = 'file:///opt/phantom/dist/index.html';

test('interface scale IPC is desktop-local, exact-shaped and strictly bounded', async () => {
  const { HOST_METHODS, LOCAL_METHODS } = await import('../desktop/security.mjs');
  for (const method of ['desktop.interfaceScale.get', 'desktop.interfaceScale.set']) {
    assert.equal(LOCAL_METHODS.has(method), true);
    assert.equal(HOST_METHODS.has(method), false);
  }
  assert.doesNotThrow(() => validateInvocation('desktop.interfaceScale.get', {}));
  for (const scale of [100, 115, 125, 150]) assert.doesNotThrow(() => validateInvocation('desktop.interfaceScale.set', { scale }));
  for (const payload of [{}, { scale: '115' }, { scale: 114 }, { scale: 151 }, { scale: 1.15 },
    { scale: null }, { scale: NaN }, { scale: Infinity }, { scale: [] }, { scale: true },
    { scale: 125, workspaceId }, { scale: 125, factor: 1.25 }, { scale: 125, path: '/tmp/other' }]) {
    assert.throws(() => validateInvocation('desktop.interfaceScale.set', payload));
  }
  assert.throws(() => validateInvocation('desktop.interfaceScale.get', { workspaceId }));
  assert.throws(() => validateInvocation('desktop.interfaceScale.get', { scale: 115 }));
  assert.throws(() => validateInvocation('desktop.interfaceScale.reset', {}));
});

test('review media requires a verified capability and supports only GET/HEAD and bounded ranges', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-review-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'projects/demo/exports');
  await mkdir(dir, { recursive: true });
  const bytes = Buffer.from('0123456789'), file = path.join(dir, 'render.mp4');
  await writeFile(file, bytes);
  const revision = 'a'.repeat(64);
  const pkg = { revision, origin: { kind: 'render', file: 'exports/render.mp4', revision, sha256: createHash('sha256').update(bytes).digest('hex') } };
  const media = createReviewMedia(), url = await media.issue(root, 'demo', pkg);
  assert.match(url, /^phantom-review:\/\/media\/[a-f0-9]{64}$/);
  const respond = (target = url, method = 'GET', range) => media.respond({ url: target, method, headers: new Headers(range ? { range } : {}) });
  const full = await respond();
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(full.headers.get('cache-control'), 'no-store');
  assert.equal(await full.text(), bytes.toString());
  const head = await respond(url, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  for (const [range, expected, contentRange] of [['bytes=2-4', '234', 'bytes 2-4/10'], ['bytes=7-', '789', 'bytes 7-9/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-100', '89', 'bytes 8-9/10']]) {
    const response = await respond(url, 'GET', range);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), contentRange);
    assert.equal(await response.text(), expected);
  }
  for (const range of ['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,4-5', 'invalid']) {
    const response = await respond(url, 'GET', range);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */10');
  }
  assert.equal((await respond(url, 'POST')).status, 405);
  for (const target of [`${url}/../secret.mp4`, `${url}?path=/etc/passwd`, `${url}/%2e%2e/file`, 'phantom-review://media/' + '0'.repeat(64), 'phantom-review://media/projects/demo/exports/render.mp4']) assert.equal((await respond(target)).status, 403);
  await assert.rejects(media.issue(root, '../demo', pkg));
  await assert.rejects(media.issue(root, 'demo', { ...pkg, origin: { ...pkg.origin, file: 'exports/../render.mp4' } }));
  await writeFile(file, 'changed');
  assert.equal((await respond()).status, 404);
  assert.equal((await respond()).status, 403, 'a changed render invalidates the token');
  await assert.rejects(media.issue(root, 'demo', pkg), /hash/);
  await writeFile(file, bytes);
  const symlinkURL = await media.issue(root, 'demo', pkg);
  await rm(file);
  const other = path.join(root, 'other.mp4');
  await writeFile(other, bytes);
  await symlink(other, file);
  assert.equal((await respond(symlinkURL)).status, 404);
  await assert.rejects(media.issue(root, 'demo', pkg), /Symlink/);
  await rm(file);
  await writeFile(file, bytes);
  const directoryURL = await media.issue(root, 'demo', pkg);
  await rm(dir, { recursive: true });
  const otherDir = path.join(root, 'other');
  await mkdir(otherDir); await writeFile(path.join(otherDir, 'render.mp4'), bytes);
  await symlink(otherDir, dir);
  assert.equal((await respond(directoryURL)).status, 404);
  await assert.rejects(media.issue(root, 'demo', pkg), /Symlink/);
  for (const method of ['review.projects', 'review.export', 'review.add', 'review.list', 'review.resolve']) assert.doesNotThrow(() => validateInvocation(method, {}));
  assert.match(contentSecurityPolicy(), /media-src[^;]*phantom-review:/);
});

test('review ranges reuse the verified identity and reject changed mtime or replacement inode', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-review-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'projects/demo/exports');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'render.mp4'), bytes = Buffer.from('0123456789');
  await writeFile(file, bytes);
  const probe = await open(file, 'r'), prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const createReadStream = prototype.createReadStream;
  let hashReads = 0;
  t.mock.method(prototype, 'createReadStream', function (options) {
    if (options?.autoClose === false) hashReads++;
    return createReadStream.call(this, options);
  });
  const revision = 'a'.repeat(64);
  const pkg = { revision, origin: { kind: 'render', file: 'exports/render.mp4', revision, sha256: createHash('sha256').update(bytes).digest('hex') } };
  const media = createReviewMedia(), url = await media.issue(root, 'demo', pkg);
  assert.equal(hashReads, 1, 'issuance hashes the render once');
  const respond = target => media.respond({ url: target, method: 'GET', headers: new Headers({ range: 'bytes=2-4' }) });
  for (let i = 0; i < 2; i++) {
    const response = await respond(url);
    assert.equal(response.status, 206);
    assert.equal(await response.text(), '234');
  }
  assert.equal(hashReads, 1, 'seeking never rehashes the MP4');
  const original = await stat(file);
  await writeFile(file, '9876543210');
  await utimes(file, original.atime, new Date(original.mtimeMs + 2000));
  assert.equal((await stat(file)).size, original.size);
  assert.equal((await respond(url)).status, 404, 'in-place changes invalidate the capability');
  assert.equal((await respond(url)).status, 403);

  await writeFile(file, bytes);
  const replacementURL = await media.issue(root, 'demo', pkg), before = await stat(file);
  const replacement = path.join(dir, 'replacement.mp4');
  await writeFile(replacement, bytes);
  assert.notEqual((await stat(replacement)).ino, before.ino);
  assert.equal((await stat(replacement)).size, before.size);
  await rename(replacement, file);
  assert.equal((await respond(replacementURL)).status, 404, 'even identical bytes at a different inode require a new token');
  assert.equal((await respond(replacementURL)).status, 403);
  assert.equal(hashReads, 2, 'only the two issuances hash the render');
});

test('desktop notifications accept bounded text and only the branches target', () => {
  for (const payload of [{ title: 'L' }, { title: 'Lista para integrar', body: '', target: 'branches' },
    { title: 't'.repeat(120), body: 'b'.repeat(300) }]) {
    assert.doesNotThrow(() => validateInvocation('desktop.notify', payload));
  }
  for (const payload of [null, [], {}, { title: '' }, { title: 1 }, { title: null },
    { title: 't'.repeat(121) }, { title: 'ok', body: 'b'.repeat(301) },
    { title: 'ok', body: null }, { title: 'ok', body: 1 }, { title: 'ok', body: [] },
    { title: 'ok', target: 'terminal' }, { title: 'ok', target: '' },
    { title: 'ok', target: null }, { title: 'ok', target: ['branches'] },
    { title: 'ok', silent: true }, { title: 'ok', body: undefined }, { title: 'ok', target: undefined }]) {
    assert.throws(() => validateInvocation('desktop.notify', payload));
  }
});

test('navigation accepts HTTP(S)/blank and rejects executable, local, credentialed and ambiguous URLs', () => {
  assert.equal(browserURL('https://example.com/a?q=1#ok'), 'https://example.com/a?q=1#ok');
  assert.equal(browserURL('http://localhost:3000'), 'http://localhost:3000/');
  assert.equal(browserURL('about:blank'), 'about:blank');
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'blob:https://example.com/id',
    'devtools://devtools', 'about:blank#x', '//example.com', 'https://user:secret@example.com', 'https:\n//example.com', ' https://example.com', '', null]) {
    assert.throws(() => browserURL(value), undefined, String(value));
  }
  assert.throws(() => browserURL('about:blank', { external: true }));
});

test('UI URL policy is exact-document, ignores only hash, and cannot be widened by lookalikes', () => {
  assert.equal(isLocalUIURL(`${ui}#panel`, ui), true);
  for (const url of ['file:///etc/passwd', `${ui}/child`, `${ui}?remote=1`, 'https://example.com/index.html', 'not a url']) {
    assert.equal(isLocalUIURL(url, ui), false);
  }
  const dev = 'http://127.0.0.1:5173/';
  assert.equal(isLocalUIURL(`${dev}#canvas`, dev), true);
  for (const url of ['http://127.0.0.1:5174/', 'http://127.0.0.1:5173/remote', 'http://127.0.0.1.evil:5173/', 'http://user@127.0.0.1:5173/']) {
    assert.equal(isLocalUIURL(url, dev), false);
  }
});

test('IPC requires the live UI webContents and exact main frame, not same-origin children or remote views', () => {
  const mainFrame = { url: ui, parent: null };
  const wc = { mainFrame, isDestroyed: () => false, getURL: () => ui };
  assert.equal(isTrustedSender({ sender: wc, senderFrame: mainFrame }, wc, ui), true);
  assert.equal(isTrustedSender({ sender: wc, senderFrame: { url: ui, parent: mainFrame } }, wc, ui), false);
  assert.equal(isTrustedSender({ sender: {}, senderFrame: mainFrame }, wc, ui), false);
  assert.equal(isTrustedSender({ sender: wc, senderFrame: null }, wc, ui), false);
  mainFrame.url = 'https://example.com';
  assert.equal(isTrustedSender({ sender: wc, senderFrame: mainFrame }, wc, ui), false);
  mainFrame.url = ui;
  wc.isDestroyed = () => true;
  assert.equal(isTrustedSender({ sender: wc, senderFrame: mainFrame }, wc, ui), false);
});

test('bounds are intersected with the content viewport, not just moved into it', () => {
  const viewport = { width: 1000, height: 700 };
  assert.deepEqual(clampBounds({ x: -50, y: -30, width: 300, height: 200 }, viewport), { x: 0, y: 0, width: 250, height: 170 });
  assert.deepEqual(clampBounds({ x: 900, y: 600, width: 500, height: 500 }, viewport), { x: 900, y: 600, width: 100, height: 100 });
  assert.deepEqual(clampBounds({ x: 1200, y: 800, width: 100, height: 100 }, viewport), { x: 1000, y: 700, width: 0, height: 0 });
  assert.deepEqual(clampBounds({ x: 1.2, y: 2.1, width: 3.7, height: 4.8 }, viewport), { x: 2, y: 3, width: 2, height: 3 });
  for (const bounds of [null, {}, { x: 0, y: 0, width: -1, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: Infinity, width: 1, height: 1 }]) {
    assert.throws(() => clampBounds(bounds, viewport));
  }
});

test('native view bounds include global UI zoom exactly once without coercing invalid coordinates', () => {
  const bounds = { x: 80, y: 40, width: 400, height: 240 };
  for (const factor of [1, 1.15, 1.25, 1.5]) {
    const native = nativeUIBounds(bounds, factor);
    for (const key of Object.keys(bounds)) assert.equal(native[key], bounds[key] * factor);
  }
  assert.deepEqual(bounds, { x: 80, y: 40, width: 400, height: 240 });
  for (const bad of [null, {}, { ...bounds, x: '80' }, { ...bounds, width: -1 }, { ...bounds, y: Infinity }]) assert.throws(() => nativeUIBounds(bad, 1.15));
  for (const factor of ['1.15', NaN, Infinity, .5, 1.51]) assert.throws(() => nativeUIBounds(bounds, factor));
});

test('native browser identity is checked against the current canonical state, type and active workspace', () => {
  const ws = { id: workspaceId, nodes: [{ id, type: 'browser' }] };
  const state = { activeWorkspaceId: workspaceId, workspaces: [ws] };
  assert.equal(browserNode(state, id, workspaceId), ws);
  assert.throws(() => browserNode({ ...state, activeWorkspaceId: null }, id, workspaceId));
  assert.throws(() => browserNode(state, workspaceId, workspaceId));
  assert.throws(() => browserNode(state, id, '../../workspace'));
  ws.nodes[0].type = 'terminal';
  assert.throws(() => browserNode(state, id, workspaceId));
});

test('RPC exposes only contract methods with bounded, finite plain JSON payloads', () => {
  assert.doesNotThrow(() => validateInvocation('limits.read', {}));
  for (const method of ['terminal.write', 'workspace.open', 'desktop.info', 'browser.capture', 'browser.inspect', 'voice.transcribe', 'host.shutdown']) {
    assert.doesNotThrow(() => validateInvocation(method, {}));
  }
  for (const method of ['shell.exec', 'fs.readFile', 'browser.executeJavaScript', 'desktop.spawn', '__proto__', null]) {
    assert.throws(() => validateInvocation(method, {}));
  }
  for (const payload of [null, [], { x: undefined }, { x: Infinity }, { x: 1n }, { x: new Date() }, JSON.parse('{"__proto__":{}}')]) {
    assert.throws(() => validateInvocation('state.get', payload));
  }
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => validateJSON(cyclic));
  assert.throws(() => validateJSON({ text: 'é'.repeat(100) }, 100));
  assert.throws(() => validateInvocation('terminal.write', { data: 'x'.repeat(1024 * 1024) }));
  assert.doesNotThrow(() => validateInvocation('voice.transcribe', { audioBase64: 'x'.repeat(2 * 1024 * 1024), mimeType: 'audio/webm' }));
  let deep = {}; for (let i = 0; i < 65; i++) deep = { deep };
  assert.throws(() => validateJSON(deep));
});

test('production CSP has no remote scripts, frames, eval or websockets; development HMR is exact-origin', () => {
  const production = contentSecurityPolicy();
  assert.match(production, /script-src 'self';/);
  assert.match(production, /frame-src 'none'/);
  assert.doesNotMatch(production, /unsafe-eval|ws:|wss:|https?:/);
  const dev = contentSecurityPolicy('http://127.0.0.1:5173/');
  assert.match(dev, /connect-src 'self' http:\/\/127\.0\.0\.1:5173 ws:\/\/127\.0\.0\.1:5173;/);
  assert.doesNotMatch(dev, /unsafe-eval|connect-src \*/);
});

test('close acknowledgements require a matching outstanding UUID and cannot authorize data loss', () => {
  assert.doesNotThrow(() => validateInvocation('desktop.closeReady', { requestId: id, discard: false }));
  assert.doesNotThrow(() => validateCloseReady({ requestId: id }, id));
  for (const payload of [{}, { requestId: 'anything' }, { requestId: id, discard: true },
    { requestId: id, discard: 'false' }, { requestId: id, stopHost: true }]) {
    assert.throws(() => validateInvocation('desktop.closeReady', payload));
  }
  assert.throws(() => validateCloseReady({ requestId: id }, workspaceId), /caducada/);
  assert.throws(() => validateCloseReady({ requestId: id }, null), /caducada/);
});

test('only transport errors mark a known host connection unavailable', () => {
  for (const error of [new Error('Host disconnected; request outcome unknown'), new Error('Host connection timed out'),
    new Error('Host startup failed: refused'), Object.assign(new Error('write failed'), { code: 'EPIPE' }),
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }), Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' })]) {
    assert.equal(isHostTransportError(error), true);
  }
  for (const error of [new Error('Host request timed out; outcome unknown'),
    new Error('Host no responde a state.get; la operación puede seguir en curso'),
    Object.assign(new Error('Host: request outcome unknown'), { code: 'HOST_REQUEST_TIMEOUT' }),
    new Error('Node not found'), new Error('Invalid socket path in workspace'),
    new Error('Unsupported workspace patch'), Object.assign(new Error('Not allowed'), { code: 'VALIDATION' })]) {
    assert.equal(isHostTransportError(error), false);
  }
});

test('path authorization uses real paths and component boundaries, rejecting traversal and escaping symlinks', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'phantom-desktop-security-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace');
  const neighbor = path.join(base, 'workspace-other');
  await mkdir(root); await mkdir(neighbor);
  const inside = path.join(root, 'note.md');
  const outside = path.join(neighbor, 'secret.txt');
  await writeFile(inside, 'note'); await writeFile(outside, 'secret');
  await symlink(outside, path.join(root, 'escape'));
  await symlink(root, path.join(base, 'alias'));
  assert.equal(await authorizedPath(inside, [root]), inside);
  assert.equal(await authorizedPath(path.join(base, 'alias', 'note.md'), [root]), inside);
  await assert.rejects(authorizedPath(path.join(root, 'escape'), [root]), /fuera/);
  await assert.rejects(authorizedPath(outside, [root]), /fuera/);
  await assert.rejects(authorizedPath(path.join(root, '..', 'workspace-other', 'secret.txt'), [root]), /fuera/);
  await assert.rejects(authorizedPath('note.md', [root]), /absoluta/);
  await assert.rejects(authorizedPath(inside, [path.join(base, 'missing')]));
  assert.equal(isWithin(neighbor, root), false);
});

// Opt-in API spike uses a fresh Electron process/window and private daemon, never the
// user's app or projects. The default suite above needs neither Electron nor DISPLAY.
test('isolated Electron API spike: bridge, native view, capture, isolation and late bounds', {
  skip: process.env.PHANTOM_DESKTOP_SPIKE !== '1', timeout: 60_000,
}, async t => {
  const { createServer } = await import('node:http');
  const { _electron } = await import('playwright');
  const base = await mkdtemp('/tmp/opencode/phantom-desktop-spike-');
  const project = path.join(base, 'project');
  await mkdir(project);
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(request.url === '/remote'
      ? '<!doctype html><title>Isolated remote fixture</title><body style="background:#345bd5;color:white">Native browser fixture</body>'
      : '<!doctype html><title>Desktop fixture</title><body>Isolated local bridge fixture</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let electron;
  t.after(async () => {
    if (electron) {
      const process = electron.process();
      const exited = process.exitCode !== null || process.signalCode !== null
        ? Promise.resolve() : new Promise(resolve => process.once('exit', resolve));
      const cleanupTimer = setTimeout(() => process.kill('SIGKILL'), 5000);
      try {
        const page = electron.windows()[0];
        if (!page) throw new Error('Fixture window already closed');
        await page.evaluate(() => window.phantom.onEvent(event => {
          if (event.type === 'desktop.beforeClose') window.phantom.invoke('desktop.closeReady', { requestId: event.requestId }).catch(() => {});
        }));
        await page.evaluate(async () => {
          const request = await window.phantom.invoke('desktop.quit', { stopHost: true });
          if (request.requestId) await window.phantom.invoke('desktop.closeReady', { requestId: request.requestId }).catch(() => {});
        }).catch(() => {});
      } catch { process.kill('SIGKILL'); }
      await exited;
      clearTimeout(cleanupTimer);
      killElectronGroup(process);
    }
    const { createConnection } = await import('node:net');
    await new Promise(resolve => {
      const socket = createConnection(path.join(base, 'state', 'host.sock'));
      const timer = setTimeout(() => { socket.destroy(); resolve(); }, 1000);
      socket.on('error', () => {});
      socket.once('connect', () => socket.write(`${JSON.stringify({ id: 'fixture-cleanup', method: 'host.shutdown', payload: {} })}\n`));
      socket.on('data', () => socket.end());
      socket.once('close', () => { clearTimeout(timer); resolve(); });
    });
    await new Promise(resolve => server.close(resolve));
    await rm(base, { recursive: true, force: true });
  });
  electron = await _electron.launch({
    args: [path.resolve(import.meta.dirname, '..'), '--ozone-platform=x11', '--use-fake-device-for-media-stream'],
    env: { ...process.env, DISPLAY: ':1', PHANTOM_WORKSPACE_HOME: path.join(base, 'state'), PHANTOM_RENDERER_URL: url },
    timeout: 15_000,
  });
  const page = await electron.firstWindow();
  await page.waitForFunction(() => Boolean(window.phantom));
  const call = (method, payload = {}) => page.evaluate(({ method, payload }) => window.phantom.invoke(method, payload), { method, payload });
  assert.deepEqual(await page.evaluate(() => ({ platform: window.phantom.platform, require: typeof require, process: typeof process })),
    { platform: 'Linux', require: 'undefined', process: 'undefined' });
  await electron.evaluate(({ dialog }) => {
    globalThis.phantomMicPrompts = 0;
    dialog.showMessageBox = async (_window, options) => {
      if (options.title === 'Micrófono para voz') globalThis.phantomMicPrompts++;
      return { response: 1 };
    };
  });
  const mic = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tracks = stream.getAudioTracks().length;
    stream.getTracks().forEach(track => track.stop());
    return tracks;
  });
  assert.equal(mic, 1);
  assert.equal(await electron.evaluate(() => globalThis.phantomMicPrompts), 1);
  assert.equal(await page.evaluate(async () => {
    try { const stream = await navigator.mediaDevices.getUserMedia({ video: true }); stream.getTracks().forEach(track => track.stop()); return 'allowed'; }
    catch { return 'denied'; }
  }), 'denied');
  const opened = await call('workspace.open', { path: project });
  const state = await call('state.get');
  const wsId = opened.id || state.activeWorkspaceId;
  const node = await call('node.create', { workspaceId: wsId, type: 'browser' });
  assert.ok(node.id);
  const bounds = { x: 30, y: 40, width: 600, height: 350 };
  assert.equal((await call('browser.attach', { id: node.id, workspaceId: wsId, url: `${url}remote`, bounds, visible: true })).attached, true);
  await electron.evaluate(async ({ webContents }) => {
    for (let attempt = 0; attempt < 250; attempt++) {
      const remote = webContents.getAllWebContents().find(wc => wc.getURL().endsWith('/remote'));
      if (remote && !remote.isLoading()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Native fixture did not load');
  });
  const remote = await electron.evaluate(async ({ webContents, BrowserWindow }) => {
    const wc = webContents.getAllWebContents().find(item => item.getURL().endsWith('/remote'));
    return {
      bridge: await wc.executeJavaScript('typeof window.phantom'),
      require: await wc.executeJavaScript('typeof require'),
      microphone: await wc.executeJavaScript(`navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {stream.getTracks().forEach(track => track.stop()); return 'allowed'}, () => 'denied')`),
      preferences: wc.getLastWebPreferences(),
      children: BrowserWindow.getAllWindows()[0].contentView.children.length,
      title: wc.getTitle(),
    };
  });
  assert.equal(remote.bridge, 'undefined');
  assert.equal(remote.require, 'undefined');
  assert.equal(remote.microphone, 'denied');
  assert.equal(await electron.evaluate(() => globalThis.phantomMicPrompts), 1);
  assert.equal(remote.preferences.sandbox, true);
  assert.equal(remote.preferences.contextIsolation, true);
  assert.equal(remote.preferences.nodeIntegration, false);
  assert.equal(remote.preferences.preload, undefined);
  assert.match(remote.title, /Isolated remote/);
  assert.equal(remote.children, 1);
  // did-finish-load precedes the first compositor frame on a fresh native view.
  await new Promise(resolve => setTimeout(resolve, 250));
  const capturePromise = call('browser.capture', { id: node.id });
  await call('browser.bounds', { id: node.id, visible: false });
  const capture = await capturePromise;
  assert.match(capture.dataUrl, /^data:image\/png;base64,/);
  assert.ok(capture.dataUrl.length > 200);
  assert.equal((await call('browser.bounds', { id: node.id, bounds, visible: true })).attached, false);
  assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.some(view => view.getVisible())), false);
  await assert.rejects(call('browser.navigate', { id: node.id, url: 'file:///etc/passwd' }));
  await assert.rejects(call('desktop.openPath', { path: '/etc/passwd' }));
  await assert.rejects(call('browser.executeJavaScript', { id: node.id, code: '1' }));

  // A missing renderer acknowledgement must reach a native choice, not discard.
  await electron.evaluate(({ dialog }) => {
    globalThis.phantomCloseChoices = [];
    dialog.showMessageBox = async (_window, options) => {
      globalThis.phantomCloseChoices.push(options);
      return { response: 0 }; // Explicit user choice: retry saving.
    };
  });
  await page.evaluate(() => {
    window.closeRequests = [];
    window.phantom.onEvent(event => { if (event.type === 'desktop.beforeClose') window.closeRequests.push(event.requestId); });
  });
  await assert.rejects(call('desktop.closeReady', { requestId: id }));
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.waitForFunction(() => window.closeRequests.length === 1);
  const firstRequest = await page.evaluate(() => window.closeRequests[0]);
  await assert.rejects(call('desktop.closeReady', { requestId: workspaceId }));
  assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isDestroyed()), false);
  await page.waitForFunction(() => window.closeRequests.length === 2, null, { timeout: 12_000 });
  const requestId = await page.evaluate(() => window.closeRequests[1]);
  assert.notEqual(requestId, firstRequest);
  await assert.rejects(call('desktop.closeReady', { requestId: firstRequest }));
  const choice = await electron.evaluate(() => globalThis.phantomCloseChoices[0]);
  assert.equal(choice.defaultId, 1);
  assert.equal(choice.cancelId, 1);
  assert.deepEqual(choice.buttons, ['Reintentar guardado', 'Cancelar cierre', 'Cerrar sin guardar']);
  await electron.evaluate(({ app }) => app.quit());
  assert.equal(await page.evaluate(() => window.closeRequests.length), 2); // Quit coalesces with the pending close.
  await call('node.update', { workspaceId: wsId, id: node.id, patch: { x: 321, y: 654, data: { note: 'drained before close' } } });
  const closed = page.waitForEvent('close');
  // The acknowledgement intentionally destroys this renderer. CDP may observe
  // that destruction before its evaluate result; the close event plus durable
  // disk/socket checks below are the outcome, not CDP scheduling order.
  try { assert.equal((await call('desktop.closeReady', { requestId, discard: false })).accepted, true); }
  catch (error) { assert.match(error.message, /Target page, context or browser has been closed/); }
  await closed;
  // Playwright's main-process inspector can hold the fixture process after quit.
  // The window has really closed; release only this isolated test process.
  let fixtureExit = new Promise(resolve => electron.process().once('exit', resolve));
  killElectronGroup(electron.process());
  await fixtureExit;
  electron = null;
  const saved = JSON.parse(await readFile(path.join(base, 'state', 'state.json'), 'utf8'));
  assert.equal(saved.workspaces.find(ws => ws.id === wsId).nodes.find(item => item.id === node.id).data.note, 'drained before close');
  // A normal close must leave the same daemon alive. Inspect the private socket,
  // without connectHost (which could accidentally spawn a replacement daemon).
  const { createConnection } = await import('node:net');
  const daemon = createConnection(path.join(base, 'state', 'host.sock'));
  await new Promise((resolve, reject) => { daemon.once('connect', resolve); daemon.once('error', reject); });
  daemon.destroy();

  // Reopen the UI and prove explicit host shutdown waits for a second UI drain.
  electron = await _electron.launch({
    args: [path.resolve(import.meta.dirname, '..'), '--ozone-platform=x11'],
    env: { ...process.env, DISPLAY: ':1', PHANTOM_WORKSPACE_HOME: path.join(base, 'state'), PHANTOM_RENDERER_URL: url },
  });
  const reopened = await electron.firstWindow();
  await reopened.waitForFunction(() => Boolean(window.phantom));
  await reopened.evaluate(() => {
    window.closeRequests = [];
    window.phantom.onEvent(event => { if (event.type === 'desktop.beforeClose') window.closeRequests.push(event.requestId); });
  });
  await reopened.evaluate(() => window.phantom.invoke('host.shutdown'));
  await reopened.waitForFunction(() => window.closeRequests.length === 1);
  assert.ok(await reopened.evaluate(() => window.phantom.invoke('state.get'))); // Host still live before ack.
  await reopened.evaluate(async ({ wsId, id }) => {
    await window.phantom.invoke('node.update', { workspaceId: wsId, id, patch: { data: { note: 'drained before host shutdown' } } });
  }, { wsId, id: node.id });
  const stopped = reopened.waitForEvent('close');
  try { await reopened.evaluate(() => window.phantom.invoke('desktop.closeReady', { requestId: window.closeRequests[0] })); }
  catch (error) { assert.match(error.message, /Target page, context or browser has been closed/); }
  await stopped;
  fixtureExit = new Promise(resolve => electron.process().once('exit', resolve));
  killElectronGroup(electron.process());
  await fixtureExit;
  electron = null;
  const stoppedState = JSON.parse(await readFile(path.join(base, 'state', 'state.json'), 'utf8'));
  assert.equal(stoppedState.workspaces.find(ws => ws.id === wsId).nodes.find(item => item.id === node.id).data.note, 'drained before host shutdown');
});

test('native Electron exits without an inspector only after the UI durable close acknowledgement', {
  skip: process.env.PHANTOM_DESKTOP_SPIKE !== '1', timeout: 30_000,
}, async t => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { createConnection } = await import('node:net');
  const { default: binary } = await import('electron');
  const base = await mkdtemp('/tmp/opencode/phantom-native-close-');
  const project = path.join(base, 'project');
  const stateDir = path.join(base, 'state');
  await mkdir(project);
  let child, release;
  let pendingResolve;
  const requests = [];
  const pending = new Promise(resolve => { pendingResolve = resolve; });
  const server = createServer(async (request, response) => {
    requests.push(request.url);
    if (request.url === '/drain') {
      release = () => response.end('save now');
      pendingResolve();
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><title>Native close fixture</title><script>
      (async () => {
        const api = window.phantom.invoke;
        const workspace = await api('workspace.open', {path:${JSON.stringify(project)}});
        const state = await api('state.get');
        const workspaceId = workspace.id || state.activeWorkspaceId;
        const note = await api('node.create', {workspaceId,type:'note',data:{text:'before drain'}});
        window.phantom.onEvent(async event => {
          if (event.type !== 'desktop.beforeClose') return;
          await fetch('/drain');
          await api('node.update', {workspaceId,id:note.id,patch:{x:222,y:333,data:{text:'native durable drain'}}});
          await api('desktop.closeReady', {requestId:event.requestId,discard:false});
        });
        window.close();
      })();
    </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    release?.();
    killElectronGroup(child);
    await new Promise(resolve => {
      const socket = createConnection(path.join(stateDir, 'host.sock'));
      const timer = setTimeout(() => { socket.destroy(); resolve(); }, 1000);
      socket.on('error', () => {});
      socket.once('connect', () => socket.write(`${JSON.stringify({ id: 'native-fixture-cleanup', method: 'host.shutdown', payload: {} })}\n`));
      socket.on('data', () => socket.end());
      socket.once('close', () => { clearTimeout(timer); resolve(); });
    });
    await new Promise(resolve => server.close(resolve));
    await rm(base, { recursive: true, force: true });
  });
  let stderr = '';
  child = spawn(binary, [path.resolve(import.meta.dirname, '..'), '--no-sandbox', '--ozone-platform=x11'], {
    env: { ...process.env, DISPLAY: ':1', PHANTOM_WORKSPACE_HOME: stateDir,
      PHANTOM_RENDERER_URL: `http://127.0.0.1:${server.address().port}/` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  await Promise.race([pending, exited.then(result => { throw new Error(`Fixture exited before drain ${JSON.stringify(result)} requests=${JSON.stringify(requests)}: ${stderr}`); })]);
  assert.equal(child.exitCode, null);
  const before = JSON.parse(await readFile(path.join(stateDir, 'state.json'), 'utf8'));
  assert.equal(before.workspaces[0].nodes[0].data.text, 'before drain');
  release();
  const result = await exited;
  assert.equal(result.code, 0, stderr);
  assert.equal(result.signal, null);
  const saved = JSON.parse(await readFile(path.join(stateDir, 'state.json'), 'utf8'));
  assert.equal(saved.workspaces[0].nodes[0].data.text, 'native durable drain');
  assert.equal(saved.workspaces[0].nodes[0].x, 222);
  // app.quit must not terminate the background daemon during a normal close.
  const daemon = createConnection(path.join(stateDir, 'host.sock'));
  await new Promise((resolve, reject) => { daemon.once('connect', resolve); daemon.once('error', reject); });
  daemon.destroy();
});
