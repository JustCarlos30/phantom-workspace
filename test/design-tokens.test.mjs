import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './appearance-preferences.test.mjs';
import { ACCENTS, accentColor, defaults, normalizeAppearance } from '../src/hooks/useAppearance.js';

// The design system as constraints (DESIGN.md and docs/design-v2.md, E1–E5).
// Shared opaque material, one masked ring and an exact per-file edge budget.
// A failure names the file and the value; fix the CSS, or if the
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
const rootDeclarations = (css, property) => declarations(css.match(/:root\s*\{([^}]+)\}/)?.[1] || '', property);
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
  const allowed = /^(var\(--r-(mark|ctl|row|group|obj|isle|pill)\)|var\(--voice-bar-radius\)|0|50%|inherit|\d*\.?\d+em|calc\(var\(--r-(mark|ctl|obj|isle)\) (- 1px|\* var\(--ov(, 1)?\))\))$/;
  const bad = [];
  for (const { name, css } of sheets)
    for (const value of declarations(css, 'border(?:-[a-z]+)*-radius'))
      for (const part of split(value, ' '))
        if (!allowed.test(part)) bad.push(`${name}: border-radius ${value}`);
  assert.deepEqual(bad, [], 'Use --r-ctl (control), --r-obj (object) or --r-isle (island); --r-mark and --r-pill for marks and chips.');
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  for (const name of ['obj', 'isle']) assert.equal(rootDeclarations(canvas, `--r-${name}`)[0], '24px');
  for (const name of ['ctl', 'row']) assert.equal(rootDeclarations(canvas, `--r-${name}`)[0], '12px');
});

test('shadows use chrome or matte workplane elevations, or a state ring', () => {
  const ring = /^(inset )?0 0 0 (\S+|calc\(.+\)) \S.*$|^(inset )?0 0 0 0 \S.*$/;
  const bad = [];
  for (const { name, css } of sheets)
    for (const value of declarations(css, 'box-shadow')) {
      if (/^(none|inherit|initial|unset)$/.test(value)) continue;
      if (name === 'src/settings.css' && value === 'inset 0 1px 0 #ffffff14') continue;
      for (const layer of split(value, ','))
        if (!/^var\(--shadow-(chrome|rest|float|workplane-rest|workplane-lift|key|well|rim)\)$/.test(layer) && !ring.test(layer)) bad.push(`${name}: box-shadow ${value}`);
    }
  assert.deepEqual(bad, [], 'Use shared object elevation tokens. Zero-offset, zero-blur rings are allowed for state only.');
  const settings = sheets.find(sheet => sheet.name === 'src/settings.css').css;
  const contacts = [...settings.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) => declarations(body, 'box-shadow').includes('inset 0 1px 0 #ffffff14'));
  assert.deepEqual(contacts.map(([, selector]) => selector.trim()), ['.st-slider'], 'Only the approved slider has inner contact');
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  assert.equal(rootDeclarations(canvas, '--shadow-chrome')[0], '0 1px 2px #000, 0 16px 32px -16px #000');
  for (const name of ['rest', 'float', 'workplane-rest', 'workplane-lift'])
    assert.equal(rootDeclarations(canvas, `--shadow-${name}`)[0], 'var(--shadow-chrome)');
  for (const name of ['key', 'well', 'rim']) assert.equal(rootDeclarations(canvas, `--shadow-${name}`)[0], 'none');
  for (const name of ['canvas-ui', 'menus']) {
    const css = sheets.find(sheet => sheet.name === `src/${name}.css`).css;
    const ring = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, , body]) => /mask-composite:\s*exclude/.test(body));
    assert.ok(ring, `${name}: masked object ring`);
    assert.match(ring[1], /::before/);
    for (const [property, value] of Object.entries({ position: 'absolute', inset: '0', 'z-index': '3', 'border-radius': 'inherit', padding: 'var(--object-ring-width)', 'pointer-events': 'none', background: 'var(--object-ring)', mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', '-webkit-mask-composite': 'xor', 'mask-composite': 'exclude' }))
      assert.equal(declarations(ring[2], property)[0], value, `${name}: ${property}`);
  }
  assert.match(canvas, /\.canvas-node\.selected\s*\{\s*--object-ring: linear-gradient\(var\(--selected-edge-top\), var\(--selected-edge-bottom\)\)/);
  for (const { name, css } of sheets.filter(sheet => /(?:canvas-ui|studio|terminal|menus)\.css$/.test(sheet.name))) {
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!split(selectors, ',').some(selector => /^(?:\.(?:canvas|app-shell)\s+)?\.canvas-node[^\s>+~]*$/.test(selector))) continue;
      for (const value of declarations(body, 'outline')) assert.match(value, /^(0|none)\b/, `${name}: no selection outline`);
      for (const value of declarations(body, 'border')) assert.match(value, /^(0|none)\b/, `${name}: the mask is the only object edge`);
    }
  }
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
// is exact. Every delta needs its selector and reason recorded in DESIGN.md.
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

test('approved type roles use local families and three weights', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  for (const [role, value] of Object.entries({ display: '600 24px/30px', title: '600 15px/20px', headline: '600 14px/22px', body: '400 14px/20px', control: '500 14px/20px', support: '400 12px/16px', micro: '500 12px/16px' })) {
    assert.equal(rootDeclarations(canvas, `--t-${role}`)[0], `${value} var(--sans)`);
  }
  for (const { name, css } of sheets) assert.doesNotMatch(css, /@import\s+url\([^)]*https?:|@font-face[^}]*https?:/i, name);
  const sidebar = sheets.find(sheet => sheet.name === 'src/sidebar.css').css;
  assert.match(sidebar, /\.rail-session-status\s*\{[^}]*flex-shrink: 0;[^}]*white-space: nowrap/);
});

