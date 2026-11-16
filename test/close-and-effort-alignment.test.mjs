import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const canvas = readFileSync(new URL('../src/components/Canvas.jsx', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../src/chat.css', import.meta.url), 'utf8');

// Closing a terminal from its header X must just close it: the press must not
// select the panel or activate its terminal, and the button must not take focus
// (focus would frame the panel and move the map).
test('terminal close button does not take focus on press', () => {
  const button = canvas.split('\n').find(line => line.includes('aria-label="Cerrar terminal"'));
  assert.ok(button, 'close button exists');
  assert.match(button, /data-panel-close/);
  assert.match(button, /onPointerDown=\{e => e\.preventDefault\(\)\}/);
});

test('pressing the close button neither records a press nor selects the panel', () => {
  const press = canvas.match(/const press = \(e, id\) => \{[\s\S]*?\n  \};/)?.[0];
  assert.ok(press, 'press handler exists');
  const bail = press.indexOf("closest('[data-panel-close]')");
  assert.ok(bail > 0, 'press bails out on [data-panel-close]');
  assert.ok(bail < press.indexOf('lastPress.current ='), 'bails out before recording the press');
  assert.ok(bail < press.indexOf('onSelect('), 'bails out before selecting');
});

test('closing a terminal hands keyboard focus back to the canvas without scrolling', () => {
  assert.match(canvas, /closeTerminal: node => \{\s*root\.current\?\.focus\(\{ preventScroll: true \}\);\s*latest\.current\.onCloseTerminal\(node\);?\s*\}/);
});

// Effort/Variant pill: label and value share the model pill's type and height.
test('effort pill shares the model pill font and height', () => {
  const rule = chat.match(/\n\.pc-reasoning \{[^}]*\}/)?.[0];
  assert.ok(rule, '.pc-reasoning rule exists');
  assert.match(rule, /font: var\(--t-support\)/);
  assert.match(rule, /height: 30px/);
  assert.doesNotMatch(rule, /font-size: 11px/);
});
