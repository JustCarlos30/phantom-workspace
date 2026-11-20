// Real detection of the agent providers and their model catalogs. Nothing is
// fabricated: a missing tool, a failed command or an empty catalog is reported
// as unavailable with the observed reason. Sessions of Claude Code and Codex
// come from host/limits.mjs (the same reading as the plan limits).
import { execFile } from 'node:child_process';
import { openCodeModels } from './chats.mjs';
import { codexModels } from './chat-models.mjs';
import { claudeModelCatalog, executionPolicy, isClaudeLike, PROVIDER_IDS, PROVIDER_LABELS } from '../shared/execution-policy.mjs';

export const PROVIDER_TOOLS = Object.freeze({
  claude: Object.freeze({ bin: 'claude', setting: 'claudePath', engine: 'claude-code' }),
  opencode: Object.freeze({ bin: 'opencode', setting: 'opencodePath', engine: 'opencode' }),
  codex: Object.freeze({ bin: 'codex', setting: 'codexPath', engine: null }),
});
const DETECT_TIMEOUT = 8000, CATALOG_TIMEOUT = 20000, DETECT_CACHE_MS = 30000, MODELS_CACHE_MS = 60000;
const strip = value => String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
const firstLine = value => strip(value).split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 200) ?? null;

// Runs a tool without a shell and always resolves with what was observed.
export function runTool(bin, args, { cwd, timeoutMs = DETECT_TIMEOUT, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise(resolve => {
    const done = (error, stdout = '', stderr = '') => {
      if (!error) { resolve({ ok: true, stdout: String(stdout), stderr: String(stderr) }); return; }
      const missing = error.code === 'ENOENT' || error.code === 'EACCES';
      const timedOut = error.code === 'ETIMEDOUT' || (error.killed === true && Boolean(error.signal));
      const reason = missing ? `No se encontró «${bin}»` : timedOut ? `«${bin} ${args.join(' ')}» no respondió en ${Math.round(timeoutMs / 1000)} s` : (strip(stderr).trim() || error.message).split('\n').slice(-3).join(' ').slice(0, 500);
      resolve({ ok: false, missing, timedOut, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), reason });
    };
    try { execFile(bin, args, { cwd, env: { ...process.env, ...(cwd ? { PWD: cwd } : {}) }, timeout: timeoutMs, maxBuffer, windowsHide: true, encoding: 'utf8' }, done); }
    catch (error) { done(error); }
  });
}

// `opencode auth list` prints boxed sections: stored credentials ("● Anthropic oauth")
// and environment providers ("● OpenRouter OPENROUTER_API_KEY"). Only names and
// login methods are kept; nothing else of the output leaves this function.
export function parseAuthList(stdout) {
  const items = []; let source = 'credentials';
  const bullet = /^[●•*◆◇○]\s*(.+)$/;
  for (const raw of strip(stdout).split('\n')) {
    const line = raw.replace(/^[\s│┃|┌└├┐┘╭╰]+/, '').trim();
    if (!line) continue;
    const match = bullet.exec(line);
    if (!match) { if (/^environment\b/i.test(line)) source = 'environment'; else if (/^credentials\b/i.test(line)) source = 'credentials'; continue; }
    const parts = match[1].trim().split(/\s+/), last = parts.length > 1 ? parts.at(-1) : null;
    const name = (last ? parts.slice(0, -1) : parts).join(' ').slice(0, 80);
    if (!name) continue;
    items.push({ name, source, ...(source === 'credentials' && last ? { method: last.slice(0, 40) } : {}) });
    if (items.length >= 100) break;
  }
  return items;
}

function sessionFromLimits(reading, id) {
  const entry = reading?.providers?.find(provider => provider?.id === id);
  if (!entry) return { available: false, reason: reading?.error ? `No se pudo leer la sesión: ${reading.error}` : 'No hay lectura de sesión para este proveedor.' };
  return { available: entry.available === true, plan: entry.plan ?? null, ...(entry.available === true ? {} : { reason: entry.reason ?? 'Sesión no disponible' }) };
}

