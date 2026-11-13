import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './appearance-preferences.test.mjs';

// The design system as constraints (see DESIGN.md, «Reglas»). Three radii,
// two shadows, one hairline, and a per-file budget of drawn edges that can
// only go down. A failure names the file and the value; fix the CSS, or if the
// rule itself should change, change it here and in DESIGN.md together.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.css') ? [path.join(dir, entry.name)] : []);
const sheets = walk(path.join(root, 'src')).map(file => ({
  name: path.relative(root, file),
  css: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));
const declarations = (css, property) => [...css.matchAll(new RegExp(`(?<![-\\w])${property}\\s*:([^;}]+)`, 'g'))]
  .map(match => match[1].replace('!important', '').trim());
const split = (value, separator) => {
  const out = []; let depth = 0, current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === separator && depth === 0) { out.push(current.trim()); current = ''; } else current += ch;
  }
  return [...out, current.trim()].filter(Boolean);
};

test('radii come from the three shapes', () => {
  const allowed = /^(var\(--r-(mark|ctl|obj|isle|pill)\)|0|50%|inherit|\d*\.?\d+em|calc\(var\(--r-(mark|ctl|obj|isle)\) (- 1px|\* var\(--ov(, 1)?\))\))$/;
  const bad = [];
  for (const { name, css } of sheets)
    for (const value of declarations(css, 'border(?:-[a-z]+)*-radius'))
      for (const part of split(value, ' '))
        if (!allowed.test(part)) bad.push(`${name}: border-radius ${value}`);
  assert.deepEqual(bad, [], 'Use --r-ctl (control), --r-obj (object) or --r-isle (island); --r-mark and --r-pill for marks and chips.');
});

test('shadows are rest, float, or a state ring', () => {
  const ring = /^(inset )?0 0 0 (\S+|calc\(.+\)) \S.*$|^(inset )?0 0 0 0 \S.*$/;
  const bad = [];
  for (const { name, css } of sheets)
    for (const value of declarations(css, 'box-shadow')) {
      if (/^(none|inherit|initial|unset)$/.test(value)) continue;
      for (const layer of split(value, ','))
        if (!/^var\(--shadow-(rest|float)\)$/.test(layer) && !ring.test(layer)) bad.push(`${name}: box-shadow ${value}`);
    }
  assert.deepEqual(bad, [], 'Elevation is --shadow-rest or --shadow-float. Zero-offset, zero-blur rings are allowed for state only.');
});

test('retired tokens stay retired', () => {
  const retired = /--(hairline-strong|edge-strong|edge|island-line|island-shadow|island-radius|object-edge|object-heavy|object-light|line-soft|line|node-border|shadow-popover|elev-[a-z0-9]+|r-(xs|sm|md|lg|xl))(?![\w-])/g;
  const bad = [];
  for (const { name, css } of sheets) for (const match of css.matchAll(retired)) bad.push(`${name}: ${match[0]}`);
  assert.deepEqual([...new Set(bad)], [], 'One hairline (--hairline), two shadows, three radii.');
});

// One box per object: an edge is drawn by the thing you can move, not by what
// is inside it. The budget is the number of border declarations per sheet; it
// may only go down. When you remove edges, lower the number in the same change.
const drawnEdges = css => [...css.matchAll(/(?<![-\w])border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?\s*:\s*([^;}]+)/g)]
  .filter(match => !/^(0|none)\b/.test(match[1].trim())).length;
test('drawn edges stay within budget', () => {
  const budget = JSON.parse(readFileSync(path.join(root, 'test/design-budget.json'), 'utf8')).borders;
  const over = [], slack = [];
  for (const { name, css } of sheets) {
    const count = drawnEdges(css), limit = budget[name] ?? 0;
    if (count > limit) over.push(`${name}: ${count} edges, budget ${limit}`);
    if (count < limit) slack.push(`${name}: ${count} edges, lower the budget from ${limit}`);
  }
  assert.deepEqual(over, [], 'New edges inside an object need a reason. Separate with space, type or tone first.');
  assert.deepEqual(slack, [], 'Edges were removed: lower test/design-budget.json so they cannot come back.');
});
export { drawnEdges, sheets };

test('working chat planes are opaque and composer height never animates', () => {
  const chat = sheets.find(sheet => sheet.name === 'src/chat.css').css;
  const side = sheets.find(sheet => sheet.name === 'src/phantom-chat.css').css;
  assert.match(side, /\.phantom-chat\s*\{[^}]*background:\s*var\(--surface\)/);
  assert.match(side, /\.phantom-chat \.pc-thread\s*\{[^}]*background:\s*var\(--surface\)/);
  assert.match(chat, /\.pc-field textarea\s*\{[^}]*transition:\s*none/);
  for (const file of ['ChatCard', 'PhantomChat']) {
    const source = readFileSync(path.join(root, `src/components/${file}.jsx`), 'utf8');
    assert.match(source, /useComposerSize\(input, draft/);
    assert.doesNotMatch(source, /Math\.min\(el\.scrollHeight/);
  }
});
