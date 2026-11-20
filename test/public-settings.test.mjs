import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSettings, portableSettings } from '../host/public-settings.mjs';

test('public settings traverse mixed arrays and arrays of arrays without losing public positions', () => {
  const input = { providers: [
    { name: 'fixture', apiKey: 'fixture-hidden-a', options: [{ password: 'fixture-hidden-b', enabled: true }] },
    [null, false, 0, 2.5, 'public', [{ privateKey: 'fixture-hidden-c', label: 'nested' }]],
    { token: 'fixture-hidden-d' }, [],
  ], nested: { rows: [[{ signingKey: 'fixture-hidden-e', count: 3 }]] } };
  assert.deepEqual(publicSettings(input), { providers: [
    { name: 'fixture', options: [{ enabled: true }] },
    [null, false, 0, 2.5, 'public', [{ label: 'nested' }]], {}, [],
  ], nested: { rows: [[{ count: 3 }]] } });
  assert.deepEqual(publicSettings([[null, true, 7], [{ accessToken: 'fixture-hidden', ok: false }]]), [[null, true, 7], [{ ok: false }]]);
});

test('public settings retain legacy sensitive-name coverage and normalized credential variants', () => {
  const names = ['secret', 'nestedSecretValue', 'TOKEN', 'password', 'credentials', 'Authorization',
    'apiKey', 'api_key', 'api-key', 'api.key', 'api key', 'api/key',
    'privateKey', 'PRIVATE_KEY', 'private-key', 'Private.Key', 'private key',
    'signingKey', 'SIGNING_KEY', 'signing-key', 'Signing.Key',
    'clientSecret', 'CLIENT_SECRET', 'client-secret', 'client.secret',
    'accessToken', 'ACCESS_TOKEN', 'access-token', 'access.token',
    'refreshToken', 'REFRESH_TOKEN', 'refresh-token', 'refresh.token',
    'passphrase', 'PASS_PHRASE', 'pass-phrase', 'pass.phrase'];
  const fields = Object.fromEntries(names.map(key => [key, 'fixture-hidden']));
  assert.deepEqual(publicSettings({ ...fields, rows: [[fields]], label: 'visible' }), { rows: [[{}]], label: 'visible' });
  // The boundary is based on key names, not guesses about public string contents.
  assert.deepEqual(publicSettings({ label: 'arbitrary user content' }), { label: 'arbitrary user content' });
});

test('public settings never mutate or alias private JSON and treat prototype keys as own data', () => {
  const input = JSON.parse('{"__proto__":{"label":"own","privateKey":"fixture-hidden"},"constructor":{"prototype":{"token":"fixture-hidden","ok":true}},"rows":[[{"label":"original","clientSecret":"fixture-hidden"}]]}');
  const before = structuredClone(input);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(input);
  const result = publicSettings(input);
  assert.deepEqual(input, before);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.deepEqual(result.__proto__, { label: 'own' });
  assert.deepEqual(result.constructor, { prototype: { ok: true } });
  assert.equal(Object.getPrototypeOf(result.constructor.prototype), Object.prototype);
  result.rows[0][0].label = 'edited';
  result.__proto__.label = 'edited';
  assert.deepEqual(input, before);
  assert.equal(Object.hasOwn(Object.prototype, 'label'), false);
});

test('portable settings allow only existing presentation keys with valid scalar types', () => {
  const normal = { theme: 'dark', language: 'es', fontSize: 14.5, terminalFontSize: 16 };
  assert.deepEqual(portableSettings({ ...normal, shell: '/fixture/shell', apiKey: 'fixture-hidden' }), normal);
  for (const value of [{ nested: { privateKey: 'fixture-hidden' } }, [{ token: 'fixture-hidden' }], [[{ label: 'fixture-hidden' }]], null, true, false]) {
    assert.deepEqual(portableSettings(Object.fromEntries(Object.keys(normal).map(key => [key, value]))), {});
  }
  for (const value of ['16', 0, -1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(portableSettings({ fontSize: value, terminalFontSize: value }), {});
  }
  assert.deepEqual(portableSettings({ theme: 1, language: 2 }), {});
});
