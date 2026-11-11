import { PLUGIN_MANIFESTS, getPluginManifest, defaultPluginPreferences, validatePluginPreferences, validatePluginConfig } from '../shared/plugins.mjs';
import { workspaceRoot, externalStatePath, observedAt, command } from './common.mjs';
import { phantomStatus } from './phantom.mjs';

function fields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
}
function descriptor(manifest, workspace) {
  const preference = validatePluginPreferences(workspace.plugins ?? defaultPluginPreferences())[manifest.id];
  const { configuration, ...identity } = structuredClone(manifest);
  return { ...identity, enabled: preference.enabled, config: preference.config, source: 'builtin' };
}
export async function plugins(method, payload, context) {
  fields(payload, method === 'plugins.list' ? ['workspaceId'] : method === 'plugins.update' ? ['workspaceId', 'id', 'patch'] : ['workspaceId', 'id'], 'plugins payload');
  if (typeof payload.workspaceId !== 'string' || !payload.workspaceId) throw new Error('workspaceId is required');
  const { workspace, root } = await workspaceRoot(context, payload);
  if (method === 'plugins.list') return { items: PLUGIN_MANIFESTS.map(manifest => descriptor(manifest, workspace)), observedAt: observedAt() };
  const manifest = getPluginManifest(payload.id);
  if (method === 'plugins.update') {
    fields(payload.patch, ['enabled', 'config'], 'plugin patch');
    if ('enabled' in payload.patch && typeof payload.patch.enabled !== 'boolean') throw new Error('Plugin enabled must be boolean');
    if ('config' in payload.patch) validatePluginConfig(manifest.id, payload.patch.config);
    // Resolve external ancestors before committing anything. No native data is opened here.
    if (payload.patch.config?.phantomData) await externalStatePath(payload.patch.config.phantomData, root);
    // Re-read after the asynchronous path check to preserve concurrent partial updates.
    const preferences = validatePluginPreferences(workspace.plugins ?? defaultPluginPreferences());
    const old = preferences[manifest.id];
    preferences[manifest.id] = { enabled: payload.patch.enabled ?? old.enabled, config: { ...old.config, ...payload.patch.config } };
    const before = workspace.plugins;
    workspace.plugins = preferences;
    try { await context.persist(); } catch (error) { workspace.plugins = before; throw error; }
    return descriptor(manifest, workspace);
  }
  if (method === 'plugins.status') return phantomStatus(payload, context);
  if (method !== 'plugins.models') throw new Error('Unknown plugins method');
  try {
    const file = context.state?.settings?.opencodePath || 'opencode';
    const { stdout } = await command(context, file, ['models'], { cwd: root });
    const models = [...new Set(stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
    if (!models.length || models.some(model => !/^[^\s/]+\/[^\s]+$/.test(model) || /[\x00-\x1f\x7f]/.test(model))) throw new Error('OpenCode returned an empty or invalid model catalog');
    return { available: true, models, observedAt: observedAt() };
  } catch (error) { return { available: false, models: [], reason: `OpenCode models unavailable: ${error.message}`, observedAt: observedAt() }; }
}
