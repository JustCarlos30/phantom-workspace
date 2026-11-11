import { phantomPlugin } from './phantom.js';

const registry = new Map([[phantomPlugin.id, phantomPlugin]]);
export const getPluginDescriptor = id => registry.get(id) || null;
export const getPluginDescriptors = () => [...registry.values()];
export function validatePluginSettings(id, value) {
  const descriptor = getPluginDescriptor(id);
  if (!descriptor) throw new Error('Plugin desconocido');
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['enabled', 'refreshMs'].includes(key))
    || typeof value.enabled !== 'boolean'
    || !Number.isInteger(value.refreshMs) || value.refreshMs < 3000 || value.refreshMs > 5000) {
    throw new Error('Configuración de plugin inválida');
  }
  return { enabled: value.enabled, refreshMs: value.refreshMs };
}
export function pluginSettings(workspace, id = 'phantom') {
  return workspace?.plugins?.[id] || { enabled: false, refreshMs: 4000 };
}
