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
        if (!/^var\(--shadow-(chrome|rest|float|workplane-rest|workplane-lift|key|well|rim)\)$/.test(layer) && !ring.test(layer)) bad.push(`${name}: box-shadow ${value}`);
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

test('light glass has inset relief, a spring and accessible opaque fallbacks only on chrome', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const tokens = canvas.match(/:root\s*\{([^}]+)\}/)?.[1];
  assert.ok(tokens);
  for (const [token, minimum] of [['glass', 44], ['glass-thick', 60]]) {
    const value = declarations(tokens, `--${token}`)[0];
    const opacity = value?.match(/^color-mix\(in srgb, var\(--glass-tint\) (\d+(?:\.\d+)?)%, transparent\)$/)?.[1];
    assert.ok(Number(opacity) >= minimum, `--${token} must be at least ${minimum}% opaque`);
  }
  const blur = declarations(tokens, '--glass-filter')[0]?.match(/blur\((\d+(?:\.\d+)?)px\)/)?.[1];
  assert.ok(Number(blur) >= 34, '--glass-filter must blur at least 34px');
  assert.match(declarations(tokens, '--glass-filter')[0], /saturate\(190%\)/);
  assert.equal(declarations(tokens, '--on')[0], '#f1ecf8');
  assert.equal(declarations(tokens, '--on-ink')[0], '#1a1226');
  const chrome = declarations(tokens, '--shadow-chrome')[0];
  assert.ok(split(chrome, ',').filter(layer => layer.startsWith('inset ')).length >= 2, 'Chrome needs top and bottom inset relief');
  assert.match(declarations(tokens, '--ease-spring')[0], /^linear\(/);
  assert.match(canvas, /@media\s*\(prefers-contrast:\s*more\)/);
  for (const preference of ['prefers-reduced-transparency: reduce', 'prefers-contrast: more']) {
    const block = canvas.slice(canvas.indexOf(`@media (${preference})`)).match(/:root\s*\{([^}]+)\}/)?.[1];
    assert.ok(block, `${preference} declares opaque material tokens`);
    assert.match(block, /--glass:\s*var\(--surface\)/);
    assert.match(block, /--glass-thick:\s*var\(--surface\)/);
    assert.match(block, /--glass-filter:\s*none/);
    assert.match(block, /--glass-sheen:\s*none/);
  }
  const bad = [];
  // Match the plane itself, including its states/pseudo-elements, rather than
  // controls descended from a plane (which may legitimately have tactile relief).
  const plane = /(?:^|[\s>+~])(?:\.pc-thread|\.terminal-[\w-]+|\.canvas-node\[data-type=["']terminal["']\])(?=[:.\[#]|$)(?:[^\s>+~]*)$/;
  for (const { name, css } of sheets) {
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/var\(--(?:shadow-key|shadow-well|glass-sheen)\)/.test(body)) continue;
      for (const selector of split(selectors, ',')) {
        if (plane.test(selector)) bad.push(`${name}: ${selector}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'Workplanes never borrow chrome sheen or control relief');
});

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

test('workplanes transmit colour without blur, wells remain dense and composer height never animates', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const chat = sheets.find(sheet => sheet.name === 'src/chat.css').css;
  const side = sheets.find(sheet => sheet.name === 'src/phantom-chat.css').css;
  const terminal = sheets.find(sheet => sheet.name === 'src/terminal.css').css;
  const tokens = canvas.match(/:root\s*\{([^}]+)\}/)[1];
  const planeAlpha = Number(declarations(tokens, '--workplane')[0]?.match(/var\(--surface\) (\d+)%/)?.[1]);
  assert.ok(planeAlpha >= 76 && planeAlpha <= 82, 'Workplane base alpha must be 76–82%');
  const wash = declarations(tokens, '--workplane-wash')[0];
  assert.match(wash, /^linear-gradient\(135deg, color-mix\(in srgb, var\(--accent\) (\d+)%?, transparent\), transparent\)$/);
  const accentAlpha = Number(wash.match(/var\(--accent\) (\d+)%/)[1]);
  assert.ok(accentAlpha <= 10, 'Diagonal wash must stay subtle');
  assert.ok(planeAlpha + accentAlpha * (1 - planeAlpha / 100) <= 82, 'Combined wash/base alpha stays within 82%');
  for (const token of ['well', 'well-raised', 'well-terminal']) {
    const opacity = Number(declarations(tokens, `--${token}`)[0]?.match(/\) (\d+)%, transparent\)/)?.[1]);
    assert.ok(opacity >= 86, `--${token} must be at least 86% opaque`);
  }
  assert.match(canvas, /\.canvas \.canvas-node\[data-type="terminal"\]\s*\{[^}]*background-color:\s*var\(--workplane\);[^}]*background-image:\s*var\(--workplane-wash\)/);
  assert.match(side, /\.phantom-chat\s*\{[^}]*background-color:\s*var\(--workplane\);[^}]*background-image:\s*var\(--workplane-wash\)/);
  assert.match(side, /\.phantom-chat \.pc-thread\s*\{[^}]*background:\s*var\(--well\)/);
  assert.match(chat, /\.pc-thread\s*\{[^}]*background:\s*var\(--well-terminal\)/);
  assert.match(chat, /\.pc-field\s*\{[^}]*background:\s*var\(--well-raised\)/);
  assert.match(terminal, /\.pt-card-screen,[^{]+\{[^}]*background:\s*var\(--well-terminal\)/);
  const plane = /(?:^|[\s>+~])(?:\.pc|\.pc-thread|\.pc-composer|\.phantom-chat|\.pt-card|\.pt-card-screen|\.terminal-panel|\.terminal-host|\.canvas-node\[data-type="terminal"\])(?=[:.\[#]|$)(?:[^\s>+~]*)$/;
  for (const { name, css } of sheets) {
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!declarations(body, '(?:-webkit-)?backdrop-filter').some(value => value !== 'none')) continue;
      for (const selector of split(selectors, ',')) assert.ok(!plane.test(selector), `No backdrop filter on workplane: ${name}: ${selector}`);
    }
  }
  assert.match(chat, /\.pc-field textarea\s*\{[^}]*transition:\s*none/);
  for (const file of ['ChatCard', 'PhantomChat']) {
    const source = readFileSync(path.join(root, `src/components/${file}.jsx`), 'utf8');
    assert.match(source, /useComposerSize\(input, draft/);
    assert.doesNotMatch(source, /Math\.min\(el\.scrollHeight/);
  }
});

test('reading and state inks retain AA on translucent wells, including a white image behind them', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const studio = sheets.find(sheet => sheet.name === 'src/studio.css').css;
  const tokens = canvas.match(/:root\s*\{([^}]+)\}/)[1];
  const rgb = name => {
    const value = declarations(tokens, `--${name}`)[0] || declarations(studio, `--${name}`)[0];
    assert.match(value, /^#[\da-f]{6}$/i);
    return value.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  };
  const luminance = rgb => rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const token of ['well', 'well-raised', 'well-terminal']) {
    const [, base, percent] = declarations(tokens, `--${token}`)[0].match(/var\(--([\w-]+)\) (\d+)%/);
    const alpha = Number(percent) / 100;
    for (const background of [[0, 0, 0], [1, 1, 1], rgb('surface-3')]) {
      const composite = rgb(base).map((v, i) => v * alpha + background[i] * (1 - alpha));
      for (const ink of ['ink', 'muted', 'working', 'attention']) {
        const ratio = contrast(rgb(ink), composite);
        assert.ok(ratio >= 4.5, `--${ink} on --${token}: ${ratio.toFixed(2)} < 4.5`);
      }
    }
  }
  assert.ok(contrast(rgb('on'), rgb('on-ink')) >= 4.5, 'Solid active keys retain AA');
});

test('chrome reading inks retain AA across the existing CSS atmospheres and project accents', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const studio = sheets.find(sheet => sheet.name === 'src/studio.css').css;
  const tokens = canvas.match(/:root\s*\{([^}]+)\}/)[1];
  const rgb = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  const token = name => rgb(declarations(tokens, `--${name}`)[0] || declarations(studio, `--${name}`)[0]);
  const over = (front, back, alpha) => front.map((v, i) => v * alpha + back[i] * (1 - alpha));
  const luminance = rgb => rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const backgrounds = [token('bg'), ...[...studio.matchAll(/--atmosphere:[^;}]+/g)]
    .flatMap(([value]) => [...value.matchAll(/#[\da-f]{6}\b/gi)].map(([hex]) => rgb(hex)))];
  // Full intensity at each gradient's brightest stop and top of the sheen.
  // Personal images are runtime content; opaque accessibility modes remain available.
  for (const accent of ['c-lilac', 'c-iris', 'c-mint', 'c-sand', 'c-rose', 'c-sky']) {
    const tint = over(token(accent), token('surface-3'), .13);
    for (const material of ['glass', 'glass-thick']) {
      const alpha = Number(declarations(tokens, `--${material}`)[0].match(/ (\d+)%/)[1]) / 100;
      for (const background of backgrounds) {
        const composite = over([1, 1, 1], over(tint, background, alpha), 31 / 255);
        for (const ink of ['ink', 'ink-on-glass']) {
          const a = luminance(token(ink)), b = luminance(composite);
          const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          assert.ok(ratio >= 4.5, `--${ink} on --${material}/${accent}: ${ratio.toFixed(2)} < 4.5`);
        }
      }
    }
  }
});

test('materials retire the old activity glint and keep auxiliary status indicators still', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  assert.doesNotMatch(canvas, /--filo-|@keyframes\s+filo-/);
  assert.doesNotMatch(canvas, /\.canvas-node::after\s*\{/);
  for (const state of ['working', 'error', 'success']) assert.match(canvas, new RegExp(`\\.canvas-node\\.pulse-${state}\\s*\\{\\s*--pulse:`));
  for (const name of ['canvas-ui', 'terminal', 'chat', 'phantom-chat', 'sidebar', 'studio']) {
    const css = sheets.find(sheet => sheet.name === `src/${name}.css`).css;
    assert.doesNotMatch(css, /animation\s*:[^;}]*\binfinite\b/, `${name}: no continuous material/status animation`);
  }
});
