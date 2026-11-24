import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, validateState } from '../host/store.mjs';
import { sortProjects, validateUsage } from '../shared/project-usage.mjs';

const p = (id, name, count, at, extra = {}) => ({ id, name, path: `/x/${name}`, ...(count === undefined ? {} : { usage: { count, lastAccessAt: at } }), ...extra });
const ids = list => list.map(w => w.id);

test('orden: activo primero, frecuencia, reciente, desempate determinista; no muta la entrada', () => {
  const list = [p('d', 'd', 1, '2026-01-01T00:00:00Z'), p('c', 'c', 5, '2026-01-01T00:00:00Z'), p('b', 'b', 5, '2026-02-01T00:00:00Z'), p('a', 'a'), p('e', 'a')];
  const copy = structuredClone(list);
  assert.deepEqual(ids(sortProjects(list, null)), ['b', 'c', 'd', 'a', 'e']);
  assert.deepEqual(ids(sortProjects(list, 'a')), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(list, copy);
});

test('legado sin metadatos es válido y no inventa uso; metadatos inválidos se rechazan', () => {
  assert.equal(validateUsage(undefined), undefined);
  for (const bad of [null, [], { count: -1, lastAccessAt: '2026-01-01' }, { count: 1.5, lastAccessAt: '2026-01-01' }, { count: 1, lastAccessAt: 'x' }, { count: 1 }]) assert.throws(() => validateUsage(bad));
});

test('selección cuenta cambios reales, ignora repetida y persiste entre reinicios', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-usage-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'a'), b = path.join(root, 'b'); fs.mkdirSync(a); fs.mkdirSync(b);
  const store = new Store(path.join(root, 'state'));
  const wa = store.transaction(() => store.open(a));
  store.transaction(() => store.open(a)); store.transaction(() => store.activate(store.getWorkspace(wa.id)));
  assert.equal(wa.usage?.count ?? store.getWorkspace(wa.id).usage.count, 1);
  const wb = store.transaction(() => store.open(b));
  store.transaction(() => store.activate(store.getWorkspace(wa.id)));
  store.flush();
  const restored = new Store(store.dir);
  assert.deepEqual(restored.state.workspaces.map(w => w.usage.count), [2, 1]);
  assert.ok(Date.parse(restored.getWorkspace(wa.id).usage.lastAccessAt));
  assert.equal(restored.getWorkspace(wb.id).usage.count, 1);
  const legacy = structuredClone(restored.state); delete legacy.workspaces[0].usage;
  assert.equal(validateState(legacy).workspaces[0].usage, undefined);
  legacy.workspaces[0].usage = { count: -1, lastAccessAt: 'x' };
  assert.throws(() => validateState(legacy));
});
