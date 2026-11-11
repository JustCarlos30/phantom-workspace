// Pure transformations shared by the native plugin surfaces.
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
  return { goal: contract.goal || '', scope: (contract.scope || []).join('\n'), checks: (contract.checks || []).map(check => ({ ...check, name: check.name || '', argv: JSON.stringify(check.argv || []) })), deps: (contract.deps || []).join('\n'), budget: contract.budget ? JSON.stringify(contract.budget, null, 2) : '', coordination: contract.coordination ? JSON.stringify(contract.coordination, null, 2) : '' };
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
  const input = { ...(original ? contractOf(original) : {}), goal, lane: 'coordinated', scope, checks, deps };
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
  const state = stateOf(value);
  const live = controllers.some(item => item.taskId === value?.id && ['running', 'starting'].includes(item.status));
  return {
    run: !live && ['created', 'pending', 'ready', 'queued', 'blocked', 'failed', 'stopped'].includes(state),
    stop: live,
    cancel: ['created', 'pending', 'ready', 'queued', 'running', 'blocked', 'stopped'].includes(state),
    recover: !live && ['running', 'blocked', 'failed', 'stopped', 'interrupted'].includes(state),
    verify: !live && ['completed', 'failed', 'blocked', 'stopped', 'review', 'verifying', 'needs_verification'].includes(state),
  };
}
