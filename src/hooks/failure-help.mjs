// «¿Qué pasó? / ¿Qué hago?» para lo que se atasca al integrar. Función pura:
// un elemento de la cola (merge.status) o una fila de Ramas (branch.overview)
// entra; sale el texto y las acciones, o null si no hay nada que arreglar.
// API estable (también la usa Trabajo):
//   failureHelp(entry, { base, hasSession, queue }) → { kind, titulo, queOcurrio, queHago, accionPrincipal, acciones } | null
//   kind: 'checks' | 'conflict' | 'behind' | 'unsaved' | 'returned' | 'error'
//   accionPrincipal / acciones[]: { id, label }; ids en ACTIONS.
//   checksExcerpt(output, max) · agentFixPrompt(entry, { base }) · duration/fileList helpers.
// Una fila de Ramas puede llevar `checks` (resultado de branch.integrate) y `request: 'failed'`.
export const ACTIONS = {
  retry: base => 'Reintentar',
  withdraw: () => 'Sacar de la cola',
  update: base => `Poner al día con ${base}`,
  resolve: () => 'Resolver conflictos en su copia',
  terminal: () => 'Abrir terminal en su copia',
  copy: () => 'Copiar comando',
  ask: () => 'Pedir al agente que lo arregle',
  session: () => 'Ir a la sesión',
  save: () => 'Guardar cambios',
  abort: () => 'Abortar',
};

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const names = (files, more = 3) => `${files.slice(0, more).join(', ')}${files.length > more ? ` y ${files.length - more} más` : ''}`;
const clip = (text, max) => String(text ?? '').trim().slice(0, max);

