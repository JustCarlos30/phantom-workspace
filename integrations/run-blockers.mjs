// Pure classification of why a Phantom run stopped. The reason text is DATA: it only
// selects a category; commands come from our own templates plus a validated task ID.
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const DEFAULT_MAX_TOKENS = 500000;

export function amendedMaxTokens(current) {
  return Number.isFinite(current) && current > 0 ? Math.ceil(current * 1.5) : DEFAULT_MAX_TOKENS;
}

export const DEFAULT_MAX_TURNS = 150;
export function amendedMaxTurns(current) {
  return Number.isFinite(current) && current > 0 ? Math.ceil(current * 1.5) : Math.ceil(DEFAULT_MAX_TURNS * 1.5);
}

// Which budget dimension a block reason names: 'time' | 'turns' | 'tokens' (default).
export function budgetKind(reason) {
  const text = clean(reason, 2000);
  if (/tiempo|timeout|time budget/i.test(text)) return 'time';
  if (/\bturns?\b|turnos|maxTurns|max_?turns/i.test(text)) return 'turns';
  return 'tokens';
}

// "resets 1:50pm (America/Mexico_City)" -> next ISO instant; only when the zone is stated and known.
export function parseRetryAt(text, now = Date.now()) {
  const match = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b[^()\n]{0,20}\(\s*([A-Za-z_]+\/[A-Za-z_]+)\s*\)/i.exec(text);
  if (!match || match[4] !== 'America/Mexico_City') return undefined;
  let hour = Number(match[1]); const minute = Number(match[2] ?? 0), pm = match[3].toLowerCase() === 'pm';
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  hour = (hour % 12) + (pm ? 12 : 0);
  // Mexico City has been a fixed UTC-6 since 2022.
  const offset = 6 * 3600000, local = new Date(now - offset);
  let at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) + offset;
  if (at <= now) at += 86400000;
  return new Date(at).toISOString();
}

const RULES = [
  { test: /PHANTOM_GATE_REFUSED[^\n]*presupuesto|presupuesto|budget (?:exceeded|exhausted)|max_?(?:tokens|turns)|maxTokens|maxTurns|límite de (?:tokens|turnos|tiempo)|tiempo (?:agotado|excedido)/i, category: 'budget' },
  { test: /5-hour limit|hit your .{0,30}limit|rate.?limit|usage limit|too many requests/i, category: 'rate_limit' },
  { test: /PHANTOM_GATE_REFUSED|policy_changed|git_dirty|\bdirty\b|fuera de(?:l)? alcance|rutas? protegid|protected path/i, category: 'policy' },
  { test: /pruebas suficientes|minNewPassedTests|EISDIR|directorios? en (?:el )?scope|\bsnapshot\b|Los checks modificaron|regresi[oó]n previa/i, category: 'contract' },
  { test: /verificaci[oó]n fallida|margen de reparaci[oó]n|reparaciones? agotad/i, category: 'verification' },
  { test: /no hay un cambio atribuible/i, category: 'no_change' },
  { test: /APIError|modelo no soportado|motor no soportado|unsupported model|model[^\n]{0,40}not supported|not supported[^\n]{0,40}model/i, category: 'engine' },
];

export function classifyBlocker(reason, task, now = Date.now()) {
  const text = clean(reason, 2000);
  const id = typeof task?.id === 'string' && TASK_ID.test(task.id) ? task.id : null;
  const rule = RULES.find(item => item.test.test(text));
  const category = rule?.category ?? 'unknown';
  const inspect = id ? [`phantom show ${id}`, `phantom events ${id}`] : [];
  const out = ({ autonomy, summary, remedy, commands = [], retryAt }) => ({ category, autonomy, summary: clean(summary, 300), remedy: clean(remedy, 400), commands: commands.map(c => clean(c, 300)).slice(0, 4), ...(retryAt ? { retryAt, retryAtMs: Date.parse(retryAt) } : {}) });
  if (category === 'budget') {
    const budget = task?.contract?.budget ?? task?.raw?.contract?.budget;
    const kind = budgetKind(text);
    if (kind === 'time') return { ...out({ autonomy: 'orchestrator', summary: 'El run agotó su presupuesto de tiempo.',
      remedy: 'amend no admite el tiempo: crea un contrato nuevo con más timeoutMs y cancela el encargo bloqueado.', commands: inspect }), category: 'contract' };
    if (kind === 'turns') return out({ autonomy: 'ask_user', summary: 'El run agotó su presupuesto de turnos.',
      remedy: 'Pregunta al usuario si autoriza ampliar los turnos; si acepta, ejecuta amend con el motivo y relanza. No amplíes sin su respuesta.',
      commands: id ? [`phantom amend ${id} --max-turns ${amendedMaxTurns(budget?.maxTurns)} --reason "presupuesto de turnos ampliado con aprobación del usuario"`, `agent.mjs run ${id}`] : [] });
    const next = amendedMaxTokens(budget?.maxTokens);
    return out({ autonomy: 'ask_user', summary: 'El run agotó su presupuesto (tokens, turnos o tiempo).',
      remedy: 'Pregunta al usuario si autoriza ampliar el presupuesto; si acepta, ejecuta amend con el motivo y relanza. No amplíes sin su respuesta.',
      commands: id ? [`phantom amend ${id} --max-tokens ${next} --reason "presupuesto ampliado con aprobación del usuario"`, `agent.mjs run ${id}`] : [] });
  }
  if (category === 'rate_limit') {
    const retryAt = parseRetryAt(text, now);
    return out({ autonomy: 'orchestrator', summary: 'El motor alcanzó su límite de uso.', retryAt,
      remedy: retryAt ? `Espera hasta ${retryAt} y relanza el encargo; informa al usuario del retraso.` : 'Espera a que se restablezca el límite y relanza el encargo; informa al usuario del retraso.', commands: inspect.slice(0, 1) });
  }
  if (category === 'contract') return out({ autonomy: 'orchestrator', summary: 'El contrato o sus checks no son ejecutables o no acreditan el cambio.', remedy: 'Lee la evidencia, crea un contrato nuevo corregido (checks, scope o pruebas) y cancela el encargo bloqueado.', commands: inspect });
  if (category === 'verification') return out({ autonomy: 'orchestrator', summary: 'La verificación falló y se agotó el margen de reparación.', remedy: 'Lee la evidencia con show y events; crea un contrato nuevo con más maxRepairs o checks corregidos.', commands: inspect });
  if (category === 'no_change') return out({ autonomy: 'orchestrator', summary: 'El run terminó sin un cambio atribuible.', remedy: 'Revisa qué hizo el agente; reformula el objetivo o el scope en un contrato nuevo.', commands: inspect });
  if (category === 'engine') return out({ autonomy: 'human', summary: 'El motor o modelo no está soportado.', remedy: 'No intentes desbloquearlo: informa al usuario para que elija un modelo o motor válido.', commands: inspect.slice(0, 1) });
  if (category === 'policy') return out({ autonomy: 'human', summary: 'Una guarda o política del harness detuvo el run.', remedy: 'No te saltes la guarda ni modifiques el harness: informa al usuario del bloqueo.', commands: inspect.slice(0, 1) });
  return out({ autonomy: 'human', summary: 'Bloqueo no reconocido.', remedy: 'No intentes desbloquearlo: informa al usuario con el motivo observado.', commands: inspect.slice(0, 1) });
}
