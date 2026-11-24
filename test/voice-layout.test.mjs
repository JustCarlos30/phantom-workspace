import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../src/chat.css', import.meta.url), 'utf8');
const voice = readFileSync(new URL('../src/voice.css', import.meta.url), 'utf8');

test('while dictating the spacer does not compete with .voice-activity', () => {
  assert.match(voice, /\.voice-activity\s*\{[^}]*\bflex:\s*1\b/);
  assert.match(chat, /\.pc-composer\[data-dictating\]\s+\.pc-bar-space\s*\{[^}]*display:\s*none/);
});

test('idle spacer keeps its flex growth', () => {
  assert.match(chat, /^\.pc-bar-space\s*\{[^}]*flex:\s*1/m);
});

test('discard/finish buttons stay at the right of the meter', () => {
  assert.match(voice, /\.voice-activity \.voice-discard\s*\{[^}]*margin-left:\s*auto/);
});