test('sidebar keeps neutral selection, compact status and consistent control sizes', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const sidebar = sheets.find(sheet => sheet.name === 'src/sidebar.css').css;
  const source = readFileSync(path.join(root, 'src/components/SidebarPanels.jsx'), 'utf8');
  for (const [name, value] of Object.entries({ bg: '#020203', surface: '#0b0b0c', 'surface-2': '#111113', 'surface-3': '#1d1d20', 'glyph-primary': '18px', 'glyph-secondary': '16px', 'glyph-stroke': '1.75', target: '40px', 'row-simple': '44px', 'row-detail': '56px', 'rail-width': '272px', 'badge-size': '32px', gutter: '12px', 'rail-group-inset': '20px', 'rail-gap': '8px', 'row-selected': '#1d1d20' })) {
    assert.equal(rootDeclarations(canvas, `--${name}`)[0], value);
  }
  assert.doesNotMatch(rootDeclarations(canvas, '--glass-tint')[0], /--accent/);
  assert.match(sidebar, /\.rail-panel-row\.selected\s*\{[^}]*background-color: var\(--row-selected\);[^}]*color: var\(--ink\)/);
  assert.match(sidebar, /\.rail-session-meta\s*\{[^}]*color: var\(--muted\)/);
  assert.doesNotMatch(sidebar, /rail-session-dot|\.rail-session-status\s*\{[^}]*color: var\(--(?:attention|working)\)/);
  assert.doesNotMatch(sidebar, /box-shadow: 0 0 0 2px var\(--(?:attention|working)\)/);
  assert.match(sidebar, /@media \(pointer: coarse\)[\s\S]*--target: 44px/);
  assert.match(source, /className="rail-session-status">\{row.statusLabel\}/);
  assert.match(source, /aria-current=\{active \? 'true' : undefined\}/);
  assert.match(source, /row\.providerLabel[\s\S]*className="rail-session-status">\{row.statusLabel\}[\s\S]*row\.time &&/);
  assert.match(source, /aria-describedby=\{`rail-meta-\$\{row.id\}`\}/);
});

