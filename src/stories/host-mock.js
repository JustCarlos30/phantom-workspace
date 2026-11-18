import { state, workspace, tasks, messages, date, graph, branches, merge, plugin, skill, conventions } from './fixtures.js';

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
    'terminal.list': () => [{ id: 'session-demo', nodeId: 'terminal-demo', workspaceId: workspace.id, status: 'running', createdAt: date }],
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
    'phantom.detail': p => p.topic === 'skills' ? { ...skill, available: true } : { available: true, ...tasks.find(t => t.id === p.id)?.raw, task: tasks.find(t => t.id === p.id)?.raw, item: tasks.find(t => t.id === p.id)?.raw },
    'phantom.events': () => items([{ id: 'event-demo', type: 'observed', message: 'Evento sintético', at: date }]),
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
    'merge.status': () => merge,
    'services.list': () => items([{ id: 'site-demo', name: 'Storybook sintético', title: 'Storybook sintético', url: 'http://127.0.0.1:6006', status: 'running', source: 'compose' }]),
    'sites.list': () => ({ items: [], projects: [] }),
    'docker.list': p => p.scope === 'sites' ? { projects: [{ workspaceId: workspace.id, name: workspace.name, path: workspace.path, compose: '/synthetic/project/compose.yaml', services: [{ name: 'storybook-demo', status: 'running', containers: [{ id: 'container-demo', name: 'storybook-demo', state: 'running' }], urls: ['http://127.0.0.1:6006'] }] }] } : items([{ id: 'container-demo', name: 'storybook-demo', status: 'running', image: 'storybook:synthetic' }]),
    'docker.logs': () => ({ text: 'Servidor sintético listo' }),
    'playground.list': () => items([{ id: 'run-demo', runtime: 'node', status: 'done', output: 'Hola, catálogo' }]),
    'automation.list': () => items([]),
    'limits.read': () => ({ available: false, reason: 'Sin cuentas reales en el catálogo', items: [] }),
    'review.projects': () => items([]),
    'mobile.status': () => ({ enabled: false, running: false, interfaces: [], devices: [], pending: [] }),
    'android.status': () => ({ configured: false, enabled: false, processAlive: false, devices: [], workspaces: [], interfaces: [], node: { compatible: false }, repoError: 'Proyecto Android no conectado en el catálogo' }),
    'voice.status': () => ({ available: false, reason: 'Micrófono aislado en Storybook' }),
    'voice.intent': p => ({ action: 'task', title: 'Borrador sintético', text: p.text }),
    'browser.detach': () => ({ ok: true }),
    'browser.hide': () => ({ ok: true }),
    'browser.bounds': () => ({ ok: true }),
    'browser.capture': () => ({ dataUrl: null }),
    'browser.attach': () => { throw new Error('WebContentsView solo existe en Electron; se muestra la UI real del navegador.'); },
    'browser.navigate': () => { throw new Error('Navegación nativa aislada en el catálogo.'); },
    'desktop.openExternal': () => ({ simulated: true }),
    'node.update': p => { const node = model.workspaces[0].nodes.find(n => n.id === p.id); if (node) Object.assign(node, p.patch); return node || p.patch; },
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
