// Central execution policy: every NEW chat, handoff and Phantom task/card run
// uses only providers the user enabled. Without settings only Claude Code is
// enabled. Historical records stay readable; only new execution is gated.
export const CLAUDE_CLIENT = 'claude';
export const HARNESS_PROVIDER = 'claude-code';
export const OPENCODE_ENGINE = 'opencode';
export const DEFAULT_CLAUDE_MODEL = 'sonnet';
export const DEFAULT_HARNESS_MODEL = `${HARNESS_PROVIDER}/${DEFAULT_CLAUDE_MODEL}`;
export const CLAUDE_MODEL_ALIASES = Object.freeze(['fable', 'opus', 'sonnet', 'haiku']);
export const PROVIDER_IDS = Object.freeze(['claude', 'opencode', 'codex']);
export const PROVIDER_LABELS = Object.freeze({ claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex' });
export const POLICY_AREAS = Object.freeze(['chat', 'handoff', 'task', 'judge']);
const AREA_LABELS = { chat: 'Chats', handoff: 'Encargos', task: 'Tareas', judge: 'Juez' };
// Harness areas run through the native harness engines; chat/handoff drive an agent CLI.
const HARNESS_AREAS = new Set(['task', 'judge']);
const SETTINGS_PATH = 'Configuración > Agentes';

const NAME = /^(?:fable|opus|sonnet|haiku|claude-[A-Za-z0-9][A-Za-z0-9._-]{0,150})$/;
const ID = /^[A-Za-z0-9][\w./:@\[\]-]{0,199}$/;
const PROVIDER_MODEL = /^[A-Za-z0-9][\w.-]{0,63}\/[A-Za-z0-9][\w./:@\[\]-]{0,199}$/;

const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const DEFAULT_POLICY = freeze({
  providers: { claude: { enabled: true }, opencode: { enabled: false }, codex: { enabled: false } },
  // model null: the agent CLI's own default (chat and handoff never passed a model before).
  defaults: {
    chat: { client: CLAUDE_CLIENT, model: null },
    handoff: { client: CLAUDE_CLIENT, model: null },
    task: { client: CLAUDE_CLIENT, model: DEFAULT_HARNESS_MODEL },
    judge: { client: CLAUDE_CLIENT, model: DEFAULT_HARNESS_MODEL },
  },
});

// A Claude model name, bare ("sonnet", "claude-sonnet-5-5") or harness-qualified ("claude-code/sonnet").
export function isClaudeModel(model) {
  if (typeof model !== 'string') return false;
  const bare = model.startsWith(`${HARNESS_PROVIDER}/`) ? model.slice(HARNESS_PROVIDER.length + 1) : model;
  return NAME.test(bare);
}
// Any identifier that names a Claude model, including through another provider ("anthropic/…", "openrouter/…claude…").
export function isClaudeLike(model) {
  if (typeof model !== 'string') return false;
  if (isClaudeModel(model) || model.startsWith(`${HARNESS_PROVIDER}/`) || /^anthropic\//i.test(model)) return true;
  return /claude/i.test(model.slice(model.indexOf('/') + 1));
}
export const harnessModel = model => model.startsWith(`${HARNESS_PROVIDER}/`) ? model : `${HARNESS_PROVIDER}/${model}`;
// Native harness routing: claude-code/<m> (or a bare Claude name) runs on Claude Code, any other provider/model on OpenCode.
export const engineOf = model => typeof model === 'string' && (model.startsWith(`${HARNESS_PROVIDER}/`) || isClaudeModel(model)) ? HARNESS_PROVIDER : OPENCODE_ENGINE;
export const clientOfEngine = engine => engine === HARNESS_PROVIDER ? CLAUDE_CLIENT : engine === OPENCODE_ENGINE ? 'opencode' : null;

export class ExecutionPolicyError extends Error {
  constructor(message) { super(message); this.name = 'ExecutionPolicyError'; this.code = 'EXECUTION_POLICY'; }
}
const shown = value => String(value).slice(0, 80);
const at = where => where ? ` (${where})` : '';
const enabled = (policy, id) => policy?.providers?.[id]?.enabled === true;
const refuse = (what, value, where) => new ExecutionPolicyError(
  `${what} «${shown(value)}» no es Claude Code${at(where)}. OpenCode no está habilitado: para usar modelos de otros proveedores habilita OpenCode en ${SETTINGS_PATH}; si no, usa «${DEFAULT_HARNESS_MODEL}» u otro modelo Claude. El historial se conserva; para ejecutar de nuevo registra un contrato nuevo con un modelo permitido.`,
);
const claudeThroughOpenCode = (value, where) => new ExecutionPolicyError(
  `El modelo «${shown(value)}» es Claude${at(where)}: Claude se ejecuta solo con Claude Code, nunca por OpenCode ni Codex. Usa «${HARNESS_PROVIDER}/<modelo>», por ejemplo «${DEFAULT_HARNESS_MODEL}».`,
);
const claudeDisabled = (value, where) => new ExecutionPolicyError(
  `El modelo «${shown(value)}» es de Claude Code, que está deshabilitado${at(where)}. Habilita Claude Code en ${SETTINGS_PATH} o usa un modelo de un proveedor habilitado.`,
);

// Validates a harness model (task, judge, contract) against the policy and returns the form the harness receives.
export function assertModelAllowed(model, policy = DEFAULT_POLICY, where) {
  if (isClaudeModel(model)) {
    if (!enabled(policy, 'claude')) throw claudeDisabled(model, where);
    return harnessModel(model);
  }
  if (typeof model === 'string' && model.startsWith(`${HARNESS_PROVIDER}/`)) throw new ExecutionPolicyError(`El modelo «${shown(model)}» no es Claude Code válido${at(where)}. Usa un alias (${CLAUDE_MODEL_ALIASES.join(', ')}) o un nombre claude-*, por ejemplo «${DEFAULT_HARNESS_MODEL}».`);
  if (isClaudeLike(model)) throw claudeThroughOpenCode(model, where);
  if (!enabled(policy, 'opencode')) throw refuse('El modelo', model, where);
  if (typeof model !== 'string' || !PROVIDER_MODEL.test(model)) throw new ExecutionPolicyError(`El modelo «${shown(model)}» no es válido${at(where)}: usa «${HARNESS_PROVIDER}/<modelo>» para Claude Code o «proveedor/modelo» para OpenCode.`);
  return model;
}
export function assertClaudeModel(model, where) {
  if (!isClaudeModel(model)) throw new ExecutionPolicyError(`El modelo «${shown(model)}» no es Claude Code${at(where)}. Este agente es Claude Code: usa «${DEFAULT_HARNESS_MODEL}» u otro modelo Claude.`);
  return harnessModel(model);
}

export function assertClientAllowed(client, policy = DEFAULT_POLICY, what = 'El agente') {
  if (!PROVIDER_IDS.includes(client)) throw new ExecutionPolicyError(`${what} «${shown(client)}» no es un proveedor conocido. Proveedores: ${PROVIDER_IDS.map(id => `${PROVIDER_LABELS[id]} («${id}»)`).join(', ')}.`);
  if (!enabled(policy, client)) {
    const fallback = enabled(policy, CLAUDE_CLIENT) && client !== CLAUDE_CLIENT ? `; mientras tanto usa Claude Code («${CLAUDE_CLIENT}»)` : '';
    throw new ExecutionPolicyError(`${what} «${client}» no está habilitado para ejecuciones nuevas. Habilita ${PROVIDER_LABELS[client]} en ${SETTINGS_PATH}${fallback}. El historial existente sigue legible.`);
  }
  return client;
}
// A model chosen for an agent CLI client (chat card, handoff): Claude through Claude Code only.
export function assertClientModel(client, model, policy = DEFAULT_POLICY, where) {
  assertClientAllowed(client, policy);
  if (client === CLAUDE_CLIENT) return assertClaudeModel(model, where);
  if (isClaudeLike(model)) throw claudeThroughOpenCode(model, where);
  const valid = client === 'opencode' ? typeof model === 'string' && PROVIDER_MODEL.test(model) : typeof model === 'string' && ID.test(model);
  if (!valid) throw new ExecutionPolicyError(`El modelo «${shown(model)}» no es válido para ${PROVIDER_LABELS[client]}${at(where)}${client === 'opencode' ? ': usa «proveedor/modelo»' : ''}.`);
  return model;
}

// Blank means "use the area default"; anything explicit must be allowed. Never falls back silently.
// Same precedence as the harness runtime: the contract's fixed model wins; payload and config only apply when the contract fixes none.
export function resolveHarnessModel(payload, contract, config, policy = DEFAULT_POLICY, area = 'task') {
  const candidates = [[contract?.model, 'contract'], [payload, 'payload'], [config, 'config']];
  const [explicit, source] = candidates.find(([value]) => value !== undefined && value !== null && value !== '') ?? [];
  if (explicit === undefined) return { model: assertModelAllowed(policy?.defaults?.[area]?.model ?? DEFAULT_HARNESS_MODEL, policy, `predeterminado de ${AREA_LABELS[area] ?? area}`), source: 'default' };
  return { model: assertModelAllowed(explicit, policy, source), source };
}

// Models a task contract declares: the contract itself, its judge and every coordination child.
export function contractModels(contract) {
  const found = [];
  const add = (model, where) => { if (model !== undefined && model !== null) found.push({ model, where }); };
  add(contract?.model, 'contrato');
  add(contract?.judge?.model, 'juez del contrato');
  const walk = (children, prefix) => (children ?? []).forEach((child, index) => {
    const label = `${prefix}${child?.id ?? child?.name ?? index + 1}`;
    add(child?.model, `hijo ${label}`); add(child?.judge?.model, `juez del hijo ${label}`);
    walk(child?.coordination?.children, `${label}/`);
  });
  walk(contract?.coordination?.children, '');
  return found;
}
export function assertContractAllowed(contract, policy = DEFAULT_POLICY) {
  for (const { model, where } of contractModels(contract)) assertModelAllowed(model, policy, where);
  return contract;
}

// Legacy names: the same checks under the default (Claude Code only) policy.
export const assertContractClaudeOnly = contract => assertContractAllowed(contract, DEFAULT_POLICY);
export const assertClaudeClient = (client, what = 'El agente') => assertClientAllowed(client, DEFAULT_POLICY, what);

// Effective policy from global settings: settings.providers and settings.executionDefaults.
// Invalid stored values throw instead of being replaced by defaults.
export function executionPolicy(settings) {
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);
  const stored = settings?.providers, storedDefaults = settings?.executionDefaults;
  if (stored !== undefined && !plain(stored)) throw new ExecutionPolicyError(`Ajustes de proveedores inválidos; revísalos en ${SETTINGS_PATH}.`);
  if (storedDefaults !== undefined && !plain(storedDefaults)) throw new ExecutionPolicyError(`Predeterminados de ejecución inválidos; revísalos en ${SETTINGS_PATH}.`);
  const providers = {}, defaults = {};
  for (const id of PROVIDER_IDS) {
    const value = stored?.[id]?.enabled;
    if (value !== undefined && typeof value !== 'boolean') throw new ExecutionPolicyError(`El estado de ${PROVIDER_LABELS[id]} debe ser habilitado o deshabilitado (${SETTINGS_PATH}).`);
    providers[id] = { enabled: value ?? DEFAULT_POLICY.providers[id].enabled };
  }
  for (const area of POLICY_AREAS) {
    const value = storedDefaults?.[area] ?? {};
    if (!plain(value)) throw new ExecutionPolicyError(`Predeterminado de ${AREA_LABELS[area]} inválido (${SETTINGS_PATH}).`);
    defaults[area] = { client: value.client ?? DEFAULT_POLICY.defaults[area].client, model: value.model === undefined ? DEFAULT_POLICY.defaults[area].model : value.model };
  }
  const policy = { providers, defaults };
  for (const area of POLICY_AREAS) assertAreaDefault(area, defaults[area], policy);
  return policy;
}
function assertAreaDefault(area, { client, model }, policy) {
  const where = `predeterminado de ${AREA_LABELS[area]}`;
  if (HARNESS_AREAS.has(area) && ![CLAUDE_CLIENT, 'opencode'].includes(client)) throw new ExecutionPolicyError(`El ${where} debe usar Claude Code («claude») u OpenCode («opencode»), los motores del harness.`);
  assertClientAllowed(client, policy, `El ${where} usa el agente`);
  if (!HARNESS_AREAS.has(area)) { if (model !== null) assertClientModel(client, model, policy, where); return; }
  if (typeof model !== 'string' || !model) throw new ExecutionPolicyError(`El ${where} necesita un modelo (${SETTINGS_PATH}).`);
  if (clientOfEngine(engineOf(model)) !== client) throw new ExecutionPolicyError(`El modelo «${shown(model)}» del ${where} no corresponde a ${PROVIDER_LABELS[client]}: Claude Code usa «${HARNESS_PROVIDER}/<modelo>» y OpenCode «proveedor/modelo».`);
  assertModelAllowed(model, policy, where);
}

// Applies a providers.configure patch over the stored settings; returns the values to persist.
export function configurePolicy(settings, patch) {
  const fail = message => { throw new ExecutionPolicyError(message); };
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!plain(patch)) fail('La configuración de proveedores debe ser un objeto.');
  for (const key of Object.keys(patch)) if (!['providers', 'defaults'].includes(key)) fail(`Campo de configuración desconocido: ${shown(key)}`);
  // A non-object stored value (legacy shape) is replaced by this configuration, never used for execution.
  const base = { providers: plain(settings?.providers) ? settings.providers : undefined, executionDefaults: plain(settings?.executionDefaults) ? settings.executionDefaults : undefined };
  const current = executionPolicy(base);
  const providers = structuredClone(current.providers), defaults = structuredClone(current.defaults);
  if (patch.providers !== undefined) {
    if (!plain(patch.providers)) fail('providers debe ser un objeto.');
    for (const [id, value] of Object.entries(patch.providers)) {
      if (!PROVIDER_IDS.includes(id)) fail(`Proveedor desconocido: ${shown(id)}`);
      if (!plain(value) || Object.keys(value).some(key => key !== 'enabled') || typeof value.enabled !== 'boolean') fail(`${PROVIDER_LABELS[id]} admite solo { enabled: true|false }.`);
      providers[id] = { enabled: value.enabled };
    }
  }
  if (patch.defaults !== undefined) {
    if (!plain(patch.defaults)) fail('defaults debe ser un objeto.');
    for (const [area, value] of Object.entries(patch.defaults)) {
      if (!POLICY_AREAS.includes(area)) fail(`Área desconocida: ${shown(area)}. Áreas: ${POLICY_AREAS.join(', ')}.`);
      if (!plain(value) || Object.keys(value).some(key => !['client', 'model'].includes(key))) fail(`El predeterminado de ${AREA_LABELS[area]} admite solo { client, model }.`);
      if (value.model === '') fail(`Modelo vacío en ${AREA_LABELS[area]}: usa null para el predeterminado de la CLI.`);
      defaults[area] = { ...defaults[area], ...value };
    }
  }
  const next = { providers, executionDefaults: defaults };
  executionPolicy(next);
  return next;
}

export function claudeModelCatalog() {
  return CLAUDE_MODEL_ALIASES.map(id => ({ id: harnessModel(id), label: id, group: 'Claude Code' }));
}

// Provenance for display: requested (declared) vs observed (evidence). Nothing is "confirmed" without evidence.
// A recorded engine (controller descriptor) is shown as recorded; without one a non-Claude model stays unknown.
export function describeExecution({ requested, requestedSource, observed, engine } = {}) {
  const observedModel = typeof observed === 'string' && observed ? observed : null;
  const claude = !requested || isClaudeModel(requested);
  const opencode = !claude && engine === OPENCODE_ENGINE && !isClaudeLike(requested);
  return {
    client: claude ? CLAUDE_CLIENT : opencode ? 'opencode' : 'desconocido', engine: claude ? HARNESS_PROVIDER : opencode ? OPENCODE_ENGINE : 'desconocido',
    requested: requested || DEFAULT_HARNESS_MODEL,
    requestedSource: requestedSource || (requested ? 'explicit' : 'default'),
    observed: observedModel,
    status: observedModel ? 'observed' : 'unknown',
  };
}
