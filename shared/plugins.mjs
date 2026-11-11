// Data-only first-party registry. Safe to import from both renderer and host.
const fail = message => { throw new Error(message); };
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`Invalid ${label}`);
  return value;
};
const keys = (value, allowed, label) => { object(value, label); for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unknown ${label} field: ${key}`); };
const string = (value, label, max = 512) => { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail(`Invalid ${label}`); };
const id = (value, label) => { string(value, label, 100); if (!/^[a-z][a-z0-9-]*$/.test(value)) fail(`Invalid ${label}`); };
function json(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || seen.has(value)) fail('Plugin manifest must be JSON serializable');
  seen.add(value);
  if (!Array.isArray(value)) object(value, 'JSON object');
  for (const key of Object.keys(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Invalid JSON key'); json(value[key], seen); }
  seen.delete(value);
}
export function validatePluginManifest(input) {
  json(input);
  keys(input, ['id', 'version', 'name', 'description', 'configuration', 'panels', 'actions'], 'manifest');
  id(input.id, 'plugin ID'); string(input.name, 'plugin name'); string(input.description, 'plugin description', 4096);
  if (typeof input.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(input.version)) fail('Invalid plugin version');
  object(input.configuration, 'configuration');
  for (const [key, field] of Object.entries(input.configuration)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) fail('Invalid configuration key');
    keys(field, ['type', 'label', 'description', 'default', 'format'], 'configuration');
    if (field.type !== 'string' || typeof field.default !== 'string') fail('Invalid configuration type/default');
    string(field.label, 'configuration label'); string(field.description, 'configuration description', 4096);
    if (field.format !== undefined && !['path', 'model'].includes(field.format)) fail('Invalid configuration format');
  }
  for (const category of ['panels', 'actions']) {
    if (!Array.isArray(input[category]) || input[category].length > 100) fail(`Invalid ${category}`);
    const seen = new Set();
    for (const entry of input[category]) {
      keys(entry, category === 'panels' ? ['id', 'name', 'description', 'nodeType'] : ['id', 'name', 'description', 'panelId'], category);
      id(entry.id, `${category} ID`); if (seen.has(entry.id)) fail(`Duplicate ${category} ID`); seen.add(entry.id);
      string(entry.name, `${category} name`); string(entry.description, `${category} description`, 4096);
      if (category === 'panels') id(entry.nodeType, 'panel node type');
      else if (!input.panels.some(panel => panel.id === entry.panelId)) fail('Unknown action panelId');
    }
  }
  return structuredClone(input);
}
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
export const PHANTOM_PLUGIN = freeze(validatePluginManifest({
  id: 'phantom', version: '1.0.0', name: 'Phantom', description: 'Cards y Skills nativos de Phantom.',
  configuration: {
    phantomPath: { type: 'string', label: 'CLI Phantom', description: 'Ruta absoluta a phantom.mjs; vacío hereda la configuración global y el descubrimiento local.', default: '', format: 'path' },
    phantomData: { type: 'string', label: 'Datos Phantom', description: 'Directorio absoluto externo al proyecto; vacío hereda los datos nativos.', default: '', format: 'path' },
    model: { type: 'string', label: 'Modelo', description: 'Identificador OpenCode provider/model; vacío hereda el modelo global.', default: '', format: 'model' },
  },
  panels: [
    { id: 'cards', name: 'Cards', description: 'Catálogo, detalle y controles nativos.', nodeType: 'phantom-cards' },
    { id: 'skills', name: 'Skills', description: 'Biblioteca y versiones inmutables.', nodeType: 'phantom-skills' },
  ],
  actions: [
    { id: 'open-cards', name: 'Abrir Cards', description: 'Abrir el panel de Cards.', panelId: 'cards' },
    { id: 'open-skills', name: 'Abrir Skills', description: 'Abrir el panel de Skills.', panelId: 'skills' },
  ],
}));
export const PLUGIN_MANIFESTS = Object.freeze([PHANTOM_PLUGIN]);
export const getPluginManifest = pluginId => { const manifest = PLUGIN_MANIFESTS.find(item => item.id === pluginId); if (!manifest) fail('Unknown plugin ID'); return manifest; };
export function validatePluginConfig(pluginId, input) {
  const manifest = getPluginManifest(pluginId); keys(input, Object.keys(manifest.configuration), 'plugin config');
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.length > (key === 'model' ? 200 : 4096) || /[\x00-\x1f\x7f]/.test(value)) fail(`Invalid ${key}`);
    if (value && (!value.trim() || value !== value.trim())) fail(`Invalid ${key}`);
    if (value && manifest.configuration[key].format === 'path' && !/^(?:\/|[A-Za-z]:[\\/])/.test(value)) fail(`${key} must be an absolute path`);
  }
  return structuredClone(input);
}
export const defaultPluginPreferences = () => ({ phantom: { enabled: false, config: { phantomPath: '', phantomData: '', model: '' } } });
export function validatePluginPreferences(input) {
  keys(input, PLUGIN_MANIFESTS.map(item => item.id), 'plugins');
  const result = defaultPluginPreferences();
  for (const [pluginId, preference] of Object.entries(input)) {
    keys(preference, ['enabled', 'config'], 'plugin preference');
    if (typeof preference.enabled !== 'boolean') fail('Plugin enabled must be boolean');
    result[pluginId] = { enabled: preference.enabled, config: { ...result[pluginId].config, ...validatePluginConfig(pluginId, preference.config) } };
  }
  return result;
}
export function validatePluginPanelData(type, data) {
  const expected = PHANTOM_PLUGIN.panels.find(panel => panel.nodeType === type);
  if (data.pluginId === undefined && data.panelId === undefined) return; // Older snapshots remain recoverable by node type.
  const manifest = getPluginManifest(data.pluginId);
  const panel = manifest.panels.find(item => item.id === data.panelId);
  if (!panel || panel.nodeType !== type || expected && expected.id !== panel.id) fail('Invalid plugin panel reference');
}
