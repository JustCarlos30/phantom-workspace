import { state, workspace, tasks, taskRun, messages, date, graph, branches, merge, environment, plugin, skill, conventions } from './fixtures.js';
import { claudeModelCatalog, executionPolicy } from '../../shared/execution-policy.mjs';

// SYNTHETIC: three projects for the global Orquestador (scenario 'orchestrator-hub').
// Alfa: a session asking permission and a blocked card with no terminal; Beta: an
// incorporation in conflict; Gamma: work in progress, nothing to review.
const minutesAgo = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const hubTerminal = (id, title, sessionId) => ({ id, type: 'terminal', title, x: 0, y: 0, w: 480, h: 320, data: { sessionId } });
export const orchestratorHubWorkspaces = [
  { id: 'hub-alfa', name: 'Alfa · pagos', nodes: [hubTerminal('n-alfa-1', 'Migración de cobros', 's-alfa-1')] },
  { id: 'hub-beta', name: 'Beta · web', nodes: [hubTerminal('n-beta-1', 'Landing nueva', 's-beta-1')] },
  { id: 'hub-gamma', name: 'Gamma · docs', nodes: [] },
];
export function orchestratorHubData(workspaceId) {
  if (workspaceId === 'hub-alfa') return {
    sessions: [{ id: 's-alfa-1', nodeId: 'n-alfa-1', workspaceId, status: 'running', screenState: 'awaiting_approval', screenStateAt: Date.now() - 4 * 60000, createdAt: minutesAgo(40) }],
    tasks: { available: true, items: [{ id: 'task_alfa_card', status: 'blocked', title: 'Migrar el esquema de facturas', updatedAt: minutesAgo(30), raw: { reason: 'Conflicto en la rama al incorporar', contract: { goal: 'Migrar el esquema de facturas' } }, location: { path: '/synthetic/alfa', branch: 'feat/facturas' } }] },
    merges: { available: true, queue: [], active: [], history: [] },
    supervisor: { workspaceId, enabled: true, status: 'pending', summary: 'Una sesión espera permiso para escribir en la base de datos de cobros.', summaryAt: minutesAgo(6), usage: { callsLastHour: 3, maxCallsPerHour: 12 }, alerts: [], pending: 2 },
  };
  if (workspaceId === 'hub-beta') return {
    sessions: [],
    tasks: { available: true, items: [] },
    merges: { available: true, queue: [{ id: 'merge-beta', status: 'conflict', title: 'feat/landing', nodeId: 'n-beta-1', requestedAt: minutesAgo(120) }], active: [], history: [] },
    supervisor: { workspaceId, enabled: true, status: 'rate-limited', summary: 'La rama de la landing choca con main en dos archivos.', summaryAt: minutesAgo(50), usage: { callsLastHour: 12, maxCallsPerHour: 12 }, alerts: [], pending: 1 },
  };
  if (workspaceId === 'hub-gamma') return {
    sessions: [],
    tasks: { available: true, items: [{ id: 'task_gamma_run', status: 'running', title: 'Reescribir la guía de instalación', updatedAt: minutesAgo(2) }] },
    merges: { available: true, queue: [], active: [], history: [] },
    supervisor: { workspaceId, enabled: false, status: 'disabled', summary: '', summaryAt: null, usage: { callsLastHour: 0, maxCallsPerHour: 12 }, alerts: [], pending: 0 },
  };
  return { sessions: [], tasks: { available: true, items: [] }, merges: { available: true, queue: [], active: [], history: [] }, supervisor: { workspaceId, status: 'disabled', summary: '', usage: {}, alerts: [] } };
}

