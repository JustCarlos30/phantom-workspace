import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchWorkspaceKey, isEditingTarget, overlayPolicy, writeOwnedTerminalInput } from './inputOwnership.js';
import { resolveBindings, validateBindings } from './workspace-commands.mjs';
import { directionalNeighbor, cycleSession } from './panel-navigation.mjs';
import { createTerminalStream } from './terminalStream.js';

const bindings = resolveBindings();
const target = (kind = 'canvas') => ({
  tagName: kind === 'xterm' ? 'TEXTAREA' : kind === 'editor' ? 'INPUT' : 'SECTION',
  closest(selector) {
    if (kind === 'xterm' && (selector.includes('.xterm') || selector.includes('textarea'))) return this;
    if (kind === 'editor' && selector.includes('input')) return this;
    return null;
  },
});
function key(key, extra = {}) {
  return { key, target: target(), defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }, ...extra };
}
async function terminal() {
  const writes = [], commands = [];
  const element = { contains: candidate => candidate?.tagName === 'TEXTAREA' };
  let receive;
  const stream = createTerminalStream({ sessionId: 'pty',
    invoke: async () => ({ seq: 0, data: '$ ', session: { status: 'running' } }),
    subscribe: callback => { receive = callback; return () => {}; },
    snapshot: async () => {}, output: async () => {}, onStatus() {}, onError() {},
  });
  await stream.start();
  const send = (event, context, { active = true, blocked = false, text = event.key } = {}) => {
    const consumed = dispatchWorkspaceKey(event, bindings, context, id => commands.push(id));
    if (!event.stopped) writeOwnedTerminalInput({ stream, element, focusedElement: event.target, active, blocked,
      sessionId: 'pty', invoke: (method, payload) => writes.push({ method, ...payload }), text });
    return consumed;
  };
  return { send, writes, commands, stream, receive };
}

test('salir desde xterm se consume antes del PTY y permite elegir vecino sin escribir', async () => {
  const f = await terminal();
  const exit = key('Escape', { ctrlKey: true, shiftKey: true, target: target('xterm') });
  assert.equal(f.send(exit, { inPanel: true }), true);
  assert.equal(exit.defaultPrevented, true);
  assert.deepEqual(f.commands, ['leave-panel']);
  assert.deepEqual(f.writes, []);
  const nodes = [{ id: 'a', type: 'terminal', x: 0, y: 0, width: 400, height: 300 },
    { id: 'b', type: 'note', x: 500, y: 0, width: 400, height: 300 }];
  let selected = 'a';
  const arrow = key('ArrowRight');
  assert.equal(dispatchWorkspaceKey(arrow, bindings, { navigationMode: true }, id => {
    selected = directionalNeighbor(nodes, selected, id);
  }), true);
  assert.equal(selected, 'b');
  assert.equal(arrow.stopped, true);
  assert.deepEqual(f.writes, []);
  f.stream.dispose();
});

test('flechas y Enter pertenecen a xterm en interacción; Escape sin modificador también', async () => {
  const f = await terminal();
  for (const [name, text] of [['ArrowLeft', '\x1b[D'], ['ArrowRight', '\x1b[C'], ['ArrowUp', '\x1b[A'], ['ArrowDown', '\x1b[B'], ['Enter', '\r'], ['Escape', '\x1b']]) {
    const event = key(name, { target: target('xterm') });
    assert.equal(f.send(event, { navigationMode: true, inPanel: true }, { text }), false);
    assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.writes.map(write => write.data), ['\x1b[D', '\x1b[C', '\x1b[A', '\x1b[B', '\r', '\x1b']);
  f.stream.dispose();
});

test('comandos globales y sesiones se capturan desde xterm sin caracteres de control en PTY', async () => {
  const f = await terminal();
  for (const [name, modifiers] of [['k', { ctrlKey: true }], ['PageDown', { ctrlKey: true }], ['PageUp', { ctrlKey: true }], ['T', { ctrlKey: true, shiftKey: true }]]) {
    assert.equal(f.send(key(name, { ...modifiers, target: target('xterm') }), { inPanel: true }), true);
  }
  assert.deepEqual(f.commands, ['palette', 'next-session', 'previous-session', 'create-terminal']);
  assert.deepEqual(f.writes, []);
  assert.equal(cycleSession([{ id: 'a', type: 'terminal' }, { id: 'hidden', type: 'terminal', data: { hidden: true } }, { id: 'b', type: 'terminal' }], 'a', 1), 'b');
  f.stream.dispose();
});

