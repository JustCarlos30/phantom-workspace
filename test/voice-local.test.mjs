import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleVoice, discoverLocalVoice } from '../integrations/voice.mjs';
import { executableOnPath, runCommand, stateDirectory } from '../integrations/run-manager.mjs';
import { parseArgs, setupVoice } from '../scripts/setup-voice.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom-voice-local-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project');
  const dataDir = path.join(root, 'data');
  await mkdir(cwd);
  const workspace = { id: randomUUID(), canonicalPath: cwd };
  const context = { dataDir, state: { settings: {} }, workspace, getWorkspace: id => id === workspace.id ? workspace : null };
  const invoke = async payload => (await handleVoice('voice.transcribe', { workspaceId: workspace.id, mimeType: 'audio/wav', audioBase64: Buffer.from('adapter fixture, not real speech').toString('base64'), ...payload }, context)).result;
  return { root, cwd, dataDir, context, workspace, invoke };
}

async function fakeConfig(f, text = 'adapter discovery fixture') {
  const script = path.join(f.root, 'fixture-engine.mjs');
  await writeFile(script, `import {writeFile} from 'node:fs/promises'; import path from 'node:path'; await writeFile(path.join(process.argv[3], 'transcript.txt'), ${JSON.stringify(text)});`);
  const config = { schemaVersion: 1, engine: 'fixture', argv: [process.execPath, script, '{input}', '{outputDir}'] };
  const dir = path.join(f.dataDir, 'voice-runtime');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  return config;
}

test('setup argument parsing and import have no installation side effects', () => {
  assert.equal(parseArgs([]).model, 'base');
  assert.deepEqual(parseArgs(['--model', 'tiny', '--data', '/tmp/local-voice-fixture']), { model: 'tiny', dataDir: '/tmp/local-voice-fixture', help: false });
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--model', 'large']), /inválido/);
  assert.throws(() => parseArgs(['--data']), /inválido/);
});

test('existing local config and explicit settings are preserved, before any network/install', async t => {
  const f = await fixture(t);
  await fakeConfig(f);
  const filename = path.join(f.dataDir, 'voice-runtime', 'config.json');
  const before = await readFile(filename, 'utf8');
  await assert.rejects(setupVoice({ dataDir: f.dataDir, model: 'base' }), /Ya hay un motor configurado/);
  assert.equal(await readFile(filename, 'utf8'), before);
  assert.deepEqual(await readdir(path.dirname(filename)), ['config.json']);
  await rm(filename);
  await writeFile(path.join(f.dataDir, 'state.json'), JSON.stringify({ settings: { localWhisperCommand: '["custom", "{input}"]' } }));
  await assert.rejects(setupVoice({ dataDir: f.dataDir }), /Ya hay un comando\/proveedor/);
  await writeFile(path.join(f.dataDir, 'state.json'), JSON.stringify({ settings: { voiceProvider: 'openai' } }));
  await assert.rejects(setupVoice({ dataDir: f.dataDir }), /Ya hay un comando\/proveedor/);
  assert.deepEqual(await readdir(path.dirname(filename)), []);
});

test('local discovery is workspace-safe and explicit command/provider wins', async t => {
  const f = await fixture(t);
  await fakeConfig(f);
  const noNetwork = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network'); });
  assert.ok(await discoverLocalVoice(f.context));
  assert.equal((await f.invoke()).text, 'adapter discovery fixture');
  const customScript = path.join(f.root, 'custom-engine.mjs');
  await writeFile(customScript, `console.log('explicit command');`);
  f.context.state.settings = { localWhisperCommand: JSON.stringify([process.execPath, customScript, '{input}']), localWhisperOutput: 'stdout' };
  assert.equal((await f.invoke()).text, 'explicit command');
  f.context.state.settings = { voiceProvider: 'openai' };
  await assert.rejects(f.invoke(), /OPENAI_API_KEY|conectar al proveedor/);
  // Explicit cloud may call the mocked fetch when a host key is already set.
  assert.ok(noNetwork.mock.callCount() <= 1);
  assert.deepEqual(await readdir(f.cwd), []);
  assert.deepEqual(await readdir(path.join(f.dataDir, 'automation', f.workspace.id)), []);
});

