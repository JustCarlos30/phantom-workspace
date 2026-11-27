import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('la clave de useVoiceDraft no incluye provider', () => {
  const src = readFileSync(new URL('../src/components/ChatCard.jsx', import.meta.url), 'utf8');
  const m = src.match(/useVoiceDraft\(([^)]*)\)/);
  assert.ok(m, 'useVoiceDraft no encontrado');
  assert.ok(!/provider/.test(m[1]), `la clave incluye provider: ${m[1]}`);
});
