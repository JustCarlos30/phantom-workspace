import test from 'node:test';
import assert from 'node:assert/strict';
import { nextAttentionId } from './attention-navigation.mjs';

const rows = flags => flags.map((needsYou, index) => ({ id: `t${index}`, needsYou }));

test('empieza tras la sesión actual y salta las que no necesitan atención', () => {
  assert.equal(nextAttentionId(rows([true, false, true, false, true]), 't0'), 't2');
  assert.equal(nextAttentionId(rows([true, false, true, false, true]), 't2'), 't4');
});

test('es cíclico: tras la última vuelve a la primera', () => {
  assert.equal(nextAttentionId(rows([true, false, true]), 't2'), 't0');
  assert.equal(nextAttentionId(rows([false, true, false]), 't2'), 't1');
});

test('devuelve null si ninguna fila necesita atención o no hay filas', () => {
  assert.equal(nextAttentionId(rows([false, false, false]), 't1'), null);
  assert.equal(nextAttentionId([], 't0'), null);
  assert.equal(nextAttentionId(undefined, 't0'), null);
});

test('sin currentId, nulo o ausente de rows empieza por la primera', () => {
  const list = rows([false, true, true]);
  assert.equal(nextAttentionId(list, null), 't1');
  assert.equal(nextAttentionId(list, undefined), 't1');
  assert.equal(nextAttentionId(list, 'desconocido'), 't1');
  assert.equal(nextAttentionId(rows([true, true]), null), 't0');
});

test('con una sola fila pendiente devuelve esa misma, esté o no seleccionada', () => {
  const list = rows([false, true, false]);
  assert.equal(nextAttentionId(list, 't1'), 't1');
  assert.equal(nextAttentionId(list, 't0'), 't1');
});

test('solo cuenta needsYou estrictamente verdadero', () => {
  const list = [{ id: 'a', needsYou: 1 }, { id: 'b', needsYou: 'sí' }, { id: 'c', needsYou: true }];
  assert.equal(nextAttentionId(list, null), 'c');
});
