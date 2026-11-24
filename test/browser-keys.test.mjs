import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardableKey } from '../desktop/browser-keys.mjs';
import { keyboardInitFromBrowserEvent } from '../src/hooks/browserKeyBridge.mjs';
import { installBrowserKeyBridge } from '../src/hooks/browserKeyBridge.js';

const input = (patch = {}) => ({ type: 'keyDown', key: 'k', code: 'KeyK', control: false, alt: false, shift: false, meta: false, ...patch });
const browserEvent = (patch = {}) => ({ type: 'browser.key', id: 'browser-1', workspaceId: 'workspace-1', key: 'k', code: 'KeyK', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, ...patch });

test('ordinary typing and unmodified navigation keys are not forwarded', () => {
  for (const key of ['k', 'Escape', 'ArrowLeft', 'Enter']) assert.equal(forwardableKey(input({ key })), null);
});

test('Shift alone does not forward typing or navigation', () => {
  assert.equal(forwardableKey(input({ key: 'K', shift: true })), null);
  assert.equal(forwardableKey(input({ key: 'ArrowLeft', code: 'ArrowLeft', shift: true })), null);
});

test('Ctrl+Shift+Escape forwards the leave-panel chord', () => {
  assert.deepEqual(forwardableKey(input({ key: 'Escape', code: 'Escape', control: true, shift: true })), {
    key: 'Escape', code: 'Escape', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false,
  });
});

test('Ctrl+K forwards the palette chord', () => {
  assert.deepEqual(forwardableKey(input({ control: true })), {
    key: 'k', code: 'KeyK', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false,
  });
});

test('Alt+ArrowLeft is forwarded', () => {
  assert.deepEqual(forwardableKey(input({ key: 'ArrowLeft', code: 'ArrowLeft', alt: true })), {
    key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false,
  });
});

test('keyUp and other input event types are ignored', () => {
  for (const type of ['keyUp', 'char', 'keydown', undefined, 1]) {
    assert.equal(forwardableKey(input({ type, control: true })), null);
  }
});

test('Linux AltGr character chords are not forwarded, including with Shift', () => {
  for (const shift of [false, true]) {
    assert.equal(forwardableKey(input({ key: '@', code: 'KeyQ', control: true, alt: true, shift })), null);
  }
});

test('modifier key presses are not forwarded as commands', () => {
  for (const key of ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']) {
    assert.equal(forwardableKey(input({ key, control: true })), null);
  }
});

test('malformed desktop inputs return null without throwing', () => {
  const malformed = [null, undefined, false, 1, 'keyDown', [], {}, input({ control: true, key: '' }), input({ control: true, code: '' })];
  for (const field of ['key', 'code', 'control', 'alt', 'shift', 'meta']) {
    for (const value of [undefined, null, 1, {}, []]) malformed.push(input({ control: true, [field]: value }));
  }
  malformed.push(input({ control: true, key: 'k'.repeat(33) }), input({ control: true, code: 'c'.repeat(33) }));
  for (const value of malformed) assert.equal(forwardableKey(value), null);
});

test('key and code lengths are bounded inclusively at 32', () => {
  const key = 'k'.repeat(32), code = 'c'.repeat(32);
  assert.equal(forwardableKey(input({ key, code, control: true })).key, key);
  assert.equal(keyboardInitFromBrowserEvent(browserEvent({ key, code })).code, code);
});

test('renderer init reproduces every keyboard field and strips unrelated data', () => {
  for (const modifiers of [
    { control: true, alt: false, shift: true, meta: false },
    { control: false, alt: true, shift: false, meta: false },
    { control: false, alt: false, shift: false, meta: true },
    { control: true, alt: true, shift: true, meta: true },
  ]) {
    const forwarded = forwardableKey(input({ ...modifiers, key: 'Escape', code: 'Escape' }));
    assert.deepEqual(keyboardInitFromBrowserEvent(browserEvent({ ...forwarded, url: 'https://example.test', bubbles: false })), {
      key: 'Escape', code: 'Escape', ctrlKey: modifiers.control, altKey: modifiers.alt, shiftKey: modifiers.shift, metaKey: modifiers.meta,
    });
  }
});

test('renderer init rejects incorrect types and malformed keyboard fields', () => {
  const malformed = [null, undefined, false, 1, 'browser.key', [], {}, browserEvent({ type: 'browser.state' }), browserEvent({ type: 1 })];
  for (const field of ['key', 'code']) {
    for (const value of [undefined, null, 1, {}, [], '', 'x'.repeat(33)]) malformed.push(browserEvent({ [field]: value }));
  }
  for (const field of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey']) {
    for (const value of [undefined, null, 1, 'true', {}, []]) malformed.push(browserEvent({ [field]: value }));
  }
  for (const value of malformed) assert.equal(keyboardInitFromBrowserEvent(value), null);
});

test('renderer also rejects ordinary typing, Shift alone and AltGr', () => {
  assert.equal(keyboardInitFromBrowserEvent(browserEvent({ ctrlKey: false })), null);
  assert.equal(keyboardInitFromBrowserEvent(browserEvent({ ctrlKey: false, shiftKey: true })), null);
  assert.equal(keyboardInitFromBrowserEvent(browserEvent({ key: '@', altKey: true })), null);
});

test('bridge dispatches a bubbling, cancelable keydown on the source panel and unsubscribes', () => {
  let listener, selector, received, unsubscribed = false;
  const panel = { dispatchEvent(event) { received = event; } };
  const win = {
    phantom: { onEvent(callback) { listener = callback; return () => { unsubscribed = true; }; } },
    CSS: { escape: value => value.replaceAll('"', '\\"') },
    document: { querySelector(value) { selector = value; return panel; } },
    KeyboardEvent: class extends Event { constructor(type, init) { super(type, init); const { key, code, ctrlKey, altKey, shiftKey, metaKey } = init; Object.assign(this, { key, code, ctrlKey, altKey, shiftKey, metaKey }); } },
  };
  const off = installBrowserKeyBridge(win);
  listener(browserEvent({ id: 'browser-"1', key: 'Escape', code: 'Escape', shiftKey: true }));
  assert.equal(selector, '[data-node-id="browser-\\"1"]');
  assert.equal(received.type, 'keydown');
  assert.equal(received.bubbles, true);
  assert.equal(received.cancelable, true);
  assert.equal(received.key, 'Escape');
  assert.equal(received.ctrlKey, true);
  assert.equal(received.shiftKey, true);
  received.preventDefault();
  assert.equal(received.defaultPrevented, true);
  off();
  assert.equal(unsubscribed, true);
});

test('bridge falls back to body when the panel is absent and ignores invalid events', () => {
  let listener;
  const received = [];
  const win = {
    phantom: { onEvent(callback) { listener = callback; return () => {}; } },
    CSS: { escape: value => value },
    document: { querySelector() { return null; }, body: { dispatchEvent(event) { received.push(event); } } },
    KeyboardEvent: class extends Event { constructor(type, init) { super(type, init); } },
  };
  installBrowserKeyBridge(win);
  listener(browserEvent());
  listener(browserEvent({ type: 'browser.state' }));
  listener(browserEvent({ key: 1 }));
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'keydown');
});

test('bridge without the desktop API returns a callable unsubscribe', () => {
  assert.doesNotThrow(() => installBrowserKeyBridge({})());
});
