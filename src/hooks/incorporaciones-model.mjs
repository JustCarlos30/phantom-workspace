import { relativeTime } from './repo-graph.mjs';

// Cola: groups what merge.status reports into the questions the
// panel answers at a glance. The host owns the facts; this only sorts them.
//   attention — requests returned to their terminal (conflict, failed checks)
//   ready     — branches that can be merged: queued requests in order, then
//               clean branches with commits nobody has requested yet
//   working   — terminals still editing or without commits to integrate
//   history   — requests already closed
const RETURNED = ['conflict', 'failed'];

const duration = ms => !Number.isFinite(ms) || ms < 0 ? '—' : ms < 60000 ? `${Math.floor(ms / 1000)} s` : ms < 3600000 ? `${Math.floor(ms / 60000)} min` : `${Math.round(ms / 360000) / 10} h`;

export function buildResumen(data, now = Date.now()) {
  const stats = data?.stats ?? {}, queued = (data?.queue ?? []).filter(item => item.status === 'queued');
  const waits = queued.map(item => now - Date.parse(item.requestedAt)).filter(Number.isFinite);
  return [
    { label: 'En cola', value: String(stats.queued ?? queued.length) },
    { label: 'Espera más antigua', value: duration(stats.oldestWaitMs ?? (waits.length ? Math.max(...waits) : null)) },
    { label: 'Integradas hoy', value: stats.mergedToday == null ? '—' : `${stats.mergedToday} · ${stats.filesToday ?? 0} archivos` },
    { label: 'Devueltas', value: String(stats.returned ?? (data?.queue ?? []).filter(item => RETURNED.includes(item.status)).length) },
    { label: 'Tests típicos', value: duration(stats.medianChecksMs) },
    { label: 'Espera típica', value: duration(stats.medianWaitMs) },
  ];
}

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

// What a branch still lacks before it lands in the base. The same steps for
// every branch, so two rows can be compared by eye:
//   Guardada → Al día → (Tests) → En main
// `missing` lists what is left in the order it has to happen and `owner` says
// whose move it is: the branch's session, the orchestrator, or you.
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const fileName = file => String(file).split('/').pop();

export function mergePath(item, { base = 'main', checks = '', orchestrator = true, auto = false } = {}) {
  const submitted = Boolean(item?.id), status = item?.status;
  const ids = ['saved', 'current', ...(checks ? ['tests'] : []), 'landed'];
  const labels = { saved: 'Guardada', current: 'Al día', tests: 'Tests', landed: `En ${base}` };
  const done = new Set(), missing = [], notes = [];
  let failed = null, owner = 'session';
  if (submitted) {
    done.add('saved');
    if (status === 'conflict') {
      failed = 'current';
      missing.push(`Resolver el conflicto${item.conflicts?.length ? ` en ${item.conflicts.slice(0, 3).join(', ')}${item.conflicts.length > 3 ? '…' : ''}` : ''}`, `Poner la rama al día con ${base} y volver a enviarla`);
    } else if (status === 'failed') {
      done.add('current'); failed = checks ? 'tests' : 'landed';
      missing.push('Corregir los tests', 'Volver a enviarla a la cola');
    } else if (status === 'merged') {
      for (const id of ids) done.add(id);
      owner = 'none';
    } else if (status === 'merging') {
      done.add('current'); owner = auto ? 'phantom' : 'orchestrator';
      missing.push(checks ? `Pasar los tests y entrar en ${base}` : `Entrar en ${base}`);
    } else if (status === 'queued') {
      done.add('current'); owner = auto ? 'phantom' : orchestrator ? 'orchestrator' : 'you';
      if (!auto && !orchestrator) missing.push('Abrir el orquestador');
      missing.push(`Que ${auto ? 'Phantom' : 'el orquestador'} la integre${item.position ? ` · turno ${item.position}` : ''}`);
      if (item.stale) notes.push('La rama avanzó después de enviarla: se integrará lo enviado');
    } else {
      owner = 'none';
      missing.push(status === 'rejected' ? 'Rechazada por el orquestador' : status === 'withdrawn' ? 'Retirada por su sesión' : 'Sin datos');
    }
  } else if (item?.missing) {
    missing.push('Git no encuentra la rama');
  } else {
    const ahead = item?.ahead ?? 0, uncommitted = item?.uncommitted ?? 0;
    if (ahead > 0 && uncommitted === 0) done.add('saved');
    if (done.has('saved') && !item?.behind) done.add('current');
    if (status === 'blocked') { owner = 'you'; missing.push(`Desbloquear al agente${item.step ? `: ${item.step}` : ''}`); }
    else if (status === 'working') missing.push('Que el agente termine');
    if (uncommitted > 0) missing.push(`Guardar ${plural(uncommitted, 'archivo', 'archivos')}`);
    else if (!ahead) missing.push('Guardar el primer cambio');
    missing.push('Enviarla a la cola');
    if (item?.running === false) notes.push('Su sesión está en pausa');
  }
  if (item?.behind > 0 && status !== 'merged') notes.push(`Le faltan ${plural(item.behind, 'commit', 'commits')} de ${base}`);
  if (item?.overlaps?.length) notes.push(`Comparte ${plural(item.overlaps.length, 'archivo', 'archivos')} con ${[...new Set(item.overlaps.flatMap(o => o.with))].join(', ')}`);
  let current = false;
  const steps = ids.map(id => {
    const state = failed === id ? 'fail' : done.has(id) ? 'done' : !failed && !current ? 'now' : 'todo';
    if (state === 'now') current = true;
    return { id, label: labels[id], state };
  });
  return { steps, missing, notes, owner, done: steps.filter(step => step.state === 'done').length, total: steps.length };
}

