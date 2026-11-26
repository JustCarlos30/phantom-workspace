import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prunePhantomControllers } from '../integrations/phantom.mjs';
import { Store } from '../host/store.mjs';

const dir = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-output-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const run = (i, extra = {}) => ({ id: `run-${i}`, status: 'completed', createdAt: new Date(1700000000000 + i * 1000).toISOString(), output: 'a'.repeat(10000) + `end${i}`, ...extra });

test('finished output goes to a private file and only the tail stays inline', t => {
  const data = dir(t), item = run(1), running = { id: 'live-run', status: 'running', output: 'z'.repeat(9000) };
  const full = item.output, workspace = { phantomControllers: [item, running] };
  assert.equal(prunePhantomControllers(workspace, new Map(), data), true);
  const file = path.join(data, 'controller-output', 'run-1.log');
  assert.equal(item.outputFile, 'controller-output/run-1.log');
  assert.equal(item.output, full.slice(-4096)); assert.equal(item.truncated, true);
  assert.equal(fs.readFileSync(file, 'utf8'), full);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600); assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(running.output.length, 9000); assert.equal(running.outputFile, undefined);
  assert.equal(prunePhantomControllers(workspace, new Map(), data), false);
  assert.equal(fs.readFileSync(file, 'utf8'), full, 'second pass does not overwrite the full log with the tail');
});

test('retired runs lose their output file and unsafe ids never touch the filesystem', t => {
  const data = dir(t), items = Array.from({ length: 10 }, (_, i) => run(i));
  const workspace = { phantomControllers: items };
  prunePhantomControllers(workspace, new Map(), data);
  assert.equal(workspace.phantomControllers.length, 8);
  const logs = fs.readdirSync(path.join(data, 'controller-output')).sort();
  assert.equal(logs.length, 8); assert.ok(!logs.includes('run-0.log') && !logs.includes('run-1.log'));
  // Retired item with a file: run-2 becomes the oldest once 8 newer runs exist.
  workspace.phantomControllers.push(run(30), run(31));
  prunePhantomControllers(workspace, new Map(), data);
  assert.equal(fs.readdirSync(path.join(data, 'controller-output')).length, 8);
  assert.ok(!fs.existsSync(path.join(data, 'controller-output', 'run-2.log')));

  const evil = { phantomControllers: [{ ...run(1), id: '../escape' }] };
  prunePhantomControllers(evil, new Map(), data);
  assert.equal(evil.phantomControllers[0].outputFile, undefined);
  assert.equal(evil.phantomControllers[0].output.length, 4096);
  assert.ok(!fs.existsSync(path.join(data, 'escape.log')));
});

test('Store migrates oversized output on load', t => {
  const data = dir(t);
  const store = new Store(data);
  store.state.workspaces.push({ id: '11111111-1111-4111-8111-111111111111', name: 'p', path: data, canonicalPath: data, camera: { x: 0, y: 0, zoom: 1 }, nodes: [], tasks: [], contextRefs: [], missions: [], workflows: [], services: [], attention: [], phantomControllers: [run(1)] });
  store.persist(); store.flush(); store.close();
  const reloaded = new Store(data); reloaded.close();
  const item = reloaded.state.workspaces[0].phantomControllers[0];
  assert.equal(item.outputFile, 'controller-output/run-1.log');
  assert.equal(item.output.length, 4096);
  assert.ok(fs.readFileSync(path.join(data, item.outputFile), 'utf8').length > 10000);
});
