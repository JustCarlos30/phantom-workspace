import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveQueue } from './saveQueue.js';
import { createCloseHandler } from './closeProtocol.js';
import { createTerminalStream } from './terminalStream.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const add = (queue, x) => queue.enqueue('w:n', 'node.update', { workspaceId: 'w', id: 'n' }, { x });

test('all flush waiters await the active drain and edits arriving during final refresh', async () => {
  const writes = [], firstWrite = deferred(), firstRead = deferred(), finalRead = deferred();
  let reads = 0, finished = false;
  const q = createSaveQueue({ invoke: async (_, p) => { writes.push(p.patch); if (writes.length === 1) await firstWrite.promise; }, refresh: () => ++reads === 1 ? firstRead.promise : finalRead.promise });
  add(q, 1);
  const a = q.flush(), b = q.flush(); assert.equal(a, b);
  b.then(() => { finished = true; });
  await turn(); add(q, 2); firstWrite.resolve(); await turn();
  assert.deepEqual(writes, [{ x: 1 }, { x: 2 }]);
  assert.equal(finished, false);
  add(q, 3); firstRead.resolve(); await turn();
  assert.deepEqual(writes, [{ x: 1 }, { x: 2 }, { x: 3 }]);
  assert.equal(finished, false); assert.equal(q.entries.get('w:n').patch.x, 3);
  finalRead.resolve(); await Promise.all([a, b]);
  assert.equal(finished, true); assert.equal(q.entries.size, 0);
});

test('save failures reject callers and survive unrelated reads until explicit retry succeeds', async () => {
  let reject = true, saved = 0, failures = 0;
  const refresh = async () => ({});
  const q = createSaveQueue({ invoke: async () => { if (reject) throw new Error('Invalid geometry'); }, refresh, onSaved: () => saved++, onError: () => failures++ });
  add(q, 10);
  await assert.rejects(q.flush(), /Invalid geometry/);
  await refresh();
  assert.equal(saved, 0); assert.equal(failures, 1); assert.equal(q.entries.size, 1);
  reject = false; await q.flush(); assert.equal(saved, 1); assert.equal(q.entries.size, 0);
});

test('a failed read retains acknowledged geometry without replaying its mutation', async () => {
  let reads = 0, writes = 0;
  const q = createSaveQueue({ invoke: async () => { writes++; }, refresh: async () => { if (++reads === 1) throw new Error('Transport closed'); } });
  add(q, 12); await assert.rejects(q.flush(), /Transport closed/);
  assert.equal(q.entries.get('w:n').patch.x, 12);
  await q.flush(); assert.equal(writes, 1); assert.equal(q.entries.size, 0);
});

test('controlled close never acknowledges a failed save and supports retry without implicit discard', async () => {
  let failure = true; const calls = [], statuses = [];
  const close = createCloseHandler({ flush: async () => { if (failure) throw new Error('Disk full'); }, invoke: async (method, payload) => calls.push([method, payload]), onStatus: value => statuses.push(value), onError: () => {} });
  assert.equal(await close('close-1'), false); assert.deepEqual(calls, []);
  assert.equal(statuses.at(-1).status, 'failed');
  failure = false; assert.equal(await close('close-1'), true);
  assert.deepEqual(calls, [['desktop.closeReady', { requestId: 'close-1', discard: false }]]);
});

test('controlled close deduplicates a request and acknowledges only after the full save drain', async () => {
  const write = deferred(), read = deferred(), calls = [];
  const q = createSaveQueue({ invoke: () => write.promise, refresh: () => read.promise }); add(q, 5); q.flush();
  const close = createCloseHandler({ flush: () => q.flush(), invoke: async (...args) => calls.push(args), onStatus: () => {}, onError: () => {} });
  const a = close('request'), b = close('request'); assert.equal(a, b);
  await turn(); assert.equal(calls.length, 0); write.resolve(); await turn(); assert.equal(calls.length, 0);
  read.resolve(); assert.equal(await a, true); assert.equal(calls.length, 1);
});

test('desktop cancellation releases close UI and never sends a late acknowledgement', async () => {
  const drain = deferred(), statuses = [], calls = [];
  const close = createCloseHandler({ flush: () => drain.promise, invoke: async (...args) => calls.push(args), onStatus: value => statuses.push(value), onError: () => {} });
  const pending = close('cancelled'); close.cancel('cancelled');
  assert.equal(statuses.at(-1), null); drain.resolve();
  assert.equal(await pending, false); assert.deepEqual(calls, []);
});