export function checksExcerpt(output, max = 40) {
  const all = String(output ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n');
  while (all.length && !all[all.length - 1].trim()) all.pop();
  const cut = all.length > max;
  return { text: all.slice(-max).join('\n'), lines: Math.min(all.length, max), total: all.length, truncated: cut };
}

const elapsed = ms => !Number.isFinite(ms) ? '' : ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60000)} min`;

export function checksSummary(checks) {
  if (!checks) return '';
  const { command, code, timedOut, durationMs } = checks;
  const how = timedOut ? `se agotó el tiempo${elapsed(durationMs) ? ` (${elapsed(durationMs)})` : ''}` : `terminó con código ${code ?? '?'}`;
  return `${command ? `«${command}» ` : 'El comando de tests '}${how}`;
}

// What the agent is told when asked to fix it: command, code, tail of the output, files.
export function agentFixPrompt(entry, { base = 'main' } = {}) {
  const help = failureHelp(entry, { base });
  if (!help) return '';
  const checks = entry?.checks, files = entry?.conflicts ?? [], parts = [`Tu rama no pudo integrarse en ${base}: ${help.titulo.toLowerCase()}.`];
  if (help.kind === 'checks' && checks) {
    parts.push(`Comando: ${checks.command || '(sin comando)'}`, `Código de salida: ${checks.code ?? '?'}${checks.timedOut ? ' (tiempo agotado)' : ''}`);
    const out = checksExcerpt(checks.output, 40);
    if (out.text) parts.push(`Últimas líneas de la salida:\n${out.text}`);
  } else if (help.kind === 'conflict') parts.push(`Archivos en conflicto: ${files.length ? files.join(', ') : '(sin lista)'}`, `Trae lo último de ${base} a tu rama, resuelve los conflictos.`);
  else if (entry?.note) parts.push(clip(entry.note, 500));
  parts.push('Corrígelo, comprueba que pasa y vuelve a enviarla a la cola.');
  return parts.join('\n');
}

// Which problem is it? Most blocking first.
function kindOf(entry) {
  const status = entry.status ?? entry.request, checks = entry.checks;
  if (status === 'rejected') return 'returned';
  if (entry.failure === 'error' || (entry.error && !entry.failure && !status)) return 'error';
  if (entry.failure === 'checks' || status === 'failed' || (checks && checks.ok === false)) return 'checks';
  if (status === 'conflict' || entry.failure === 'conflict' || entry.conflicts?.length) return 'conflict';
  if (entry.failure === 'stale' || status === 'stale') return 'behind';
  if (entry.error) return 'error';
  if (status === 'queued' || status === 'merging' || status === 'merged') return null;
  const unsaved = entry.changeCount ?? entry.uncommitted ?? 0;
  if (unsaved > 0) return 'unsaved';
  if (entry.ahead > 0 && entry.behind > 0 && !entry.isBase) return 'behind';
  return null;
}

export function failureHelp(entry, { base = entry?.base || 'main', hasSession = false, queue = Boolean(entry?.id) } = {}) {
  if (!entry) return null;
  const kind = kindOf(entry);
  if (!kind) return null;
  const files = entry.conflicts ?? [];
  const make = (titulo, queOcurrio, queHago, order, primary) => {
    const ids = [...new Set(order)].filter(id => (id !== 'ask' && id !== 'session' || hasSession) && (id !== 'retry' && id !== 'withdraw' || queue));
    const item = id => ({ id, label: ACTIONS[id](base) });
    const main = ids.includes(primary) ? primary : ids[0];
    return { kind, titulo, queOcurrio, queHago, accionPrincipal: main ? item(main) : null, acciones: ids.map(item) };
  };
  const live = entry.running === true || entry.terminal?.running === true;
  if (kind === 'checks') {
    const checks = entry.checks;
    return make(checks?.timedOut ? 'Los tests tardaron demasiado' : 'Los tests fallaron',
      checks ? `${checksSummary(checks)}.` : clip(entry.note, 300) || 'Los tests no pasaron al integrar la rama.',
      `Arregla lo que falla en su copia y vuelve a enviarla. ${base} no cambió.`,
      ['ask', 'terminal', 'retry', 'withdraw', 'session'], hasSession ? 'ask' : 'terminal');
  }
  if (kind === 'conflict') {
    return make(`Choca con ${base}`,
      files.length ? `${count(files.length, 'archivo cambió', 'archivos cambiaron')} en ${base} y en la rama: ${names(files)}.` : `La rama y ${base} cambiaron lo mismo.`,
      `Trae lo último de ${base} a su copia y resuelve los conflictos${hasSession ? ', o pídeselo al agente' : ''}.`,
      ['ask', ...(live ? [] : ['resolve']), 'update', 'terminal', 'retry', 'withdraw', 'session'], hasSession ? 'ask' : live ? 'terminal' : 'resolve');
  }
  if (kind === 'behind') {
    return make(`Le falta lo último de ${base}`,
      entry.behind > 0 ? `${base} tiene ${count(entry.behind, 'cambio nuevo', 'cambios nuevos')} que la rama no tiene.` : `${base} avanzó después de enviarla.`,
      'Ponla al día y vuelve a enviarla. Si choca, te lo diré.',
      ['update', 'resolve', 'terminal', 'retry', 'session'], 'update');
  }
  if (kind === 'unsaved') {
    const n = entry.changeCount ?? entry.uncommitted ?? 0;
    return make('Hay cambios sin guardar',
      `${count(n, 'archivo está', 'archivos están')} sin guardar en su copia; sin guardar no se pueden integrar.`,
      'Guárdalos para poder integrar la rama.',
      ['save', 'terminal', 'session'], 'save');
  }
  if (kind === 'returned') {
    return make('El orquestador la devolvió',
      clip(entry.note, 400) || 'El orquestador la rechazó sin dar motivo.',
      'Corrige lo que pide y vuelve a enviarla, o sácala de la cola.',
      ['ask', 'retry', 'withdraw', 'session'], hasSession ? 'ask' : 'withdraw');
  }
  return make('Git dio un error',
    clip(entry.error || entry.note, 400) || 'Git no pudo leer o integrar la rama.',
    'Inténtalo otra vez. Si se repite, mira la copia de la rama en una terminal.',
    ['retry', 'terminal', 'withdraw', 'session'], queue ? 'retry' : 'terminal');
}
