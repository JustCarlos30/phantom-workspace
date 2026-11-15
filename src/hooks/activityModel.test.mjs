import test from 'node:test';
import assert from 'node:assert/strict';
import { ago, buildActivity, branchState, classifyNotice, classifyTask, freshness, integrationState, pendingChat, rowKind, sessionState, taskLinks, timeOf } from './activityModel.mjs';

test('Un shell abierto no acredita actividad del agente y salir no acredita éxito', () => {
  assert.equal(sessionState({ status: 'running' }).label, 'En espera');
  assert.equal(sessionState({ status: 'exited', exitCode: 0 }).label, 'Cerrada');
  assert.equal(sessionState({ status: 'exited', exitCode: 2 }).label, 'Cerrada · código 2');
  assert.equal(sessionState({ status: 'lost' }).needsYou, true);
  assert.equal(sessionState({ status: 'running', agentState: 'running' }).label, 'Trabajando');
  assert.equal(sessionState({ status: 'running' }, false).label, 'Sin conexión');
  assert.equal(sessionState(null).label, 'Sin datos');
});

test('Estados explícitos de tareas y desconocidos no se convierten en progreso', () => {
  for (const status of ['blocked', 'awaiting_approval', 'awaiting_input', 'failed']) assert.equal(classifyTask({ status }).needsYou, true);
  for (const status of ['running', 'queued', 'done', 'alien', undefined]) assert.equal(classifyTask({ status }).needsYou, false);
  assert.equal(classifyTask({}).label, 'Sin datos');
  assert.equal(classifyTask({ status: 'alien' }).label, 'Sin datos');
});

test('Leer un aviso no lo aprueba ni resuelve una intervención', () => {
  const notice = { status: 'awaiting_approval', acknowledgedAt: '2026-11-11' };
  assert.deepEqual(classifyNotice(notice), { read: true, approved: false, needsYou: true });
  assert.deepEqual(classifyNotice({ approved: true }), { read: false, approved: true, needsYou: false });
  const before = buildActivity({ workspace: { attention: [{ id: 'n', status: 'blocked' }] } });
  const after = buildActivity({ workspace: { attention: [{ id: 'n', status: 'blocked', acknowledgedAt: 'now' }] } });
  assert.equal(before.needs.length, after.needs.length);
  assert.equal(after.unread, 0);
});

const nodes = [{ id: 'n', type: 'terminal', title: 'Oculta', data: { sessionId: 's', hidden: true, worktree: { branch: 'feature' } } }];
const sessions = [{ id: 's', nodeId: 'n', status: 'running' }];

test('Vínculos por identidad real; títulos, PID, rama y carpeta no unen tareas a sesiones', () => {
  assert.equal(taskLinks({ raw: { sessionId: 's' } }, sessions, nodes).length, 1);
  assert.equal(taskLinks({ raw: { refs: [{ kind: 'terminal', id: 'n' }] } }, sessions, nodes).length, 1);
  assert.equal(taskLinks({ raw: { nodeId: 'n' } }, sessions, nodes).length, 1);
  assert.equal(taskLinks({ title: 'Oculta', raw: { branch: 'feature', pid: 2, contract: { workspace: '/same' } } }, sessions, nodes).length, 0);
  assert.equal(taskLinks({ raw: { refs: [{ kind: 'card', id: 's' }] } }, sessions, nodes).length, 0);
});

test('Sesiones ocultas son operativas y estados de tareas solo se propagan con vínculo real', () => {
  const model = buildActivity({ workspace: { nodes }, sessions, tasks: [{ id: 't', status: 'blocked', raw: { sessionId: 's' } }] });
  assert.equal(model.sessions[0].hidden, true);
  assert.equal(model.sessions[0].nodeId, 'n');
  assert.equal(model.sessions[0].label, 'Bloqueada');
  assert.equal(model.needs.length, 1, 'Una tarea bloqueada no se duplica como intervención de sesión');
  const unrelated = buildActivity({ workspace: { nodes }, sessions, tasks: [{ id: 't', status: 'blocked' }] });
  assert.equal(unrelated.sessions[0].label, 'En espera');
});

