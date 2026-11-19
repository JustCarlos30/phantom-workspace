// Central execution policy: every NEW chat, handoff and Phantom task/card run
// uses Claude Code. Historical records stay readable; only new execution is gated.
export const CLAUDE_CLIENT = 'claude';
export const HARNESS_PROVIDER = 'claude-code';
export const DEFAULT_CLAUDE_MODEL = 'sonnet';
export const DEFAULT_HARNESS_MODEL = `${HARNESS_PROVIDER}/${DEFAULT_CLAUDE_MODEL}`;
export const CLAUDE_MODEL_ALIASES = Object.freeze(['fable', 'opus', 'sonnet', 'haiku']);

const NAME = /^(?:fable|opus|sonnet|haiku|claude-[A-Za-z0-9][A-Za-z0-9._-]{0,150})$/;

// A Claude model name, bare ("sonnet", "claude-sonnet-5-5") or harness-qualified ("claude-code/sonnet").
export function isClaudeModel(model) {
  if (typeof model !== 'string') return false;
  const bare = model.startsWith(`${HARNESS_PROVIDER}/`) ? model.slice(HARNESS_PROVIDER.length + 1) : model;
  return NAME.test(bare);
}
export const harnessModel = model => model.startsWith(`${HARNESS_PROVIDER}/`) ? model : `${HARNESS_PROVIDER}/${model}`;

export class ExecutionPolicyError extends Error {
  constructor(message) { super(message); this.name = 'ExecutionPolicyError'; this.code = 'EXECUTION_POLICY'; }
}
const refuse = (what, value, where) => new ExecutionPolicyError(
  `${what} «${String(value).slice(0, 80)}» no es Claude Code${where ? ` (${where})` : ''}. Phantom Workspace solo ejecuta con Claude Code: usa «${DEFAULT_HARNESS_MODEL}» u otro modelo Claude. El historial se conserva; para ejecutar de nuevo registra un contrato nuevo con un modelo Claude.`,
);

// Blank means "use the default"; anything explicit must be Claude. Never falls back silently.
// Same precedence as the harness runtime: the contract's fixed model wins; payload and config only apply when the contract fixes none.
export function resolveHarnessModel(payload, contract, config) {
  const candidates = [[contract?.model, 'contract'], [payload, 'payload'], [config, 'config']];
  const [explicit, source] = candidates.find(([value]) => value !== undefined && value !== null && value !== '') ?? [];
  if (explicit === undefined) return { model: DEFAULT_HARNESS_MODEL, source: 'default' };
  if (!isClaudeModel(explicit)) throw refuse('El modelo', explicit, source);
  return { model: harnessModel(explicit), source };
}
export function assertClaudeModel(model, where) {
  if (!isClaudeModel(model)) throw refuse('El modelo', model, where);
  return harnessModel(model);
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
export function assertContractClaudeOnly(contract) {
  for (const { model, where } of contractModels(contract)) if (!isClaudeModel(model)) throw refuse('El modelo declarado', model, where);
  return contract;
}

export function assertClaudeClient(client, what = 'El agente') {
  if (client !== CLAUDE_CLIENT) throw new ExecutionPolicyError(`${what} «${String(client)}» no está admitido para ejecuciones nuevas. Usa Claude Code («${CLAUDE_CLIENT}»). El historial existente sigue legible.`);
  return client;
}

export function claudeModelCatalog() {
  return CLAUDE_MODEL_ALIASES.map(id => ({ id: harnessModel(id), label: id, group: 'Claude Code' }));
}

// Provenance for display: requested (declared) vs observed (evidence). Nothing is "confirmed" without evidence.
export function describeExecution({ requested, requestedSource, observed } = {}) {
  const observedModel = typeof observed === 'string' && observed ? observed : null;
  // A non-Claude requested model (historical record) is never relabeled as Claude: client/engine are unknown.
  const claude = !requested || isClaudeModel(requested);
  return {
    client: claude ? CLAUDE_CLIENT : 'desconocido', engine: claude ? HARNESS_PROVIDER : 'desconocido',
    requested: requested || DEFAULT_HARNESS_MODEL,
    requestedSource: requestedSource || (requested ? 'explicit' : 'default'),
    observed: observedModel,
    status: observedModel ? 'observed' : 'unknown',
  };
}
