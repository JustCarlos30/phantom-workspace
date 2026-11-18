import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildStreamArgv, cleanTranscript, createPhraseCorrector } from '../integrations/voice-stream.mjs';
import { suggestCorrections, parseCorrectionLines, addCorrectionLine } from '../src/hooks/voice-send.mjs';

const root = new URL('../scripts/', import.meta.url).pathname;
// voice_text.py has no third-party imports, so it runs without the ASR runtime.
const py = code => {
  const run = spawnSync('python3', ['-I', '-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(root)}); import voice_text as v\n${code}`], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
};

test('Diccionario aplica sustituciones sin encadenarlas y respeta mayúscula inicial', () => {
  assert.deepEqual(py(`p = v.parse_corrections("meikap => makeup\\nmake up => makeup\\nguey => wey\\nwey => guey")
print(json.dumps([v.apply_corrections("Guey, el make up y el meikap", p), v.apply_corrections("meikapero", p)]))`),
  ['Wey, el makeup y el makeup', 'meikapero']);
});

test('Muletillas: quita titubeos y conserva demostrativos y jerga', () => {
  assert.deepEqual(py(`print(json.dumps([v.strip_fillers(t) for t in ["Eeh, este... pues el makeup no sirve", "Este proyecto está chido, o sea, funciona", "o sea que no", "mmm no sé", "eh"]]))`),
  ['pues el makeup no sirve', 'Este proyecto está chido, funciona', 'o sea que no', 'no sé', '']);
});

test('Modo keep no toca las muletillas y remove sí', () => {
  assert.deepEqual(py(`print(json.dumps([v.postprocess("eeh el meikap", {"meikap": "makeup"}, m) for m in ("keep", "remove")]))`), ['eeh el makeup', 'el makeup']);
});

test('Correcciones inválidas se rechazan', () => {
  for (const bad of ['sin flecha', ' => nada', 'algo =>', 'x'.repeat(81) + ' => y', 'a => b\n'.repeat(101)]) {
    const run = spawnSync('python3', ['-I', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(root)}); import voice_text as v; v.parse_corrections(sys.argv[1])`, bad], { encoding: 'utf8' });
    assert.notEqual(run.status, 0, bad.slice(0, 20));
    assert.match(run.stderr, /Corrección|Correcciones/);
  }
});

test('El prompt cabe en el presupuesto y conserva el contexto reciente', () => {
  const [length, hasContext, hasDefault] = py(`p = v.build_prompt("", "x " * 250, "contexto reciente de la frase")
print(json.dumps([len(p), p.endswith("contexto reciente de la frase"), "wey" in v.build_prompt("", "", "")]))`);
  assert.ok(length <= 640);
  assert.equal(hasContext, true);
  assert.equal(hasDefault, true);
});

test('Argumentos nuevos solo van a un motor que los admite, y siempre se validan', () => {
  const base = ['python', 'voice-stream.py'];
  // A worker installed before voice_text.py existed must keep receiving only the old flags.
  assert.deepEqual(buildStreamArgv(base, { voiceProfile: 'pues wey', voiceFillers: 'remove' }).slice(2), ['--language', 'es', '--vocabulary', '', '--pause-ms', '500', '--vad-threshold', '0.5']);
  assert.deepEqual(buildStreamArgv(base, {}, true).slice(-2), ['--fillers', 'clean']);
  assert.equal(buildStreamArgv(base, { voiceFillers: 'keep' }, true).includes('--fillers'), false);
  const argv = buildStreamArgv(base, { voiceProfile: 'pues wey', voiceCorrections: 'meikap => makeup\nguey => wey', voiceFillers: 'remove' }, true);
  assert.deepEqual(argv.slice(-6), ['--profile', 'pues wey', '--corrections', 'meikap => makeup\nguey => wey', '--fillers', 'remove']);
  for (const settings of [{ voiceFillers: 'otro' }, { voiceProfile: 'x'.repeat(401) }, { voiceProfile: 'a\nb' }, { voiceCorrections: 'x'.repeat(4001) }, { voiceCorrections: 'a\u0000b' }, { voiceCorrections: 5 }]) {
    assert.throws(() => buildStreamArgv(base, settings), /inválid/, JSON.stringify(settings).slice(0, 40));
  }
});

test('Cada frase confirmada se corrige con su contexto sin esperar al final', async () => {
  const calls = [], gates = [];
  const corrector = createPhraseCorrector((text, context) => { calls.push({ text, context }); return new Promise(resolve => gates.push(resolve)); });
  corrector.track('');
  corrector.track('empecé a divulgar');
  corrector.track('empecé a divulgar');
  // Until the correction lands the user sees the raw phrase next to the live tail.
  assert.deepEqual(corrector.compose({ confirmed: 'empecé a divulgar', partial: 'y luego', text: 'x' }), { confirmed: 'empecé a divulgar', partial: 'y luego', text: 'empecé a divulgar y luego' });
  gates[0]({ text: 'Empecé a divagar', cleaned: true });
  await corrector.settle(1000);
  corrector.track('empecé a divulgar y luego me perdí');
  assert.deepEqual(calls, [{ text: 'empecé a divulgar', context: '' }, { text: 'y luego me perdí', context: 'Empecé a divagar' }]);
  // A correction that fails or is late keeps the raw phrase and reports why.
  gates[1]({ text: 'y luego me perdí', cleaned: false, reason: 'sin red' });
  await corrector.settle(1000);
  assert.deepEqual(corrector.compose({ confirmed: 'ignored', partial: '', text: 'ignored' }), { confirmed: 'Empecé a divagar y luego me perdí', partial: '', text: 'Empecé a divagar y luego me perdí', cleaned: true, cleanSkipped: 'sin red' });
  corrector.track('empecé a divulgar y luego me perdí otra frase');
  const started = Date.now();
  await corrector.settle(30);
  assert.ok(Date.now() - started < 500);
  assert.equal(corrector.compose({ partial: '' }).confirmed, 'Empecé a divagar y luego me perdí otra frase');
  // If the worker rewrites its earlier text, start over instead of misaligning phrases.
  corrector.track('texto distinto');
  assert.equal(corrector.compose({ partial: '' }).confirmed, 'texto distinto');
});

test('Limpieza con LLM: solo en modo clean, con respaldo ante cualquier falla', async () => {
  let calls = 0;
  let sent;
  const ok = async (url, init) => { calls++; sent = { headers: init.headers, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Pues el makeup no sirve, wey.' }] }) }; };
  const text = 'eeh pues el makeup no sirve, wey';
  assert.deepEqual(await cleanTranscript(text, { voiceFillers: 'keep' }, ok, { ANTHROPIC_API_KEY: 'k' }), { text, cleaned: false });
  assert.deepEqual(await cleanTranscript(text, { voiceFillers: 'remove' }, ok, { ANTHROPIC_API_KEY: 'k' }), { text, cleaned: false });
  assert.equal(calls, 0);
  assert.equal((await cleanTranscript(text, { voiceFillers: 'clean' }, ok, {})).reason, 'Falta ANTHROPIC_API_KEY en el host');
  assert.deepEqual(await cleanTranscript(text, { voiceFillers: 'clean' }, ok, { ANTHROPIC_API_KEY: 'k' }), { text: 'Pues el makeup no sirve, wey.', cleaned: true });
  // The dictation is sent as data, on the fast model by default, with thinking off.
  assert.equal(sent.body.model, 'claude-haiku-5-5');
  assert.equal(sent.body.messages[0].content, `<dictado>\n${text}\n</dictado>`);
  assert.deepEqual(sent.body.thinking, { type: 'disabled' });
  assert.equal(sent.body.fallbacks, undefined);
  assert.equal(sent.headers['anthropic-beta'], undefined);
  await cleanTranscript(text, { voiceFillers: 'clean', voiceCleanModel: 'claude-fable-5-2', voiceVocabulary: 'Phantom divagar' }, ok, { ANTHROPIC_API_KEY: 'k' });
  assert.equal(sent.body.thinking, undefined);
  assert.equal(sent.body.fallbacks, 'default');
  assert.equal(sent.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.match(sent.body.system, /Phantom divagar$/);
  await cleanTranscript('y luego', {}, ok, { ANTHROPIC_API_KEY: 'k' }, { context: 'Empecé a divagar' });
  assert.equal(sent.body.messages[0].content, '<contexto>\nEmpecé a divagar\n</contexto>\n<dictado>\ny luego\n</dictado>');
  assert.equal((await cleanTranscript(text, { voiceFillers: 'clean', voiceCleanModel: 'bad model!' }, ok, { ANTHROPIC_API_KEY: 'k' })).cleaned, false);
  const refused = async () => ({ ok: true, json: async () => ({ stop_reason: 'refusal', content: [] }) });
  assert.deepEqual(await cleanTranscript(text, { voiceFillers: 'clean' }, refused, { ANTHROPIC_API_KEY: 'k' }), { text, cleaned: false, reason: 'Claude no completó la limpieza (refusal)' });
  const runaway = async () => ({ ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Claro, aquí tienes una respuesta muy larga que no es una limpieza. '.repeat(5) }] }) });
  assert.equal((await cleanTranscript(text, { voiceFillers: 'clean' }, runaway, { ANTHROPIC_API_KEY: 'k' })).cleaned, false);
  const boom = async () => { throw new Error('red'); };
  assert.equal((await cleanTranscript(text, { voiceFillers: 'clean' }, boom, { ANTHROPIC_API_KEY: 'k' })).text, text);
  const http = async () => ({ ok: false, body: { cancel: async () => {} } });
  assert.equal((await cleanTranscript(text, { voiceFillers: 'clean' }, http, { ANTHROPIC_API_KEY: 'k' })).cleaned, false);
});

test('Sugiere correcciones solo para palabras mal oídas', () => {
  assert.deepEqual(suggestCorrections('pues el meikap no sirve y el guey se fue', 'Pues el makeup no sirve y el wey se fue'), [{ heard: 'meikap', meant: 'makeup' }, { heard: 'guey', meant: 'wey' }]);
  assert.deepEqual(suggestCorrections('hola mundo', 'hola mundo cruel'), []);
  assert.deepEqual(suggestCorrections('a b c d e f', 'x'), []);
  assert.deepEqual(suggestCorrections('el meikap', 'el makeup', [{ heard: 'meikap', meant: 'makeup' }]), []);
  assert.deepEqual(suggestCorrections('', 'algo'), []);
});

test('Las correcciones se agregan y se leen en el formato del worker', () => {
  const text = addCorrectionLine(addCorrectionLine('', { heard: 'meikap', meant: 'makeup' }), { heard: 'guey', meant: 'wey' });
  assert.equal(text, 'meikap => makeup\nguey => wey');
  assert.deepEqual(parseCorrectionLines(`# nota\n${text}\n`), [{ heard: 'meikap', meant: 'makeup' }, { heard: 'guey', meant: 'wey' }]);
});
