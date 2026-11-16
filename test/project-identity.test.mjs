import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ACCENTS, accentColor, defaults } from '../src/hooks/useAppearance.js';

const root = new URL('../', import.meta.url);
const source = name => readFileSync(new URL(name, root), 'utf8');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = new URL(entry.name, dir);
  return entry.isDirectory() ? walk(new URL(`${entry.name}/`, dir)) : entry.name.endsWith('.css') ? [file] : [];
});
const sheets = walk(new URL('src/', root)).map(file => ({ file, css: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
const rules = css => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const sidebar = source('src/sidebar.css');
const switcher = source('src/components/ProjectSwitcher.jsx');

test('project discs have a single stylesheet owner', () => {
  const owners = sheets.filter(({ css }) => /\.project-initials\b/.test(css));
  assert.deepEqual(owners.map(({ file }) => file.pathname.split('/').pop()), ['sidebar.css']);
  const disc = rules(sidebar).filter(([, selectors]) => selectors.trim() === '.project-initials');
  assert.equal(disc.length, 1);
  assert.match(disc[0][2], /border-radius:\s*50%/);
  for (const percent of [22, 86, 34]) assert.match(disc[0][2], new RegExp(`var\\(--project-accent, var\\(--accent\\)\\) ${percent}%`));
});

test('collapsed rail keeps its live button and shares ProjectMark', () => {
  const app = source('src/App.jsx');
  assert.match(app, /import ProjectSwitcher,\s*\{ ProjectMark \}/);
  assert.match(app, /<button className="rail-collapsed-project"[^>]*>[\s\S]*?<ProjectMark project=\{workspace\} small \/>/);
  const backgrounds = rules(sidebar).filter(([, selectors]) => /\.project-initials\b/.test(selectors)).flatMap(([, , body]) => [...body.matchAll(/(?<![-\w])background\s*:/g)]);
  assert.equal(backgrounds.length, 1);
});

test('legacy styles no longer own the project list', () => {
  for (const file of ['styles', 'studio']) assert.doesNotMatch(source(`src/${file}.css`), /\.project-list\b/);
});

test('project menu rows use their own saved accent and shared initials', () => {
  const rows = switcher.match(/<nav className="project-list"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(rows);
  assert.doesNotMatch(rows, /<Folder\b/);
  assert.match(rows, /<ProjectMark project=\{w\} small \/>/);
  assert.match(rows, /'--project-accent': accentColor\(loadAppearance\(w.id\).accent\)/);
  assert.match(switcher, /<ProjectMark project=\{active\} \/>/);
});

test('accentColor resolves every accent and defaults for unknown keys', () => {
  for (const [key, , hex] of ACCENTS) assert.equal(accentColor(key), hex);
  const fallback = ACCENTS.find(([key]) => key === defaults.accent)[2];
  assert.equal(accentColor('unknown'), fallback);
  assert.equal(accentColor(), fallback);
});

test('appearance swatches use type tokens and on-ink', () => {
  for (const { file, css } of sheets) {
    for (const [, selectors, body] of rules(css)) {
      if (/\.(accent-options|background-option)\b/.test(selectors)) assert.doesNotMatch(body, /font-size\s*:\s*[\d.]+px/, file.pathname);
      if (/\.accent-options\b/.test(selectors)) assert.doesNotMatch(body, /--primary-ink/, file.pathname);
    }
  }
  assert.match(source('src/components/Appearance.jsx'), /className="accent-options" role="group" aria-label="Color de acento"/);
});

test('background selection has a solid offset outline instead of an accent halo', () => {
  const selected = sheets.flatMap(({ css }) => rules(css).filter(([, selectors]) => /\.background-option\[aria-pressed=true\]/.test(selectors)));
  assert.ok(selected.length);
  for (const [, , body] of selected) assert.doesNotMatch(body, /box-shadow\s*:[^;]*color-mix\([^;]*var\(--accent\)/);
  assert.ok(selected.some(([, , body]) => /outline:\s*2px solid var\(--accent\)/.test(body) && /outline-offset:\s*3px/.test(body)));
});
