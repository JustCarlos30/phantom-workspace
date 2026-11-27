import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(root, 'src/motion.css'), 'utf8');
const token = name => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
const ms = value => (value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000);

// Texto fuera del bloque @media (con llaves balanceadas).
function split() {
  const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(start >= 0, 'falta el bloque no-preference');
  let depth = 0, end = -1;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) { end = i; break; }
  }
  return { inside: css.slice(start, end + 1), outside: css.slice(0, start) + css.slice(end + 1) };
}

test('tokens de movimiento existen', () => {
  for (const name of ['--ease-spring', '--ease-exit', '--dur-pop', '--stagger']) assert.ok(token(name), name);
  assert.match(token('--ease-spring'), /^cubic-bezier\(|^linear\(/);
});

test('todo keyframes y animation está protegido por reduced-motion', () => {
  const { inside, outside } = split();
  assert.doesNotMatch(outside, /@keyframes|animation\s*:/);
  assert.match(inside, /@keyframes pop-in/);
  assert.match(inside, /animation\s*:/);
});

test('duraciones dentro de rango', () => {
  assert.equal(ms(token('--dur-pop')), 180);
  const stagger = ms(token('--stagger'));
  assert.ok(stagger >= 20 && stagger <= 60);
});

test('pulso lento dura al menos 2s y Concentración lo detiene', () => {
  assert.ok(ms(token('--dur-pulse-slow')) >= 2000);
  assert.match(css, /animation: pulse-slow var\(--dur-pulse-slow\)/);
  assert.match(css, /\.studio-concentration :is\([^)]*\.motion-pulse-slow[^)]*\)\s*\{\s*animation: none/);
});

test('solo el pulso lento es infinito', () => {
  const infinite = css.match(/animation\s*:[^;]*\binfinite\b/g) ?? [];
  assert.equal(infinite.length, 1);
  assert.match(infinite[0], /pulse-slow/);
});
