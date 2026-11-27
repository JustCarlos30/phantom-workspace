/**
 * Registro persistente taskId -> {workspaceId, ownerNodeId?, parentId?, goal?, via?}.
 * JSON atómico (tmp + rename), acotado a MAX_TASKS con expulsión de las cerradas más antiguas.
 * Nunca inventa dueño: sin ancestro mapeado, resolve() devuelve la entrada sin ownerNodeId.
 */
import fs from 'node:fs';
import path from 'node:path';

export const MAX_TASKS = 5000;
const MAX_DEPTH = 32;
const str = (v, max = 400) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const taskId = str(raw.taskId, 200);
  const workspaceId = str(raw.workspaceId, 200);
  if (!taskId || !workspaceId) return null;
  const e = { taskId, workspaceId };
  for (const [k, max] of [['ownerNodeId', 200], ['parentId', 200], ['goal', 240], ['via', 80]]) {
    const v = str(raw[k], max);
    if (v) e[k] = v;
  }
  if (e.parentId === taskId) delete e.parentId;
  if (Number.isFinite(raw.closedAt)) e.closedAt = raw.closedAt;
  return e;
}

export function createTaskRegistry({ file, now = Date.now } = {}) {
  const tasks = new Map();

  if (file) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const raw of Array.isArray(data?.tasks) ? data.tasks : []) {
        const e = normalize(raw);
        if (e) tasks.set(e.taskId, e);
      }
    } catch { /* sin archivo o corrupto: registro vacío */ }
  }

  function persist() {
    if (!file) return;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, tasks: [...tasks.values()] }));
    fs.renameSync(tmp, file);
  }

  function evict() {
    while (tasks.size > MAX_TASKS) {
      let victim = null;
      for (const e of tasks.values()) {
        if (e.closedAt !== undefined && (!victim || e.closedAt < victim.closedAt)) victim = e;
      }
      victim ??= tasks.values().next().value;
      tasks.delete(victim.taskId);
    }
  }

  function remember(input) {
    const next = normalize(input);
    if (!next) return null;
    const prev = tasks.get(next.taskId);
    const merged = { ...(prev ?? {}), ...next };
    delete merged.closedAt;
    tasks.delete(next.taskId);
    tasks.set(next.taskId, merged);
    evict();
    persist();
    return { ...merged };
  }

  const get = (taskId) => {
    const e = tasks.get(taskId);
    return e ? { ...e } : null;
  };

  function resolve(taskId) {
    const e = tasks.get(taskId);
    if (!e) return null;
    const out = { ...e };
    if (out.ownerNodeId) return out;
    const seen = new Set([taskId]);
    let parentId = e.parentId;
    for (let i = 0; parentId && i < MAX_DEPTH && !seen.has(parentId); i += 1) {
      seen.add(parentId);
      const p = tasks.get(parentId);
      if (!p) break;
      if (p.ownerNodeId) {
        out.ownerNodeId = p.ownerNodeId;
        out.workspaceId = p.workspaceId;
        break;
      }
      parentId = p.parentId;
    }
    return out;
  }

  function close(taskId) {
    const e = tasks.get(taskId);
    if (!e) return false;
    e.closedAt = now();
    persist();
    return true;
  }

  const list = ({ workspaceId } = {}) =>
    [...tasks.values()].filter((e) => !workspaceId || e.workspaceId === workspaceId).map((e) => ({ ...e }));

  return { remember, get, resolve, close, list };
}
