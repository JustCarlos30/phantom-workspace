// Pure transformations shared by the native plugin surfaces.
import { describeExecution, contractModels, isClaudeModel } from '../../shared/execution-policy.mjs';

// Effective client/engine/model for a card with provenance. "requested" is what a
// new run would ask for; "observed" is only what events actually recorded. Nothing
// is called confirmed without evidence, and a non-Claude declared model is shown as blocked.
export function executionFacts({ contract, typedModel, pluginModel, observedModel, recordedRequest } = {}) {
  const typed = typedModel?.trim(), plugin = pluginModel?.trim();
  const declared = contractModels(contract).filter(item => !isClaudeModel(item.model));
  // Same precedence as the host: a model fixed by the contract wins; typed/plugin values apply only when it fixes none.
  const pick = contract?.model ? [contract.model, 'contrato'] : typed ? [typed, 'solicitud actual'] : plugin ? [plugin, 'configuración del plugin'] : [undefined, 'predeterminado'];
  const base = describeExecution({ requested: pick[0], requestedSource: pick[1], observed: observedModel });
  const ignored = contract?.model && typed && typed !== contract.model ? ` El modelo escrito «${typed}» se ignora: el contrato fija el suyo.` : '';
  const blocked = declared.length ? `El contrato declara «${declared[0].model}» (${declared[0].where}), que no es Claude Code: una ejecución nueva se bloquea.` : pick[0] && !isClaudeModel(pick[0]) ? `«${pick[0]}» (${pick[1]}) no es Claude Code: una ejecución nueva se bloquea.` : null;
  return { ...base, blocked, note: ignored || null, recordedRequest: recordedRequest || null, observedLabel: base.observed ?? 'Desconocido' };
}
export const linesOf = value => String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
export const itemsOf = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
export const contractOf = value => value?.contract || value?.spec || value?.raw?.contract || value || {};
export const stateOf = value => typeof value?.status === 'string' ? value.status : typeof value?.state === 'string' ? value.state : 'unknown';
export const refOf = value => value?.ref || value?.raw?.ref || null;
export const goalOf = value => value?.goal || value?.title || contractOf(value)?.goal || value?.id || 'Sin objetivo declarado';
export function emptyCardForm() {
  return { goal: '', scope: '', checks: [{ name: '', argv: '' }], deps: '', budget: '', coordination: '' };
}
export function cardFormOf(value) {
  const contract = contractOf(value);
  return { goal: contract.goal || '', scope: (contract.scope || []).join('\n'), checks: (contract.checks || []).map(check => ({ ...check, name: check.name || '', argv: JSON.stringify(check.argv || []) })), deps: (contract.dependencies || []).join('\n'), budget: contract.budget ? JSON.stringify(contract.budget, null, 2) : '', coordination: contract.coordination ? JSON.stringify(contract.coordination, null, 2) : '' };
}
export function validateScopePath(path) {
  return Boolean(path && !/[\x00-\x1f]/.test(path) && !/^(?:\/|[A-Za-z]:[\\/])/.test(path) && !path.split(/[\\/]/).includes('..'));
}
function objectJSON(text, label) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`${label}: JSON inválido.`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: debe ser un objeto JSON.`);
  return value;
}
export function buildCardInput(form, original) {
  const goal = form.goal.trim(), scope = linesOf(form.scope), deps = linesOf(form.deps);
  if (!goal) throw new Error('Escribe el objetivo de la Card.');
  if (!scope.length || scope.some(path => !validateScopePath(path))) throw new Error('Scope: indica rutas relativas al proyecto, sin controles ni segmentos .. .');
  if (!form.checks.length) throw new Error('Declara al menos un check real.');
  const names = new Set();
  const checks = form.checks.map(check => {
    const name = check.name.trim();
    if (!name || names.has(name)) throw new Error('Cada check necesita un nombre único.');
    names.add(name);
    let argv;
    try { argv = JSON.parse(check.argv); } catch { throw new Error(`Check ${name}: argv debe ser un array JSON de strings.`); }
    if (!Array.isArray(argv) || !argv.length || argv.some(arg => typeof arg !== 'string' || /[\x00\r\n]/.test(arg)) || !argv[0].trim()) throw new Error(`Check ${name}: argv requiere un comando y argumentos strings válidos.`);
    return { ...check, name, argv };
  });
  const input = { ...(original ? contractOf(original) : {}), goal, lane: 'coordinated', scope, checks, dependencies: deps };
  delete input.deps;
  if (form.budget.trim()) {
    const budget = objectJSON(form.budget, 'Budget');
    if (Object.entries(budget).some(([key, value]) => !Number.isFinite(value) || value < 0 || (value === 0 && key !== 'maxRepairs'))) throw new Error('Budget: usa límites numéricos positivos (maxRepairs admite cero).');
    input.budget = budget;
  } else delete input.budget;
  if (form.coordination.trim()) input.coordination = objectJSON(form.coordination, 'Coordinación');
  else delete input.coordination;
  return input;
}
export function filterCards(items, query, state) {
  const text = query.trim().toLowerCase();
  return items.filter(item => (!state || stateOf(item) === state) && `${goalOf(item)} ${item.id || ''}`.toLowerCase().includes(text));
}
export function cardActions(value, controllers = []) {
  const task = value?.task || value;
  const state = stateOf(task);
  // phantom.detail retains native runs in chronological order, including failed
  // verification attempts. Only the latest run establishes current provenance.
  const runs = value?.runs ?? task?.runs;
  const run = Array.isArray(runs) ? runs.at(-1) : null;
  const reconciliationOrigin = run?.recovery?.state === 'reconciled'
    || (run?.mode === 'verification' && run?.status === 'failed' && typeof run?.recoveryOf === 'string');
  const live = controllers.some(item => item.taskId === task?.id && ['running', 'starting'].includes(item.status));
  return {
    run: !live && ['ready', 'blocked'].includes(state),
    stop: live,
    cancel: !live && ['ready', 'blocked'].includes(state),
    recover: !live && ['running', 'recovering'].includes(run?.status),
    verify: !live && state === 'blocked' && reconciliationOrigin,
  };
}
