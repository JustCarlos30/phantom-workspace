import test from 'node:test';
import assert from 'node:assert/strict';
import { toolForKey } from './canvas-tool-keys.mjs';

test('C alterna comentario y selector', () => {
  assert.equal(toolForKey({ key: 'c' }, { tool: 'select' }), 'comment');
  assert.equal(toolForKey({ key: 'C' }, { tool: 'comment', focused: true }), 'select');
});

test('V vuelve a selector también en enfoque', () => {
  assert.equal(toolForKey({ key: 'v' }, { tool: 'comment', focused: true }), 'select');
  assert.equal(toolForKey({ key: 'v' }, { tool: 'comment' }), 'select');
});

test('H solo fuera de enfoque', () => {
  assert.equal(toolForKey({ key: 'h' }, { tool: 'select' }), 'hand');
  assert.equal(toolForKey({ key: 'h' }, { tool: 'select', focused: true }), null);
});

test('modificadores y campos editables se ignoran', () => {
  for (const m of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(toolForKey({ key: 'v', [m]: true }, { tool: 'comment' }), null);
  assert.equal(toolForKey({ key: 'c' }, { tool: 'select', editable: true }), null);
  assert.equal(toolForKey({ key: 'x' }, { tool: 'select' }), null);
});
