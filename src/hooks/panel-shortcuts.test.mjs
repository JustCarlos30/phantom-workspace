import test from 'node:test';
import assert from 'node:assert/strict';
import { panelShortcut } from './panel-shortcuts.mjs';

test('maps Ctrl/Cmd+Shift+T/B/N/Z to panel types', () => {
  for (const [key, type] of Object.entries({ t: 'terminal', b: 'browser', n: 'note', z: 'zone' })) {
    assert.equal(panelShortcut({ key, ctrlKey: true, shiftKey: true }), type);
    assert.equal(panelShortcut({ key: key.toUpperCase(), metaKey: true, shiftKey: true }), type);
  }
});

test('ignores other key combinations', () => {
  assert.equal(panelShortcut({ key: 't', ctrlKey: true }), null);
  assert.equal(panelShortcut({ key: 't', shiftKey: true }), null);
  assert.equal(panelShortcut({ key: 't', ctrlKey: true, shiftKey: true, altKey: true }), null);
  assert.equal(panelShortcut({ key: 'x', metaKey: true, shiftKey: true }), null);
});
