import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyUsage, parseUsage, readUsage, writeUsage, recordOpen, frequentTools, hideTool, setPaused, resetUsage, updateUsage, usagePersisted } from './tool-usage.mjs';

const memory = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v), m }; };
const open = (usage, type, times, start = 1) => { for (let i = 0; i < times; i++) usage = recordOpen(usage, type, { now: start + i }); return usage; };
const all = ['note', 'terminal', 'git', 'browser', 'repo'];

test('projects are isolated', () => {
  const s = memory();
  updateUsage(s, 'a', u => open(u, 'note', 2));
  assert.deepEqual(frequentTools(readUsage(s, 'a'), all), ['note']);
  assert.deepEqual(frequentTools(readUsage(s, 'b'), all), []);
});

test('threshold, ranking, ties and limit', () => {
  assert.deepEqual(frequentTools(open(emptyUsage(), 'note', 1), all), []);
  let u = open(emptyUsage(), 'note', 2, 10);
  u = open(u, 'terminal', 2, 20);
  u = open(u, 'git', 2, 20);
  u = open(u, 'browser', 3, 5);
  assert.deepEqual(frequentTools(u, all), ['browser', 'git', 'terminal']);
  assert.deepEqual(frequentTools(u, ['note', 'git']), ['git', 'note']);
  assert.deepEqual(frequentTools(u, ['terminal', 'git']).slice(), ['git', 'terminal']);
});

test('hide persists, pause stops learning, reset keeps pause', () => {
  const s = memory();
  updateUsage(s, 'a', u => open(u, 'note', 3));
  updateUsage(s, 'a', u => hideTool(u, 'note'));
  assert.deepEqual(frequentTools(readUsage(s, 'a'), all), []);
  assert.equal(readUsage(s, 'a').stats.dismissed, 1);
  updateUsage(s, 'a', u => setPaused(u, true));
  updateUsage(s, 'a', u => recordOpen(u, 'terminal'));
  assert.equal(readUsage(s, 'a').stats.total, 3);
  updateUsage(s, 'a', resetUsage);
  const after = readUsage(s, 'a');
  assert.equal(after.paused, true);
  assert.deepEqual([after.tools, after.hidden, after.stats], [{}, [], { total: 0, fromFrequent: 0, dismissed: 0 }]);
  assert.equal(recordOpen(setPaused(emptyUsage(), false), 'x').stats.total, 1);
});

test('corrupt and denied storage never throw', () => {
  for (const raw of ['{', 'null', '[]', '{"v":9}', '{"v":1,"tools":{"a":{"count":-4}},"hidden":[1]}']) assert.deepEqual(parseUsage(raw), emptyUsage());
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(readUsage(denied, 'a'), emptyUsage());
  assert.equal(writeUsage(denied, 'a', emptyUsage()), false);
  assert.equal(updateUsage(denied, 'a', u => open(u, 'note', 1)).persisted, false);
  assert.equal(updateUsage(null, 'a', u => u).persisted, false);
});

const sessionDenied = () => ({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
const sessionStale = () => ({ getItem: () => null, setItem() { throw new Error('full'); } });

for (const [name, make] of [['null', () => null], ['denied', sessionDenied], ['stale get after failed set', sessionStale]]) {
  test(`session fallback (${name}): pause survives open and reset`, () => {
    const s = make();
    assert.equal(usagePersisted(s, 'p'), name === 'stale get after failed set');
    updateUsage(s, 'p', u => setPaused(u, true));
    updateUsage(s, 'p', u => recordOpen(u, 'note'));
    const r = updateUsage(s, 'p', resetUsage);
    assert.equal(r.persisted, false);
    assert.equal(readUsage(s, 'p').paused, true);
    assert.equal(usagePersisted(s, 'p'), false);
  });

  test(`session fallback (${name}): two hidden tools kept, projects isolated`, () => {
    const s = make();
    updateUsage(s, 'a', u => hideTool(u, 'git'));
    updateUsage(s, 'a', u => hideTool(u, 'note'));
    assert.deepEqual(readUsage(s, 'a').hidden, ['git', 'note']);
    assert.deepEqual(readUsage(s, 'b').hidden, []);
  });
}

test('working storages do not leak into each other', () => {
  const mk = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const one = mk(), two = mk();
  updateUsage(one, 'p', u => hideTool(u, 'git'));
  assert.deepEqual(readUsage(two, 'p').hidden, []);
  assert.deepEqual(readUsage(one, 'p').hidden, ['git']);
  assert.equal(usagePersisted(one, 'p'), true);
});

test('counters only grow on recorded successes, tracking frequent source', () => {
  let u = recordOpen(emptyUsage(), 'note');
  u = recordOpen(u, 'note', { fromFrequent: true });
  assert.deepEqual(u.stats, { total: 2, fromFrequent: 1, dismissed: 0 });
  assert.equal(u.tools.note.count, 2);
});