export function createHost({ scenario = 'data', overrides = {}, workspaceId = workspace.id } = {}) {
  const listeners = new Set(), pending = new Set(), calls = [], unknown = [];
  const model = structuredClone(state);
  model.activeWorkspaceId = workspaceId;
  model.workspaces[0].id = workspaceId;
  let disposed = false, seq = 0;
  const emit = event => { if (!disposed) for (const listener of listeners) listener(structuredClone(event)); };
  const chat = { messages: scenario === 'empty' ? [] : structuredClone(messages), running: scenario === 'working', queue: [], meta: { model: 'Modelo sintético', inputTokens: 1200, outputTokens: 240 } };
  if (scenario === 'attention') chat.messages.push({ id: 'permission', role: 'assistant', parts: [{ id: 'permission-demo', type: 'permission', status: 'pending', tool: 'read', detail: 'src/example.jsx', reason: 'Lectura sintética' }] });
  const items = value => ({ available: true, items: scenario === 'empty' ? [] : value, observedAt: date });
  const responses = {
    'state.get': () => model,
    'desktop.info': () => ({ version: 'catálogo', dataDir: '/synthetic/data', platform: 'linux' }),
    'system.info': () => ({ version: 'catálogo', dataDir: '/synthetic/data', platform: 'linux' }),
    'settings.update': p => (model.settings = { ...model.settings, ...p.patch }),
    'providers.list': () => {
      const policy = executionPolicy(model.settings);
      return { observedAt: date, policy, providers: [
        { id: 'claude', label: 'Claude Code', engine: 'claude-code', status: 'available', binary: { path: '/synthetic/bin/claude', version: '2.1.328 (sintético)' }, session: { available: true, plan: 'max' } },
        { id: 'opencode', label: 'OpenCode', engine: 'opencode', status: 'available', binary: { path: '/synthetic/bin/opencode', version: '1.2.3 (sintético)' }, session: { available: false, credentials: [], reason: 'Sin cuentas sintéticas: ejecuta «opencode auth login»' }, models: { available: true, count: 2 } },
        { id: 'codex', label: 'Codex', engine: null, status: 'unavailable', reason: 'No se encontró «codex» en el entorno sintético', binary: { path: '/synthetic/bin/codex', version: null }, session: { available: false, plan: null, reason: 'Sin sesión sintética' } },
      ].map(provider => ({ ...provider, enabled: policy.providers[provider.id].enabled })) };
    },
    'providers.models': p => {
      const policy = executionPolicy(model.settings);
      if (!Object.hasOwn(policy.providers, p.provider)) throw new Error(`Proveedor desconocido: ${p.provider}`);
      const base = { provider: p.provider, engine: p.provider === 'claude' ? 'claude-code' : p.provider === 'opencode' ? 'opencode' : null, enabled: policy.providers[p.provider].enabled, observedAt: date };
      if (p.provider === 'claude') return { ...base, available: true, items: claudeModelCatalog().map(item => ({ ...item, engine: 'claude-code' })) };
      if (p.provider === 'opencode') return { ...base, available: true, items: [{ id: 'openai/gpt-5', engine: 'opencode' }, { id: 'openrouter/qwen3-coder', engine: 'opencode' }], excluded: 0 };
      return { ...base, available: false, items: [], reason: 'Codex no está instalado en el entorno sintético' };
    },
    'terminal.list': () => scenario === 'environment' ? environment.sessions : [{ id: 'session-demo', nodeId: 'terminal-demo', workspaceId: workspace.id, status: 'running', createdAt: date }],
    'terminal.attach': () => ({ seq, data: '\x1b[36mPhantom · salida sintética\x1b[0m\r\nSin PTY ni proceso real.\r\n$ ', session: { id: 'session-demo', status: 'running', cols: 80, rows: 24 } }),
    'terminal.tail': () => ({ lines: ['Phantom · salida sintética', 'Revisando componentes'], text: 'Phantom · salida sintética', status: 'running', observedAt: date }),
    'terminal.resize': () => ({ ok: true }),
    'terminal.write': p => { emit({ type: 'terminal.output', sessionId: p.sessionId, seq: ++seq, data: p.data }); return { ok: true }; },
    'chat.get': () => chat,
    'chat.models': () => ({ items: [{ id: 'synthetic', name: 'Modelo sintético' }], models: [] }),
    'chat.send': p => { chat.messages.push({ id: `sent-${calls.length}`, role: 'user', parts: [{ type: 'text', text: p.text }] }); emit({ type: 'chat.changed', workspaceId: p.workspaceId, nodeId: p.nodeId }); return chat; },
    'chat.clear': () => { chat.messages = []; return chat; },
    'chat.stop': () => { chat.running = false; return chat; },
    'chat.configure': p => ({ ...p }),
    'chat.permission.answer': p => { for (const m of chat.messages) for (const part of m.parts) if (part.type === 'permission') part.status = 'answered'; emit({ type: 'chat.changed', workspaceId: p.workspaceId, nodeId: p.nodeId }); return { ok: true }; },
    'phantom.list': p => items(p.topic === 'skills' ? [skill] : tasks),
    'phantom.detail': p => {
      if (p.topic === 'skills') return { ...skill, available: true };
      const raw = tasks.find(t => t.id === p.id)?.raw;
      const task = raw?.status === 'blocked' ? { ...raw, run: taskRun } : raw;
      return { available: true, ...task, task, item: task };
    },
    'phantom.control': p => ({ ok: true, id: p.id, action: p.action, simulated: true }),
    'phantom.events': () => items([{ id: 'event-demo', type: 'run.started', at: date }, { id: 'event-fail', type: 'run.finished', at: '2026-01-01T10:12:30Z', data: { reason: 'Verificación fallida; margen de reparación agotado' } }]),
    'phantom.controllers': () => items([]),
    'plugins.list': () => items([plugin, { ...plugin, id: 'convencions', name: 'Convencions' }, { ...plugin, id: 'video-log', name: 'Bitácora' }]),
    'plugin.get': () => plugin,
    'plugin.update': p => p.settings,
    'plugins.status': p => p.id === 'convencions' ? { ...conventions, workspaceId: p.workspaceId } : p.id === 'video-log' ? { available: true, observedAt: date, sourcePath: '/synthetic/bitacora.md', state: 'ready', origins: [{ id: 'origin-demo', kind: 'video', video: 'video-demo', title: 'Video sintético', markdown: '# Contexto\n\nEjemplo de lectura local.', startLine: 1, endLine: 8 }], insights: [{ id: 'insight-demo', originId: 'origin-demo', kind: 'video', video: 'video-demo', title: 'Conservar la evidencia', summary: 'Separar observaciones de decisiones.', markdown: '## Aprendizaje\n\nConservar la **evidencia**.', headingLine: 3, startLine: 3, endLine: 8 }] } : { available: true, connected: true, state: 'ready' },
    'plugins.models': () => items([]),
    'skills.catalog': () => items([{ id: 'file-skill', name: 'Revisión local', title: 'Revisión local', path: '/synthetic/project/SKILL.md', workspaceId, origin: 'project', source: 'project', agent: 'claude', group: 'Proyecto', folders: [], fileCount: 1, description: 'Ejemplo local sin leer disco' }]),
    'skills.read': () => ({ body: '# Revisión local\n\nLee y comprueba.', available: true, files: [], path: '/synthetic/project/SKILL.md' }),
    'branch.overview': () => branches,
    'repo.graph': () => graph,
    'repo.commit': () => ({ available: true, commit: graph.commits[0], files: [], diff: '' }),
    'repo.files': () => ({ available: true, items: [], files: [] }),
    'repo.diff': () => ({ available: true, text: 'diff --git a/example b/example\n--- a/example\n+++ b/example\n@@ -1 +1 @@\n-anterior\n+nuevo', files: [] }),
    'git.inspect': () => ({ available: true, branch: 'main', branches: ['main'], changes: [], worktrees: [] }),
    'merge.status': () => scenario === 'environment' ? { ...merge, checks: environment.checks.checks } : merge,
    'terminal.setup.retry': () => ({ ok: true }),
    'terminal.stop': () => ({ ok: true }),
    'services.list': () => scenario === 'environment' ? { ...items(environment.ports), scripts: environment.scripts } : items([{ id: 'site-demo', name: 'Storybook sintético', title: 'Storybook sintético', url: 'http://127.0.0.1:6006', status: 'running', source: 'compose' }]),
    'sites.list': () => ({ items: [], projects: [] }),
    'env.list': () => ({ workspaceId, compose: true, project: 'synthetic-project', observedAt: date, profiles: ['preview'], services: scenario === 'empty' ? [] : [{ name: 'storybook-demo', lifecycle: 'persistent', purpose: 'Catálogo sintético sin Docker real', card: 'task-0', profiles: ['preview'], status: 'running', urls: ['http://127.0.0.1:6006'], url: 'http://127.0.0.1:6006', owner: null }] }),
    'docker.list': p => p.scope === 'sites' ? { projects: [{ workspaceId: workspace.id, name: workspace.name, path: workspace.path, compose: '/synthetic/project/compose.yaml', services: [{ name: 'storybook-demo', status: 'running', containers: [{ id: 'container-demo', name: 'storybook-demo', state: 'running' }], urls: ['http://127.0.0.1:6006'] }] }] } : items([{ id: 'container-demo', name: 'storybook-demo', status: 'running', image: 'storybook:synthetic' }]),
    'docker.logs': () => ({ text: 'Servidor sintético listo' }),
    'playground.list': () => items([{ id: 'run-demo', runtime: 'node', status: 'done', output: 'Hola, catálogo' }]),
    'automation.list': () => items([]),
    'limits.read': () => ({ available: false, reason: 'Sin cuentas reales en el catálogo', items: [] }),
    'review.projects': () => items([]),
    'mobile.status': () => ({ enabled: false, running: false, interfaces: [], devices: [], pending: [] }),
    'mobile.audit': () => ({ events: [] }),
    'android.status': () => ({ configured: false, enabled: false, processAlive: false, devices: [], workspaces: [], interfaces: [], node: { compatible: false }, repoError: 'Proyecto Android no conectado en el catálogo' }),
    'voice.status': () => ({ available: false, reason: 'Micrófono aislado en Storybook' }),
    'voice.stream.warm': () => ({ ready: true }),
    'voice.intent': p => ({ action: 'task', title: 'Borrador sintético', text: p.text }),
    'browser.detach': () => ({ ok: true }),
    'browser.hide': () => ({ ok: true }),
    'browser.bounds': () => ({ ok: true }),
    'browser.capture': () => ({ dataUrl: null }),
    'browser.attach': () => { throw new Error('WebContentsView solo existe en Electron; se muestra la UI real del navegador.'); },
    'browser.navigate': () => { throw new Error('Navegación nativa aislada en el catálogo.'); },
    'desktop.openExternal': () => ({ simulated: true }),
    'node.update': p => { const node = model.workspaces[0].nodes.find(n => n.id === p.id); if (node) Object.assign(node, p.patch); return node || p.patch; },
    'orchestrator.send': p => ({ workspaceId: p.workspaceId, nodeId: 'orchestrator-demo', mode: 'chat', created: false }),
    'voice.stream.cancel': () => ({}),
    ...(scenario === 'orchestrator-hub' ? {
      'terminal.list': p => orchestratorHubData(p.workspaceId).sessions,
      'phantom.list': p => orchestratorHubData(p.workspaceId).tasks,
      'merge.status': p => orchestratorHubData(p.workspaceId).merges,
      'supervisor.read': p => orchestratorHubData(p.workspaceId).supervisor,
    } : {}),
    ...overrides,
  };
  return {
    calls, unknown, model,
    onEvent(listener) { if (disposed) throw new Error('Fixture cerrada'); listeners.add(listener); return () => listeners.delete(listener); },
    emit,
    async invoke(method, payload = {}) {
      if (disposed) throw new Error('Fixture cerrada');
      calls.push({ method, payload: structuredClone(payload) });
      if (!Object.hasOwn(responses, method)) { unknown.push(method); throw new Error(`Método de fixture desconocido: ${method}`); }
      if (scenario === 'error' && !method.startsWith('browser.')) throw new Error('Fallo de lectura sintético · Reintenta');
      if (scenario === 'loading') return new Promise(resolve => pending.add(resolve));
      return structuredClone(await responses[method](payload));
    },
    dispose() { disposed = true; listeners.clear(); for (const resolve of pending) resolve(null); pending.clear(); },
    get subscriptions() { return listeners.size; },
    get disposed() { return disposed; },
  };
}

let current;
export const api = (method, payload) => current.invoke(method, payload);
export function installHost(options) {
  current?.dispose();
  current = createHost(options);
  window.phantom = current;
  window.__storybookHost = current;
  return current;
}
