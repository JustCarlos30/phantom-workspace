import os from 'node:os';
import { assert, object } from './store.mjs';
import { Chats } from './chats.mjs';

// workspace.mobile.snapshot: bounded, read-only view of the nodes an external
// gateway already authorized. The caller supplies only identifiers; every fact
// comes from the host's live stores. This socket does not authenticate phones:
// the gateway must derive nodeIds from the device grants.
export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_LIMITS = Object.freeze({ nodeIds: 64, pending: 50, attention: 50, text: 200, title: 120 });

const KEYS = ['workspaceId', 'nodeIds'];
const DENIED = 'Nodo no autorizado o no disponible en este proyecto';
const ROOTS = /(?:\/(?:home|Users|root|tmp|var|etc|opt|mnt|usr|run|srv)\/[^\s'"`)\]]*)/g;

function cleaner(roots) {
  const known = [...new Set(roots.filter(v => typeof v === 'string' && v.length > 3))].sort((a, b) => b.length - a.length);
  return (value, max = SNAPSHOT_LIMITS.text) => {
    let out = String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
    for (const root of known) out = out.split(root).join('[ruta]');
    return out.replace(ROOTS, '[ruta]').replace(/\s+/g, ' ').trim().slice(0, max);
  };
}

function validateRequest(p) {
  object(p);
  for (const key of Object.keys(p)) assert(KEYS.includes(key), `Campo no admitido: ${key}`);
  assert(typeof p.workspaceId === 'string' && p.workspaceId && p.workspaceId.length <= 200, 'workspaceId requerido');
  assert(Array.isArray(p.nodeIds), 'nodeIds debe ser un array explícito (vacío no significa todos)');
  assert(p.nodeIds.length <= SNAPSHOT_LIMITS.nodeIds, `nodeIds admite como máximo ${SNAPSHOT_LIMITS.nodeIds} nodos`);
  for (const id of p.nodeIds) assert(typeof id === 'string' && id && id.length <= 200, 'nodeIds solo admite identificadores de texto');
  return [...new Set(p.nodeIds)];
}

export function createMobileProject({ store, terminals, chats, now = () => Date.now() }) {
  function sessionOf(workspace, node) {
    const id = node.data?.sessionId;
    return id ? terminals.sessions.find(s => s.id === id && s.nodeId === node.id && s.workspaceId === workspace.id) ?? null : null;
  }
  // Only what the host observes: never "completed" from an idle process.
  function agentState({ node, session, chatInfo, pending }) {
    const reported = node.data?.agent ?? null, base = { reportedStatus: reported?.status ?? null, source: reported?.source ?? null, updatedAt: reported?.updatedAt ?? null };
    if (chatInfo) {
      let state = 'idle';
      if (pending.some(p => p.kind === 'permission')) state = 'awaiting_approval';
      else if (pending.some(p => p.kind === 'question')) state = 'awaiting_input';
      else if (chatInfo.running) state = 'working';
      return { state, ...base, observedAt: null };
    }
    if (!session) return { state: 'none', ...base, observedAt: null };
    if (session.status !== 'running') return { state: session.status === 'exited' ? 'exited' : 'lost', ...base, observedAt: null };
    const d = terminals.descriptor(session);
    if (['working', 'awaiting_approval', 'awaiting_input'].includes(d.screenState)) return { state: d.screenState, ...base, observedAt: d.screenStateAt ?? null };
    if (['working', 'blocked', 'review'].includes(reported?.status) && reported.source === 'agent') return { state: reported.status, ...base, observedAt: reported.updatedAt ?? null };
    return { state: 'idle', ...base, observedAt: null };
  }

  function snapshot(params) {
    const nodeIds = validateRequest(params);
    const w = store.getWorkspace(params.workspaceId), mainId = Chats.mainId(w), observed = now();
    const nodes = nodeIds.map(id => {
      if (id === mainId) return chats.mainNode(w);
      const node = w.nodes.find(n => n.id === id && n.type === 'terminal');
      assert(node, DENIED);
      return node;
    });
    const clean = cleaner([w.canonicalPath, w.path, os.homedir(), store.dir, ...nodes.map(n => n.data?.cwd)]);
    const pending = [], sessions = [], tasks = [], authorizedSessions = new Map();
    let pendingTruncated = false;
    for (const node of nodes) {
      const session = sessionOf(w, node), main = node.id === mainId, provider = node.data?.chat?.provider ?? null;
      const chatInfo = main || provider ? { running: chats.running(node.id), provider } : null;
      for (const s of terminals.sessions) if (s.nodeId === node.id && s.workspaceId === w.id) authorizedSessions.set(s.id, node.id);
      const mine = [];
      if (chatInfo) for (const { part } of chats.turns.get(node.id)?.pending?.values() ?? []) {
        if (part.status !== 'pending') continue;
        const item = part.type === 'permission'
          ? { kind: 'permission', id: part.id, nodeId: node.id, sessionId: session?.id ?? null, summary: clean(`Permiso: ${part.tool}`), ...(part.danger ? { danger: true } : {}) }
          : part.type === 'question'
            ? { kind: 'question', id: part.id, nodeId: node.id, sessionId: session?.id ?? null, summary: clean(part.questions?.[0]?.question ?? 'Pregunta del agente'), questionCount: part.questions?.length ?? 1 }
            : null;
        if (!item) continue;
        mine.push(item);
        if (pending.length < SNAPSHOT_LIMITS.pending) pending.push(item); else pendingTruncated = true;
      }
      const agent = agentState({ node, session, chatInfo, pending: mine });
      const run = node.data?.agent?.run;
      sessions.push({
        nodeId: node.id,
        kind: main ? 'main' : chatInfo ? 'chat' : 'terminal',
        title: clean(node.title, SNAPSHOT_LIMITS.title),
        hidden: node.data?.hidden === true,
        process: session ? { state: session.status, ...(session.status === 'exited' && Number.isInteger(session.exitCode) ? { exitCode: session.exitCode } : {}) } : { state: 'none' },
        ...(chatInfo ? { chat: { provider: chatInfo.provider, running: chatInfo.running } } : {}),
        agent: { ...agent, ...(run ? { run: { phase: run.phase, stalled: run.stalled === true } } : {}) },
        pendingCount: mine.length,
        target: { workspaceId: w.id, nodeId: node.id, sessionId: session?.id ?? null },
      });
      const card = node.data?.agent;
      if (card?.cardId) tasks.push({ id: clean(card.cardId, 200), title: clean(card.cardTitle ?? '', SNAPSHOT_LIMITS.title), nodeId: node.id, via: 'agent.cardId' });
    }
    const wanted = new Set(nodes.map(n => n.id));
    const related = (w.attention ?? []).filter(item => (typeof item.nodeId === 'string' && wanted.has(item.nodeId)) || (typeof item.sessionId === 'string' && authorizedSessions.has(item.sessionId)));
    const ordered = related.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const attention = ordered.slice(0, SNAPSHOT_LIMITS.attention).map(item => {
      const nodeId = wanted.has(item.nodeId) ? item.nodeId : authorizedSessions.get(item.sessionId);
      return { id: String(item.id).slice(0, 200), title: clean(item.title), source: clean(item.source, 60), createdAt: item.createdAt ?? null, acknowledged: Boolean(item.acknowledgedAt), nodeId, sessionId: typeof item.sessionId === 'string' && authorizedSessions.has(item.sessionId) ? item.sessionId : null };
    });
    return {
      version: SNAPSHOT_VERSION,
      observedAt: new Date(observed).toISOString(),
      project: { id: w.id, name: clean(w.name, SNAPSHOT_LIMITS.title) },
      limits: { ...SNAPSHOT_LIMITS },
      sessions,
      pending,
      attention,
      tasks,
      truncated: { pending: pendingTruncated, attention: ordered.length > attention.length },
    };
  }
  return { snapshot };
}
