import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveStreamScript } from '../integrations/voice-stream.mjs';

test('Sustituye el script del motor y conserva los demás argumentos en orden', () => {
  const argv = ['/engine/venv/bin/python', '-u', '/engine/voice-stream.py', '--model', '/models/voice-stream.py.backup'];
  assert.deepEqual(resolveStreamScript(argv, '/bundled/voice-stream.py'), [
    '/engine/venv/bin/python', '-u', '/bundled/voice-stream.py', '--model', '/models/voice-stream.py.backup',
  ]);
});

test('Resolver el script devuelve una copia sin mutar la entrada', () => {
  const argv = Object.freeze(['/engine/python', '/engine/voice-stream.py']);
  const resolved = resolveStreamScript(argv, '/bundled/voice-stream.py');
  assert.notStrictEqual(resolved, argv);
  assert.deepEqual(argv, ['/engine/python', '/engine/voice-stream.py']);
});

test('Sin voice-stream.py conserva todos los argumentos', () => {
  const argv = ['/engine/python', '/engine/other.py', '--model', 'local'];
  assert.deepEqual(resolveStreamScript(argv, '/bundled/voice-stream.py'), argv);
});

test('El script empaquetado declara los ajustes de dictado enviados por el host', async () => {
  const script = await readFile(new URL('../scripts/voice-stream.py', import.meta.url), 'utf8');
  for (const flag of ['--language', '--vocabulary', '--pause-ms', '--vad-threshold']) {
    assert.match(script, new RegExp(`parser\\.add_argument\\(["']${flag}["']`));
  }
});