export function createProviders({ settings = () => ({}), cwd = () => process.cwd(), limits, run = runTool, codexCatalog = codexModels, now = Date.now } = {}) {
  let detected = null, pending = null;
  const catalogs = new Map();
  const bins = () => Object.fromEntries(PROVIDER_IDS.map(id => [id, settings()?.[PROVIDER_TOOLS[id].setting] || PROVIDER_TOOLS[id].bin]));
  const binary = async (bin, directory) => {
    const result = await run(bin, ['--version'], { cwd: directory, timeoutMs: DETECT_TIMEOUT });
    if (result.ok) return { status: 'available', binary: { path: bin, version: firstLine(result.stdout) ?? firstLine(result.stderr) } };
    return { status: result.missing ? 'unavailable' : 'error', reason: result.reason, binary: { path: bin, version: null } };
  };
  const detectOpenCode = async (bin, directory) => {
    const found = await binary(bin, directory);
    if (found.status !== 'available') return { ...found, session: { available: false, reason: found.reason, credentials: [] }, models: { available: false, count: 0, reason: found.reason } };
    const [auth, models] = await Promise.all([run(bin, ['auth', 'list'], { cwd: directory, timeoutMs: DETECT_TIMEOUT }), run(bin, ['models'], { cwd: directory, timeoutMs: CATALOG_TIMEOUT })]);
    const credentials = auth.ok ? parseAuthList(auth.stdout) : [];
    const count = models.ok ? openCodeModels(models.stdout).filter(item => !isClaudeLike(item.id)).length : 0;
    return {
      ...found,
      session: { available: credentials.length > 0, credentials, ...(credentials.length ? {} : { reason: auth.ok ? 'OpenCode no tiene credenciales: inicia sesión con `opencode auth login`.' : `No se pudo leer \`opencode auth list\`: ${auth.reason}` }) },
      models: { available: count > 0, count, ...(count ? {} : { reason: models.ok ? 'OpenCode no listó modelos fuera de Claude.' : `No se pudo leer \`opencode models\`: ${models.reason}` }) },
    };
  };
  const detect = async key => {
    const tools = bins(), directory = cwd();
    const reading = limits ? await Promise.resolve().then(() => limits.read()).catch(error => ({ providers: [], error: error.message })) : { providers: [], error: 'lectura de sesiones no configurada' };
    const [claude, opencode, codex] = await Promise.all([binary(tools.claude, directory), detectOpenCode(tools.opencode, directory), binary(tools.codex, directory)]);
    const entry = (id, value, session) => ({ id, label: PROVIDER_LABELS[id], engine: PROVIDER_TOOLS[id].engine, ...value, ...(session ? { session } : {}) });
    const value = { observedAt: new Date(now()).toISOString(), providers: [entry('claude', claude, sessionFromLimits(reading, 'claude')), entry('opencode', opencode), entry('codex', codex, sessionFromLimits(reading, 'codex'))] };
    detected = { key, at: now(), value };
    return value;
  };
  return {
    // Detection is cached briefly; enabled flags and the policy are always read live.
    async list({ force = false } = {}) {
      const policy = executionPolicy(settings());
      const key = JSON.stringify([bins(), cwd()]);
      let value;
      if (!force && detected?.key === key && now() - detected.at < DETECT_CACHE_MS) value = detected.value;
      else { pending ??= detect(key).finally(() => { pending = null; }); value = await pending; }
      return { observedAt: value.observedAt, policy, providers: value.providers.map(provider => ({ ...provider, enabled: policy.providers[provider.id].enabled })) };
    },
    // Model catalog per provider. Claude is static; OpenCode and Codex ask their CLI.
    // Claude models offered by other providers are excluded: Claude runs only through Claude Code.
    async models(provider, { force = false } = {}) {
      if (!PROVIDER_IDS.includes(provider)) throw new Error(`Proveedor desconocido: ${String(provider).slice(0, 40)}. Proveedores: ${PROVIDER_IDS.join(', ')}`);
      const policy = executionPolicy(settings()), base = { provider, engine: PROVIDER_TOOLS[provider].engine, enabled: policy.providers[provider].enabled };
      if (provider === 'claude') return { ...base, available: true, items: claudeModelCatalog().map(item => ({ ...item, engine: 'claude-code' })), observedAt: new Date(now()).toISOString() };
      const bin = bins()[provider], directory = cwd(), key = JSON.stringify([provider, bin, directory]);
      const cached = catalogs.get(key);
      if (!force && cached && now() - cached.at < MODELS_CACHE_MS) return { ...cached.value, enabled: base.enabled };
      let items, reason;
      if (provider === 'opencode') {
        const result = await run(bin, ['models', '--verbose'], { cwd: directory, timeoutMs: CATALOG_TIMEOUT });
        if (result.ok) items = openCodeModels(result.stdout).map(item => ({ ...item, engine: 'opencode' }));
        else reason = `OpenCode no pudo listar sus modelos: ${result.reason}`;
      } else {
        try { items = (await codexCatalog(bin, directory, { timeoutMs: CATALOG_TIMEOUT })).map(item => ({ ...item, client: 'codex' })); }
        catch (error) { reason = error.message; }
      }
      if (!items) return { ...base, available: false, reason, items: [], observedAt: new Date(now()).toISOString() };
      const allowed = items.filter(item => !isClaudeLike(item.id));
      if (!allowed.length) return { ...base, available: false, reason: `${PROVIDER_LABELS[provider]} no listó modelos fuera de Claude.`, items: [], excluded: items.length, observedAt: new Date(now()).toISOString() };
      const value = { ...base, available: true, items: allowed, excluded: items.length - allowed.length, observedAt: new Date(now()).toISOString() };
      catalogs.set(key, { at: now(), value });
      while (catalogs.size > 20) catalogs.delete(catalogs.keys().next().value);
      return value;
    },
    invalidate() { detected = null; catalogs.clear(); },
  };
}