function terminalFixture(options = {}) {
  let listener;
  const calls = [], statuses = [], errors = [], snapshots = [], output = [];
  const emit = event => listener?.(event);
  const stream = createTerminalStream({ sessionId: 'session',
    subscribe: callback => { listener = callback; return () => { listener = null; }; },
    invoke: async (method, payload) => { calls.push([method, payload]); return options.attach ? options.attach(emit) : { session: { status: 'running' }, data: 'snapshot', seq: 0 }; },
    snapshot: async (text, current) => { if (options.snapshot) await options.snapshot(text, current); if (current()) snapshots.push(text); },
    output: text => { output.push(text); return options.output?.(text); },
    onStatus: status => statuses.push(status), onError: message => errors.push(message), maxBytes: options.maxBytes, connected: options.connected,
  });
  return { stream, emit, calls, statuses, errors, snapshots, output };
}
const event = (seq, data) => ({ type: 'terminal.output', sessionId: 'session', seq, data });

test('a terminal mounted offline waits for restored connection before attaching', async () => {
  const f = terminalFixture({ connected: false }); await f.stream.start();
  assert.equal(f.calls.length, 0); assert.equal(f.statuses.at(-1), 'disconnected');
  f.emit({ type: 'connection', status: 'connected' }); await turn();
  assert.equal(f.calls.length, 1); assert.equal(f.stream.canWrite(), true); f.stream.dispose();
});

test('terminal subscribes before attach and merges snapshot/live output without duplicates', async () => {
  const applying = deferred();
  const f = terminalFixture({ attach: emit => { emit(event(1, 'in snapshot')); emit(event(2, 'after snapshot')); return { session: { status: 'running' }, data: 'snapshot 1', seq: 1 }; }, snapshot: () => applying.promise });
  const attaching = f.stream.start(); await turn();
  f.emit(event(2, 'duplicate')); f.emit(event(3, 'during xterm drain'));
  assert.equal(f.stream.canWrite(), false); assert.deepEqual(f.output, []);
  applying.resolve(); await attaching;
  assert.deepEqual(f.snapshots, ['snapshot 1']); assert.deepEqual(f.output, ['after snapshot', 'during xterm drain']);
  assert.equal(f.stream.canWrite(), true); f.stream.dispose();
});

test('terminal ignores an old attach after disconnect and reattaches only on restored transport', async () => {
  const first = deferred(), restored = deferred(); let count = 0;
  const f = terminalFixture({ attach: () => ++count === 1 ? first.promise : restored.promise });
  const initial = f.stream.start();
  f.emit({ type: 'connection', status: 'disconnected' });
  assert.equal(f.stream.canWrite(), false); assert.equal(f.statuses.at(-1), 'disconnected');
  f.emit({ type: 'connection', status: 'error', message: 'Host offline' });
  first.resolve({ session: { status: 'running' }, data: 'stale', seq: 0 }); await initial;
  assert.deepEqual(f.snapshots, []); assert.equal(f.calls.length, 1);
  f.emit({ type: 'connection', status: 'connected' }); await turn();
  f.emit(event(6, 'new tail'));
  restored.resolve({ session: { status: 'running' }, data: 'restored', seq: 5 }); await turn();
  assert.deepEqual(f.snapshots, ['restored']); assert.deepEqual(f.output, ['new tail']);
  assert.equal(f.stream.canWrite(), true);
  assert.ok(f.calls.every(([method]) => method === 'terminal.attach')); f.stream.dispose();
});

test('terminal exit during snapshot application cannot be overwritten by stale running status', async () => {
  const applying = deferred(); const f = terminalFixture({ snapshot: () => applying.promise });
  const pending = f.stream.start(); await turn(); f.emit({ type: 'terminal.exit', sessionId: 'session', exitCode: 0 });
  applying.resolve(); await pending;
  assert.equal(f.statuses.at(-1), 'exited'); assert.equal(f.stream.canWrite(), false); f.stream.dispose();
});

test('terminal detects sequence loss, bounds pending output and requires a snapshot retry', async () => {
  const parsed = deferred(); const f = terminalFixture({ maxBytes: 8, output: () => parsed.promise }); await f.stream.start();
  f.emit(event(2, 'gap')); assert.equal(f.statuses.at(-1), 'lost'); assert.equal(f.stream.canWrite(), false); assert.deepEqual(f.output, []);
  await f.stream.retry(); f.emit(event(1, '12345')); f.emit(event(2, '67890'));
  assert.equal(f.statuses.at(-1), 'lost'); assert.deepEqual(f.output, ['12345']);
  f.emit(event(3, 'ignored')); assert.deepEqual(f.output, ['12345']);
  parsed.resolve(); await f.stream.retry(); assert.equal(f.stream.canWrite(), true); f.stream.dispose();
});

test('terminal bounds its attach buffer and ignores responses after disposal', async () => {
  const response = deferred(); const f = terminalFixture({ maxBytes: 4, attach: () => response.promise });
  const pending = f.stream.start(); f.emit(event(1, '12345'));
  assert.equal(f.statuses.at(-1), 'lost');
  response.resolve({ session: { status: 'running' }, data: 'must not apply', seq: 1 }); await pending;
  assert.deepEqual(f.snapshots, []); f.stream.dispose(); f.emit(event(2, 'ignored')); assert.deepEqual(f.output, []);
});
