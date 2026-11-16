import { assert, object, text } from './store.mjs';

export function validateLaunch(payload, node) {
  object(payload);
  for (const key of Object.keys(payload)) assert(['sessionId','command','title'].includes(key), `Clave de proceso desconocida: ${key}`);
  assert(!node.data.process, 'Un proceso no puede lanzar otros procesos');
  assert(typeof payload.command === 'string', 'El comando debe ser texto');
  assert(!/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(payload.command), 'El comando debe ser una línea sin caracteres de control');
  const command = payload.command.trim();
  text(command, 'comando (1..2000 caracteres)', 2000);
  assert(command, 'El comando no puede estar vacío');
  const title = payload.title === undefined ? command.slice(0,60) : payload.title;
  text(title, 'título del proceso (máximo 120 caracteres)', 120);
  assert(title.trim() && !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(title), 'El título del proceso debe ser una línea sin caracteres de control');
  return { command, title: title.trim() };
}

export function createProcessLimit({ now = Date.now } = {}) {
  const sessions = new Map();
  return sessionId => {
    const time = now();
    for (const [id,times] of sessions) {
      const recent = times.filter(t => t > time - 3600000);
      if (recent.length) sessions.set(id,recent); else sessions.delete(id);
    }
    const times = sessions.get(sessionId) ?? [];
    assert(times.length < 10, 'Límite de procesos: máximo 10 por sesión emisora por hora');
    times.push(time); sessions.set(sessionId,times);
    return new Date(time).toISOString();
  };
}

export function processList(nodes, sessions, nodeId) {
  return nodes.filter(n => n.type === 'terminal' && n.data.process).map(n => {
    const p = n.data.process;
    return { processId:p.id, nodeId:n.id, sessionId:n.data.sessionId ?? null, title:p.title, command:p.command, cwd:p.cwd, status:sessions.some(s => s.id === n.data.sessionId && s.nodeId === n.id && s.status === 'running') ? 'running' : 'stopped', createdAt:p.createdAt, mine:p.from.nodeId === nodeId };
  });
}