test('Historial relanzado no navega a una sesión diferente; panel sin descriptor permanece desconocido', () => {
  const model = buildActivity({ workspace: { nodes }, sessions: [{ id: 'old', nodeId: 'n', status: 'exited' }] });
  assert.equal(model.sessions.find(s => s.id === 'old').nodeId, null);
  assert.equal(model.sessions.find(s => s.nodeId === 'n').label, 'Sin datos');
  assert.equal(model.sessions.find(s => s.id === 'old').title, 'Sesión anterior', 'Un identificador nunca hace de título');
  assert.equal(model.sessionCount, 1);
  assert.equal(model.unknownViews, 1);
  assert.equal(taskLinks({ raw: { nodeId: 'n' } }, [{ id: 'old', nodeId: 'n' }], nodes).length, 0);
  assert.equal(taskLinks({ raw: { refs: [{ kind: 'terminal', id: 'n' }] } }, [{ id: 'old', nodeId: 'n' }], nodes).length, 0);
});

test('Integración exige base explícita y comparación válida; no integrada nunca significa lista', () => {
  const git = { available: true, base: 'main', comparison: { baseOid: 'abc' }, branches: [{ name: 'feature', merged: false, ahead: 2, behind: 1 }, { name: 'other', merged: true }] };
  assert.equal(branchState(git.branches[0], { ...git, comparison: null }), 'Integración desconocida');
  assert.equal(branchState(git.branches[0], { ...git, base: null }), 'Integración desconocida');
  assert.equal(branchState(git.branches[0], { ...git, available: false }), 'Integración desconocida');
  const model = buildActivity({ workspace: { nodes }, sessions, git });
  assert.equal(model.pendingBranches, 1);
  assert.equal(model.branches[0].label, 'No integrada');
  assert.equal(model.branches[0].sessions[0].id, 's');
  assert.equal(model.branches[1].sessions.length, 0);
  assert.equal(buildActivity({ workspace: { nodes }, git: { branches: git.branches } }).unknownBranches, 2);
});

test('screen state turns a quiet agent terminal into a needs-you signal', () => {
  assert.deepEqual(sessionState({ status: 'running', screenState: 'awaiting_approval', agentState: 'working' }), { needsYou: true, label: 'Pide permiso', tone: 'warning', screen: 'awaiting_approval' });
  assert.equal(sessionState({ status: 'running', screenState: 'awaiting_input' }).needsYou, true);
  assert.deepEqual(sessionState({ status: 'running', screenState: 'working' }), { needsYou: false, label: 'Trabajando', tone: 'working', screen: 'working' });
  assert.equal(sessionState({ status: 'running', screenState: 'awaiting_input' }, false).needsYou, false);
});

test('Terminadas reúne tareas cerradas e incorporaciones, lo más reciente primero; lo no empezado no es progreso', () => {
  const activity = buildActivity({
    tasks: [
      { id: 'old', status: 'completed', raw: { updatedAt: '2026-11-10T10:00:00Z' } },
      { id: 'run', status: 'running' }, { id: 'wait', status: 'ready' }, { id: 'stuck', status: 'blocked' },
      { id: 'drop', status: 'cancelled', raw: { updatedAt: '2026-11-12T10:00:00Z' } },
    ],
    merges: { available: true, queue: [], active: [], history: [{ id: 'm', title: 'Rama', status: 'merged', finishedAt: '2026-11-13T10:00:00Z' }, { id: 'r', status: 'rejected', finishedAt: '2026-11-11T10:00:00Z' }] },
  });
  assert.deepEqual(activity.finished.map(item => [item.key, item.tone]), [['merge:m', 'done'], ['task:drop', 'cancelled'], ['merge:r', 'cancelled'], ['task:old', 'done']]);
  assert.deepEqual(activity.inProgress.map(item => [item.id, item.tone, item.label]), [['run', 'working', 'Trabajando'], ['wait', 'waiting', 'Sin empezar']]);
  assert.deepEqual(activity.needs.map(item => item.id), ['stuck']);
  assert.deepEqual(buildActivity({ merges: { available: false, history: [{ id: 'x', status: 'merged' }] } }).finished, []);
});

