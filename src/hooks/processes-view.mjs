export function processesView(nodes = [], sessions = [], services = []) {
  return nodes.filter(node => node.type === 'terminal' && node.data?.process)
    .sort((a,b) => b.data.process.createdAt.localeCompare(a.data.process.createdAt))
    .map(node => {
      const process = node.data.process, sessionId = node.data.sessionId;
      const session = sessions.find(session => session.id === sessionId && session.nodeId === node.id);
      return { ...process, processId:process.id, nodeId:node.id, sessionId,
        status:session?.status === 'running' ? 'running' : 'stopped',
        exitCode:session && session.status !== 'running' && Number.isInteger(session.exitCode) ? session.exitCode : null,
        services:sessionId ? services.filter(service => service.source === 'managed' && service.owner?.sessionId === sessionId) : [],
      };
    });
}

// Plain-words health of a port after a probe; a service never probed says so.
export function healthView(service) {
  const code = Number.isInteger(service?.httpStatus) ? ` (HTTP ${service.httpStatus})` : '';
  if (service?.health === 'healthy') return { tone: 'ok', text: `Responde${code}` };
  if (service?.health === 'unhealthy') return { tone: 'warn', text: `Responde con error${code}` };
  if (service?.health === 'unreachable') return { tone: 'bad', text: 'No responde' };
  return { tone: 'none', text: 'Sin comprobar' };
}

// Setup of the session copies (worktrees): what happened, why, and whether Reintentar applies.
const SETUP = {
  queued: ['En espera', 'La preparación está a punto de empezar.'],
  checking: ['Revisando', 'Se comprueba si las dependencias ya están listas.'],
  installing: ['Instalando dependencias', 'Esto puede tardar unos minutos.'],
  ready: ['Lista', 'Las dependencias están listas.'],
  skipped: ['No hacía falta', 'Esta copia no necesita preparar dependencias.'],
  failed: ['Falló', 'La instalación de dependencias no terminó. La terminal sigue funcionando.'],
  cancelled: ['Cancelada', 'La preparación se interrumpió antes de terminar.'],
};
export function setupView(sessions = []) {
  return sessions.filter(session => session.worktree && session.setup?.status).map(session => {
    const { status, error, reason, output, updatedAt } = session.setup, [label, why] = SETUP[status] || ['Sin datos', ''];
    const busy = ['queued', 'checking', 'installing'].includes(status);
    return { sessionId: session.id, nodeId: session.nodeId, name: session.name || 'Sesión', cwd: session.cwd, status, label, why: error || (status === 'skipped' && reason) || why,
      problem: status === 'failed' || status === 'cancelled', canRetry: !busy && status !== 'ready' && status !== 'skipped' && session.status === 'running', output: output || '', updatedAt: updatedAt || null };
  });
}

// The one thing the board asks of you first: state in plain words, why, and a single action.
// Order: failed preparation, process that ended badly, port that does not answer, nothing running.
export function envLead({ setup = [], rows = [], ports = [], scripts = [] } = {}) {
  const retry = setup.find(item => item.problem && item.canRetry);
  if (retry) return { tone: 'bad', text: 'Una copia de sesión no terminó de prepararse.', why: retry.why, action: { kind: 'retry', id: retry.sessionId, label: 'Reintentar' } };
  const failed = rows.find(row => row.status === 'stopped' && row.exitCode > 0);
  if (failed) return { tone: 'bad', text: `«${failed.title}» terminó con error.`, why: `Salió con el código ${failed.exitCode}. Mira su salida reciente para saber por qué.`, action: { kind: 'restart', id: failed.processId, label: 'Reiniciar' } };
  const dead = ports.find(port => port.health === 'unreachable' && port.source === 'managed');
  if (dead) return { tone: 'warn', text: `El puerto ${dead.port} no responde.`, why: 'Algo lo abrió, pero no contesta. Puede estar arrancando todavía.', action: null };
  const running = rows.filter(row => row.status === 'running').length;
  if (running) return { tone: 'ok', text: running === 1 ? 'Hay 1 proceso en marcha.' : `Hay ${running} procesos en marcha.`, why: 'Los puertos y sitios de abajo muestran si responden.', action: null };
  const first = scripts.find(script => script.origin === 'project' && ['dev', 'start'].includes(script.name)) || scripts[0];
  if (first) return { tone: 'none', text: 'No hay nada en marcha.', why: 'Puedes arrancar el proyecto con uno de sus scripts.', action: { kind: 'run', id: first.id, label: `Ejecutar ${first.name}` } };
  return { tone: 'none', text: 'No hay nada en marcha.', why: 'Este proyecto no declara scripts en package.json. Fija un sitio o pide a un agente que arranque un servidor.', action: null };
}

// Where the integration test command comes from (merge.status → checks).
export function checksView(checks) {
  if (!checks) return null;
  const command = typeof checks.command === 'string' ? checks.command : '';
  if (checks.configured) return { command, source: command ? 'Definido para este proyecto en Cola de integración.' : 'Definido para este proyecto: no ejecutar pruebas.', empty: !command };
  return { command, source: command ? 'Detectado: package.json declara el script test.' : 'No hay pruebas configuradas ni un script test en package.json.', empty: !command };
}

// A script is "running" when a live process of the same command already uses its folder.
export const scriptRunning = (script, rows = []) => rows.some(row => row.status === 'running' && row.command === script.command && row.cwd === script.cwd);

// The process record a node carries; the operator is the origin when the user launches it.
export const operatorProcess = (script, id, createdAt) => ({ id, title: script.origin === 'session' ? `${script.name} (copia de la sesión)` : script.name, command: script.command, cwd: script.cwd, from: { nodeId: 'operator', title: 'Operador' }, createdAt });
