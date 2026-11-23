import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvZero, mergePath, homebrewFallback, loadShellEnvironment, resolveNodeBinary } from '../desktop/shell-env.mjs';
import { guardScript } from '../host/merge-guard.mjs';

test('parseEnvZero separa entradas por NUL y conserva "=" y saltos de línea en valores', () => {
  const env = parseEnvZero('PATH=/a:/b\0LANG=es_ES.UTF-8\0X=a=b\nc\0basura\0');
  assert.deepEqual(env, { PATH: '/a:/b', LANG: 'es_ES.UTF-8', X: 'a=b\nc' });
});

test('mergePath antepone el PATH del shell y elimina duplicados', () => {
  assert.equal(mergePath('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin'), '/opt/homebrew/bin:/usr/bin:/bin');
});

test('darwin fusiona PATH y LANG del shell de login; Linux no toca el entorno', () => {
  const calls = [];
  const run = (shell, args, options) => { calls.push({ shell, args, options }); return 'PATH=/opt/homebrew/bin:/usr/bin\0LANG=en_US.UTF-8\0'; };
  const mac = loadShellEnvironment({ platform: 'darwin', env: { SHELL: '/bin/bash', PATH: '/usr/bin:/bin' }, run });
  assert.equal(mac.PATH, '/opt/homebrew/bin:/usr/bin:/bin');
  assert.equal(mac.LANG, 'en_US.UTF-8');
  assert.equal(calls[0].shell, '/bin/bash');
  assert.deepEqual(calls[0].args, ['-ilc', 'command env -0']);
  assert.equal(calls[0].options.timeout, 5000);
  const linux = { PATH: '/usr/bin' };
  loadShellEnvironment({ platform: 'linux', env: linux, run });
  assert.deepEqual(linux, { PATH: '/usr/bin' });
  assert.equal(calls.length, 1);
});

test('darwin usa el fallback de Homebrew si el shell falla', () => {
  const env = loadShellEnvironment({ platform: 'darwin', env: { PATH: '/usr/bin' }, run: () => { throw new Error('timeout'); } });
  assert.equal(env.PATH, '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin');
  assert.equal(homebrewFallback(undefined), '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin');
});

test('resolveNodeBinary: variable, luego PATH, luego candidatos por plataforma', () => {
  const only = set => file => set.includes(file);
  assert.equal(resolveNodeBinary({ platform: 'linux', env: { PHANTOM_NODE_BINARY: '/x/node', PATH: '/n' }, executable: only(['/n/node']) }), '/x/node');
  assert.equal(resolveNodeBinary({ platform: 'darwin', env: { PATH: '/m:/n' }, executable: only(['/n/node']) }), '/n/node');
  assert.equal(resolveNodeBinary({ platform: 'darwin', env: { PATH: '' }, executable: only(['/usr/local/bin/node']) }), '/usr/local/bin/node');
  assert.equal(resolveNodeBinary({ platform: 'darwin', env: { PATH: '' }, executable: only(['/opt/homebrew/bin/node', '/usr/local/bin/node']) }), '/opt/homebrew/bin/node');
  assert.equal(resolveNodeBinary({ platform: 'linux', env: { PATH: '' }, executable: only([]) }), '/usr/bin/node');
});

test('el hook usa sha256sum si existe y shasum -a 256 si no, siempre comparando el digest', () => {
  const script = guardScript('abc123');
  const sha = script.indexOf('command -v sha256sum'), shasum = script.indexOf('command -v shasum');
  assert.ok(sha > 0 && shasum > sha);
  assert.match(script, /shasum -a 256 \| cut -d' ' -f1/);
  assert.match(script, /\[ -n "\$digest" \] && \[ "\$digest" = "abc123" \] && exit 0/);
});
