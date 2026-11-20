import { PLUGIN_MANIFESTS, validatePluginConfig, validatePluginPreferences } from '../shared/plugins.mjs';
import { readVideoLog } from './video-log.mjs';
import { readConvencions } from './convencions.mjs';
import { workspaceRoot, externalStatePath, observedAt } from './common.mjs';
import { assertClaudeModel, claudeModelCatalog, DEFAULT_HARNESS_MODEL } from '../shared/execution-policy.mjs';
import { phantomStatus } from './phantom.mjs';

function record(workspace, manifest) {
  const prefs = validatePluginPreferences(workspace.plugins)[manifest.id];
  return { ...structuredClone(manifest), ...prefs, source: 'builtin' };
}
export async function plugins(method, payload, context) {
  const allowed = method === 'plugins.list' ? ['workspaceId'] : method === 'plugins.update' ? ['workspaceId', 'id', 'patch'] : ['workspaceId', 'id'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !allowed.includes(key)) || typeof payload.workspaceId !== 'string') throw new Error('Invalid plugins payload');
  const { workspace, root } = await workspaceRoot(context, payload);
  if (method === 'plugins.list') return { items: PLUGIN_MANIFESTS.map(manifest => record(workspace, manifest)), observedAt: observedAt() };
  const manifest = PLUGIN_MANIFESTS.find(plugin => plugin.id === payload.id);
  if (!manifest) throw new Error('Unknown plugin');
  if (method === 'plugins.status') return payload.id === 'convencions' ? readConvencions(workspace) : payload.id === 'video-log' ? readVideoLog(workspace) : phantomStatus(payload, context);
  if (method === 'plugins.models') {
    if (payload.id !== 'phantom') throw new Error('Este plugin no utiliza modelos');
    // Claude Code catalog is static: no external model-listing CLI is started.
    return { available: true, models: claudeModelCatalog().map(item => item.id), defaultModel: DEFAULT_HARNESS_MODEL, engine: 'claude-code', observedAt: observedAt() };
  }
  const patch = payload.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['enabled', 'config'].includes(key))) throw new Error('Invalid plugin patch');
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new Error('Invalid plugin enabled');
  if (patch.config !== undefined) {
    validatePluginConfig(patch.config, payload.id);
    // New explicit configuration must name a Claude Code model; stored legacy values stay readable.
    if (payload.id === 'phantom' && typeof patch.config.model === 'string' && patch.config.model) assertClaudeModel(patch.config.model, 'configuración del plugin Phantom');
    if (patch.config.phantomData) await externalStatePath(patch.config.phantomData, root);
  }
  // Re-read after asynchronous path validation; a concurrent update may have landed.
  const current = validatePluginPreferences(workspace.plugins);
  const prefs = current[payload.id];
  const next = validatePluginPreferences({ ...current, [payload.id]: { ...prefs, enabled: patch.enabled ?? prefs.enabled, config: { ...prefs.config, ...patch.config } } });
  const previous = workspace.plugins; workspace.plugins = next;
  try { await context.persist(); } catch (error) { workspace.plugins = previous; throw error; }
  return record(workspace, manifest);
}
