import test from 'node:test';
import assert from 'node:assert/strict';
import { contextAdvice, contextNudge, nudgeDismissal, contextUse as measuredContextUse, mergeChat } from './chatState.js';
const contextUse = meta => measuredContextUse({ contextSource: 'claude:request-v1', ...meta });

test('Eventos de compactación conservan historial y actualizan sesión, operación y evidencia sin lecturas inventadas', () => {
  const message = { id: 'original', parts: [{ type: 'text', text: 'historial' }] };
  let chat = { provider: 'opencode', sessionId: null, messages: [message], meta: { contextSource: 'opencode:request-v1', contextTokens: 190000 } };
  chat = mergeChat(chat, { provider: 'opencode', running: false, sessionId: 'native', messages: [] });
  assert.equal(chat.sessionId, 'native', 'a completed first turn enables the meter without remounting');
  chat = mergeChat(chat, { provider: 'opencode', running: true, operation: 'compact', messages: [] });
  assert.equal(chat.sessionId, 'native'); assert.equal(chat.operation, 'compact');
  const records = [{ id: 'c', status: 'done', summaryId: 'summary' }];
  chat = mergeChat(chat, { provider: 'opencode', running: false, operation: null, meta: {}, compactions: records, messages: [] });
  assert.equal(chat.operation, null); assert.equal(chat.running, false);
  assert.deepEqual(chat.compactions, records); assert.equal(measuredContextUse(chat.meta), null);
  assert.strictEqual(chat.messages[0], message);
  const other = mergeChat(chat, { provider: 'codex', sessionId: 'foreign', messages: [] });
  assert.strictEqual(other, chat);
  chat = mergeChat(chat, { provider: 'opencode', sessionId: null, messages: [] });
  assert.equal(chat.sessionId, null);
});

test('mergeChat conserva las partes y mensajes que no cambian durante streaming', () => {
  const untouched = { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Hola' }] };
  const previous = { id: 'assistant', status: 'streaming', parts: [
    { type: 'tool', id: 'read', name: 'read', status: 'done', input: { path: 'a.txt' }, output: 'contenido' },
    { type: 'text', text: 'Respuesta' },
  ], usage: { outputTokens: 2 } };
  const incoming = structuredClone(previous);
  incoming.parts[1].text += ' alargada';
  const merged = mergeChat({ provider: 'claude', messages: [untouched, previous] }, { provider: 'claude', running: true, messages: [incoming] });
  assert.strictEqual(merged.messages[0], untouched);
  assert.notStrictEqual(merged.messages[1], previous);
  assert.strictEqual(merged.messages[1].parts[0], previous.parts[0]);
  assert.strictEqual(merged.messages[1].usage, previous.usage);
  assert.notStrictEqual(merged.messages[1].parts[1], previous.parts[1]);
  assert.equal(merged.messages[1].parts[1].text, 'Respuesta alargada');
});

test('Legacy, invalid and cleared state cannot retain context warnings', () => {
  for (const meta of [{ contextTokens: 164000 }, {}, ...[NaN, Infinity, -1, null].map(contextTokens => ({ contextTokens, contextSource: 'claude:request-v1' }))]) {
    assert.equal(measuredContextUse(meta), null);
    assert.equal(contextNudge(measuredContextUse(meta)), null);
  }
  const chat = { provider: 'claude', messages: [], meta: { contextSource: 'claude:request-v1', contextTokens: 150000 } };
  const cleared = mergeChat(chat, { provider: 'claude', running: false, meta: {}, messages: [] });
  assert.equal(measuredContextUse(JSON.parse(JSON.stringify(cleared)).meta), null);
});

test('El descarte sobrevive a lecturas ausentes y solo baja con una banda inferior', () => {
  assert.equal(nudgeDismissal(2, null), 2);
  assert.equal(nudgeDismissal(1, 2), 1);
  assert.equal(nudgeDismissal(2, 1), 1);
  assert.equal(nudgeDismissal(1, 0), 0);
  assert.deepEqual(measuredContextUse({ contextSource: 'codex:request-v1', contextTokens: 144871, contextWindow: 258400 }), { tokens: 144871, window: 258400, ratio: 144871 / 258400 });
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
