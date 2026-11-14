import test from 'node:test';
import assert from 'node:assert/strict';
import { contextAdvice, contextUse } from './chatState.js';

const advise = meta => contextAdvice(contextUse(meta))?.band ?? null;

test('Sin lectura del proveedor no hay recomendación', () => {
  assert.equal(advise({}), null);
  assert.equal(advise({ contextTokens: 0, contextWindow: 200_000 }), null);
});

test('Con ventana conocida las zonas son fracciones de la ventana', () => {
  assert.equal(advise({ contextTokens: 50_000, contextWindow: 200_000 }), 'ok');
  assert.equal(advise({ contextTokens: 80_000, contextWindow: 200_000 }), 'watch');
  assert.equal(advise({ contextTokens: 139_999, contextWindow: 200_000 }), 'watch');
  assert.equal(advise({ contextTokens: 140_000, contextWindow: 200_000 }), 'compact');
});

test('Una ventana de 1M no esconde un historial grande: se mide por fracción', () => {
  assert.equal(advise({ contextTokens: 300_000, contextWindow: 1_000_000 }), 'ok');
  assert.equal(advise({ contextTokens: 450_000, contextWindow: 1_000_000 }), 'watch');
});

test('Sin ventana se usan tamaños absolutos', () => {
  assert.equal(advise({ contextTokens: 30_000 }), 'ok');
  assert.equal(advise({ contextTokens: 60_000 }), 'watch');
  assert.equal(advise({ contextTokens: 150_000 }), 'compact');
});

test('Cada zona trae título y explicación', () => {
  const advice = contextAdvice(contextUse({ contextTokens: 150_000, contextWindow: 200_000 }));
  assert.equal(advice.title, 'Compacta ahora');
  assert.ok(advice.hint.length > 20);
});
