import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProviders, parseAuthList, runTool } from '../host/providers.mjs';
import { createHost } from '../host/server.mjs';
import { POLICY_HINTS, setExecutionPolicy } from '../host/agent-policy.mjs';

const AUTH_LIST = `\x1b[90m┌\x1b[0m  Credentials ~/.local/share/opencode/auth.json
│
●  Anthropic oauth
│
●  OpenAI api
│
└  2 credentials

┌  Environment
│
●  OpenRouter OPENROUTER_API_KEY
│
└  1 environment variable
`;

const limits = (providers = [{ id: 'claude', available: true, plan: 'max' }, { id: 'codex', available: false, reason: 'No hay una sesión de ChatGPT en Codex ni en OpenCode.' }]) => ({ reads: 0, async read() { this.reads++; return { providers }; } });
// Fake tool runner: maps "bin arg…" to an observed result; anything else is a missing binary.
function runner(table) {
  const calls = [];
  const run = async (bin, args) => {
    calls.push([bin, ...args].join(' '));
    const entry = table[[bin, ...args].join(' ')];
    if (entry === undefined) return { ok: false, missing: true, reason: `No se encontró «${bin}»` };
    return typeof entry === 'string' ? { ok: true, stdout: entry, stderr: '' } : entry;
  };
  return { run, calls };
}

test('parseAuthList keeps provider names and login methods only, tolerating boxes and ANSI', () => {
  assert.deepEqual(parseAuthList(AUTH_LIST), [
    { name: 'Anthropic', source: 'credentials', method: 'oauth' },
    { name: 'OpenAI', source: 'credentials', method: 'api' },
    { name: 'OpenRouter', source: 'environment' },
  ]);
  assert.doesNotMatch(JSON.stringify(parseAuthList(AUTH_LIST)), /OPENROUTER_API_KEY/);
  assert.deepEqual(parseAuthList(''), []);
  assert.deepEqual(parseAuthList('algo inesperado\nsin viñetas'), []);
});

test('runTool reports a missing binary and a timeout as observed, never as success', async () => {
  const missing = await runTool(path.join(os.tmpdir(), 'phantom-no-such-binary'), ['--version']);
  assert.equal(missing.ok, false); assert.equal(missing.missing, true); assert.match(missing.reason, /No se encontró/);
  const slow = await runTool(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 200 });
  assert.equal(slow.ok, false); assert.equal(slow.timedOut, true); assert.match(slow.reason, /no respondió/);
  const ok = await runTool(process.execPath, ['--version']);
  assert.equal(ok.ok, true); assert.match(ok.stdout, /^v\d+/);
});

test('detection with every binary absent reports unavailable with a reason and fabricates nothing', async () => {
  const { run } = runner({});
  const providers = createProviders({ settings: () => ({}), cwd: () => os.tmpdir(), limits: limits([]), run });
  const result = await providers.list();
  assert.deepEqual(result.providers.map(p => [p.id, p.status, p.enabled]), [['claude', 'unavailable', true], ['opencode', 'unavailable', false], ['codex', 'unavailable', false]]);
  for (const provider of result.providers) { assert.match(provider.reason, /No se encontró/); assert.equal(provider.binary.version, null); }
  const opencode = result.providers.find(p => p.id === 'opencode');
  assert.deepEqual([opencode.session.available, opencode.session.credentials, opencode.models.count], [false, [], 0]);
  assert.equal(result.providers.find(p => p.id === 'claude').session.available, false);
  assert.deepEqual(result.policy.providers.opencode, { enabled: false });
});

test('detection reads binaries, OpenCode auth/models and Claude/Codex sessions from limits; cache is short and policy is live', async () => {
  const settings = { opencodePath: '/opt/opencode' };
  const { run, calls } = runner({
    'claude --version': '2.1.328 (Claude Code)\n',
    '/opt/opencode --version': '1.2.3\n',
    '/opt/opencode auth list': AUTH_LIST,
    '/opt/opencode models': 'openai/gpt-5\nanthropic/claude-sonnet-4\nopenai/gpt-5-mini\n',
    'codex --version': { ok: false, missing: false, reason: 'codex: error de configuración' },
  });
  let time = 1000;
  const reading = limits();
  const providers = createProviders({ settings: () => settings, cwd: () => '/tmp', limits: reading, run, now: () => time });
  const result = await providers.list();
  const [claude, opencode, codex] = result.providers;
  assert.deepEqual([claude.status, claude.binary.version, claude.session], ['available', '2.1.328 (Claude Code)', { available: true, plan: 'max' }]);
  assert.equal(claude.engine, 'claude-code');
  assert.deepEqual([opencode.status, opencode.binary.path, opencode.session.available, opencode.session.credentials.length, opencode.models.count], ['available', '/opt/opencode', true, 3, 2]);
  assert.deepEqual([codex.status, codex.reason, codex.session.available, codex.engine], ['error', 'codex: error de configuración', false, null]);
  assert.match(codex.session.reason, /ChatGPT/);
  const count = calls.length;
  settings.providers = { opencode: { enabled: true } };
  const cached = await providers.list();
  assert.equal(calls.length, count, 'detection is cached');
  assert.equal(cached.providers[1].enabled, true, 'enabled flags follow the settings immediately');
  time += 31000;
  await providers.list();
  assert.ok(calls.length > count, 'cache expires');
  const before = calls.length; await providers.list({ force: true }); assert.ok(calls.length > before);
  assert.ok(reading.reads >= 2);
});

