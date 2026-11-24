import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionChipLabel } from './sessionChipLabel.mjs';

test('rama propia con nombre de proyecto usa el nombre', () => {
  assert.deepEqual(sessionChipLabel({ cwd: '/w/e957ef2a-dd5b', branch: 'phantom/terminal-e957ef2a', workspaceName: 'Phantom' }), { name: 'Phantom', own: true });
});
test('rama propia sin nombre cae al último tramo', () => {
  assert.deepEqual(sessionChipLabel({ cwd: '/w/e957ef2a-dd5b/', branch: 'phantom/terminal-x' }), { name: 'e957ef2a-dd5b', own: true });
});
test('rama normal usa el último tramo y own=false', () => {
  assert.deepEqual(sessionChipLabel({ cwd: '/home/u/proyecto', branch: 'main', workspaceName: 'Otro' }), { name: 'proyecto', own: false });
});
test('cwd vacío devuelve Sesión', () => {
  assert.deepEqual(sessionChipLabel({ cwd: '', branch: null }), { name: 'Sesión', own: false });
  assert.equal(sessionChipLabel({}).name, 'Sesión');
});
