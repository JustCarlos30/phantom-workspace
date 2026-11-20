// Performance contract for the host state (Fase 1 de rendimiento).
// The persisted state must stay light under a demanding load, and frequent
// mutations must not rewrite state.json once per change.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../host/store.mjs';

const INLINE_OUTPUT = 4096;

function heavyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-perf-'));
  const dir = path.join(root, 'data');
  const store = new Store(dir);
  const outputs = new Map();
  for (let p = 0; p < 5; p++) {
    const folder = path.join(root, `project-${p}`); fs.mkdirSync(folder);
    const w = store.open(folder);
    for (let i = 0; i < 170; i++) w.nodes.push({ id: randomUUID(), type: 'note', title: `Nota ${i}`, x: i * 10, y: p * 10, width: 400, height: 300, data: { text: 'n'.repeat(64) } });
    w.phantomControllers = Array.from({ length: 20 }, (_, i) => {
      const id = randomUUID(), output = `${id}:` + 'o'.repeat(18 * 1024) + `:end-${i}`;
      outputs.set(id, output);
      return { id, taskId: `task_${i}`, workspaceId: w.id, backend: 'phantom', action: 'run', status: 'completed', createdAt: new Date(1700000000000 + i * 1000).toISOString(), endedAt: new Date(1700000001000 + i * 1000).toISOString(), output, exitCode: 0 };
    });
  }
  store.persist(); store.flush();
  return { root, dir, store, outputs };
}

test('finished controller output leaves state.json and stays readable on disk', () => {
  const { dir, outputs } = heavyFixture();
  const store = new Store(dir); store.flush();
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const controllers = persisted.workspaces.flatMap(w => w.phantomControllers || []);
  assert.ok(controllers.length > 0);
  for (const c of controllers) {
    assert.ok(typeof c.output === 'string' && c.output.length <= INLINE_OUTPUT, `inline output ${c.output?.length} > ${INLINE_OUTPUT}`);
    const full = outputs.get(c.id);
    assert.ok(full.endsWith(c.output), 'inline output keeps the tail');
    assert.equal(typeof c.outputFile, 'string');
    const file = path.isAbsolute(c.outputFile) ? c.outputFile : path.join(dir, c.outputFile);
    assert.ok(path.resolve(file).startsWith(path.resolve(dir) + path.sep), 'output file lives inside the data dir');
    assert.equal(fs.readFileSync(file, 'utf8'), full, 'full output preserved on disk');
    assert.equal(fs.statSync(file).mode & 0o077, 0, 'output file is private');
  }
  const bytes = fs.statSync(path.join(dir, 'state.json')).size;
  assert.ok(bytes < 900 * 1024, `state.json is ${bytes} bytes for 5 projects × 170 nodes × 20 runs`);
});

test('burst of mutations is coalesced into few state.json writes and flush is durable', async () => {
  const { dir } = heavyFixture();
  const store = new Store(dir); store.flush();
  const file = path.join(dir, 'state.json');
  let writes = 0;
  const watcher = fs.watch(dir, (event, name) => { if (name === 'state.json' && event === 'rename') writes++; });
  const node = store.state.workspaces[0].nodes[0];
  const started = performance.now();
  for (let i = 0; i < 100; i++) store.transaction(() => { node.x = i; });
  const elapsed = performance.now() - started;
  await new Promise(resolve => setTimeout(resolve, 400));
  watcher.close();
  assert.ok(writes <= 5, `100 mutations caused ${writes} state.json replacements`);
  assert.ok(elapsed < 400, `100 transactions took ${elapsed.toFixed(1)} ms`);
  assert.equal(new Store(dir).state.workspaces[0].nodes[0].x, 99, 'coalesced write persisted the last state');
  store.transaction(() => { node.x = 1234; }); store.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).workspaces[0].nodes[0].x, 1234, 'flush writes synchronously');
});

test('failed transaction still rolls back without persisting', () => {
  const { dir } = heavyFixture();
  const store = new Store(dir); store.flush();
  const before = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
  assert.throws(() => store.transaction(() => { store.state.workspaces[0].nodes[0].width = -1; }));
  assert.equal(store.state.workspaces[0].nodes[0].width, 400);
  store.flush();
  assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), before);
});
