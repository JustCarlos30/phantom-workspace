// Pure form transformations: argv entries are never split or passed to a shell.
export const lines = value => value.split('\n').map(v => v.trim()).filter(Boolean);
export function cardDraft(source) {
  return structuredClone(source?.contract || { goal: '', lane: 'coordinated', scope: [], checks: [] });
}
export function cardInput(draft) {
  const value = structuredClone(draft);
  if (!value.goal?.trim()) throw new Error('Escribe el objetivo de la card.');
  if (value.lane !== 'coordinated') throw new Error('Una card nativa requiere lane coordinated.');
  if (!Array.isArray(value.scope) || !Array.isArray(value.checks)) throw new Error('Alcance y checks deben ser listas.');
  if (!value.scope.length) throw new Error('Declara al menos un archivo editable exacto.');
  for (const file of value.scope) if (typeof file !== 'string' || !file || file.startsWith('/') || file.includes('\\') || /[*?\[\]]/.test(file) || file.split('/').some(p => !p || ['.', '..', '.git', '.phantom'].includes(p))) throw new Error('Usa rutas relativas exactas, sin comodines ni salir del proyecto.');
  for (const check of value.checks) {
    if (!check.name?.trim() || !Array.isArray(check.argv) || !check.argv.length || check.argv.some(a => typeof a !== 'string' || !a.length || a.includes('\0'))) throw new Error('Cada check necesita nombre, ejecutable y argumentos no vacíos.');
  }
  return value;
}
export function skillDraft(source) {
  return structuredClone(source?.manifest || source?.input || { id: '', version: '1.0.0', description: '', actions: [], body: '', requiresTools: [], resources: [] });
}
export function skillInput(draft, previous) {
  const value = structuredClone(draft);
   if (!value.id?.trim() || !value.version?.trim() || !value.description?.trim() || !value.body?.trim()) throw new Error('Completa identificador, versión, descripción e instrucciones.');
  if (!Array.isArray(value.actions) || !Array.isArray(value.resources) || !Array.isArray(value.requiresTools)) throw new Error('Acciones, herramientas y recursos deben ser listas.');
  if (!/^[a-z0-9]+(?:[./-][a-z0-9]+)*$/.test(value.id) || value.id.length > 96) throw new Error('Usa un identificador en minúsculas, sin espacios.');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value.version)) throw new Error('La versión debe ser semántica, por ejemplo 1.0.0.');
  if (!value.actions.length || value.actions.some(a => !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(a))) throw new Error('Declara al menos una acción válida, por ejemplo code.review.');
  if (previous?.ref?.scope === 'global') throw new Error('Las skills globales son de solo lectura.');
  if (previous && (value.id !== previous.ref?.id || value.version === previous.ref?.version)) throw new Error('Conserva el identificador y declara una nueva versión inmutable.');
  return value;
}
export function filteredCards(items, query, status) {
  return items.filter(item => item.kind === 'card' && (!status || item.status === status) && `${item.title} ${item.id}`.toLowerCase().includes(query.toLowerCase()));
}
export function cardGroups(items) {
  return [...new Set(items.map(item => item.status || 'Sin estado'))].map(status => ({ status, items: items.filter(item => (item.status || 'Sin estado') === status) }));
}
export const pluginCall = (api, workspaceId, operation, payload = {}) => api('plugins.invoke', { workspaceId, pluginId: 'phantom', operation, payload });
