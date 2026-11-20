export const noop = () => {};
export const done = async () => {};
export const date = '2026-01-01T10:00:00Z';
export const markdown = '# Ejemplo sintético\n\nContenido **importante**, _contexto_ y `código`.\n\n- Leer la fuente\n- Comprobar el resultado\n\n> Una observación no es una norma.\n\n| Estado | Resultado |\n| --- | --- |\n| Listo | Datos sintéticos |\n\n```js\nconst mensaje = "Hola, Phantom";\n```';
export const terminalNode = { id: 'terminal-demo', type: 'terminal', title: 'Sesión de ejemplo', x: 32, y: 32, width: 620, height: 460, data: { sessionId: 'session-demo', cwd: '/synthetic/project', agent: { status: 'working', step: 'Revisando componentes', cardId: 'task-demo' } } };
export const chatNode = { ...terminalNode, id: 'chat-demo', title: 'Conversación de ejemplo', data: { chat: { provider: 'claude', permissionMode: 'ask' }, agent: { status: 'idle' } } };
export const noteNode = { id: 'note-demo', type: 'note', title: 'Contexto del catálogo', x: 40, y: 40, width: 440, height: 300, data: { text: 'Datos sintéticos. Selecciona, mueve o renombra este panel.' } };
export const workspace = { id: 'storybook-project', name: 'Proyecto de ejemplo', path: '/synthetic/project', canonicalPath: '/synthetic/project', camera: { x: 40, y: 40, zoom: 1 }, nodes: [noteNode], tasks: [], missions: [], workflows: [], contextRefs: [], services: [], attention: [], spaces: [], plugins: { phantom: { enabled: true, refreshMs: 4000, config: {} }, convencions: { enabled: true }, 'video-log': { enabled: true, config: { sourcePath: '/synthetic/bitacora.md' } } } };
export const state = { schemaVersion: 1, activeWorkspaceId: workspace.id, settings: {}, workspaces: [workspace] };
const taskSpecs = [
  ['running', 'Catalogar componentes'],
  ['blocked', '## Título\nMostrar el resumen de cambios en la Card\n\n## Propósito\nVer qué archivos cambió el agente sin abrir JSON.\n\n## Después esperado\nUna fila con archivos, +/− y checks.', { reason: 'Verificación fallida; margen de reparación agotado', resolution: { supersededBy: null, landed: 0 } }],
  ['completed', 'Revisar fundamentos'],
  ['blocked', 'Añadir filtro por rama a la Mesa', { reason: 'Hijo ui: No hay un cambio atribuible que satisfaga el encargo', resolution: { supersededBy: { id: 'task-4', status: 'completed' }, landed: 0 } }],
  ['completed', 'Filtrar la Mesa por rama o worktree'],
  ['blocked', 'Recortar la salida de los checks', { reason: 'El motor reportó un error: Presupuesto de tokens agotado', resolution: { supersededBy: null, landed: 2 } }],
  ['cancelled', 'Probar un diseño descartado'],
  ['blocked', 'Corregir el orden de las zonas', { reason: 'Verificación fallida', resolution: { supersededBy: null, landed: 0 } }],
];
export const tasks = taskSpecs.map(([status, goal, extra = {}], i) => ({ id: `task-${i}`, title: goal, source: 'phantom', status, ...(extra.resolution ? { resolution: extra.resolution } : {}), raw: { id: `task-${i}`, kind: 'card', status, contract: { goal, workspace: '/synthetic/project', scope: ['src/example.jsx', 'src/example.css'], checks: [{ name: 'Ejemplo', argv: ['node', '--test'] }], budget: { timeoutMs: 1500000, maxTurns: 40 } }, evidence: ['Evidencia sintética'], createdAt: date, updatedAt: date, ...(extra.reason ? { reason: extra.reason } : {}) } }));
export const taskRun = {
  id: 'run-demo', status: 'failed', mode: 'execution', startedAt: date, endedAt: '2026-01-01T10:12:30Z', turns: 18, tools: 42, reason: 'Verificación fallida; margen de reparación agotado',
  evidence: {
    baseline: { available: true, checks: [{ name: 'suite-unitaria', passed: true, durationMs: 8200, argv: ['npm', 'test'] }] },
    verification: [
      { round: 1, available: true, passed: false, changed: ['src/example.jsx'], checks: [{ name: 'suite-unitaria', passed: false, durationMs: 9100, argv: ['npm', 'test'] }] },
      { round: 2, available: true, passed: false, changed: ['src/example.jsx', 'src/example.css'], checks: [{ name: 'suite-unitaria', passed: false, durationMs: 9400, argv: ['npm', 'test'], exitCode: 1, stdout: '✔ resumen vacío\n✔ archivos sin cambios\n✖ resumen con archivos\n  AssertionError: esperado "2 archivos · +14 −3"\n  recibido "Sin cambios registrados"', stderr: 'npm error Test failed.' }, { name: 'build', passed: true, durationMs: 4300, argv: ['npm', 'run', 'build'] }] },
    ],
  },
  summary: {
    message: 'Añadí la fila de resumen y los estilos.\nEl test de resumen con archivos sigue fallando: el host no entrega summary.files en este fixture.\nNecesito que el host incluya summary en phantom.detail o que amplíes el alcance a host/.\nNo toqué otros archivos.\nLos estilos usan solo tokens vigentes.\nEl build pasa.\nQueda pendiente revisar el estado vacío.',
    files: [{ path: 'src/example.jsx', added: 12, removed: 3 }, { path: 'src/example.css', added: 2, removed: 0 }],
    patch: 'diff --git a/src/example.jsx b/src/example.jsx\n--- a/src/example.jsx\n+++ b/src/example.jsx\n@@ -1,3 +1,4 @@\n-const resumen = null;\n+const resumen = runSummary(run);\n+export default resumen;',
    patchTruncated: false,
  },
};
export const messages = [{ id: 'm1', role: 'user', createdAt: date, parts: [{ type: 'text', text: '¿Qué muestra este catálogo?' }] }, { id: 'm2', role: 'assistant', createdAt: date, parts: [{ type: 'text', text: markdown }] }];
export const graph = { available: true, commits: [{ oid: 'abcdef123456', parents: ['123456abcdef'], subject: 'Añadir catálogo sintético', author: 'Agente de ejemplo', email: 'demo@example.invalid', at: date, refs: ['HEAD -> main'] }, { oid: '123456abcdef', parents: [], subject: 'Preparar fundamentos', author: 'Agente de ejemplo', at: date, refs: ['feature/catalogo'] }], more: false };
export const branches = { available: true, base: { branch: 'main', path: '/synthetic/project' }, checks: 'node --test', integration: { enabled: false }, branches: [{ name: 'main', isBase: true, ahead: 0, behind: 0, changes: [], committed: [], worktree: { path: '/synthetic/project', exists: true, main: true } }, { name: 'feature/catalogo', ahead: 2, behind: 0, changes: [], committed: ['src/example.jsx'], work: 'none', worktree: { path: '/synthetic/catalogo', exists: true } }, { name: 'feature/textos-largos-para-comprobar-truncado-y-lectura', ahead: 0, behind: 1, changes: [{ path: 'src/example.jsx', status: ' M' }], changeCount: 1, committed: [], worktree: { path: '/synthetic/textos', exists: true } }] };
export const merge = { available: true, enabled: false, base: { branch: 'main', uncommitted: 0 }, baseBranch: 'main', guard: { installed: false, reason: 'Protecciones nativas no conectadas en el catálogo' }, requests: [], queue: [], active: [], history: [], settings: {}, orchestrator: null };
export const environmentNodes = [{ id: 'node-dev', type: 'terminal', title: 'Proceso: dev', x: 40, y: 400, width: 620, height: 360, data: { sessionId: 'session-dev', process: { id: 'process-dev', title: 'dev', command: 'vite --host 127.0.0.1', cwd: '/synthetic/project', from: { nodeId: 'operator', title: 'Operador' }, createdAt: date } } }];
export const environment = {
  scripts: [
    { id: 'script-dev', name: 'dev', origin: 'project', command: 'vite --host 127.0.0.1', body: 'vite --host 127.0.0.1', cwd: '/synthetic/project' },
    { id: 'script-build', name: 'build', origin: 'project', command: 'vite build', body: 'vite build', cwd: '/synthetic/project' },
    { id: 'script-test', name: 'test', origin: 'project', command: 'node --test', body: 'node --test', cwd: '/synthetic/project' },
  ],
  ports: [
    { id: 'port-5173', title: 'Vite', url: 'http://127.0.0.1:5173', port: 5173, source: 'managed', owner: { sessionId: 'session-dev' }, health: 'healthy', httpStatus: 200 },
    { id: 'port-5174', title: 'Servidor de API', url: 'http://127.0.0.1:5174', port: 5174, source: 'managed', owner: { sessionId: 'session-api' }, health: 'unreachable' },
  ],
  sessions: [
    { id: 'session-dev', nodeId: 'node-dev', workspaceId: 'storybook-project', status: 'running', createdAt: date },
    { id: 'session-copy', nodeId: 'terminal-demo', workspaceId: 'storybook-project', status: 'running', name: 'Copia de catálogo', worktree: true, cwd: '/synthetic/catalogo', createdAt: date, setup: { status: 'failed', error: 'npm install terminó con el código 1', output: 'npm ERR! network request failed', updatedAt: date } },
  ],
  checks: { available: true, checks: { configured: true, command: 'npm test' } },
};
export const appearance ={ background: 'gengar', accent: 'ivory', intensity: 35, gengar: true, gengarIntensity: 60, pulse: false, concentration: false, grid: true, image: '' };
export const need = { key: 'permission-demo', need: 'permission', headline: '¿Permitir la lectura de ejemplo?', title: 'Sesión de ejemplo', context: 'Catálogo sintético', at: Date.parse(date), code: 'Leer src/example.jsx', chatId: chatNode.id, requestId: 'permission-demo', target: 'terminal', nodeId: chatNode.id };
export const activity = { connected: true, now: Date.parse(date), sources: {}, needs: [need], pending: { now: [need], later: [] }, inProgress: [], activeSessions: [], integrations: { active: [] }, current: [], today: [], retry: noop };
export const plugin = { id: 'phantom', name: 'Phantom', enabled: true, version: '1.0.0', refreshMs: 4000, config: {}, panels: [], actions: [] };
export const skill = { id: 'skill-demo', title: 'Revisión de interfaz', source: 'phantom', ref: { scope: 'workspace', id: 'skill-demo', version: '1.0.0', sha256: 'a'.repeat(64) }, manifest: { name: 'Revisión de interfaz', description: 'Procedimiento sintético para revisar una interfaz', body: markdown, requiresTools: [], actions: ['review.ui'], resources: [{ name: 'ejemplo.md', mediaType: 'text/markdown', content: '# Recurso sintético\n\nComprobar el resultado.' }] } };
export const conventions = { contractVersion: 1, workspaceId: workspace.id, repository: workspace.path, state: 'ready', available: true, reason: null, observedAt: date, bases: [{ id: 'base-demo', name: 'Base sintética', versions: [{ version: '1.0.0', publishedAt: date, description: 'Ejemplo de contrato de lectura; no declara reglas del proyecto real.', conventions: ['adopted', 'observed', 'proposed', 'excepted'].map((state, i) => ({ id: `convention-${i}`, title: ['Regla sintética adoptada', 'Patrón observado', 'Propuesta pendiente', 'Excepción documentada'][i], state, scope: { kind: 'project', target: '.' }, what: 'Conservar la evidencia del ejemplo', when: 'Al revisar la interfaz sintética', why: 'Separar hechos de decisiones', verification: 'Leer el escenario del catálogo', sources: [{ label: 'Fixture sintética', reference: 'src/stories/fixtures.js', observedAt: date }], exception: state === 'excepted' ? { reason: 'Ejemplo de excepción con motivo', until: null } : null })) }] }], project: null };
