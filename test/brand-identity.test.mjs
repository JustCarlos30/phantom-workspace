import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('el icono es un SVG válido de Titi, no los bloques antiguos', async () => {
  const svg = await read('assets/phantom.svg');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 128 128"/);
  assert.match(svg, /<\/svg>\s*$/);
  assert.match(svg, /<title>Titi<\/title>/);
  assert.doesNotMatch(svg, /#202c44|#779aff/);
});

test('el empaquetado fija StartupWMClass e Icon a un PNG', async () => {
  const source = await read('scripts/package.mjs');
  assert.match(source, /StartupWMClass=\$\{metadata\.name\}/);
  assert.match(source, /phantom-icon\.png/);
  assert.match(source, /Icon=\$\{iconPath\}/);
  assert.match(source, /\.local.*share.*applications/s);
});

test('los glyphs de proveedor existen y dibujan svg con viewBox 24', async () => {
  const source = await read('src/components/Glyphs.jsx');
  assert.match(source, /viewBox: '0 0 24 24'/);
  for (const name of ['ClaudeGlyph', 'OpenCodeGlyph', 'CodexGlyph', 'providerKey']) {
    assert.match(source, new RegExp(`export function ${name}\\b`));
  }
  for (const name of ['ClaudeGlyph', 'OpenCodeGlyph', 'CodexGlyph']) {
    const body = source.split(`export function ${name}`)[1].split('\n}')[0];
    assert.match(body, /<svg [^>]*\{\.\.\.base\}/);
  }
});

test('OpenCodeGlyph se distingue de ShellGlyph y no usa el chevron de terminal', async () => {
  const source = await read('src/components/Glyphs.jsx');
  const body = name => source.split(`export function ${name}`)[1].split('\n}')[0];
  assert.notEqual(body('OpenCodeGlyph'), body('ShellGlyph'));
  assert.doesNotMatch(body('OpenCodeGlyph'), /m7/);
});
