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

const ENV_KEYS = { list: ['sessionId'], up: ['sessionId', 'service', 'profile'], run: ['sessionId', 'job', 'timeout'], down: ['sessionId', 'service'] };
const ENV_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export function validateEnv(action, payload) {
  assert(Object.hasOwn(ENV_KEYS, action), 'Acción de entorno desconocida');
  object(payload);
  for (const key of Object.keys(payload)) assert(ENV_KEYS[action].includes(key), `Clave de entorno desconocida: ${key}`);
  const fields = {};
  for (const key of ['service', 'profile', 'job']) if (payload[key] !== undefined) {
    assert(typeof payload[key] === 'string' && ENV_NAME.test(payload[key]), `Nombre de ${key === 'service' ? 'servicio' : key === 'profile' ? 'perfil' : 'trabajo'} inválido`);
    fields[key] = payload[key];
  }
  if (action === 'up') assert((fields.service === undefined) !== (fields.profile === undefined), 'Indica un servicio o un perfil');
  if (action === 'run') {
    assert(fields.job !== undefined, 'Indica el trabajo');
    if (payload.timeout !== undefined) { assert(Number.isInteger(payload.timeout) && payload.timeout >= 1 && payload.timeout <= 3600, 'El tiempo límite debe ser un entero entre 1 y 3600 segundos'); fields.timeout = payload.timeout; }
  }
  return fields;
}

// Operaciones que cambian el entorno: máximo 60 por sesión emisora y hora.
export function createEnvLimit({ now = Date.now } = {}) {
  const sessions = new Map();
  return sessionId => {
    const time = now();
    for (const [id, times] of sessions) {
      const recent = times.filter(t => t > time - 3600000);
      if (recent.length) sessions.set(id, recent); else sessions.delete(id);
    }
    const times = sessions.get(sessionId) ?? [];
    assert(times.length < 60, 'Límite de entorno: máximo 60 operaciones por sesión emisora por hora');
    times.push(time); sessions.set(sessionId, times);
  };
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