const OWNER = { phantom: 'Depende de Phantom', session: 'Depende de su sesión', terminal: 'Depende de su sesión', orchestrator: 'Depende del orquestador', you: 'Depende de ti', none: '' };
export const ownerLabel = owner => OWNER[owner] ?? '';

// Board labels use the same seven branch states as Ramas; `blocked` is the
// agent's state, not the branch's.
const BRANCH_STATE = {
  conflict: ['Conflicto', 'danger'], failed: ['Tests fallaron', 'danger'], blocked: ['Bloqueada', 'danger'],
  merging: ['Integrando', 'working'], queued: ['En cola', 'muted'], ready: ['Lista', 'success'],
  working: ['Trabajando', 'working'], review: ['Lista', 'success'], unsaved: ['Sin guardar', 'attention'], idle: ['Trabajando', 'working'],
};
// Every branch that is not yet in the base, most urgent first: returned
// requests, the one being merged, the queue in its order, clean branches
// nobody requested, and finally work still in progress.
export function buildBranchBoard(data) {
  if (data?.available !== true) return { base: '', rows: [], counts: { total: 0, attention: 0, queued: 0, ready: 0, working: 0 } };
  const model = buildIncorporaciones(data), base = data.base?.branch || 'main';
  const options = { base, checks: data.checks?.command || '', orchestrator: Boolean(data.orchestrator), auto: data.auto };
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
    ...model.working.filter(item => item.status !== 'blocked').map(item => row(item, item.status === 'working' ? 'working' : item.uncommitted > 0 ? 'unsaved' : BRANCH_STATE[item.status] ? item.status : 'idle')),
  ];
  return { base, rows, counts: { total: rows.length, attention: model.attention.length + blocked.length, queued: model.queued.length + (model.merging ? 1 : 0), ready: model.unrequested.length, working: model.working.length - blocked.length } };
}

// The Cola tab: what is being integrated now, what follows in order, and what
// came back to its session. Branches nobody sent belong to Ramas, not here.
const COLA = {
  merging: ['Integrando', 'working'], queued: ['En cola', 'neutral'], conflict: ['Conflicto', 'danger'], failed: ['Tests fallaron', 'danger'],
  merged: ['En main', 'neutral'], rejected: ['Rechazada', 'danger'], withdrawn: ['Retirada', 'neutral'],
};
export function buildCola(data, now = Date.now()) {
  const model = buildIncorporaciones(data), base = data?.base?.branch || 'main';
  const row = (item, detail) => {
    const [label, tone] = COLA[item.status] ?? ['Sin datos', 'neutral'];
    return { key: item.id, item, state: item.status, label: item.status === 'merged' ? `En ${base}` : label, tone, detail };
  };
  const size = item => item.fileCount != null ? plural(item.fileCount, 'archivo', 'archivos') : '';
  const returned = item => item.status === 'failed' ? `Los tests fallaron${Number.isFinite(item.checks?.code) ? ` · código ${item.checks.code}` : ''}${item.checks?.timedOut ? ' · tiempo agotado' : ''}`
    : item.conflicts?.length ? `${fileName(item.conflicts[0])}${item.conflicts.length > 1 ? ` y ${item.conflicts.length - 1} más chocan` : ' choca'} con ${base}` : `Choca con ${base}`;
  const closedAt = item => item.finishedAt || item.updatedAt || item.requestedAt;
  const day = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toDateString(); };
  const closed = model.history.map(item => ({ ...row(item, [item.status === 'rejected' && item.note, size(item), Number.isFinite(item.checks?.durationMs) && `Tests ${duration(item.checks.durationMs)}`, item.by === 'auto' ? 'Automática' : item.by === 'orchestrator' ? 'Orquestador' : '', relativeTime(closedAt(item), now)].filter(Boolean).join(' · ')), today: day(closedAt(item)) === day(now) }));
  const who = data?.auto ? 'Phantom' : 'El orquestador';
  const title = model.merging ? `${who} está integrando «${model.merging.title}»`
    : data?.auto ? model.queued.length ? `${plural(model.queued.length, 'rama', 'ramas')} en cola; se integran solas` : 'Phantom está en espera'
    : !data?.orchestrator ? 'Sin orquestador abierto'
    : model.queued.length ? `El orquestador tiene ${plural(model.queued.length, 'rama', 'ramas')} en cola` : 'El orquestador está en espera';
  return {
    base, orchestrator: title,
    now: model.merging ? [row(model.merging, `${who} la está integrando`)] : [],
    next: model.queued.map((item, index) => row(item, [`Turno ${index + 1}`, size(item), Number.isFinite(Date.parse(item.requestedAt)) && `Espera ${duration(Math.max(0, now - Date.parse(item.requestedAt)))}`].filter(Boolean).join(' · '))),
    returned: model.attention.map(item => row(item, returned(item))),
    today: closed.filter(item => item.today), earlier: closed.filter(item => !item.today),
    counts: { now: model.merging ? 1 : 0, next: model.queued.length, returned: model.attention.length, open: (model.merging ? 1 : 0) + model.queued.length + model.attention.length },
  };
}
