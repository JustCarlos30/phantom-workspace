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
