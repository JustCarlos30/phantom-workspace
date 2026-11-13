// Incorporaciones: groups what merge.status reports into the questions the
// panel answers at a glance. The host owns the facts; this only sorts them.
//   attention — requests returned to their terminal (conflict, failed checks)
//   ready     — branches that can be merged: queued requests in order, then
//               clean branches with commits nobody has requested yet
//   working   — terminals still editing or without commits to integrate
//   history   — requests already closed
const RETURNED = ['conflict', 'failed'];

// Commits saved, nothing uncommitted, branch readable and no agent mid-edit.
export function isReadyBranch(item) {
  return Boolean(item && !item.missing && item.ahead > 0 && item.uncommitted === 0 && item.status !== 'working' && item.status !== 'blocked');
}

export function buildIncorporaciones(data) {
  const queue = data?.queue ?? [], active = data?.active ?? [], history = data?.history ?? [];
  const merging = queue.find(item => item.status === 'merging') ?? null;
  const queued = queue.filter(item => item.status === 'queued');
  const attention = queue.filter(item => RETURNED.includes(item.status));
  const unrequested = active.filter(isReadyBranch);
  const working = active.filter(item => !isReadyBranch(item));
  const merged = history.filter(item => item.status === 'merged');
  const ready = [...queued.map(item => ({ kind: 'request', item })), ...unrequested.map(item => ({ kind: 'branch', item }))];
  const overlapping = new Set([...queue, ...active].filter(item => item.overlaps?.length).map(item => item.nodeId ?? item.id)).size;
  return {
    merging, queued, attention, unrequested, working, ready, merged, history,
    counts: {
      // Every integration request card that is still open, whatever its state.
      cards: queue.length,
      ready: ready.length,
      queued: queued.length,
      unrequested: unrequested.length,
      attention: attention.length,
      working: working.length,
      merged: merged.length,
      overlapping,
    },
  };
}

// What a branch still lacks before it lands in the base. The same five or six
// steps for every branch, so two rows can be compared by eye:
//   commits → saved → requested → merge → (checks) → in base
// `missing` lists what is left in the order it has to happen and `owner` says
// whose move it is: the branch's terminal, the orchestrator, or you.
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const STEP_LABELS = { commits: 'Commits', saved: 'Guardado', requested: 'Solicitud', merge: 'Merge', checks: 'Checks' };