test('bad config/argv and unavailable local engine give actionable failures without network', async t => {
  const f = await fixture(t);
  const config = await fakeConfig(f);
  const filename = path.join(f.dataDir, 'voice-runtime', 'config.json');
  const noNetwork = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network'); });
  config.argv[0] = '/definitely/not/installed/whisper';
  await writeFile(filename, JSON.stringify(config));
  await assert.rejects(f.invoke(), /Motor local no disponible.*npm run setup:voice/);
  config.argv = [process.execPath, 'no-placeholder'];
  await writeFile(filename, JSON.stringify(config));
  await assert.rejects(f.invoke(), /necesita \{input\}/);
  config.argv = [process.execPath, '{input}', '{unknown}'];
  await writeFile(filename, JSON.stringify(config));
  await assert.rejects(f.invoke(), /Placeholders/);
  await writeFile(filename, '{broken');
  await assert.rejects(f.invoke(), /JSON de voz local inválido/);
  await rm(filename);
  const oldPath = process.env.PATH;
  process.env.PATH = '';
  f.context.state.settings.voiceProvider = 'local';
  try { await assert.rejects(f.invoke(), /npm run setup:voice/); }
  finally { if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath; }
  assert.equal(noNetwork.mock.callCount(), 0);
});

// Opt-in integration proof. Never installs/downloads anything, including on CI.
// Run: PHANTOM_TEST_LOCAL_VOICE=1 node --test test/voice-local.test.mjs
test('real offline faster-whisper transcribes synthetic speech and WebM', { skip: process.env.PHANTOM_TEST_LOCAL_VOICE !== '1' }, async t => {
  const f = await fixture(t);
  const realData = stateDirectory();
  const configPath = path.join(realData, 'voice-runtime', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.engine, 'faster-whisper');
  assert.equal(config.computeType, 'int8');
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  await access(config.provenance.modelPath);
  f.context.dataDir = realData;
  f.context.state.settings.voiceProvider = 'local';
  const espeak = await executableOnPath('espeak-ng') || await executableOnPath('espeak');
  assert.ok(espeak, 'espeak/espeak-ng required for explicit synthetic speech proof');
  const sourceText = 'Create a task to review the project tomorrow. This is a local voice test.';
  const wav = path.join(f.root, 'synthetic-english.wav');
  const spoken = await runCommand(espeak, ['-v', 'en-us', '-s', '145', '-w', wav, sourceText], { cwd: f.cwd, timeoutMs: 10_000 });
  assert.equal(spoken.code, 0);
  const noNetwork = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Local ASR must not call cloud'); });
  let transcript;
  try { transcript = await f.invoke({ audioBase64: (await readFile(wav)).toString('base64') }); }
  catch (error) {
    const [executable, ...args] = config.argv.map(arg => arg.replaceAll('{input}', wav).replaceAll('{outputDir}', f.root));
    const diagnostic = await runCommand(executable, args, { cwd: f.cwd, timeoutMs: 60_000 });
    t.diagnostic(`Synthetic fixture engine diagnostics: ${diagnostic.output}`);
    throw error;
  }
  assert.equal(transcript.provider, 'local');
  t.diagnostic(JSON.stringify({ source: 'espeak synthetic English, no microphone', sourceText, transcript: transcript.text, model: config.model, revision: config.provenance.revision }));
  assert.match(transcript.text, /task/i);
  assert.match(transcript.text, /tomorrow/i);
  assert.match(transcript.text, /voice test/i);
  const ffmpeg = await executableOnPath('ffmpeg');
  assert.ok(ffmpeg, 'ffmpeg required to generate a MediaRecorder-like WebM proof');
  const webm = path.join(f.root, 'synthetic-english.webm');
  const converted = await runCommand(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', wav, '-c:a', 'libopus', webm], { cwd: f.cwd, timeoutMs: 10_000 });
  assert.equal(converted.code, 0);
  const webmTranscript = await f.invoke({ mimeType: 'audio/webm;codecs=opus', audioBase64: (await readFile(webm)).toString('base64') });
  assert.match(webmTranscript.text, /task/i);
  assert.match(webmTranscript.text, /voice test/i);
  assert.equal(noNetwork.mock.callCount(), 0);
  t.diagnostic(JSON.stringify({ format: 'audio/webm;codecs=opus', transcript: webmTranscript.text }));
  const intents = (await handleVoice('voice.intent', { workspaceId: f.workspace.id, text: transcript.text }, f.context)).result;
  assert.equal(intents.action, 'task');
  assert.equal(intents.workspaceId, f.workspace.id);
});
