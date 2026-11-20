// «¿Qué pasó? / ¿Qué hago?» para tareas de Phantom que te necesitan. Pura:
// estado nativo + motivo + ejecuciones + controlador → texto y un botón principal.
//   taskHelp({ status, reason, runs, controller, actions }) → { kind, titulo, queOcurrio, queHago, accionPrincipal, acciones } | null
//   kind: 'failed' | 'budget' | 'permission' | 'verification' | 'controller' | 'blocked'
//   acciones[]: { id, label } con id en TASK_ACTIONS; solo las que Phantom admite (`actions` de cardActions).
import { checksExcerpt, checksSummary } from './failure-help.mjs';

export const TASK_ACTIONS = {
  run: 'Reintentar', verify: 'Verificar de nuevo', recover: 'Recuperar', cancel: 'Cancelar',
  replace: 'Preparar reemplazo', session: 'Ir a la sesión',
};

const clip = (text, max) => String(text ?? '').trim().slice(0, max);

// Checks que fallaron en las ejecuciones más recientes (la más nueva primero).
export function failedChecks(runs = [], max = 5) {
  const out = [];
  for (const run of runs) {
    const rounds = [run?.evidence?.baseline, ...(run?.evidence?.verification || [])].filter(Boolean).reverse();
    for (const round of rounds) for (const check of round.checks || []) {
      if (check.passed === false && out.length < max) out.push({ name: check.name || 'Check', summary: checksSummary({ command: Array.isArray(check.argv) ? check.argv.join(' ') : '', code: check.exitCode, timedOut: check.timedOut, durationMs: check.durationMs }), excerpt: checksExcerpt([check.stderr, check.stdout, check.error].filter(value => typeof value === 'string' && value).join('\n'), 40) });
    }
    if (out.length) break;
  }
  return out;
}

function kindOf({ status, reason = '', controller, runs }) {
  const text = String(reason).toLowerCase();
  if (/presupuesto|budget|turnos|maxturns|maxtools|herramientas|tiempo|timeout|tokens/.test(text)) return 'budget';
  if (/permis|denied|denegad|autoriz/.test(text)) return 'permission';
  if (controller?.status === 'lost' || (controller?.status === 'failed' && status !== 'failed')) return 'controller';
  if (/verific/.test(text) || failedChecks(runs, 1).length) return 'verification';
  return status === 'failed' ? 'failed' : 'blocked';
}

const COPY = {
  failed: ['La tarea falló', 'La ejecución terminó con error y Phantom no la dio por buena.', 'Reintenta; si se repite, mira el motivo abajo o prepara un reemplazo con otro contrato.', 'run'],
  budget: ['Se acabó el presupuesto', 'La tarea llegó a un límite (tiempo, turnos o herramientas) antes de terminar.', 'Reintenta con la misma Card o prepara un reemplazo con un presupuesto mayor.', 'replace'],
  permission: ['Falta un permiso', 'El agente necesitó algo que no tiene permitido.', 'Responde en la sesión para darle el permiso o ajusta el alcance en un reemplazo.', 'session'],
  verification: ['Los checks no pasaron', 'El trabajo terminó, pero la verificación de Phantom encontró fallos.', 'Verifica de nuevo si ya lo arreglaste, o reintenta para que el agente lo corrija.', 'verify'],
  controller: ['Se perdió el controlador', 'El proceso que ejecutaba la tarea ya no responde y Phantom no sabe cómo terminó.', 'Recupera la ejecución para que Phantom reconcilie lo que quedó hecho.', 'recover'],
  blocked: ['Phantom la bloqueó', 'Phantom detuvo la tarea y espera una decisión tuya.', 'Reintenta o cancela. Si no sabes por qué, abre Detalles.', 'run'],
};

export function taskHelp({ status, reason = '', runs = [], controller = null, actions = {}, hasSession = false } = {}) {
  if (status !== 'failed' && status !== 'blocked') return null;
  const kind = kindOf({ status, reason, controller, runs });
  const [titulo, queOcurrio, queHago, preferred] = COPY[kind];
  const available = ['run', 'verify', 'recover', 'cancel'].filter(id => actions[id]);
  if (hasSession) available.push('session');
  if (status === 'failed' || kind === 'budget') available.push('replace');
  const ids = [...new Set(available)];
  const main = ids.includes(preferred) ? preferred : ids.find(id => id !== 'cancel') || ids[0];
  const item = id => ({ id, label: TASK_ACTIONS[id] });
  const why = clip(reason, 400);
  return { kind, titulo, queOcurrio: why ? `${queOcurrio} Motivo: ${why}` : queOcurrio, queHago, accionPrincipal: main ? item(main) : null, acciones: ids.map(item) };
}
