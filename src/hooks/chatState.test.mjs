import test from 'node:test';
import assert from 'node:assert/strict';
import { contextAdvice, contextNudge, contextUse as measuredContextUse, mergeChat } from './chatState.js';
const contextUse = meta => measuredContextUse({ contextSource: 'claude:request-v1', ...meta });

test('Legacy, invalid and cleared state cannot retain context warnings', () => {
  for (const meta of [{ contextTokens: 164000 }, { contextTokens: 164000, contextSource: 'codex:request-v1' }, {}, ...[NaN, Infinity, -1, null].map(contextTokens => ({ contextTokens, contextSource: 'claude:request-v1' }))]) {
    assert.equal(measuredContextUse(meta), null);
    assert.equal(contextNudge(measuredContextUse(meta)), null);
  }
  const chat = { provider: 'claude', messages: [], meta: { contextSource: 'claude:request-v1', contextTokens: 150000 } };
  const cleared = mergeChat(chat, { provider: 'claude', running: false, meta: {}, messages: [] });
  assert.equal(measuredContextUse(JSON.parse(JSON.stringify(cleared)).meta), null);
});

test('El aviso aparece al entrar en zona cara y usa el porcentaje real', () => {
  assert.equal(contextNudge(contextUse({ contextTokens: 50_000, contextWindow: 200_000 })), null);
  const watch = contextNudge(contextUse({ contextTokens: 84_000, contextWindow: 200_000 }));
  assert.equal(watch.band, 'watch');
  assert.match(watch.title, /42% del contexto/);
  assert.match(watch.body, /84k tokens/);
  assert.equal(contextNudge(contextUse({ contextTokens: 150_000, contextWindow: 200_000 })).band, 'compact');
});

test('Descartar silencia la zona actual pero no la siguiente', () => {
  const watch = contextUse({ contextTokens: 84_000, contextWindow: 200_000 });
  const high = contextUse({ contextTokens: 150_000, contextWindow: 200_000 });
  assert.equal(contextNudge(watch, 1), null);
  assert.equal(contextNudge(high, 1).band, 'compact');
  assert.equal(contextNudge(high, 2), null);
});

test('Sin ventana el aviso habla en tokens', () => {
  assert.match(contextNudge(contextUse({ contextTokens: 70_000 })).title, /70k tokens de contexto/);
});

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

test('Una ventana de 1M no esconde un historial grande: manda el tamaño', () => {
  assert.equal(advise({ contextTokens: 100_000, contextWindow: 1_000_000 }), 'ok');
  assert.equal(advise({ contextTokens: 150_000, contextWindow: 1_000_000 }), 'watch');
  assert.equal(advise({ contextTokens: 300_000, contextWindow: 1_000_000 }), 'compact');
  assert.equal(contextAdvice(contextUse({ contextTokens: 300_000, contextWindow: 1_000_000 })).cause, 'size');
  assert.equal(contextAdvice(contextUse({ contextTokens: 140_000, contextWindow: 200_000 })).cause, 'share');
});

test('Si manda el tamaño, el aviso habla en tokens y no en un porcentaje bajo', () => {
  const nudge = contextNudge(contextUse({ contextTokens: 180_000, contextWindow: 1_000_000 }));
  assert.equal(nudge.band, 'watch');
  assert.match(nudge.title, /180k tokens de contexto/);
  assert.doesNotMatch(nudge.title, /%/);
});

test('Sin ventana se usan tamaños absolutos', () => {
  assert.equal(advise({ contextTokens: 30_000 }), 'ok');
  assert.equal(advise({ contextTokens: 60_000 }), 'watch');
  assert.equal(advise({ contextTokens: 150_000 }), 'compact');
});

test('Cada zona trae título y explicación', () => {
  const advice = contextAdvice(contextUse({ contextTokens: 150_000, contextWindow: 200_000 }));
  assert.equal(advice.title, 'Conversación muy larga');
  assert.ok(advice.hint.length > 20);
});
