import test from 'node:test';
import assert from 'node:assert/strict';
import { canSubmit, mergeDictation, sendAction } from './voice-send.mjs';

test('Enviar grabando detiene y arma incluso sin borrador', () => {
  for (const draft of ['', 'escrito']) assert.equal(sendAction({ status: 'recording', draft, armed: false }), 'stop-and-send');
});
test('Enviar transcribiendo espera el texto final', () => {
  assert.equal(sendAction({ status: 'transcribing', draft: '', armed: false }), 'await-voice');
  assert.equal(sendAction({ status: 'transcribing', draft: 'escrito', armed: true }), 'none');
});
test('Durante permiso solo se envía el borrador escrito', () => {
  assert.equal(sendAction({ status: 'requesting', draft: 'texto', armed: false }), 'send');
  assert.equal(sendAction({ status: 'requesting', draft: ' ', armed: false }), 'none');
});
test('Al terminar sin texto desarmar no envía el borrador por sí solo', () => {
  assert.equal(canSubmit({ status: 'idle', draft: '', connected: true }), false);
  assert.equal(sendAction({ status: 'idle', draft: 'conservado', armed: true }), 'none');
  assert.equal(mergeDictation('conservado  ', 'dictado'), 'conservado dictado');
});
test('Detener el micrófono solo combina texto; enviar exige acción explícita', () => {
  assert.equal(mergeDictation('', 'dictado'), 'dictado');
  assert.equal(mergeDictation('  ', 'dictado'), 'dictado');
  assert.equal(mergeDictation('  borrador  ', 'dictado'), '  borrador dictado');
  assert.equal(sendAction({ status: 'idle', draft: 'dictado', armed: false }), 'send');
});
test('Disponibilidad de Enviar respeta conexión, carga, envío y armado', () => {
  for (const status of ['idle', 'requesting', 'recording', 'transcribing']) {
    for (const draft of ['', 'texto']) {
      const state = { status, draft, connected: true, ready: true, sending: false, armed: false };
      assert.equal(canSubmit(state), !!draft || ['recording', 'transcribing'].includes(status));
      for (const blocked of [{ connected: false }, { ready: false }, { sending: true }, { armed: true }]) assert.equal(canSubmit({ ...state, ...blocked }), false);
    }
  }
});
