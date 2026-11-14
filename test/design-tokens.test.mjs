import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './appearance-preferences.test.mjs';

// The design system as constraints (see DESIGN.md, «Reglas»). Three radii,
// chrome/workplane elevations, one hairline, and a per-file budget of drawn edges that can
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

test('shadows use chrome or matte workplane elevations, or a state ring', () => {
  const ring = /^(inset )?0 0 0 (\S+|calc\(.+\)) \S.*$|^(inset )?0 0 0 0 \S.*$/;
  const bad = [];
  for (const { name, css } of sheets)
    for (const value of declarations(css, 'box-shadow')) {
      if (/^(none|inherit|initial|unset)$/.test(value)) continue;
      for (const layer of split(value, ','))
        if (!/^var\(--shadow-(chrome|rest|float|workplane-rest|workplane-lift)\)$/.test(layer) && !ring.test(layer)) bad.push(`${name}: box-shadow ${value}`);
    }
  assert.deepEqual(bad, [], 'Use chrome or matte workplane elevation tokens. Zero-offset, zero-blur rings are allowed for state only.');
});

test('canvas chrome never borrows panel selection elevation, including responsive rules', () => {
  const bad = [];
  for (const { name, css } of sheets.filter(sheet => ['src/canvas-ui.css', 'src/studio.css'].includes(sheet.name))) {
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!declarations(match[2], 'box-shadow').includes('var(--shadow-float)')) continue;
      for (const selector of split(match[1], ','))
        if (!/^\.canvas-node(?=[\s.:#\[>+~]|$)/.test(selector)) bad.push(`${name}: ${selector}`);
    }
  }
  assert.deepEqual(bad, [], '--shadow-float belongs to canvas panels; chrome uses --shadow-chrome.');
});

test('retired tokens stay retired', () => {
  const retired = /--(hairline-strong|edge-strong|edge|island-line|island-shadow|island-radius|object-edge|object-heavy|object-light|line-soft|line|node-border|shadow-popover|elev-[a-z0-9]+|r-(xs|sm|md|lg|xl))(?![\w-])/g;
  const bad = [];
  for (const { name, css } of sheets) for (const match of css.matchAll(retired)) bad.push(`${name}: ${match[0]}`);
  assert.deepEqual([...new Set(bad)], [], 'One hairline (--hairline), chrome/workplane elevations, three radii.');
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

test('workplane elevation aliases stay local and the canvas exposes environmental art', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const studio = sheets.find(sheet => sheet.name === 'src/studio.css').css;
  const plane = canvas.match(/\.canvas \.canvas-node\[data-type="terminal"\]\s*\{([^}]+)\}/)?.[1];
  assert.ok(plane);
  assert.match(plane, /--shadow-rest:\s*var\(--shadow-workplane-rest\)/);
  assert.match(plane, /--shadow-float:\s*var\(--shadow-workplane-lift\)/);
  assert.match(plane, /filter:\s*none/);
  assert.match(plane, /backdrop-filter:\s*none/);
  assert.doesNotMatch(canvas, /brightness\(\.7\)|saturate\(\.72\)/);
  assert.match(studio, /\.canvas-region \.canvas\s*\{[^}]*z-index:\s*1;[^}]*background-color:\s*transparent/);
});

test('spectral reading and state inks retain AA contrast on opaque planes', () => {
  const css = readFileSync(path.join(root, 'src/studio.css'), 'utf8');
  const color = name => {
    const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i'))?.[1];
    assert.ok(value, `Declared opaque palette token --${name}`);
    const rgb = value.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const plane of ['bg', 'surface', 'surface-2', 'surface-3', 'terminal-bg']) {
    for (const ink of ['ink', 'muted', 'working', 'attention']) {
      const a = color(plane), b = color(ink), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      assert.ok(ratio >= 4.5, `--${ink} on --${plane}: ${ratio.toFixed(2)} < 4.5`);
    }
  }
});

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
