import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sidebar = read('src/components/SidebarPanels.jsx');
const glyphs = read('src/components/Glyphs.jsx');

const glyphBody = name => {
  const match = glyphs.match(new RegExp(`export function ${name}\\b[\\s\\S]*?\\n}`));
  assert.ok(match, `${name} must exist`);
  return match[0];
};

test('session rail uses the shared provider glyphs, not generic AI emblems', () => {
  assert.doesNotMatch(sidebar, /\b(Sparkles|Bot|Code2)\b/);
  assert.match(sidebar, /ProviderGlyph/);
});

test('no provider or agent glyph is a sparkle or asterisk', () => {
  const agent = glyphBody('AgentGlyph');
  assert.doesNotMatch(agent, /m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z/i, 'AgentGlyph must not be a four-point sparkle');
  const claude = glyphBody('ClaudeGlyph');
  assert.doesNotMatch(claude, /M12 3v18M3 12h18/, 'ClaudeGlyph must not be an asterisk');
});

test('each provider keeps a distinct silhouette', () => {
  const bodies = ['ClaudeGlyph', 'OpenCodeGlyph', 'CodexGlyph', 'ShellGlyph', 'AgentGlyph'].map(glyphBody);
  assert.equal(new Set(bodies.map(b => b.replace(/export function \w+/, ''))).size, bodies.length);
});

test('rail badges keep their shared 18px line glyph on selection and use flat state colour', () => {
  const css = read('src/sidebar.css');
  assert.match(glyphs, /strokeWidth: 1\.75/);
  assert.match(read('src/components/ShellIcons.jsx'), /strokeWidth="1\.75"/);
  assert.match(sidebar, /ProviderGlyph[^>]*size=\{18\}/);
  assert.match(sidebar, /<Icon size=\{18\} variant="line"/);
  assert.doesNotMatch(sidebar, /rail-session-dot|active=\{active\}/);
  assert.match(sidebar, /data-state=\{row.needsYou \? 'attention' : row.tone === 'working' \? 'working' : 'rest'\}/);
  assert.match(css, /\.rail-panel-row > button > \.rail-agent-mark\s*\{[^}]*width: var\(--badge-size\); height: var\(--badge-size\);[^}]*border-radius: 50%; background: var\(--badge-neutral\); color: var\(--badge-ink\); box-shadow: none/);
  assert.match(css, /\.rail-session-row\[data-state="working"\] > button > \.rail-agent-mark \{ background: var\(--badge-working\)/);
  assert.match(css, /\.rail-session-row\[data-state="attention"\] > button > \.rail-agent-mark \{ background: var\(--badge-attention\)/);
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.includes('rail-agent-mark')) continue;
    assert.doesNotMatch(selector, /:hover|:active|\.selected|aria-current/);
    assert.doesNotMatch(body, /gradient|drop-shadow|scale\(/);
  }
});
