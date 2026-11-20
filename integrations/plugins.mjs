import { PLUGIN_MANIFESTS, validatePluginConfig, validatePluginPreferences } from '../shared/plugins.mjs';
import { readVideoLog } from './video-log.mjs';
import { readConvencions } from './convencions.mjs';
import { workspaceRoot, externalStatePath, observedAt, command } from './common.mjs';
import { assertModelAllowed, claudeModelCatalog, engineOf, executionPolicy, isClaudeLike } from '../shared/execution-policy.mjs';
import { phantomStatus } from './phantom.mjs';
import { openCodeModels } from '../host/chats.mjs';

// Harness models of the enabled engines: Claude Code is static; OpenCode asks its CLI only when enabled.
async function harnessModels(policy, context, root) {
  const items = [], unavailable = {};
  if (policy.providers.claude.enabled) items.push(...claudeModelCatalog().map(item => ({ id: item.id, engine: 'claude-code', group: item.group })));
  if (policy.providers.opencode.enabled) {
    try {
      const { stdout } = await command(context, context.state?.settings?.opencodePath || 'opencode', ['models'], { cwd: root, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
      const listed = openCodeModels(stdout).filter(item => !isClaudeLike(item.id));
      if (listed.length) items.push(...listed.map(item => ({ id: item.id, engine: 'opencode', group: item.group })));
      else unavailable.opencode = 'OpenCode no listó modelos fuera de Claude.';
    } catch (error) { unavailable.opencode = `OpenCode no pudo listar sus modelos: ${error.message.split('\n')[0]}`; }
  }
  return { items, unavailable };
}

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
    // Only enabled engines are offered; with the default policy no external CLI is started.
    const policy = executionPolicy(context.state?.settings), defaultModel = policy.defaults.task.model;
    const { items, unavailable } = await harnessModels(policy, context, root);
    return { available: items.length > 0, models: items.map(item => item.id), items, defaultModel, engine: engineOf(defaultModel), engines: [...new Set(items.map(item => item.engine))], ...(Object.keys(unavailable).length ? { unavailable } : {}), observedAt: observedAt() };
  }
  const patch = payload.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['enabled', 'config'].includes(key))) throw new Error('Invalid plugin patch');
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new Error('Invalid plugin enabled');
  if (patch.config !== undefined) {
    validatePluginConfig(patch.config, payload.id);
    // New explicit configuration must name a model of an enabled engine; stored legacy values stay readable.
    if (payload.id === 'phantom' && typeof patch.config.model === 'string' && patch.config.model) assertModelAllowed(patch.config.model, executionPolicy(context.state?.settings), 'configuración del plugin Phantom');
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
