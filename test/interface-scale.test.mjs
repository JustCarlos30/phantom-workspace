import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterfaceScaleModel, DEFAULT_INTERFACE_SCALE, INTERFACE_SCALES, validateInterfaceScale } from '../src/hooks/interfaceScale.js';

test('interface scale accepts only the four numeric choices and defaults to 115%', () => {
  assert.equal(DEFAULT_INTERFACE_SCALE, 115);
  for (const scale of INTERFACE_SCALES) assert.equal(validateInterfaceScale(scale), scale);
  for (const scale of [undefined, null, false, true, '115', '125%', {}, [], NaN, Infinity, -Infinity, 0, 99, 110, 114.9, 151, 1000]) {
    assert.throws(() => validateInterfaceScale(scale), /Escala no válida/);
  }
});

test('local scale survives a new model instance without any workspace key', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phantom-scale-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'interface-scale.json'), applied = [];
  const storage = {
    read: async () => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    write: value => writeFile(file, JSON.stringify(value)),
    apply: factor => { applied.push(factor); },
  };
  const model = createInterfaceScaleModel(storage);
  assert.deepEqual(await model.load(), { scale: 115, error: '' });
  for (const scale of INTERFACE_SCALES) {
    assert.deepEqual(await model.set(scale), { scale, error: '' });
    const restarted = createInterfaceScaleModel(storage);
    assert.deepEqual(await restarted.load(), { scale, error: '' });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { scale });
  }
  assert.deepEqual(applied, [1, 1.15, 1.25, 1.5]);
  await writeFile(file, '{broken');
  const recovered = createInterfaceScaleModel(storage);
  assert.equal((await recovered.load()).scale, 115);
  assert.match((await recovered.get()).error, /No se pudo leer/);
  assert.equal(await readFile(file, 'utf8'), '{broken', 'reading never overwrites corrupt preferences');
  assert.equal((await recovered.set(125)).error, '');
});

test('invalid saved choices recover to default; invalid mutations never apply or write', async () => {
  for (const saved of [{}, [], '115', { scale: '125' }, { scale: 116 }, { scale: Infinity }]) {
    let writes = 0, applies = 0;
    const model = createInterfaceScaleModel({ read: async () => saved, write: () => { writes++; }, apply: () => { applies++; } });
    assert.equal((await model.load()).scale, 115);
    assert.match((await model.get()).error, /No se pudo leer/);
    await assert.rejects(model.set(116), /Escala no válida/);
    assert.equal(writes, 0);
    assert.equal(applies, 0);
    assert.equal((await model.get()).scale, 115);
  }
});

test('write and native zoom failures preserve the previous choice and allow retry', async () => {
  let failWrite = false, failApply = false, saved = { scale: 125 };
  const applied = [];
  const model = createInterfaceScaleModel({
    read: () => saved,
    write: value => { if (failWrite) throw new Error('disk full'); saved = value; },
    apply: factor => { applied.push(factor); if (failApply && factor === 1.5) throw new Error('zoom failed'); },
  });
  await model.load();
  failWrite = true;
  await assert.rejects(model.set(150), /Se conserva la escala anterior/);
  assert.deepEqual(applied, [1.5, 1.25]);
  assert.equal(saved.scale, 125);
  assert.equal((await model.get()).scale, 125);
  failWrite = false; failApply = true;
  await assert.rejects(model.set(150), /Se conserva la escala anterior/);
  assert.equal(saved.scale, 125);
  failApply = false;
  assert.equal((await model.set(150)).scale, 150);
  assert.equal(saved.scale, 150);
});

test('concurrent scale changes serialize native application and persistence', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const events = [];
  const model = createInterfaceScaleModel({
    read: () => null,
    apply: factor => { events.push(['apply', factor]); },
    write: async value => { if (value.scale === 125) await gate; events.push(['save', value.scale]); },
  });
  await model.load();
  const first = model.set(125), second = model.set(150), latest = model.get();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [['apply', 1.25]]);
  release();
  assert.equal((await first).scale, 125);
  assert.equal((await second).scale, 150);
  assert.equal((await latest).scale, 150);
  assert.deepEqual(events, [['apply', 1.25], ['save', 125], ['apply', 1.5], ['save', 150]]);
});
