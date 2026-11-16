import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayPolicy, isEditingTarget, writeOwnedTerminalInput } from './inputOwnership.js';
import { createTerminalStream } from './terminalStream.js';
import { createInlineName, createDraftRegistry } from './inlineName.js';
import { createSaveQueue } from './saveQueue.js';
import { createCloseHandler } from './closeProtocol.js';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));

test('inspector occludes browser but does not block terminal input; modal surfaces block both', () => {
  assert.deepEqual(overlayPolicy({ inspector: 'tasks' }), { inputBlocked: false, browserObscured: true, navigationBlocked: false });
  assert.deepEqual(overlayPolicy({ inspector: 'context', palette: true }), { inputBlocked: true, browserObscured: true, navigationBlocked: true });
  for (const field of ['voice', 'edit', 'menu', 'sidebar', 'closing']) assert.equal(overlayPolicy({ [field]: true }).inputBlocked, true);
});

test('isolated two-terminal bridge routes Space/Ctrl+C only to the clicked terminal with inspector open', async () => {
  const calls = [], streams = [];
  for (const sessionId of ['terminal-a', 'terminal-b']) {
    const stream = createTerminalStream({ sessionId, invoke: async () => ({ session: { status: 'running' }, seq: 0, data: '' }), subscribe: () => () => {}, snapshot: async () => {}, output: async () => {}, onStatus: () => {}, onError: () => {} });
    await stream.start(); streams.push(stream);
  }
  const aInput = { closest: selector => selector.includes('.xterm') ? {} : null };
  const bInput = { closest: selector => selector.includes('.xterm') ? {} : null };
  const inspectorField = { closest: selector => selector.includes('input') ? {} : null };
  const roots = [{ contains: target => target === aInput }, { contains: target => target === bInput }];
  const invoke = async (method, payload) => calls.push([method, payload]);
  const { inputBlocked } = overlayPolicy({ inspector: 'tasks' });
  for (const text of [' ', '\u0003']) {
    for (let i = 0; i < 2; i++) await writeOwnedTerminalInput({ stream: streams[i], active: !inputBlocked, element: roots[i], focusedElement: bInput, sessionId: ['terminal-a', 'terminal-b'][i], invoke, text });
  }
  assert.deepEqual(calls, [['terminal.write', { sessionId: 'terminal-b', data: ' ' }], ['terminal.write', { sessionId: 'terminal-b', data: '\u0003' }]]);
  assert.equal(isEditingTarget(bInput), true, 'canvas keyboard handling yields to the xterm target');
  assert.equal(isEditingTarget(inspectorField), true, 'canvas keyboard handling yields to inspector fields');
  for (let i = 0; i < 2; i++) assert.equal(writeOwnedTerminalInput({ stream: streams[i], active: true, element: roots[i], focusedElement: inspectorField, sessionId: ['terminal-a', 'terminal-b'][i], invoke, text: 'field text' }), null);
  assert.equal(calls.length, 2);
  assert.equal(writeOwnedTerminalInput({ stream: streams[1], active: !overlayPolicy({ palette: true }).inputBlocked, element: roots[1], focusedElement: bInput, sessionId: 'terminal-b', invoke, text: 'blocked' }), null);
  assert.equal(calls.length, 2);
  for (const stream of streams) stream.dispose();
});

function editorFixture(options = {}) {
  const staged = [], states = [], ended = [];
  const editor = createInlineName({ value: 'Original', stage: value => staged.push(value), flush: options.flush || (async () => {}), update: value => states.push(value), end: focus => ended.push(focus) });
  return { editor, staged, states, ended };
}

test('Escape ends inline rename before blur and never commits the cancelled value', async () => {
  const f = editorFixture(); f.editor.change('Cancelled'); f.editor.cancel();
  await f.editor.commit(false); f.editor.prepare();
  assert.deepEqual(f.staged, []); assert.deepEqual(f.ended, [true]);
});

test('Enter stages exactly once, awaits durable flush and returns focus to the header', async () => {
  const saved = deferred(), f = editorFixture({ flush: () => saved.promise });
  f.editor.change('  New name  ');
  const enter = f.editor.commit(true), blur = f.editor.commit(false);
  assert.equal(enter, blur); f.editor.prepare();
  assert.deepEqual(f.staged, ['New name']); assert.deepEqual(f.ended, []);
  saved.resolve(); assert.equal(await enter, true); assert.deepEqual(f.ended, [true]);
});

test('blur saves without stealing focus; unchanged names are no-op writes', async () => {
  const f = editorFixture(); await f.editor.commit(false);
  assert.deepEqual(f.staged, []); assert.deepEqual(f.ended, [false]);
});

test('invalid and failed name saves remain visible and recoverable inline', async () => {
  const invalid = editorFixture(); invalid.editor.change('   ');
  assert.equal(await invalid.editor.commit(true), false);
  assert.match(invalid.states.at(-1).error, /Escribe un nombre/); assert.deepEqual(invalid.ended, []); assert.deepEqual(invalid.staged, []);
  const failed = editorFixture({ flush: async () => { throw new Error('Disk full'); } }); failed.editor.change('Pending');
  assert.equal(await failed.editor.commit(true), false); assert.equal(failed.states.at(-1).error, 'Disk full'); assert.deepEqual(failed.ended, []);
  failed.editor.cancel(); await failed.editor.commit(false);
  assert.deepEqual(failed.staged, ['Pending', 'Original'], 'Escape rolls back an optimistic failed rename');
});

test('close handshake prepares an open name draft and waits for its durable write before ACK', async () => {
  const write = deferred(), calls = [], registry = createDraftRegistry();
  const queue = createSaveQueue({ invoke: async (method, payload) => { calls.push([method, payload]); await write.promise; }, refresh: async () => {} });
  const flush = () => { registry.prepare(); return queue.flush(); };
  const editor = createInlineName({ value: 'Project', stage: name => queue.enqueue('workspace:w', 'workspace.update', { id: 'w' }, { name }), flush, update: () => {}, end: () => {} });
  const off = registry.register(editor.prepare); editor.change('Named before close');
  const close = createCloseHandler({ flush, invoke: async (...args) => calls.push(args), onStatus: () => {}, onError: () => {} });
  const closing = close('close'); await turn();
  assert.deepEqual(calls, [['workspace.update', { id: 'w', patch: { name: 'Named before close' } }]]);
  write.resolve(); assert.equal(await closing, true);
  assert.deepEqual(calls.at(-1), ['desktop.closeReady', { requestId: 'close', discard: false }]); off();
});

test('invalid inline draft prevents close ACK; cancel unregisters its value from later preparation', async () => {
  const registry = createDraftRegistry(), calls = [], f = editorFixture();
  registry.register(f.editor.prepare); f.editor.change('');
  const close = createCloseHandler({ flush: () => { registry.prepare(); return Promise.resolve(); }, invoke: async (...args) => calls.push(args), onStatus: () => {}, onError: () => {} });
  assert.equal(await close('invalid'), false); assert.deepEqual(calls, []);
  f.editor.cancel(); assert.equal(await close('retry'), true); assert.deepEqual(f.staged, []);
});