export function mergePath(item, { base = 'main', checks = '', orchestrator = true } = {}) {
  const submitted = Boolean(item?.id), status = item?.status;
  const ids = ['commits', 'saved', 'requested', 'merge', ...(checks ? ['checks'] : []), 'landed'];
  const done = new Set(), missing = [], notes = [];
  let failed = null, owner = 'terminal';
  if (submitted) {
    for (const id of ['commits', 'saved', 'requested']) done.add(id);
    if (status === 'conflict') {
      failed = 'merge';
      missing.push(`Resolver el conflicto${item.conflicts?.length ? ` en ${item.conflicts.slice(0, 3).join(', ')}${item.conflicts.length > 3 ? '…' : ''}` : ''}`, `Traer ${base} a la rama y volver a enviarla`);
    } else if (status === 'failed') {
      done.add('merge'); failed = checks ? 'checks' : 'merge';
      missing.push(`Corregir los checks${item.checks?.command ? ` (${item.checks.command})` : ''}`, 'Volver a enviar la solicitud');
    } else if (status === 'merged') {
      for (const id of ids) done.add(id);
      owner = 'none';
    } else if (status === 'merging') {
      owner = 'orchestrator';
      missing.push(checks ? 'Terminar el merge y pasar los checks' : 'Terminar el merge');
    } else if (status === 'queued') {
      owner = orchestrator ? 'orchestrator' : 'you';
      if (!orchestrator) missing.push('Abrir la sesión orquestadora');
      missing.push(`Que el orquestador la incorpore${item.position ? ` · turno ${item.position}` : ''}`);
      if (item.stale) notes.push('La rama avanzó después de enviarla: se incorporará el commit enviado');
    } else {
      owner = 'none';
      missing.push(status === 'rejected' ? 'Rechazada por el orquestador' : status === 'withdrawn' ? 'Retirada por su terminal' : 'Estado desconocido');
    }
  } else if (item?.missing) {
    missing.push('Git no encuentra la rama');
  } else {
    const ahead = item?.ahead ?? 0, uncommitted = item?.uncommitted ?? 0;
    if (ahead > 0) done.add('commits');
    if (ahead > 0 && uncommitted === 0) done.add('saved');
    if (status === 'blocked') { owner = 'you'; missing.push(`Desbloquear al agente${item.step ? `: ${item.step}` : ''}`); }
    else if (status === 'working') missing.push('Que el agente termine su trabajo');
    if (uncommitted > 0) missing.push(`Guardar ${plural(uncommitted, 'archivo', 'archivos')} en un commit`);
    else if (!ahead) missing.push('Hacer el primer commit');
    missing.push('Enviar la solicitud de integración');
    if (item?.running === false) notes.push('Su terminal no tiene sesión activa');
  }
  if (item?.behind > 0 && status !== 'merged') notes.push(`${plural(item.behind, 'commit', 'commits')} detrás de ${base}`);
  if (item?.overlaps?.length) notes.push(`Comparte ${plural(item.overlaps.length, 'archivo', 'archivos')} con ${[...new Set(item.overlaps.flatMap(o => o.with))].join(', ')}`);
  let current = false;
  const steps = ids.map(id => {
    const state = failed === id ? 'fail' : done.has(id) ? 'done' : !failed && !current ? 'now' : 'todo';
    if (state === 'now') current = true;
    return { id, label: id === 'landed' ? base : STEP_LABELS[id], state };
  });
  return { steps, missing, notes, owner, done: steps.filter(step => step.state === 'done').length, total: steps.length };
}

const OWNER = { terminal: 'Depende de su terminal', orchestrator: 'Depende del orquestador', you: 'Depende de ti', none: '' };
export const ownerLabel = owner => OWNER[owner] ?? '';

const BRANCH_STATE = {
  conflict: ['Conflicto', 'danger'], failed: ['Checks fallidos', 'danger'], blocked: ['Bloqueada', 'danger'],
  merging: ['Incorporando', 'accent'], queued: ['En cola', 'accent'], ready: ['Sin solicitar', 'success'],
  working: ['Trabajando', 'working'], review: ['Lista para revisión', 'success'], idle: ['En pausa', 'muted'],
};
// Every branch that is not yet in the base, most urgent first: returned
// requests, the one being merged, the queue in its order, clean branches
// nobody requested, and finally work still in progress.
export function buildBranchBoard(data) {
  if (data?.available !== true) return { base: '', rows: [], counts: { total: 0, attention: 0, queued: 0, ready: 0, working: 0 } };
  const model = buildIncorporaciones(data), base = data.base?.branch || 'main';
  const options = { base, checks: data.checks?.command || '', orchestrator: Boolean(data.orchestrator) };
  const row = (item, state) => {
    const [label, tone] = BRANCH_STATE[state] ?? [state, 'muted'];
    return { key: item.id || item.nodeId, item, state, label, tone, path: mergePath(item, options) };
  };
  const blocked = model.working.filter(item => item.status === 'blocked');
  const rows = [
    ...model.attention.map(item => row(item, item.status)),
    ...blocked.map(item => row(item, 'blocked')),
    ...(model.merging ? [row(model.merging, 'merging')] : []),
    ...model.queued.map(item => row(item, 'queued')),
    ...model.unrequested.map(item => row(item, 'ready')),
    ...model.working.filter(item => item.status !== 'blocked').map(item => row(item, BRANCH_STATE[item.status] ? item.status : 'idle')),
  ];
  return { base, rows, counts: { total: rows.length, attention: model.attention.length + blocked.length, queued: model.queued.length + (model.merging ? 1 : 0), ready: model.unrequested.length, working: model.working.length - blocked.length } };
}