test('sidebar status text retains AA over its selected neutral surface', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const studio = sheets.find(sheet => sheet.name === 'src/studio.css').css;
  assert.deepEqual(rootDeclarations('.pixel-field { --attention: transparent; } :root { --attention: #f5c04a; } .pixel-field { --attention: transparent; }', '--attention'), ['#f5c04a']);
  const rgb = name => {
    const value = rootDeclarations(canvas, `--${name}`)[0] || rootDeclarations(studio, `--${name}`)[0];
    assert.match(value, /^#[\da-f]{6}$/i);
    return value.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  };
  const luminance = values => values.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const sidebar = sheets.find(sheet => sheet.name === 'src/sidebar.css').css;
  assert.match(sidebar, /background-color: var\(--surface\)/);
  assert.match(sidebar, /background-image: var\(--object-fill\)/);
  assert.match(sidebar, /\.rail-panel-row\.selected\s*\{[^}]*background-color: var\(--row-selected\)/);
  const planes = ['object-top', 'object-bottom', 'row-selected'].map(name => [name, rgb(name)]);
  planes.push(['selected-hover', rgb('row-selected').map(value => value * .96 + .04)], ['selected-press', rgb('row-selected').map(value => value * .75)]);
  for (const [plane, values] of planes) {
    for (const ink of ['ink', 'muted', 'ink-on-glass', 'working', 'attention']) {
      const a = luminance(rgb(ink)), b = luminance(values);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${ink} on sidebar ${plane}`);
    }
  }
});

test('E3 controls share flat levels, a single segmented recipe and tonal row feedback', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const shell = sheets.find(sheet => sheet.name === 'src/shell.css').css;
  const sidebar = sheets.find(sheet => sheet.name === 'src/sidebar.css').css;
  for (const [name, value] of Object.entries({ on: '#ece6d8', 'on-hover': '#f6f1e6', 'on-press': '#d6d0c2', 'control-size': '36px', 'dock-control-size': '40px', 'control-fill': '#ffffff14', 'control-hover': '#ffffff1f', 'control-press': '#ffffff0a', 'seg-height': '36px', 'seg-pad': '4px', 'seg-gap': '4px', 'row-hover': '#ffffff0a', 'row-press': '#00000040', 'row-air': '2px', 'row-selected-hover': 'color-mix(in srgb, var(--row-selected), #fff 4%)', 'row-selected-press': 'color-mix(in srgb, var(--row-selected), #000 25%)', 'dur-fast': '120ms', 'dock-h': '64px', 'dock-clearance': '24px', 'dock-pad': '12px', 'dock-gap': '12px', 'focus-width': '2px', 'focus-offset': '2px', divider: '#ffffff12' }))
    assert.equal(rootDeclarations(canvas, `--${name}`)[0], value, name);
  assert.match(shell, /\.control-segmented\s*\{[^}]*height: var\(--seg-height\); padding: var\(--seg-pad\); gap: var\(--seg-gap\); border: 0; border-radius: var\(--r-pill\); background: var\(--control-fill\)/);
  assert.match(shell, /\.control-segmented > button\s*\{[^}]*height: calc\(var\(--seg-height\) - 2 \* var\(--seg-pad\)\)/);
  assert.match(shell, /\.dock-action\.dock-primary\s*\{[^}]*padding: 0 18px; gap: 8px;[^}]*background: var\(--primary\); color: var\(--primary-ink\)/);
  assert.equal(rootDeclarations(canvas, '--primary')[0], 'var(--accent)');
  const chat = sheets.find(sheet => sheet.name === 'src/chat.css').css;
  const settings = sheets.find(sheet => sheet.name === 'src/settings.css').css;
  assert.match(chat, /\.pc-send \{[^}]*background: var\(--primary\); color: var\(--primary-ink\)/);
  assert.match(settings, /\.st-btn\.is-primary \{[^}]*background: var\(--primary\); color: var\(--primary-ink\)/);
  assert.match(chat, /\.pc-field textarea \{[^}]*caret-color: var\(--accent\)/);
  for (const { name, css } of sheets)
    for (const [, selector, body] of css.matchAll(/([^{}]*(?:working|attention|danger|success|st-switch|st-seg)[^{}]*)\{([^}]*)\}/g))
      assert.doesNotMatch(body, /var\(--(?:accent|primary)\)/, `${name}: state/switch selector ${selector.trim()} must not use the accent`);
  assert.match(sidebar, /border-block: var\(--row-air\) solid transparent; background-clip: padding-box; border-radius: var\(--r-row\)/);
  assert.match(sidebar, /\.rail-panel-group[^{}]*::before\s*\{[^}]*height: var\(--divider-width\); background: var\(--divider\)/);
  for (const value of declarations(sidebar + shell, '(?:scale|translate)')) assert.equal(value, 'none');
  assert.match(canvas, /\.pc-send, \.pc-modes button, \.pc-field button, \.pd-tabs button\):active:not\(:disabled\)\s*\{\s*scale: none/);
  assert.match(shell, /@media \(pointer: coarse\)[\s\S]*--target: 44px/);
  assert.match(shell, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important/);
  const luminance = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  for (const state of ['working', 'attention']) assert.ok(1.05 / (luminance(rootDeclarations(canvas, `--badge-${state}`)[0]) + .05) >= 3, `White glyph on ${state} badge retains 3:1`);
});

test('object chrome has a vertical fill, one ring and accessible opaque material', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const tokens = canvas.match(/:root\s*\{([^}]+)\}/)?.[1];
  assert.ok(tokens);
  assert.equal(declarations(tokens, '--glass')[0], 'var(--surface)');
  assert.equal(declarations(tokens, '--glass-thick')[0], 'var(--surface)');
  assert.equal(declarations(tokens, '--glass-filter')[0], 'none');
  assert.equal(declarations(tokens, '--glass-sheen')[0], 'var(--object-fill)');
  for (const [name, value] of Object.entries({ 'object-top': '#151518', 'object-bottom': '#0b0b0d', 'object-sheen': 'radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, #fff 4%, transparent), transparent 60%)', 'object-fill': 'var(--object-sheen), linear-gradient(var(--object-top), var(--object-bottom))', 'object-ring-width': '1px', 'object-edge-top': 'color-mix(in srgb, #fff 26%, transparent)', 'object-edge-bottom': 'color-mix(in srgb, #fff 7%, transparent)', 'object-ring': 'linear-gradient(var(--object-edge-top), var(--object-edge-bottom))', 'selected-edge-top': 'color-mix(in srgb, #fff 36%, transparent)', 'selected-edge-bottom': 'color-mix(in srgb, #fff 10%, transparent)' }))
    assert.equal(declarations(tokens, `--${name}`)[0], value);
  assert.equal(declarations(tokens, '--on')[0], '#ece6d8');
  assert.equal(declarations(tokens, '--on-ink')[0], '#141414');
  const chrome = declarations(tokens, '--shadow-chrome')[0];
  assert.doesNotMatch(chrome, /\binset\b/);
  assert.equal(declarations(tokens, '--ease-spring')[0], 'var(--ease-settle)');
  assert.match(canvas, /@media\s*\(prefers-contrast:\s*more\)/);
  for (const preference of ['prefers-reduced-transparency: reduce', 'prefers-contrast: more']) {
    const block = canvas.slice(canvas.indexOf(`@media (${preference})`)).match(/:root\s*\{([^}]+)\}/)?.[1];
    assert.ok(block, `${preference} declares opaque material tokens`);
    assert.match(block, /--glass:\s*var\(--surface\)/);
    assert.match(block, /--glass-thick:\s*var\(--surface\)/);
    assert.match(block, /--glass-filter:\s*none/);
    assert.match(block, /--glass-sheen:\s*var\(--object-fill\)/);
  }
  const bad = [];
  // Reading planes cannot acquire control relief; object material is shared.
  const plane = /(?:^|[\s>+~])(?:\.pc-thread|\.terminal-[\w-]+|\.canvas-node\[data-type=["']terminal["']\])(?=[:.\[#]|$)(?:[^\s>+~]*)$/;
  for (const { name, css } of sheets) {
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/var\(--(?:shadow-key|shadow-well)\)/.test(body)) continue;
      for (const selector of split(selectors, ',')) {
        if (plane.test(selector)) bad.push(`${name}: ${selector}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'Reading planes never borrow control relief');
  assert.match(canvas, /\.canvas-node\s*\{[^}]*border: 0;[^}]*background: var\(--object-fill\) var\(--surface\)/);
  assert.match(canvas, /\.canvas \.canvas-node > \.node-header,\s*\.canvas \.canvas-node > \.node-body\s*\{\s*background: transparent/);
  const settings = sheets.find(sheet => sheet.name === 'src/settings.css').css;
  assert.match(settings, /\.inspector-host\.settings-sheet\s*\{[^}]*background: var\(--object-fill\) var\(--surface\)/);
  assert.match(canvas, /\.activity-dock \.dock-main::before, \.activity-dock \.activity-notch::before\s*\{\s*content: none/);
  for (const { name, css } of sheets) {
    for (const value of declarations(css, 'background-color'))
      assert.doesNotMatch(value, /gradient\(|var\(--(?:object-fill|object-ring|glass-sheen|workplane-wash)\)/, `${name}: images cannot be background colors`);
  }
});

test('workplane elevation aliases share object contact and the canvas exposes environmental art', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const studio = sheets.find(sheet => sheet.name === 'src/studio.css').css;
  const plane = canvas.match(/\.canvas \.canvas-node\[data-type="terminal"\]\s*\{([^}]+)\}/)?.[1];
  assert.ok(plane);
  assert.match(plane, /--shadow-rest:\s*var\(--shadow-workplane-rest\)/);
  assert.match(plane, /--shadow-float:\s*var\(--shadow-workplane-lift\)/);
  for (const name of ['workplane-rest', 'workplane-lift']) assert.equal(rootDeclarations(canvas, `--shadow-${name}`)[0], 'var(--shadow-chrome)');
  assert.match(plane, /filter:\s*none/);
  assert.match(plane, /backdrop-filter:\s*none/);
  assert.doesNotMatch(canvas, /brightness\(\.7\)|saturate\(\.72\)/);
  assert.match(studio, /\.canvas-region \.canvas\s*\{[^}]*z-index:\s*1;[^}]*background-color:\s*transparent/);
});