test('model catalogs: Claude static, OpenCode without Claude, Codex through its catalog; failures stay unavailable', async () => {
  const { run } = runner({ 'opencode models --verbose': 'openai/gpt-5\n{"variants":{"high":{}}}\nopenrouter/anthropic/claude-opus\nopenai/gpt-5-mini\n' });
  const codexCatalog = async () => [{ id: 'gpt-5-codex', group: 'Codex' }];
  const providers = createProviders({ settings: () => ({}), cwd: () => '/tmp', run, codexCatalog });
  const claude = await providers.models('claude');
  assert.deepEqual(claude.items.map(i => i.id), ['claude-code/fable', 'claude-code/opus', 'claude-code/sonnet', 'claude-code/haiku']);
  assert.equal(claude.engine, 'claude-code'); assert.equal(claude.enabled, true);
  const opencode = await providers.models('opencode');
  assert.deepEqual(opencode.items.map(i => i.id), ['openai/gpt-5', 'openai/gpt-5-mini']);
  assert.deepEqual(opencode.items[0].variants, ['high']); assert.equal(opencode.excluded, 1); assert.equal(opencode.enabled, false);
  const codex = await providers.models('codex');
  assert.deepEqual(codex.items, [{ id: 'gpt-5-codex', group: 'Codex', client: 'codex' }]);
  await assert.rejects(providers.models('gemini'), /Proveedor desconocido/);
  const broken = createProviders({ settings: () => ({}), cwd: () => '/tmp', run: runner({}).run, codexCatalog: async () => { throw new Error('Codex no pudo listar sus modelos: tiempo de espera agotado'); } });
  const missing = await broken.models('opencode');
  assert.deepEqual([missing.available, missing.items], [false, []]); assert.match(missing.reason, /No se encontró/);
  const failed = await broken.models('codex');
  assert.deepEqual([failed.available, failed.items], [false, []]); assert.match(failed.reason, /tiempo de espera/);
});

test('host providers.list/configure/models: validated, persisted, live policy and no credentials in public settings', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-providers-'));
  const { run } = runner({ 'claude --version': '2.1.328\n', 'opencode models --verbose': 'openai/gpt-5\n' });
  let host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }), providerOptions: { limits: limits(), run } });
  t.after(async () => { setExecutionPolicy(); await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  let listed = await host.invoke('providers.list');
  assert.deepEqual(listed.policy.providers, { claude: { enabled: true }, opencode: { enabled: false }, codex: { enabled: false } });
  assert.equal(listed.providers.find(p => p.id === 'opencode').status, 'unavailable');
  await assert.rejects(host.invoke('providers.configure', { providers: { opencode: { enabled: 'si' } } }), /enabled/);
  await assert.rejects(host.invoke('providers.configure', { defaults: { task: { client: 'opencode', model: 'openai/gpt-5' } } }), /Habilita OpenCode/);
  assert.equal((await host.invoke('state.get')).settings.providers, undefined, 'a refused configuration persists nothing');
  const configured = await host.invoke('providers.configure', { providers: { opencode: { enabled: true } }, defaults: { judge: { client: 'opencode', model: 'openai/gpt-5' } } });
  assert.deepEqual(configured.policy.defaults.judge, { client: 'opencode', model: 'openai/gpt-5' });
  assert.match(POLICY_HINTS.engine, /OpenCode/);
  assert.equal((await host.invoke('providers.models', { provider: 'opencode' })).items[0].id, 'openai/gpt-5');
  // settings.update cannot bypass validation of the policy keys.
  await assert.rejects(host.invoke('settings.update', { patch: { providers: { opencode: { enabled: false } } } }), /Juez.*Habilita OpenCode/);
  await host.invoke('settings.update', { patch: { opencodeApiKey: 'sk-secret', providerToken: 'x' } });
  const state = await host.invoke('state.get');
  assert.deepEqual(state.settings.providers.opencode, { enabled: true });
  assert.doesNotMatch(JSON.stringify(state.settings), /sk-secret/);
  assert.doesNotMatch(JSON.stringify(await host.invoke('providers.list')), /sk-secret|OPENROUTER/);
  // Persisted across a restart.
  await host.close();
  host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }), providerOptions: { limits: limits(), run } });
  listed = await host.invoke('providers.list');
  assert.equal(listed.providers.find(p => p.id === 'opencode').enabled, true);
  await host.invoke('providers.configure', { providers: { opencode: { enabled: false } }, defaults: { judge: { client: 'claude', model: 'claude-code/sonnet' } } });
  assert.doesNotMatch(POLICY_HINTS.engine, /OpenCode/);
});
