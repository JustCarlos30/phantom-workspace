// Data-only first-party registry, shared by host and renderer. No executable extensions.
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function json(value, seen = new Set(), depth = 0) {
  if (depth > 32) fail('Plugin data too deep');
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return;
  if ((!Array.isArray(value) && !object(value)) || seen.has(value)) fail('Plugin data must be JSON serializable');
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Invalid plugin key');
    json(child, seen, depth + 1);
  }
  seen.delete(value);
}
const string = (value, label, max = 512) => { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail(`Invalid ${label}`); };
const keys = (value, allowed, label) => { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`Invalid ${label}`); };
export function validatePluginManifest(input) {
  json(input);
  keys(input, ['id', 'version', 'name', 'description', 'configuration', 'panels', 'actions'], 'plugin manifest');
  string(input.id, 'plugin id', 80); if (!/^[a-z][a-z0-9-]*$/.test(input.id)) fail('Invalid plugin id');
  string(input.version, 'plugin version', 80); if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(input.version)) fail('Invalid plugin version');
  string(input.name, 'plugin name'); string(input.description, 'plugin description', 4096);
  if (!object(input.configuration)) fail('Invalid plugin configuration');
  for (const [key, field] of Object.entries(input.configuration)) {
    string(key, 'configuration key', 80); keys(field, ['type', 'default', 'label'], 'configuration field');
    if (field.type !== 'string' || typeof field.default !== 'string') fail('Invalid configuration field');
    string(field.label, 'configuration label');
  }
  for (const kind of ['panels', 'actions']) {
    if (!Array.isArray(input[kind]) || input[kind].length > 100) fail(`Invalid plugin ${kind}`);
    const ids = new Set();
    for (const entry of input[kind]) {
      keys(entry, kind === 'panels' ? ['id', 'name', 'nodeType'] : ['id', 'name', 'panelId'], kind);
      string(entry.id, `${kind} id`, 80); string(entry.name, `${kind} name`);
      if (ids.has(entry.id)) fail(`Duplicate ${kind} id`); ids.add(entry.id);
      if (kind === 'panels') string(entry.nodeType, 'panel nodeType', 80);
      else if (!input.panels.some(panel => panel.id === entry.panelId)) fail('Unknown action panel');
    }
  }
  return structuredClone(input);
}
export const PHANTOM_PLUGIN = validatePluginManifest({
  id: 'phantom', version: '1.0.0', name: 'Phantom', description: 'Cards y Skills nativas de Phantom.',
  configuration: {
    phantomPath: { type: 'string', default: '', label: 'CLI Phantom (ruta absoluta)' },
    phantomData: { type: 'string', default: '', label: 'Datos Phantom (fuera del proyecto)' },
    model: { type: 'string', default: '', label: 'Modelo OpenCode' },
  },
  panels: [{ id: 'cards', name: 'Cards', nodeType: 'phantom-cards' }, { id: 'skills', name: 'Skills', nodeType: 'phantom-skills' }],
  actions: [{ id: 'phantom.cards', name: 'Abrir Cards', panelId: 'cards' }, { id: 'phantom.skills', name: 'Abrir Skills', panelId: 'skills' }],
});
export const VIDEO_LOG_PLUGIN = validatePluginManifest({
  id: 'video-log', version: '1.0.0', name: 'Bitácora de videos',
  description: 'Aprendizajes de una fuente Markdown local, con su evidencia, límites y contexto completo.',
  configuration: { sourcePath: { type: 'string', default: '', label: 'Archivo Markdown (ruta absoluta)' } },
  panels: [{ id: 'insights', name: 'Bitácora de videos', nodeType: 'video-log' }],
  actions: [{ id: 'video-log.open', name: 'Abrir Bitácora de videos', panelId: 'insights' }],
});
export const PLUGIN_MANIFESTS = [PHANTOM_PLUGIN, VIDEO_LOG_PLUGIN];
export function validatePluginConfig(input, id = 'phantom') {
  const manifest = PLUGIN_MANIFESTS.find(plugin => plugin.id === id);
  if (!manifest) fail('Unknown plugin');
  keys(input, Object.keys(manifest.configuration), 'plugin config'); json(input);
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.length > (key === 'model' ? 200 : 4096) || /[\x00-\x1f\x7f]/.test(value)) fail(`Invalid ${key}`);
    if (value && !value.trim()) fail(`Invalid ${key}`);
    if (value && key !== 'model' && !/^(?:\/|[A-Za-z]:[\\/])/.test(value)) fail(`${key} must be absolute`);
  }
  return structuredClone(input);
}
export function defaultPlugins() {
  return Object.fromEntries(PLUGIN_MANIFESTS.map(plugin => [plugin.id, { enabled: false, config: Object.fromEntries(Object.entries(plugin.configuration).map(([key, field]) => [key, field.default])) }]));
}
export function validatePluginPreferences(input = defaultPlugins()) {
  keys(input, PLUGIN_MANIFESTS.map(plugin => plugin.id), 'workspace plugins');
  const result = defaultPlugins();
  for (const { id } of PLUGIN_MANIFESTS) {
    const prefs = input[id];
    if (prefs === undefined) continue;
    keys(prefs, ['enabled', 'config', 'refreshMs'], 'plugin preferences');
    if (typeof prefs.enabled !== 'boolean') fail('Invalid plugin enabled');
    result[id] = { enabled: prefs.enabled, config: { ...result[id].config, ...validatePluginConfig(prefs.config ?? {}, id) } };
    if (prefs.refreshMs !== undefined) {
      if (!Number.isInteger(prefs.refreshMs) || prefs.refreshMs < 3000 || prefs.refreshMs > 5000) fail('Invalid plugin refreshMs');
      result[id].refreshMs = prefs.refreshMs;
    }
  }
  return result;
}
export function validatePluginPanel(type, data) {
  const plugin = PLUGIN_MANIFESTS.find(item => item.panels.some(panel => panel.nodeType === type));
  if (data.pluginId !== undefined && data.pluginId !== (plugin?.id || 'phantom')) fail('Unknown panel pluginId');
  if (data.panelId !== undefined && !plugin?.panels.some(panel => panel.id === data.panelId && panel.nodeType === type)) fail('Invalid panelId');
  if (plugin) {
    data.pluginId ??= plugin.id; data.panelId ??= plugin.panels.find(panel => panel.nodeType === type).id;
  }
}