test('neutral reading and state inks retain AA contrast on opaque planes', () => {
  const css = readFileSync(path.join(root, 'src/studio.css'), 'utf8');
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const rgb = name => {
    const value = rootDeclarations(canvas, `--${name}`)[0] || rootDeclarations(css, `--${name}`)[0];
    assert.ok(value, `Declared opaque palette token --${name}`);
    assert.match(value, /^#[\da-f]{6}$/i);
    return value.slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
  };
  const luminance = values => values.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const planes = ['bg', 'surface', 'surface-2', 'surface-3', 'terminal-bg', 'well', 'well-raised', 'well-terminal', 'object-top', 'object-bottom'].map(name => [name, rgb(name)]);
  for (const t of [.25, .5, .75]) planes.push([`gradient ${t}`, rgb('object-top').map((v, i) => v * (1 - t) + rgb('object-bottom')[i] * t)]);
  for (const [plane, values] of planes) {
    for (const ink of ['ink', 'muted', 'ink-3', 'prose-ink', 'terminal-ink', 'working', 'attention', 'action', 'success', 'danger', 'idle']) {
      const a = luminance(values), b = luminance(rgb(ink)), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const minimum = ink === 'idle' ? 3 : 4.5;
      assert.ok(ratio >= minimum, `--${ink} on --${plane}: ${ratio.toFixed(2)} < ${minimum}`);
    }
  }
});

test('workplanes and wells are opaque without blur and composer height never animates', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const chat = sheets.find(sheet => sheet.name === 'src/chat.css').css;
  const side = sheets.find(sheet => sheet.name === 'src/phantom-chat.css').css;
  const terminal = sheets.find(sheet => sheet.name === 'src/terminal.css').css;
  const tokens = canvas.match(/:root\s*\{([^}]+)\}/)[1];
  assert.equal(declarations(tokens, '--workplane')[0], 'var(--surface)');
  assert.equal(declarations(tokens, '--workplane-wash')[0], 'var(--object-fill)');
  for (const [token, color] of Object.entries({ well: '#040405', 'well-raised': '#0b0b0d', 'well-terminal': '#040405' })) {
    for (const value of declarations(canvas, `--${token}`)) assert.equal(value, color, `--${token} stays opaque in every preference`);
  }
  assert.match(canvas, /\.canvas \.canvas-node\[data-type="terminal"\]\s*\{[^}]*background-color:\s*var\(--workplane\);[^}]*background-image:\s*var\(--workplane-wash\)/);
  assert.match(side, /\.phantom-chat\s*\{[^}]*background-color:\s*var\(--workplane\);[^}]*background-image:\s*var\(--workplane-wash\)/);
  assert.match(side, /\.phantom-chat \.pc-thread\s*\{[^}]*background:\s*var\(--well\)/);
  assert.match(chat, /\.pc-thread\s*\{[^}]*background:\s*var\(--well-terminal\)/);
  assert.match(chat, /\.pc-composer\s*\{[^}]*background:\s*var\(--well-terminal\)/);
  assert.match(side, /\.phantom-chat \.pc-composer\s*\{[^}]*background:\s*var\(--well\)/);
  assert.match(chat, /\.pc-field\s*\{[^}]*border-radius:\s*var\(--r-obj\);[^}]*background:\s*var\(--composer-fill\);[^}]*box-shadow:\s*inset 0 0 0 1px var\(--composer-ring\)/);
  assert.match(terminal, /\.pt-card-screen,[^{]+\{[^}]*background:\s*var\(--well-terminal\)/);
  const plane = /(?:^|[\s>+~])(?:\.pc|\.pc-thread|\.pc-composer|\.phantom-chat|\.pt-card|\.pt-card-screen|\.terminal-panel|\.terminal-host|\.canvas-node\[data-type="terminal"\])(?=[:.\[#]|$)(?:[^\s>+~]*)$/;
  for (const { name, css } of sheets) {
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!declarations(body, '(?:-webkit-)?backdrop-filter').some(value => value !== 'none')) continue;
      for (const selector of split(selectors, ',')) assert.ok(!plane.test(selector), `No backdrop filter on workplane: ${name}: ${selector}`);
    }
  }
  assert.match(chat, /\.pc-field textarea\s*\{[^}]*transition:\s*none/);
  for (const file of ['ChatCard', 'PhantomChat', 'PhantomOrchestrator']) {
    const source = readFileSync(path.join(root, `src/components/${file}.jsx`), 'utf8');
    assert.match(source, /useComposerSize\(input, preview/);
    assert.match(source, /const preview = dictationPreview\(voice, draft\)/);
    assert.doesNotMatch(source, /Math\.min\(el\.scrollHeight/);
  }
});

test('E5 session rows, quote and activity use two surface levels and measured progress only', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const chat = sheets.find(sheet => sheet.name === 'src/chat.css').css;
  const source = readFileSync(path.join(root, 'src/components/ChatCard.jsx'), 'utf8');
  for (const [name, value] of Object.entries({ 'session-row-height': '64px', 'choice-col': '20px', 'radio-dot': '8px', 'activity-row-height': '40px', 'activity-row-py': '8px', 'progress-height': '4px', 'progress-track': '#2c2c2d', 'quote-width': '2px', 'quote-inset': '12px', 'quote-gap': '8px', 'composer-field-min': '40px', 'composer-gap': '12px', 'prose-ink': '#d9d6cf', 't-code': '400 12px/16px var(--mono)' }))
    assert.equal(rootDeclarations(canvas, `--${name}`)[0], value);
  assert.match(source, /AGENT_MODES\.filter\(mode => enabled\.includes\(mode.id\)\)/);
  assert.equal(rootDeclarations(canvas, '--panel-header-session')[0], '56px');
  assert.equal(rootDeclarations(canvas, '--t-terminal-preview')[0], '400 12px/18px var(--mono)');
  assert.match(chat, /\.activity-trace\s*\{ --trace-duration: 7s/);
  for (const [index, length] of ['14px', '10px', '6px', '3px', '1.2px'].entries()) assert.ok(chat.includes(`rect:nth-child(${index + 1}) { --L: ${length} !important; }`));
  assert.match(source, /className="pc-modes control-segmented"/);
  assert.match(source, /role="radio" aria-checked=\{active === mode.id\}/);
  assert.match(source, /'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'/);
  assert.match(source, /<blockquote className="pc-message is-user">/);
  assert.match(source, /phantom \? <PhantomGlyph size=\{16\}/);
  assert.match(source, /state.live && state.total > 0 && <progress[^>]+max=\{state.total\} value=\{state.passed\}/);
  assert.doesNotMatch(source, /<progress(?![^>]*max=\{state.total\})/);
  assert.match(chat, /\.pc-message.is-user\s*\{[^}]*border-left: var\(--quote-width\) solid var\(--on\);[^}]*background: none/);
  assert.match(chat, /\.pc-tools::before\s*\{[^}]*left: 32px; top: 10px; bottom: 18px;[^}]*background: var\(--divider\)/);
  assert.match(chat, /\.pc-subagent\s*\{[^}]*background: none/);
  assert.match(chat, /\.pc-session-row\s*\{[^}]*border-radius: var\(--r-row\)/);
  assert.match(chat, /\.pc-composer\s*\{[^}]*padding: 0 24px 24px;/);
  assert.doesNotMatch(chat, /\.pc-composer\s*\{[^}]*border-top:/);
  assert.match(chat, /\.pc-field:focus-within\s*\{[^}]*background:\s*var\(--composer-fill-lit\)/);
  assert.match(chat, /\.pc-field textarea:focus-visible\s*\{[^}]*outline:\s*0/);
  for (const [name, value] of Object.entries({ 'composer-fill': 'color-mix(in srgb, #fff 3%, transparent)', 'composer-fill-lit': 'color-mix(in srgb, #fff 5%, transparent)', 'composer-ring': 'color-mix(in srgb, #fff 8%, transparent)', 'composer-light-top': 'color-mix(in srgb, #fff 30%, transparent)', 'composer-max': '720px' }))
    assert.equal(rootDeclarations(canvas, `--${name}`)[0], value);
  for (const css of [chat, sheets.find(sheet => sheet.name === 'src/phantom-chat.css').css]) {
    assert.doesNotMatch(css, /\.pc-field(?::hover|\.is-listening)\s*\{/);
    assert.doesNotMatch(css, /\.pc\.is-focused \.pc-(?:composer|controls|field textarea)\s*\{/);
  }
});

test('E5 dictation is a field preview and a real-level meter without decorative loops', () => {
  const css = sheets.find(sheet => sheet.name === 'src/voice.css').css;
  const source = readFileSync(path.join(root, 'src/components/VoiceActivity.jsx'), 'utf8');
  for (const [name, value] of Object.entries({ 'meter-height': '36px', 'meter-px': '12px', 'meter-gap': '8px', 'meter-fill': '#ffffff14', 'bar-width': '3px', 'bar-gap': '3px', 'bar-radius': '2px', 'bars-height': '16px', 'composer-divider': '#ffffff26' }))
    assert.equal(rootDeclarations(css, `--voice-${name}`)[0], value);
  assert.doesNotMatch(source + css, /requestAnimationFrame|VoiceOrb|voice-aura|Te escucho|te escucho|Cancelar audio/);
  assert.match(source, /voice.status === 'recording' && Number.isFinite\(voice.level\)/);
  assert.match(source, /'--bar-level': level \* weight/);
  assert.match(source, /if \(voice.status === 'idle'\) return draft/);
  assert.match(source, /if \(voice.status === 'idle'\) return null/);
  assert.match(source, /aria-label="Descartar dictado"/);
  assert.match(source, /aria-label="Terminar dictado"/);
  assert.match(css, /\.voice-live-confirmed\s*\{ color: var\(--ink\)/);
  assert.match(css, /\.voice-live-partial\s*\{ color: var\(--muted\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important; transition: none !important/);
  for (const file of ['ChatCard', 'PhantomChat', 'PhantomOrchestrator']) {
    const component = readFileSync(path.join(root, `src/components/${file}.jsx`), 'utf8');
    assert.match(component, /<VoiceTranscript voice=\{voice\} draft=\{draft\}/);
    assert.match(component, /hint="Esc descarta · Enter envía"/);
    assert.match(component, /value=\{preview\} readOnly=\{voice.status !== 'idle'\}/);
    assert.match(component, /sendAction\(/);
    assert.match(component, /canSubmit\(/);
  }
});

test('reading and state inks retain AA on opaque wells, including a white image behind them', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const studio = sheets.find(sheet => sheet.name === 'src/studio.css').css;
  const tokens = canvas.match(/:root\s*\{([^}]+)\}/)[1];
  const rgb = name => {
    const value = declarations(tokens, `--${name}`)[0] || rootDeclarations(studio, `--${name}`)[0];
    assert.match(value, /^#[\da-f]{6}$/i);
    return value.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  };
  const luminance = rgb => rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const token of ['well', 'well-raised', 'well-terminal']) {
    const value = declarations(tokens, `--${token}`)[0];
    assert.match(value, /^#[\da-f]{6}$/i, 'Wells have no alpha channel');
    const alpha = 1;
    for (const background of [[0, 0, 0], [1, 1, 1], rgb('surface-3')]) {
      const composite = rgb(token).map((v, i) => v * alpha + background[i] * (1 - alpha));
      assert.deepEqual(composite, rgb(token), 'A white image cannot penetrate the well');
      for (const ink of ['ink', 'muted', 'ink-3', 'working', 'attention', 'action', 'success', 'danger']) {
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
  const token = name => rgb(declarations(tokens, `--${name}`)[0] || rootDeclarations(studio, `--${name}`)[0]);
  const over = (front, back, alpha) => front.map((v, i) => v * alpha + back[i] * (1 - alpha));
  const luminance = rgb => rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  assert.match(declarations(tokens, '--glass-tint')[0], /^#[\da-f]{6}$/i);
  assert.ok(luminance(token('glass-tint')) <= luminance(token('surface')));
  const sidebar = sheets.find(sheet => sheet.name === 'src/sidebar.css').css;
  const chat = sheets.find(sheet => sheet.name === 'src/chat.css').css;
  const shell = sheets.find(sheet => sheet.name === 'src/shell.css').css;
  const panels = sheets.find(sheet => sheet.name === 'src/panels.css').css;
  assert.doesNotMatch(panels, /\.dock-action\[data-type\][^{}]*\{[^}]*var\(--type\b/);
  assert.match(sidebar, /\.context-menu-panel\s*\{[^}]*background-color: var\(--menu\)/);
  assert.match(chat, /\.pc-models\s*\{[^}]*background: var\(--object-fill\) var\(--menu\)/);
  for (const [, selectors, body] of shell.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.includes('.dock-action'))
      for (const background of declarations(body, 'background(?:-color)?')) assert.doesNotMatch(background, /var\(--type\b/);
  }
  const backgrounds = [token('bg'), ...[...studio.matchAll(/--atmosphere:[^;}]+/g)]
    .flatMap(([value]) => [...value.matchAll(/#[\da-f]{6}\b/gi)].map(([hex]) => rgb(hex)))];
  // Opaque chrome stays independent of atmospheres and project accents.
  for (const accent of ['action', 'attention', 'success', 'danger', 'ink']) {
    for (const material of ['object-top', 'object-bottom']) {
      for (const background of backgrounds) {
        const plane = token(material);
        const composite = over(plane, background, 1);
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
  const flash = canvas.match(/\.canvas-node::after\s*\{([^}]+)\}/)[1];
  assert.equal(declarations(flash, 'padding')[0], 'var(--object-ring-width)');
  assert.equal(declarations(flash, 'inset')[0], '0');
  assert.equal(declarations(flash, 'mask-composite')[0], 'exclude');
  assert.equal(declarations(flash, 'pointer-events')[0], 'none');
  assert.match(canvas, /\.canvas-node\.map-flash::after\s*\{\s*animation: map-flash var\(--map-flash-duration\) var\(--ease-settle\)/);
  assert.equal(rootDeclarations(canvas, '--map-flash-duration')[0], '900ms');
  assert.equal(rootDeclarations(canvas, '--dur-open')[0], '320ms');
  const trace = sheets.find(sheet => sheet.name === 'src/activity-trace.css').css;
  assert.equal(rootDeclarations(canvas, '--trace-width')[0], '1.5px');
  assert.equal(rootDeclarations(canvas, '--trace-duration')[0], '5.6s');
  assert.equal(rootDeclarations(canvas, '--working-head')[0], '#e2ff7a');
  assert.match(trace, /animation: trace-orbit var\(--trace-duration\) linear infinite/);
  assert.doesNotMatch(trace, /drop-shadow|trace-error|steps\(|pulse-success|pulse-attention|pulse-turn/);
  assert.match(trace, /stroke-dasharray: var\(--L\) calc\(100px - var\(--L\)\)/);
  assert.match(trace, /\.studio-concentration[\s\S]*animation-play-state: paused/);
  assert.match(trace, /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  const source = readFileSync(path.join(root, 'src/components/Canvas.jsx'), 'utf8');
  assert.doesNotMatch(source, /PixelField|PIXEL_KIND/);
  assert.match(source, /state === 'working' && <ActivityTrace/);
  for (const state of ['working', 'error', 'success']) assert.match(canvas, new RegExp(`\\.canvas-node\\.pulse-${state}\\s*\\{\\s*--pulse:`));
  for (const name of ['canvas-ui', 'terminal', 'chat', 'phantom-chat', 'sidebar', 'studio']) {
    const css = sheets.find(sheet => sheet.name === `src/${name}.css`).css;
    assert.doesNotMatch(css, /animation\s*:[^;}]*\binfinite\b/, `${name}: no continuous material/status animation`);
  }
});

test('deep black planes step up in order and menus share the object material', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const menus = sheets.find(sheet => sheet.name === 'src/menus.css').css;
  const level = name => parseInt(rootDeclarations(canvas, `--${name}`)[0].slice(1, 3), 16);
  const ladder = ['bg', 'terminal-bg', 'surface', 'surface-2', 'surface-3'].map(level);
  assert.deepEqual(ladder, [...ladder].sort((a, b) => a - b), 'Planes must step from the black canvas upwards.');
  assert.ok(level('bg') <= 8, 'The canvas stays black.');
  assert.ok(level('surface-3') <= 32, 'No plane rises into grey.');
  assert.match(menus, /background-color: var\(--menu\)/);
  for (const name of ['bg', 'surface', 'surface-2', 'surface-3', 'terminal-bg']) {
    const studio = sheets.find(sheet => sheet.name === 'src/studio.css').css;
    assert.equal(rootDeclarations(canvas, `--${name}`)[0], rootDeclarations(studio, `--${name}`)[0]);
  }
  assert.equal(rootDeclarations(canvas, '--menu')[0], 'var(--surface)');
  assert.equal(rootDeclarations(canvas, '--dot')[0], 'color-mix(in srgb, #f2f0eb 5%, transparent)');
  assert.doesNotMatch(canvas, /var\(--dot-major\)/);
  assert.match(canvas, /radial-gradient\(var\(--dot\) 1px, transparent 1\.2px\)/);
  assert.match(menus, /background-image: var\(--object-fill\)/);
  assert.match(menus, /mask-composite: exclude/);
  assert.match(menus, /select:not\(\[multiple\]\):not\(\[size\]\)\s*\{[^}]*appearance: base-select/);
  assert.match(menus, /::picker\(select\)\s*\{[^}]*appearance: base-select/);
  // The current value is ink, weight and a mark; the only fill is hover/keyboard.
  assert.match(menus, /\[aria-selected="true"\]:not\(:hover, :focus-visible\)[^{]*\{[^}]*background: none/s);
  assert.doesNotMatch(menus, /outline:\s*2px/);
});

test('stable badge palette is defined, rail uses state and active switches stay ivory with dark indicators', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  for (const [name, value] of Object.entries({ steel: 'oklch(0.64 0.11 250)', mint: 'oklch(0.64 0.10 165)', honey: 'oklch(0.64 0.11 85)', coral: 'oklch(0.64 0.11 30)', violet: 'oklch(0.64 0.10 300)', petrol: 'oklch(0.64 0.10 210)', neutral: 'oklch(0.36 0.008 260)', working: '#5d7521', attention: '#b5872f', ink: '#fff' }))
    assert.equal(rootDeclarations(canvas, `--badge-${name}`)[0], value);
  for (const { name, css } of sheets) for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const value of declarations(body, 'background(?:-color|-image)?')) {
      if (!/var\(--badge-/.test(value)) continue;
      if (name === 'src/settings.css') {
        assert.match(selectors.trim(), /^\.st-ico(?:\[data-tone="(?:steel|violet)"\])?$/);
        assert.match(value, /^var\(--badge-(?:neutral|steel|violet)\)$/);
      } else if (name === 'src/chat.css') {
        for (const selector of split(selectors.trim(), ',')) assert.match(selector, /^\.pc-session-badge(?:\[data-provider="(?:claude|opencode|codex)"\]|\.is-(?:permission|folder|model))?$/);
        assert.match(value, /^var\(--badge-(?:neutral|coral|mint|steel|violet)\)$/);
      } else {
        assert.equal(name, 'src/sidebar.css');
        assert.match(selectors.trim(), /(?:\.rail-agent-mark|\.project-initials)$/);
        assert.doesNotMatch(value, /--badge-(?:steel|mint|honey|coral|violet|petrol)/, 'Type mode is not enabled');
      }
    }
  }
  const source = readFileSync(path.join(root, 'src/components/Settings.jsx'), 'utf8');
  const categories = source.match(/const CATEGORIES = \[([\s\S]*?)\n\];/)[1];
  assert.equal([...categories.matchAll(/\['[^']+', '[^']+', \w+, '(?:neutral|steel|violet)'\]/g)].length, 8);
  for (const [id, tone] of [['git', 'steel'], ['data', 'steel'], ['voice', 'violet']]) assert.match(categories, new RegExp(`\\['${id}', '[^']+', \\w+, '${tone}'\\]`));
  assert.doesNotMatch(categories, /'working'|'success'|'attention'|'danger'|'accent'/);
  assert.match(source, /className="st-ico" data-tone=\{tone\}/);
  const css = sheets.find(sheet => sheet.name === 'src/settings.css').css;
  assert.match(css, /\.st-ico\s*\{[^}]*width: var\(--badge-size\); height: var\(--badge-size\); border-radius: 50%; background: var\(--badge-neutral\); color: var\(--badge-ink\)/);
  assert.doesNotMatch(css, /(?:hover|active|aria-current)[^{]*\.st-ico\s*\{/);
  assert.match(css, /\.st-switch\[aria-checked="true"\]\s*\{\s*background: var\(--on\)/);
  assert.match(css, /\.st-switch\[aria-checked="true"\] > i\s*\{[^}]*background: var\(--on-ink\)/);
  assert.match(css, /\.st :is\(button, input, select, textarea, summary\):focus-visible\s*\{\s*outline: 2px solid var\(--accent\)/);
  const incorporaciones = sheets.find(sheet => sheet.name === 'src/incorporaciones.css').css;
  assert.match(incorporaciones, /\.inc-switch\[aria-checked="true"\]\s*\{\s*background: var\(--on\)/);
  assert.match(incorporaciones, /\.inc-switch\[aria-checked="true"\] i\s*\{[^}]*background: var\(--on-ink\)/);
  const branches = sheets.find(sheet => sheet.name === 'src/branches.css').css;
  assert.doesNotMatch(branches, /\.br-button\.is-armed[^{}]*\{[^}]*var\(--success\)/);
  const terminal = sheets.find(sheet => sheet.name === 'src/terminal.css').css;
  for (const provider of ['claude', 'opencode', 'codex', 'agent']) {
    assert.equal(declarations(terminal, `--hue-${provider}`)[0], 'var(--ink)', `${provider} chrome is decorative, not a state`);
  }
});

test('E4 settings use flat groups, inset dividers and borderless aligned controls', () => {
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  const css = sheets.find(sheet => sheet.name === 'src/settings.css').css;
  for (const [name, value] of Object.entries({ 'inspector-width': '320px', 'interior-flat': '#111113', 'r-group': 'calc(var(--r-obj) - var(--box-pad))', 'section-gap': '8px', 'group-gap': '12px', 'row-py': '12px', 'divider-inset': 'calc(var(--row-px) + var(--icon-col) + var(--row-gap))', 'settings-switch-width': '44px', 'settings-switch-height': '26px', 'settings-switch-thumb': '20px', 'settings-slider-height': '32px', 'control-off': '#4e4e50' }))
    assert.equal(rootDeclarations(canvas, `--${name}`)[0], value, name);
  assert.match(css, /\.inspector-host\.settings-sheet\s*\{[^}]*inset: var\(--gutter\) var\(--gutter\) var\(--gutter\) auto;[^}]*width: min\(var\(--inspector-width\)/);
  assert.match(css, /\.st-list\s*\{[^}]*border: 0; border-radius: var\(--r-group\); background: var\(--interior-flat\); box-shadow: none/);
  assert.match(css, /\.st-nav li \+ li::before\s*\{ left: var\(--divider-inset\)/);
  assert.match(css, /:is\(:hover, :active\) \+ \*::before/);
  assert.match(css, /\.st-row:hover\s*\{ background-color: var\(--row-hover\)/);
  assert.match(css, /\.st-row:active\s*\{ background-color: var\(--row-press\)/);
  assert.match(css, /\.st :is\(\.st-input, \.st-select\)\s*\{[^}]*border: 0; background: transparent; box-shadow: inset 0 0 0 1px color-mix\(in srgb, var\(--ink\) 12%, transparent\)/);
  assert.match(css, /\.st :is\(\.st-input, \.st-select\):is\(:focus, :focus-visible\)\s*\{ outline: none; box-shadow: inset 0 0 0 1px color-mix\(in srgb, var\(--ink\) 40%, transparent\)/);
  assert.match(css, /\.st-switch > i\s*\{[^}]*transition: transform 200ms var\(--ease-settle\)/);
  assert.match(css, /\.st-switch\[aria-checked="true"\] > i\s*\{ transform: translateX\(18px\)/);
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.includes('.settings-sheet') || selectors.trim() === '.st-slider' || selectors.trim() === '.st-slider-fill') continue;
    for (const value of declarations(body, 'background(?:-image)?')) assert.doesNotMatch(value, /gradient\(|--object-(?:fill|ring)/, selectors);
    for (const value of declarations(body, '(?:scale|translate)')) assert.equal(value, 'none');
    for (const value of declarations(body, 'border')) assert.match(value, /^(0|none)\b/);
  }
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*transition: none !important/);
});

test('E4 identity reuses Titi, preserves legacy preference keys and stops decorative rest', () => {
  const source = file => readFileSync(path.join(root, file), 'utf8');
  for (const file of ['src/App.jsx', 'src/components/Appearance.jsx', 'src/components/GengarMascot.jsx']) assert.doesNotMatch(source(file), /assets\/gengar|Mostrar Gengar|title="Gengar"/);
  assert.match(source('src/components/Appearance.jsx'), /label="Mostrar Titi" checked=\{appearance.gengar\}/);
  assert.match(source('src/components/Appearance.jsx'), /update\(\{ gengarIntensity: Number\(e.target.value\) \}\)/);
  assert.match(source('src/App.jsx'), /identity=\{appearance.gengar && view.nodes.some\(node => !node.data\?\.hidden\)\}/);
  assert.doesNotMatch(source('src/App.jsx'), /<PhantomFace|--gengar-art/);
  assert.doesNotMatch(source('src/components/PhantomChat.jsx'), /PhantomGlyph|PhantomFace/);
  assert.match(source('src/components/Glyphs.jsx'), /still data-operation-glyph="titi"/);
  assert.match(source('src/components/TitiGhost.jsx'), /useSpriteMotion\(canvasRef, !still && !\['calm', 'asleep'\].includes\(mood\)\)/);
  assert.match(source('src/components/TitiGhost.jsx'), /cancelAnimationFrame\(raf\)/);
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  for (const [name, value] of Object.entries({ 'identity-size': '40px', 'identity-inset': '4px', 'identity-glyph-size': '16px', 'identity-ink': 'var(--on)' })) assert.equal(rootDeclarations(canvas, `--${name}`)[0], value);
});

test('attention aliases colour only the masked panel ring and compact marks, never surfaces or wells', () => {
  const aliases = new Set(['--attention', '--warning', '--tone', '--pc-tone', '--badge-attention']);
  const references = value => [...value.matchAll(/var\((--[\w-]+)/g)].map(match => match[1]);
  const usesAttention = value => /#(?:f5c04a|b5872f)\b|rgba?\(\s*245[, ]+192[, ]+74\b/i.test(value) || references(value).some(name => aliases.has(name));
  let changed;
  do {
    changed = false;
    for (const { css } of sheets) for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:([^;}]+)/g)) {
      if (!aliases.has(name) && usesAttention(value)) { aliases.add(name); changed = true; }
    }
  } while (changed);
  const marks = /(?:\.rail-session-dot\.warning|\.attention-button i|\.status-dot\.(?:connecting|disconnected)|\.host-indicator\.(?:connecting|reconnecting) i|\.pt-card-now\[data-tone="attention"\] > i|\.pt-card-line\.is-current::before|\.reference-timeline button|\.phantom-chat-toggle:is\([^{}]+\)::after|\.pd-tab-dot|\.notch-dot|\.phantom-launcher-dot|\.pc-context-bands li\.is-watch > i|\.rp-dirty-dot|\.rp-mix-seg\.is-conflict|\.rp-mix-key\.is-conflict i|\.rp-side-mix \.is-conflict|\.pc-dep i)$/;
  const bad = [];
  for (const { name, css } of sheets) for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const declaration of body.split(';')) {
      const match = declaration.match(/^\s*([\w-]+)\s*:\s*([\s\S]*)$/);
      if (!match) continue;
      const [, property, value] = match;
      if (!/^(?:background(?:-[\w-]+)?|border(?:-[\w-]+)?|outline(?:-[\w-]+)?|box-shadow|filter|fill|stroke)$/.test(property) || !usesAttention(value)) continue;
      for (const selector of split(selectors.trim(), ',')) {
        if (/^background(?:-color)?$/.test(property) && marks.test(selector)) continue;
        if (property === 'stroke' && selector.includes('.phantom-face')) continue;
        if (name === 'src/sidebar.css' && property === 'background' && value.trim() === 'var(--badge-attention)' && selector === '.rail-session-row[data-state="attention"] > button > .rail-agent-mark') continue;
        if (name === 'src/canvas-ui.css' && property === 'background' && value.trim() === 'var(--attention-ring)' && /^\.canvas-node\[data-panel-state="attention"\]::(?:before|after)$/.test(selector)) continue;
        bad.push(`${name}: ${selector}: ${property}: ${value}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'Attention is ink, a compact mark or the masked panel ring, never a tinted surface');
  const terminal = sheets.find(sheet => sheet.name === 'src/terminal.css').css;
  assert.match(terminal, /\.pt-state\s*\{[^}]*background: var\(--fill-2\)/);
  assert.doesNotMatch(terminal, /\.pt-state\s*\{[^}]*background:[^;}]*currentColor/);
  const canvas = sheets.find(sheet => sheet.name === 'src/canvas-ui.css').css;
  assert.equal(rootDeclarations(canvas, '--attention-ring')[0], 'color-mix(in srgb, var(--attention) 80%, transparent)');
  assert.match(canvas, /\.canvas-node\[data-panel-state="attention"\]::before\s*\{\s*background: var\(--attention-ring\)/);
});

test('ivory fallback agrees across CSS, preferences and terminal without losing saved accents or ANSI', () => {
  const studio = sheets.find(sheet => sheet.name === 'src/studio.css').css;
  for (const [name, color] of Object.entries({ attention: '#f5c04a', success: '#65ba83', working: '#c6f135', action: '#c6f135', danger: '#f27670', accent: '#f2f0eb' })) {
    assert.equal(rootDeclarations(studio, `--${name}`)[0], color);
  }
  assert.equal(defaults.accent, 'ivory');
  for (const value of [undefined, null, '', 'missing']) {
    assert.equal(accentColor(value), '#f2f0eb');
    assert.equal(normalizeAppearance({ accent: value }).accent, 'ivory');
  }
  for (const [key, , color] of ACCENTS) {
    assert.equal(accentColor(normalizeAppearance({ v: 4, accent: key }).accent), color);
  }
  const source = readFileSync(path.join(root, 'src/components/TerminalPanel.jsx'), 'utf8');
  const body = source.match(/function phantomTheme\(\) \{([\s\S]*?)\n\}/)[1];
  const theme = tokens => Function('getComputedStyle', 'document', body)(() => ({ getPropertyValue: name => tokens[name] || '' }), { documentElement: {} });
  const fallback = theme({});
  assert.equal(fallback.cursor, '#f2f0eb');
  assert.equal(fallback.background, '#040405');
  assert.equal(fallback.background, rootDeclarations(studio, '--terminal-bg')[0]);
  assert.equal(fallback.foreground, rootDeclarations(studio, '--terminal-ink')[0]);
  assert.equal(fallback.selectionBackground, '#f2f0eb4d');
  const personal = theme({ '--accent': '#f27670', '--terminal-bg': '#151515', '--terminal-ink': '#f2f0eb' });
  assert.equal(personal.cursor, '#f27670');
  assert.equal(personal.background, '#151515');
  assert.equal(personal.foreground, '#f2f0eb');
  const ansi = { black: '#232040', red: '#ff86b7', green: '#7aeec4', yellow: '#f5cf8a', blue: '#7da8ff', magenta: '#c39bff', cyan: '#6fe3f2', white: '#a9a6cf', brightBlack: '#5d5888', brightRed: '#ffa3c8', brightGreen: '#9df4d4', brightYellow: '#f8dca8', brightBlue: '#a0c0ff', brightMagenta: '#d6b8ff', brightCyan: '#98ecf6', brightWhite: '#e4e2f7' };
  for (const [name, color] of Object.entries(ansi)) {
    assert.equal(fallback[name], color);
    assert.equal(personal[name], color);
  }
});
