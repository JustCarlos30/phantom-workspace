// Shared declarative contract. No renderer or Node dependencies.
export const plugins = Object.freeze([Object.freeze({
  id: 'phantom', name: 'Phantom', description: 'Contratos de ejecución y biblioteca de skills nativas.', version: '1.0.0',
  configuration: { connection: 'host', preferences: ['cardsView', 'model'] },
  panels: [{ type: 'phantom-cards', name: 'Cards Phantom' }, { type: 'phantom-skills', name: 'Skills Phantom' }],
  actions: [{ id: 'phantom-cards', title: 'Abrir Cards Phantom' }, { id: 'phantom-skills', title: 'Abrir Skills Phantom' }],
})]);
export const pluginById = id => plugins.find(plugin => plugin.id === id);
export const panelPlugin = type => plugins.find(plugin => plugin.panels.some(panel => panel.type === type));
export const pluginEnabled = (workspace, id = 'phantom') => workspace?.plugins?.[id]?.enabled === true;
export const pluginPreferences = workspace => ({ cardsView: 'list', model: '', ...workspace?.plugins?.phantom?.preferences });
export function validatePluginSettings(value) {
  const obj = v => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Configuración de plugin inválida'); };
  obj(value);
  for (const [id, settings] of Object.entries(value)) {
    if (!pluginById(id)) throw new Error('Plugin desconocido');
    obj(settings);
    if (Object.keys(settings).some(k => !['enabled', 'preferences'].includes(k)) || typeof settings.enabled !== 'boolean') throw new Error('Activación de plugin inválida');
    obj(settings.preferences);
    for (const [key, v] of Object.entries(settings.preferences)) {
      if (key === 'cardsView' && ['list', 'board'].includes(v)) continue;
      if (key === 'model' && typeof v === 'string' && v.length <= 200 && !/[\x00-\x1f\x7f]/.test(v)) continue;
      throw new Error('Preferencia de plugin inválida');
    }
  }
  return value;
}
