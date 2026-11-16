import test from 'node:test';
import { killElectronGroup } from './support/electron-process.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';

test('failed phantom:invoke restores connection without further renderer requests', {
  skip: process.env.PHANTOM_DESKTOP_SPIKE !== '1', timeout: 30_000,
}, async t => {
  const { _electron } = await import('playwright');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-ipc-reconnect-'));
  const stateDir = path.join(root, 'state');
  await fs.mkdir(stateDir);
  const sockets = new Set();
  let app, connections = 0, writes = 0;
  const host = net.createServer(socket => {
    sockets.add(socket); connections++;
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write(JSON.stringify({ event: { type: 'connection', status: 'connected', generation: connections } }) + '\n');
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
        if (request.method === 'workspace.update') { writes++; socket.destroy(); return; }
        socket.write(JSON.stringify({ id: request.id, result: { workspaces: [] } }) + '\n');
      }
    });
  });
  const ui = http.createServer((_request, response) => response.end('<!doctype html><title>Connection fixture</title>'));
  t.after(async () => {
    if (app) {
      const child = app.process();
      const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve()
        : new Promise(resolve => child.once('exit', resolve));
      killElectronGroup(child); await exited;
    }
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(resolve => host.close(resolve)), new Promise(resolve => ui.close(resolve))]);
    await fs.rm(root, { recursive: true, force: true });
  });
  await new Promise(resolve => host.listen(path.join(stateDir, 'host.sock'), resolve));
  await new Promise(resolve => ui.listen(0, '127.0.0.1', resolve));
  app = await _electron.launch({
    executablePath: process.env.PHANTOM_TEST_EXECUTABLE || undefined,
    args: [...(process.env.PHANTOM_TEST_EXECUTABLE ? [] : [path.resolve(import.meta.dirname, '..')]), '--ozone-platform=x11'],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1', PHANTOM_WORKSPACE_HOME: stateDir,
      PHANTOM_RENDERER_URL: `http://127.0.0.1:${ui.address().port}/` },
  });
  const page = await app.firstWindow();
  await page.evaluate(async () => {
    window.connectionEvents = [];
    window.phantom.onEvent(event => window.connectionEvents.push(event));
    await window.phantom.invoke('state.get');
  });
  await assert.rejects(page.evaluate(() => window.phantom.invoke('workspace.update', {
    id: '8955a666-b72a-410d-bf23-02740ac48212', patch: { name: 'Recovery fixture' },
  })), /outcome unknown/);
  await page.waitForFunction(() => window.connectionEvents.some(event => event.status === 'connected' && event.generation === 2), { timeout: 5000 });
  assert.equal(connections, 2);
  assert.equal(writes, 1);
  assert.deepEqual(await page.evaluate(() => window.phantom.invoke('state.get')), { workspaces: [] });
});