test('escritura normal, IME y AltGraph no disparan comandos del workspace', () => {
  const commands = [];
  for (const event of [key('0', { target: target('editor') }), key('Enter', { target: target('editor') }),
    key('ArrowRight', { target: target('editor') }), key('k', { ctrlKey: true, isComposing: true }),
    key('k', { ctrlKey: true, keyCode: 229 }), key('k', { ctrlKey: true, getModifierState: name => name === 'AltGraph' }),
    key('Dead'), key('Process')]) {
    assert.equal(dispatchWorkspaceKey(event, bindings, { navigationMode: true }, id => commands.push(id)), false);
    assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(commands, []);
});

test('entrar exige modo navegación y ownership del canvas', () => {
  const commands = [];
  assert.equal(dispatchWorkspaceKey(key('Enter'), bindings, {}, id => commands.push(id)), false);
  assert.equal(dispatchWorkspaceKey(key('Enter'), bindings, { navigationMode: true }, id => commands.push(id)), true);
  assert.deepEqual(commands, ['enter-panel']);
});

test('overlays retienen teclado y bloquean incluso escritura tardía de xterm y rueda', async () => {
  const f = await terminal();
  for (const overlay of ['palette', 'projectsOpen', 'shortcutsOpen', 'list', 'voice', 'folder']) {
    const policy = overlayPolicy({ [overlay]: true });
    assert.equal(f.send(key('k', { ctrlKey: true, target: target('xterm') }), { blocked: policy.navigationBlocked }, { blocked: policy.inputBlocked }), false);
    assert.equal(writeOwnedTerminalInput({ stream: f.stream, active: true, wheelOwned: true, blocked: policy.inputBlocked,
      sessionId: 'pty', text: '\x1b[A', invoke: (...args) => f.writes.push(args) }), null);
  }
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.writes, []);
  f.stream.dispose();
});

test('una selección sin foco DOM, una desconexión y una vista inactiva no pueden escribir', async () => {
  const f = await terminal();
  assert.equal(f.send(key('a'), {}, { active: true }), false);
  f.send(key('b', { target: target('xterm') }), {}, { active: false });
  f.receive({ type: 'connection', status: 'disconnected' });
  f.send(key('c', { target: target('xterm') }), {});
  assert.deepEqual(f.writes, []);
  f.stream.dispose();
});

test('rebinding se despacha; desactivar elimina captura y duplicados no destruyen las vías de salida', () => {
  const custom = resolveBindings({ palette: 'Ctrl+Alt+Y', 'create-note': null });
  const commands = [];
  assert.equal(dispatchWorkspaceKey(key('k', { ctrlKey: true }), custom, {}, id => commands.push(id)), false);
  assert.equal(dispatchWorkspaceKey(key('y', { ctrlKey: true, altKey: true }), custom, {}, id => commands.push(id)), true);
  assert.equal(dispatchWorkspaceKey(key('N', { ctrlKey: true, shiftKey: true }), custom, {}, id => commands.push(id)), false);
  assert.deepEqual(commands, ['palette']);
  const rejected = validateBindings({ 'leave-panel': null, shortcuts: null, palette: bindings.projects });
  assert.ok(rejected.conflicts.length >= 3);
  const exit = key('Escape', { ctrlKey: true, shiftKey: true, target: target('xterm') });
  assert.equal(dispatchWorkspaceKey(exit, rejected.bindings, { inPanel: true }, id => commands.push(id)), true);
  assert.equal(commands.at(-1), 'leave-panel');
});

test('editores enriquecidos conservan flechas y los eventos consumidos no se despachan de nuevo', () => {
  const editor = { isContentEditable: true };
  assert.equal(isEditingTarget(editor), true);
  assert.equal(isEditingTarget(null), false);
  const commands = [];
  const event = key('ArrowRight', { target: editor });
  assert.equal(dispatchWorkspaceKey(event, bindings, { navigationMode: true }, id => commands.push(id)), false);
  const palette = key('k', { ctrlKey: true });
  assert.equal(dispatchWorkspaceKey(palette, bindings, {}, id => commands.push(id)), true);
  assert.equal(dispatchWorkspaceKey(palette, bindings, {}, id => commands.push(id)), false);
  assert.deepEqual(commands, ['palette']);
});

test('dictado se despacha una vez, respeta overlays y puede ceder su acorde a paleta', async () => {
  const f = await terminal();
  const event = key('m', { ctrlKey: true, shiftKey: true, target: target('xterm') });
  assert.equal(f.send(event, { inPanel: true }), true);
  assert.equal(f.send(event, { inPanel: true }), false);
  assert.deepEqual(f.commands, ['dictation']);
  assert.deepEqual(f.writes, []);
  const commands = [];
  const custom = validateBindings({ palette: 'Ctrl+Shift+M', dictation: 'Alt+M' });
  assert.deepEqual(custom.conflicts, []);
  assert.equal(dispatchWorkspaceKey(key('m', { ctrlKey: true, shiftKey: true }), custom.bindings, {}, id => commands.push(id)), true);
  assert.equal(dispatchWorkspaceKey(key('m', { altKey: true }), custom.bindings, {}, id => commands.push(id)), true);
  assert.equal(dispatchWorkspaceKey(key('m', { altKey: true }), custom.bindings, { blocked: true }, id => commands.push(id)), false);
  assert.equal(dispatchWorkspaceKey(key('m', { altKey: true, isComposing: true }), custom.bindings, {}, id => commands.push(id)), false);
  assert.equal(dispatchWorkspaceKey(key('m', { altKey: true }), resolveBindings({ dictation: null }), {}, id => commands.push(id)), false);
  assert.deepEqual(commands, ['palette', 'dictation']);
  f.stream.dispose();
});