test('El conteo solo se marca desactualizado por las fuentes que lo alimentan', () => {
  const now = 1_000_000, ok = { at: now - 1000 };
  assert.equal(freshness({ sources: { tasks: ok, sessions: ok, merges: ok, limits: { error: 'sin plan' }, git: { at: now - 900000 } }, now }).state, 'fresh');
  assert.deepEqual(freshness({ sources: { tasks: { at: now - 1000, error: 'falló' }, sessions: ok, merges: ok }, now }), { state: 'stale', failing: ['tareas de Phantom'] });
  assert.equal(freshness({ sources: { tasks: ok, sessions: { at: now - 60000 }, merges: ok }, now }).state, 'stale');
  assert.equal(freshness({ sources: { tasks: ok, sessions: ok, merges: {} }, now }).state, 'loading');
  assert.equal(freshness({ sources: { tasks: { error: 'Phantom no instalado' }, sessions: ok, merges: ok }, now }).state, 'stale');
  assert.equal(freshness({ sources: {}, connected: false, now }).state, 'offline');
});

test('Cada fila dice por qué está ahí y hace cuánto', () => {
  assert.equal(rowKind({ status: 'awaiting_approval' }), 'approval');
  assert.equal(rowKind({ status: 'running', screen: 'awaiting_input', needsYou: true }), 'input');
  assert.equal(rowKind({ status: 'blocked' }), 'blocked');
  assert.equal(rowKind({ status: 'failed' }), 'failed');
  assert.equal(rowKind({ target: 'integration', status: 'conflict' }), 'returned');
  assert.equal(rowKind({ target: 'integration', status: 'blocked' }), 'blocked');
  assert.equal(rowKind({ status: 'completed', tone: 'done' }), 'done');
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.deepEqual(['2026-11-13T11:59:40Z', '2026-11-13T11:15:00Z', '2026-11-13T07:00:00Z', '2026-11-10T12:00:00Z'].map(value => ago(Date.parse(value), now)), ['ahora', 'hace 45 min', 'hace 5 h', 'hace 3 d']);
  assert.equal(ago(0, now), '');
  assert.equal(timeOf({ createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-13T12:00:00Z' }), now);
  assert.equal(timeOf({}), 0);
});

const chatNodes = [
  { id: 'c1', type: 'terminal', title: 'Phantom Mobile', data: { chat: { provider: 'codex' } } },
  { id: 'c2', type: 'terminal', title: 'Tests de cámara', data: { chat: { provider: 'claude' } } },
  { id: 't1', type: 'terminal', title: 'Navegación', data: { sessionId: 's1', worktree: { branch: 'phantom/terminal-1' } } },
];
const permission = { type: 'permission', id: 'p1', tool: 'Bash', detail: 'npm i expo-camera', status: 'pending' };
const question = { type: 'question', id: 'q1', status: 'pending', questions: [{ question: '¿Mantengo la duración adaptativa?', multiSelect: false, options: [{ label: 'Sí' }, { label: 'No' }] }] };

test('Solo un turno en curso tiene permisos o preguntas pendientes', () => {
  const messages = [{ id: 'm', parts: [{ type: 'text', text: 'hola' }, permission, { ...permission, id: 'p0', status: 'allowed' }, question] }];
  assert.deepEqual(pendingChat({ running: true, messages }).map(part => part.id), ['p1', 'q1']);
  assert.deepEqual(pendingChat({ running: false, messages }), []);
  assert.deepEqual(pendingChat(null), []);
});

test('Permisos y preguntas de chat encabezan «Decide ahora» con lo necesario para responder en la fila', () => {
  const model = buildActivity({
    workspace: { id: 'w', nodes: chatNodes },
    chats: [{ nodeId: 'c2', running: true, pending: [question] }, { nodeId: 'c1', running: true, pending: [permission, { ...permission, id: 'p2' }] }, { nodeId: 'phantom:w', running: true, pending: [{ ...permission, id: 'p3', tool: 'mcp__x__y', detail: '' }] }, { nodeId: 'gone', running: true, pending: [permission] }],
  });
  assert.deepEqual(model.pending.now.map(row => [row.need, row.chatId, row.requestId]), [['permission', 'c1', 'p1'], ['permission', 'phantom:w', 'p3'], ['question', 'c2', 'q1']]);
  const [ask, main, asked] = model.pending.now;
  assert.deepEqual([ask.headline, ask.code, ask.context, ask.nodeId, ask.target], ['Ejecutar', 'npm i expo-camera', 'Phantom Mobile · Codex pide permiso · 1 más', 'c1', 'chat']);
  assert.deepEqual([main.headline, main.code, main.context, main.nodeId, main.target], ['Usar una herramienta', 'mcp__x__y', 'Phantom · Phantom pide permiso', null, 'phantom']);
  assert.deepEqual([asked.headline, asked.options, asked.context], ['¿Mantengo la duración adaptativa?', ['Sí', 'No'], 'Tests de cámara · Claude espera tu respuesta']);
  assert.equal(model.count, 3);
  assert.equal(model.needs, model.pending.now);
  assert.deepEqual(model.sessions.filter(s => s.nodeId !== 't1').map(s => [s.nodeId, s.label, s.needsYou]), [['c1', 'Pide permiso', true], ['c2', 'Te hizo una pregunta', true]]);
  const long = buildActivity({ workspace: { id: 'w', nodes: chatNodes }, chats: [{ nodeId: 'c2', running: true, pending: [{ ...question, questions: [{ question: '¿Cuál?', options: [{ label: 'Una opción bastante larga' }, { label: 'No' }] }] }] }] });
  assert.deepEqual(long.pending.now[0].options, []);
  assert.equal(buildActivity({ workspace: { id: 'w', nodes: chatNodes }, chats: [{ nodeId: 'c1', running: true, pending: [permission] }], connected: false }).count, 0);
});

test('Una sesión aparece una sola vez: el permiso del chat calla a su rama y a su pantalla', () => {
  const merges = { available: true, base: { branch: 'main', uncommitted: 0 }, active: [], history: [], queue: [{ id: 'r1', nodeId: 'c1', title: 'Phantom Mobile', status: 'conflict', conflicts: ['Canvas.jsx'] }, { id: 'r2', nodeId: 't1', title: 'Navegación', status: 'conflict', conflicts: ['Canvas.jsx', 'App.jsx', 'x.js'] }, { id: 'r3', nodeId: 'c2', title: 'Tests de cámara', status: 'failed' }] };
  const model = buildActivity({
    workspace: { id: 'w', nodes: chatNodes }, merges,
    sessions: [{ id: 's1', status: 'running', screenState: 'awaiting_approval' }],
    chats: [{ nodeId: 'c1', running: true, pending: [permission] }],
  });
  assert.deepEqual(model.pending.now.map(row => [row.key, row.need]), [['chat:c1', 'permission'], ['session:s1', 'approval'], ['merge:r3', 'checks']]);
  assert.deepEqual(model.pending.now.map(row => row.nodeId), ['c1', 't1', 'c2']);
  assert.deepEqual([model.pending.now[1].headline, model.pending.now[1].context], ['Pide permiso para continuar', 'Navegación · Terminal']);
  assert.equal(model.pending.now[2].headline, 'Tests de cámara: tests fallidos');
  const alone = buildActivity({ workspace: { id: 'w', nodes: chatNodes }, merges });
  assert.deepEqual(alone.pending.now.map(row => [row.headline, row.context]), [['Phantom Mobile choca con main', 'Conflicto en Canvas.jsx'], ['Navegación choca con main', 'Conflicto en Canvas.jsx, App.jsx'], ['Tests de cámara: tests fallidos', 'Hay que corregirlos y volver a enviarla']]);
});

test('«Cuando puedas»: ramas listas, main sin guardar y cola sin nadie integrando; nada de esto cuenta', () => {
  const merges = {
    available: true, base: { branch: 'main', uncommitted: 1 }, orchestrator: null, history: [],
    queue: [{ id: 'q', nodeId: 'a', title: 'Glifos', status: 'queued' }, { id: 'q2', nodeId: 'b', title: 'Mapa', status: 'queued' }],
    active: [{ nodeId: 'x', title: 'Tests de cámara', ahead: 2, uncommitted: 0, status: 'idle' }, { nodeId: 'y', title: 'Sucia', ahead: 1, uncommitted: 3, status: 'idle' }, { nodeId: 'z', title: 'Viva', ahead: 1, uncommitted: 0, status: 'working' }],
  };
  const model = buildActivity({ merges });
  assert.deepEqual(model.pending.later.map(row => [row.need, row.count, row.headline]), [['ready', 1, '1 rama lista para main'], ['unsaved', 1, 'main tiene 1 archivo sin guardar'], ['queue', 2, 'Hay 2 ramas en cola y nadie integrando']]);
  assert.equal(model.pending.later[0].context, 'Tests de cámara');
  assert.equal(model.count, 0);
  const tended = buildActivity({ merges: { ...merges, base: { branch: 'main', uncommitted: 0 }, orchestrator: { nodeId: 'o', running: true } } });
  assert.deepEqual(tended.pending.later.map(row => row.need), ['ready']);
  assert.deepEqual(buildActivity({ merges: { ...merges, orchestrator: { nodeId: 'o', running: false } } }).pending.later.map(row => row.need), ['ready', 'unsaved', 'queue']);
  assert.deepEqual(buildActivity({ merges: { ...merges, available: false } }).pending.later, []);
  assert.deepEqual(buildActivity({}).pending, { now: [], later: [] });
});

test('«En curso» y «Hoy»: quien trabaja una vez, lo cerrado hoy y los avisos nuevos', () => {
  const now = new Date(2026, 10, 13, 15, 0).getTime(), at = (day, hour) => new Date(2026, 10, day, hour, 0).toISOString();
  const model = buildActivity({
    now,
    workspace: { id: 'w', nodes: chatNodes, attention: [{ id: 'viejo', title: 'Aviso viejo', createdAt: at(10, 9) }, { id: 'visto', title: 'Ya visto', createdAt: at(10, 9), acknowledgedAt: at(10, 10) }, { id: 'hoy', title: 'Visto hoy', createdAt: at(13, 9), acknowledgedAt: at(13, 10) }] },
    sessions: [{ id: 's1', status: 'running', screenState: 'working' }],
    chats: [{ nodeId: 'c1', running: true, pending: [] }, { nodeId: 'c2', running: true, pending: [question] }],
    tasks: [{ id: 'run', title: 'Tarea viva', status: 'running' }, { id: 'ayer', status: 'completed', raw: { updatedAt: at(12, 9) } }, { id: 'hecha', title: 'Hecha', status: 'completed', raw: { updatedAt: at(13, 11) } }],
    merges: { available: true, base: { branch: 'main' }, queue: [{ id: 'm', nodeId: 't1', title: 'Navegación', status: 'merging' }], active: [], history: [{ id: 'h', title: 'Glifos', status: 'merged', finishedAt: at(13, 12) }] },
  });
  assert.deepEqual(model.current.map(row => [row.headline, row.state]), [['Tarea viva', 'Trabajando'], ['Navegación', 'Integrando'], ['Phantom Mobile', 'Trabajando']]);
  assert.deepEqual(model.today.map(row => [row.headline, row.state]), [['Glifos', 'En main'], ['Hecha', 'Terminada'], ['Visto hoy', ''], ['Aviso viejo', 'Nuevo']]);
});

test('Etiquetas en lenguaje llano', () => {
  assert.deepEqual(['queued', 'merging', 'conflict', 'failed', 'merged'].map(status => integrationState({ status })), ['En cola', 'Integrando', 'Conflicto', 'Tests fallidos', 'En main']);
  assert.deepEqual(['blocked', 'awaiting_approval', 'awaiting_input', 'running', 'completed'].map(status => classifyTask({ status }).label), ['Bloqueada', 'Pide permiso', 'Te hizo una pregunta', 'Trabajando', 'Terminada']);
  assert.equal(sessionState({ status: 'running', screenState: 'awaiting_input' }).label, 'Terminó · tu turno');
});
