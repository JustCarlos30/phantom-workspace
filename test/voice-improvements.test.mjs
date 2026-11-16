import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_REPOS, parseArgs, setupVoice } from '../scripts/setup-voice.mjs';
import { buildStreamArgv } from '../integrations/voice-stream.mjs';
import { classifyIntent } from '../integrations/voice.mjs';

test('Setup acepta los modelos grandes y usa repositorios oficiales', async () => {
  for (const model of Object.keys(MODEL_REPOS)) assert.equal(parseArgs(['--model', model]).model, model);
  assert.equal(MODEL_REPOS['large-v3-turbo'], 'mobiuslabsgmbh/faster-whisper-large-v3-turbo');
  for (const model of ['tiny', 'base', 'small', 'medium', 'large-v3']) assert.equal(MODEL_REPOS[model], `Systran/faster-whisper-${model}`);
  assert.throws(() => parseArgs(['--model', 'unknown']), /Argumento inválido/);
  await assert.rejects(setupVoice({ model: 'unknown' }), /Modelos permitidos/);
});

test('Argumentos del stream incluyen ajustes y valores por defecto', () => {
  const base = ['python', 'voice-stream.py'];
  assert.deepEqual(buildStreamArgv(base, { voiceLanguage: 'auto', voiceVocabulary: 'Orion API', voicePauseMs: 1200, voiceVadThreshold: 0.7 }), [...base, '--language', 'auto', '--vocabulary', 'Orion API', '--pause-ms', '1200', '--vad-threshold', '0.7']);
  assert.deepEqual(base, ['python', 'voice-stream.py']);
  assert.deepEqual(buildStreamArgv(base).slice(2), ['--language', 'es', '--vocabulary', '', '--pause-ms', '700', '--vad-threshold', '0.5']);
});

test('Argumentos rechazan idioma, controles y rangos inválidos', () => {
  for (const settings of [
    { voiceLanguage: 'es-ES' }, { voiceLanguage: 12 }, { voiceVocabulary: 'x'.repeat(501) }, { voiceVocabulary: 'a\nb' }, { voiceVocabulary: 'a\u007fb' },
    { voicePauseMs: 299 }, { voicePauseMs: 2001 }, { voicePauseMs: 700.5 }, { voicePauseMs: '700' },
    { voiceVadThreshold: 0.19 }, { voiceVadThreshold: 0.81 }, { voiceVadThreshold: NaN },
  ]) assert.throws(() => buildStreamArgv(['python'], settings), /inválid/);
});

test('Reglas reconocen sinónimos solo al inicio', async () => {
  for (const [action, prefixes] of Object.entries({ task: ['apunta', 'anota', 'recuérdame', 'pendiente'], decision: ['decidimos', 'acordamos'], open: ['ve a', 'navega a', 'abrir página'], search: ['encuentra', 'localiza'] })) {
    for (const prefix of prefixes) {
      const result = await classifyIntent(`${prefix} contenido`, 'workspace');
      assert.equal(result.action, action);
      assert.equal(result.text, 'contenido');
      assert.equal(result.provider, 'rules');
    }
  }
  assert.equal((await classifyIntent('mañana decidimos contenido', 'workspace')).action, 'task');
});

function mockClaude(t, fetch) {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'fixture-key';
  t.after(() => { if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous; });
  t.mock.method(globalThis, 'fetch', fetch);
}

test('Claude devuelve un borrador validado y petición acotada', async t => {
  mockClaude(t, async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    assert.equal(options.headers['x-api-key'], 'fixture-key');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'claude-haiku-5-5');
    assert.equal(body.max_tokens, 512);
    assert.deepEqual(body.tool_choice, { type: 'tool', name: 'classify_intent' });
    return Response.json({ content: [{ type: 'tool_use', name: 'classify_intent', input: { action: 'search', query: 'documentación' } }] });
  });
  assert.deepEqual(await classifyIntent('encuentra documentación', 'w', { voiceIntentProvider: 'claude' }), { workspaceId: 'w', action: 'search', text: 'encuentra documentación', query: 'documentación', provider: 'claude' });
});

for (const [name, response] of [
  ['HTTP 500', () => new Response('', { status: 500 })],
  ['JSON inválido', () => new Response('{')],
  ['acción fuera del enum', () => Response.json({ content: [{ type: 'tool_use', name: 'classify_intent', input: { action: 'execute', title: 'inválido' } }] })],
  ['título demasiado largo', () => Response.json({ content: [{ type: 'tool_use', name: 'classify_intent', input: { action: 'task', title: 'x'.repeat(241) } }] })],
  ['respuesta mayor de 64 KiB', () => new Response('x'.repeat(65537))],
  ['error de red', () => { throw new Error('red'); }],
]) test(`Claude usa reglas ante ${name}`, async t => {
  mockClaude(t, async () => response());
  const result = await classifyIntent('anota revisar', 'w', { voiceIntentProvider: 'claude' });
  assert.equal(result.provider, 'rules');
  assert.equal(result.title, 'revisar');
  assert.ok(result.fallbackReason);
});

test('Claude sin clave usa reglas sin hacer peticiones', async t => {
  mockClaude(t, () => assert.fail('No debe llamar a la API sin clave'));
  delete process.env.ANTHROPIC_API_KEY;
  const result = await classifyIntent('acordamos revisar', 'w', { voiceIntentProvider: 'claude' });
  assert.equal(result.provider, 'rules');
  assert.equal(result.action, 'decision');
  assert.match(result.fallbackReason, /Falta ANTHROPIC_API_KEY/);
});
