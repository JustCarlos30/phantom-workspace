import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { assert, object, text, canonicalFolder, pushAttention } from './store.mjs';
import { mergeAgentConfig, terminalPolicy } from './agent-policy.mjs';
import { git, guardState, installGuard, removeGuard, mergeToken, roleEnv, roleOf, integrationPolicy } from './merge-guard.mjs';
import { checksFor, runChecks, validateChecks } from './checks.mjs';

// Incorporaciones: requests integrate one at a time, automatically or by the
// orchestrator. The queue lives in workspace.integration; Git facts are read on demand.
const OPEN = ['queued', 'merging', 'conflict', 'failed'];
const AGENT_CLI = fileURLToPath(new URL('../scripts/agent.mjs', import.meta.url));
const now = () => new Date().toISOString();
const line = (value, label, max) => { text(value, label, max); assert(!/[\x00-\x1f\x7f]/.test(value), `${label} debe ser una sola línea`); return value.trim(); };
const count = value => value ? value.split('\n').length : 0;

export const IMMUTABLE_TTL = 10 * 60 * 1000;

export class GitPolling {
  constructor(execute = git) { this.entries = new Map(); this.active = 0; this.waiters = []; this.execute = execute; }
  invalidate() { this.entries.clear(); }
  read(key, fn, ttl = 2000) {
    const previous = this.entries.get(key);
    if (previous && (previous.pending || previous.until > Date.now())) return previous.promise;
    const entry = { pending: true, until: 0 };
    entry.promise = Promise.resolve().then(fn).then(value => {
      entry.pending = false; entry.until = Date.now() + ttl;
      if (!ttl && this.entries.get(key) === entry) this.entries.delete(key);
      return value;
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    for (const [id, item] of this.entries) if (!item.pending && item.until <= Date.now()) this.entries.delete(id);
    return entry.promise;
  }
  async limit(fn) {
    if (this.active >= 8) await new Promise(resolve => this.waiters.push(resolve));
    else this.active++;
    try { return await fn(); }
    finally { const next = this.waiters.shift(); if (next) next(); else this.active--; }
  }
  git(cwd, args) {
    // Only immutable object queries survive a poll; checkout and file facts stay fresh.
    const command = args[0] === '--literal-pathspecs' ? args[1] : args[0];
    const immutable = ['rev-list', 'diff', 'merge-tree', 'ls-tree'].includes(command) && args.some(arg => /^[0-9a-f]{40,64}(?:\.\.\.?[0-9a-f]{40,64})?$/.test(arg));
    // Keyed by object ids, these never change: keep them across polls (host mutations still clear them).
    return this.read(JSON.stringify(['git', cwd, args]), () => this.limit(() => this.execute(cwd, args)), immutable ? IMMUTABLE_TTL : 0);
  }
}

const CLOSED_LIMIT = 60;
// Keeps every open item and only the most recent closed ones; returns true when something was dropped.
export function pruneIntegrationQueue(integration) {
  const queue = integration?.queue;
  if (!Array.isArray(queue)) return false;
  const stamp = item => Date.parse(item.finishedAt ?? item.updatedAt) || 0;
  const closed = queue.filter(item => !OPEN.includes(item.status));
  if (closed.length <= CLOSED_LIMIT) return false;
  const keep = new Set(closed.sort((a, b) => stamp(b) - stamp(a)).slice(0, CLOSED_LIMIT));
  integration.queue = queue.filter(item => OPEN.includes(item.status) || keep.has(item));
  return true;
}

export class Merges {
  constructor({ store, terminals, mutate, emit }) {
    Object.assign(this, { store, terminals, mutate, emit });
    this.running = new Set(); this.bases = new Map(); this.draining = new Set();
    this.polling = new GitPolling();
    // A merge cannot outlive the host: Git either finished it or left it for the next attempt.
    let interrupted = false;
    for (const w of store.state.workspaces) for (const item of w.integration?.queue ?? []) if (item.status === 'merging') { item.status = 'queued'; interrupted = true; }
    for (const w of store.state.workspaces) interrupted = pruneIntegrationQueue(w.integration) || interrupted;
    if (interrupted) store.persist();
  }
  of(w) { return w.integration ?? { enabled: false, plan: '', queue: [] }; }
  // Mutations re-resolve the workspace: earlier awaits may have let other writes land.
  change(workspaceId, fn) {
    this.polling.invalidate();
    return this.mutate(workspaceId, () => {
      const w = this.store.getWorkspace(workspaceId);
      w.integration = { plan: '', ...this.of(w) };
      return fn(w.integration, w);
    });
  }
  async base(w) {
    const source = canonicalFolder(w.canonicalPath || w.path);
    let branch;
    try { branch = await git(source, ['symbolic-ref', '-q', '--short', 'HEAD']); }
    catch (error) {
      if (/not a git repository/i.test(error.message)) throw new Error('La carpeta del proyecto no es un repositorio Git.');
      throw new Error('El checkout del proyecto no está en una rama (HEAD separado). Cambia a la rama de integración.');
    }
    const oid = await git(source, ['rev-parse', '--verify', 'HEAD^{commit}']).catch(() => { throw new Error('El repositorio todavía no tiene commits.'); });
    this.bases.set(w.id, branch);
    return { source, branch, oid };
  }
  baseName(w) { return this.base(w).then(base => base.branch); }

  // What a chat turn needs to act under its role: the same identity a PTY of the
  // card gets (agent CLI, session, guard environment) plus its instructions.
  agentContext(w, node) {
    const session = node.data.sessionId, branch = node.data.worktree?.branch ?? null;
    const env = {
      ...roleEnv({ stateDir: this.store.dir, workspace: w, node, branch }),
      PHANTOM_WORKSPACE_SOCKET: path.join(this.store.dir, 'host.sock'), PHANTOM_AGENT_CLI: AGENT_CLI, PHANTOM_AGENT_NODE: process.execPath,
      ...(session ? { PHANTOM_TERMINAL_SESSION_ID: session } : {}),
    };
    // Every chat turn carries the Phantom registration policy, whatever the
    // provider; Incorporaciones adds the card's role when it is on.
    const integration = w.integration?.enabled && session ? { role: roleOf(node), base: this.bases.get(w.id) ?? null } : null;
    const instructions = terminalPolicy({ workspaceId: w.id, nodeId: node.id, sessionId: session ?? null, cwd: node.data.cwd ?? node.data.worktree?.path ?? w.canonicalPath ?? w.path, branch, integration });
    // OpenCode takes instructions as files named in its inline config; Claude takes the text.
    try {
      const file = path.join(this.store.dir, 'merge-guard', `${node.id}.md`);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, instructions, { mode: 0o600 });
      env.OPENCODE_CONFIG_CONTENT = mergeAgentConfig(process.env.OPENCODE_CONFIG_CONTENT, file);
    } catch { /* An unusable inherited config must not block the turn; the guard still applies. */ }
    return { env, instructions };
  }

  status(w, requestId) {
    const key = JSON.stringify(['merge.status', w, requestId, this.terminals.sessions.map(({ nodeId, status }) => [nodeId, status])]);
    return this.polling.read(key, () => this.readStatus(w, requestId), 0);
  }
  async readStatus(w, requestId) {
    const git = (cwd, args) => this.polling.git(cwd, args);
    const integration = this.of(w), orchestratorNode = w.nodes.find(n => n.type === 'terminal' && n.data?.role === 'orchestrator');
    const merged = integration.queue.filter(item => item.status === 'merged'), recent = [...merged].sort((a, b) => (Date.parse(a.finishedAt) || 0) - (Date.parse(b.finishedAt) || 0)).slice(-30);
    const median = values => { values = values.filter(Number.isFinite).sort((a, b) => a - b); const n = values.length; return n ? (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2 : null; };
    const waits = integration.queue.filter(item => item.status === 'queued').map(item => Date.now() - Date.parse(item.requestedAt)).filter(Number.isFinite);
    const today = merged.filter(item => new Date(item.finishedAt).toDateString() === new Date().toDateString());
    const live = id => this.terminals.sessions.some(s => s.nodeId === id && s.status === 'running');
    const result = {
      auto: integration.auto ?? false, ...(integration.autoBlocked ? { autoBlocked: integration.autoBlocked } : {}),
      stats: { queued: integration.queue.filter(item => item.status === 'queued').length, returned: integration.queue.filter(item => ['conflict', 'failed'].includes(item.status)).length, oldestWaitMs: waits.length ? Math.max(0, ...waits) : null, mergedToday: today.length, filesToday: today.reduce((sum, item) => sum + (item.fileCount ?? 0), 0), mergedTotal: merged.length, medianWaitMs: median(recent.map(item => Date.parse(item.startedAt) - Date.parse(item.requestedAt))), medianChecksMs: median(recent.map(item => item.checks?.durationMs)), autoMerged: recent.filter(item => item.by === 'auto').length },
      available: false, enabled: integration.enabled, plan: integration.plan ?? '', planUpdatedAt: integration.planUpdatedAt ?? null,
      guard: { installed: false }, orchestrator: orchestratorNode ? { nodeId: orchestratorNode.id, title: orchestratorNode.title, running: live(orchestratorNode.id) } : null,
      active: [], queue: [], history: [], observedAt: now(),
    };
    let base;
    try { base = await this.base(w); } catch (error) { return { ...result, reason: error.message }; }
    const { source } = base;
    const [guard, dirty] = await Promise.all([this.polling.limit(() => guardState(source)), git(source, ['status', '--porcelain', '--untracked-files=no']).then(count, () => null)]);
    const terminals = w.nodes.filter(n => n.type === 'terminal' && n.data?.worktree?.branch && n.data.role !== 'orchestrator').slice(0, 80);
    const facts = new Map(await Promise.all(terminals.map(async node => {
      const { branch, path: tree } = node.data.worktree;
      try {
        const head = await git(source, ['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`]);
        const [behind, ahead] = (await git(source, ['rev-list', '--left-right', '--count', `${base.oid}...${head}`])).split(/\s+/).map(Number);
        const files = ahead ? (await git(source, ['diff', '--name-only', `${base.oid}...${head}`])).split('\n').filter(Boolean) : [];
        const uncommitted = fs.existsSync(tree) ? await git(tree, ['status', '--porcelain']).then(count, () => null) : null;
        return [node.id, { head, ahead, behind, files, uncommitted }];
      } catch { return [node.id, null]; }
    })));
    const open = integration.queue.filter(item => OPEN.includes(item.status));
    // Files touched by more than one unmerged branch: where the order of integration matters.
    const touching = new Map();
    for (const node of terminals) for (const file of facts.get(node.id)?.files ?? []) touching.set(file, [...(touching.get(file) ?? []), node]);
    const overlapsOf = node => (facts.get(node.id)?.files ?? []).filter(file => touching.get(file).length > 1).slice(0, 25)
      .map(file => ({ path: file, with: touching.get(file).filter(other => other.id !== node.id).map(other => other.title) }));
    const describe = node => {
      const fact = facts.get(node.id), agent = node.data.agent ?? {};
      return {
        nodeId: node.id, title: node.title, branch: node.data.worktree.branch, running: live(node.id), missing: !fact,
        ahead: fact?.ahead ?? null, behind: fact?.behind ?? null, uncommitted: fact?.uncommitted ?? null,
        files: fact?.files.slice(0, 200) ?? [], fileCount: fact?.files.length ?? 0, overlaps: overlapsOf(node),
        step: agent.step ?? '', status: agent.status ?? 'idle', cardId: agent.cardId || '', cardTitle: agent.cardTitle ?? '',
      };
    };
    result.queue = await Promise.all(open.map(async (item, index) => {
      const fact = facts.get(item.nodeId);
      // Inspect the immutable submitted commit, never the worker's later HEAD.
      let inspection;
      try {
        assert(/^[0-9a-f]{40,64}$/.test(item.headOid), 'Commit enviado inválido');
        const range = `${base.oid}...${item.headOid}`;
        const names = (await git(source, ['diff', '--name-only', '-z', range])).split('\0').filter(Boolean);
        const [behind, ahead] = (await git(source, ['rev-list', '--left-right', '--count', `${base.oid}...${item.headOid}`])).split(/\s+/).map(Number);
        inspection = { available: true, headOid: item.headOid, baseOid: base.oid, files: names.slice(0, 200), fileCount: names.length, behind, ahead };
        if (requestId === item.id) {
          try {
            const diff = await git(source, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', range]);
            inspection.diff = diff.slice(0, 64000); inspection.diffTruncated = diff.length > 64000;
          } catch (error) { inspection.diffError = error.message; }
        }
      } catch (error) { inspection = { available: false, headOid: item.headOid, baseOid: base.oid, reason: error.message }; }
      const overlaps = (inspection.files || []).filter(file => touching.has(file) && touching.get(file).some(other => other.id !== item.nodeId))
        .slice(0, 25).map(file => ({ path: file, with: touching.get(file).filter(other => other.id !== item.nodeId).map(other => other.title) }));
      // Legacy requests without a captured Card ID remain unknown even if the terminal is rebound.
      return { ...item, position: index + 1, stale: fact ? fact.head !== item.headOid : null, inspection, files: inspection.files || [], fileCount: inspection.fileCount ?? null, overlaps, behind: inspection.behind ?? null };
    }));
    const requested = new Set(open.map(item => item.nodeId));
    // Work not yet requested: commits or edits to integrate, or a live agent that declared what it is doing.
    result.active = terminals.filter(node => !requested.has(node.id)).map(describe).filter(item => item.ahead || item.uncommitted || (item.running && ['working', 'blocked'].includes(item.status)));
    result.history = integration.queue.filter(item => !OPEN.includes(item.status)).slice(-30).reverse();
    return { ...result, available: true, guard, base: { branch: base.branch, oid: base.oid, uncommitted: dirty }, checks: { command: checksFor(w, source), configured: typeof integration.checks === 'string' } };
  }

  // The current session of a terminal node. Chat cards keep it after the PTY is gone.
  session(sessionId) {
    const session = this.terminals.get(text(sessionId, 'session ID', 128)), w = this.store.getWorkspace(session.workspaceId), node = w.nodes.find(n => n.id === session.nodeId);
    assert(node?.type === 'terminal' && node.data.sessionId === session.id, 'Esta sesión ya no es la sesión vigente de su terminal; abre una sesión nueva.');
    assert(this.of(w).enabled, 'Incorporaciones no está activo en este proyecto.');
    return { session, w, node };
  }
  orchestrator(p) {
    // The project's Phantom conversation integrates for the user without a
    // terminal session: it proves the role with the project's merge token.
    if (p.sessionId === undefined && p.workspaceId !== undefined) {
      const w = this.store.getWorkspace(text(p.workspaceId, 'workspace ID', 128));
      assert(this.of(w).enabled, 'Incorporaciones no está activo en este proyecto.');
      assert(typeof p.token === 'string' && p.token === mergeToken(this.store.dir, w.id), 'Solo la sesión orquestadora puede ordenar, incorporar o rechazar.');
      return { w };
    }
    const found = this.session(p.sessionId);
    assert(roleOf(found.node) === 'orchestrator' && p.token === mergeToken(this.store.dir, found.w.id), 'Solo la sesión orquestadora puede ordenar, incorporar o rechazar.');
    return found;
  }
  item(integration, id, statuses) {
    const item = integration.queue.find(item => item.id === id || (typeof id === 'string' && id.length >= 6 && item.id.startsWith(id)));
    assert(item, 'Solicitud de incorporación no encontrada');
    assert(statuses.includes(item.status), `La solicitud está en estado «${item.status}»; se esperaba ${statuses.join(' o ')}.`);
    return item;
  }
  // Tell the worker through its declared step, and the user through attention.
  returnToWorker(w, item, step) {
    const node = w.nodes.find(n => n.id === item.nodeId);
    if (node) node.data.agent = { ...node.data.agent, step: step.replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, 1000), status: 'blocked', source: 'agent', updatedAt: now() };
    this.notice(w, item, item.status === 'rejected' ? 'rejected' : item.failure, step);
  }
  // Attention for the user, deduplicated by eventKey so an automatic retry does not repeat it. Never touches the worker.
  notice(w, item, failure, step) {
    const eventKey = `merge:${item.id}:${failure}:${item.headOid}`;
    if (w.attention.some(a => a.eventKey === eventKey)) return;
    const attention = { id: randomUUID(), title: `${item.title}: ${step}`.slice(0, 512), source: 'incorporaciones', ref: item.id, nodeId: item.nodeId, failure, branch: item.branch, eventKey, createdAt: now(), observedAt: now() };
    if (failure === 'conflict') attention.conflicts = (item.conflicts || []).slice(0, 3);
    pushAttention(w, attention);
    queueMicrotask(() => this.emit({ type: 'attention.new', workspaceId: w.id, item: attention }));
  }
  // The problem is in the project checkout: warn the user, the request stays queued.
  checkoutNotice(workspaceId, requestId, failure, step) {
    try {
      this.change(workspaceId, (integration, current) => {
        const item = integration.queue.find(item => item.id === requestId);
        if (item) this.notice(current, item, failure, step);
      });
    } catch { /* Workspace may have been removed. */ }
  }

  async handle(method, p) {
    if (['merge.status', 'merge.queue'].includes(method)) return this.act(method, p);
    this.polling.invalidate();
    try { return await this.act(method, p); }
    finally { this.polling.invalidate(); }
  }
  async act(method, p) {
    if (method === 'merge.status') return this.status(this.store.getWorkspace(p.workspaceId), p.requestId);
    if (method === 'merge.configure') {
      const w = this.store.getWorkspace(p.workspaceId);
      assert(p.enabled === undefined || typeof p.enabled === 'boolean', 'Invalid enabled'); assert(p.auto === undefined || typeof p.auto === 'boolean', 'Invalid auto'); assert(p.enabled !== undefined || p.checks !== undefined || p.auto !== undefined, 'Nada que configurar');
      // checks: a command, '' for none, or null to detect it from the project.
      const checks = p.checks === undefined ? undefined : validateChecks(p.checks);
      const { source } = await this.base(w);
      if (p.enabled === true) await installGuard(source, this.store.dir, w.id); else if (p.enabled === false) await removeGuard(source);
      this.change(w.id, integration => { delete integration.autoBlocked; if (p.auto !== undefined) integration.auto = p.auto; if (p.enabled !== undefined) integration.enabled = p.enabled; if (checks === null) delete integration.checks; else if (checks !== undefined) integration.checks = checks; });
      void this.drain(w.id);
      return this.status(this.store.getWorkspace(w.id));
    }
    if (method === 'merge.queue') {
      const { w, node, session } = this.session(p.sessionId);
      return { self: { nodeId: node.id, role: roleOf(node), branch: session.worktree?.branch ?? null }, ...await this.status(w) };
    }
    if (method === 'merge.submit') {
      const { session, w, node } = this.session(p.sessionId);
      assert(roleOf(node) === 'worker', 'La sesión orquestadora no solicita incorporaciones; las ejecuta.');
      const branch = session.worktree?.branch; assert(branch, 'Esta terminal no tiene worktree ni rama propia.');
      const summary = p.summary === undefined ? '' : line(p.summary, 'resumen', 500);
      const base = await this.base(w);
      assert(await git(session.cwd, ['symbolic-ref', '-q', '--short', 'HEAD']).catch(() => '') === branch, `El worktree ya no está en su rama ${branch}.`);
      assert(!await git(session.cwd, ['status', '--porcelain']), 'Hay cambios sin commitear en este worktree. Haz commit (o descártalos) antes de solicitar la incorporación.');
      const headOid = await git(session.cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
      assert(Number(await git(base.source, ['rev-list', '--count', `${base.oid}..${headOid}`])) > 0, `Esta rama no tiene commits nuevos respecto a ${base.branch}.`);
      // A request must already contain the current base: the worker pulls it in and resolves here, never the orchestrator.
      const upToDate = await git(base.source, ['merge-base', '--is-ancestor', base.oid, headOid]).then(() => true, () => false);
      assert(upToDate, `Esta rama no incluye lo último de ${base.branch}. Ejecuta \`git merge ${base.branch}\` en este worktree, resuelve, vuelve a pasar las comprobaciones y solicita de nuevo.`);
      const submitted = this.change(w.id, (integration, current) => {
        let item = integration.queue.find(item => item.nodeId === node.id && OPEN.includes(item.status));
        assert(item?.status !== 'merging', 'Esta solicitud se está incorporando ahora mismo.');
        const cardId = node.data.agent?.cardId || '';
        if (item) { delete item.conflicts; delete item.checks; delete item.failure; delete item.error; Object.assign(item, { headOid, cardId, summary: summary || item.summary, status: 'queued', updatedAt: now() }); }
        else { item = { id: randomUUID(), nodeId: node.id, title: node.title, branch, cardId, summary, note: '', status: 'queued', headOid, base: base.branch, requestedAt: now(), updatedAt: now() }; integration.queue.push(item); }
        pruneIntegrationQueue(integration);
        const target = current.nodes.find(n => n.id === node.id);
        target.data.agent = { ...target.data.agent, step: (summary || 'Listo para incorporar').slice(0, 1000), status: 'review', source: 'agent', updatedAt: now() };
        return { ...item, position: integration.queue.filter(item => OPEN.includes(item.status)).indexOf(item) + 1 };
      });
      void this.drain(w.id);
      return submitted;
    }
    // Operator (renderer) actions: no session, addressed by workspace and item id; the orchestrator still integrates.
    if (method === 'merge.withdraw' && p.sessionId === undefined) {
      const w = this.store.getWorkspace(text(p.workspaceId, 'workspace ID', 128)); assert(this.of(w).enabled, 'Incorporaciones no está activo en este proyecto.');
      return this.change(w.id, integration => Object.assign(this.item(integration, p.id, ['queued', 'failed', 'conflict', 'rejected', 'stale']), { status: 'withdrawn', by: 'operator', finishedAt: now(), updatedAt: now() }));
    }
    if (method === 'merge.retry') {
      const w = this.store.getWorkspace(text(p.workspaceId, 'workspace ID', 128)); assert(this.of(w).enabled, 'Incorporaciones no está activo en este proyecto.');
      const item = this.change(w.id, integration => {
        const item = this.item(integration, p.id, ['failed', 'conflict', 'stale']);
        for (const key of ['conflicts', 'checks', 'failure', 'error']) delete item[key];
        return Object.assign(item, { status: 'queued', by: 'operator', updatedAt: now() });
      });
      void this.drain(w.id);
      return item;
    }
    if (method === 'merge.withdraw') {
      const { w, node } = this.session(p.sessionId);
      return this.change(w.id, integration => {
        const item = integration.queue.find(item => item.nodeId === node.id && ['queued', 'conflict', 'failed'].includes(item.status));
        assert(item, 'Esta terminal no tiene una solicitud pendiente.');
        return Object.assign(item, { status: 'withdrawn', finishedAt: now(), updatedAt: now() });
      });
    }
    if (method === 'merge.plan') {
      const { w } = this.orchestrator(p); text(p.text, 'plan', 4000);
      return this.change(w.id, integration => { integration.plan = p.text.trim(); integration.planUpdatedAt = now(); return { plan: integration.plan }; });
    }
    if (method === 'merge.order') {
      const { w } = this.orchestrator(p); assert(Array.isArray(p.ids) && p.ids.length && p.ids.length <= 500, 'Indica al menos un ID');
      return this.change(w.id, integration => {
        const first = p.ids.map(id => this.item(integration, id, OPEN));
        assert(new Set(first).size === first.length, 'IDs repetidos');
        integration.queue = [...first, ...integration.queue.filter(item => !first.includes(item))];
        return integration.queue.filter(item => OPEN.includes(item.status)).map((item, index) => ({ position: index + 1, id: item.id, title: item.title, status: item.status }));
      });
    }
    if (method === 'merge.note') {
      const { w } = this.orchestrator(p); const note = line(p.text, 'nota', 1000);
      return this.change(w.id, integration => Object.assign(this.item(integration, p.id, OPEN), { note, updatedAt: now() }));
    }
    if (method === 'merge.reject') {
      const { w } = this.orchestrator(p); const reason = line(p.reason, 'motivo', 1000); assert(reason, 'Indica el motivo del rechazo');
      return this.change(w.id, (integration, current) => {
        const item = Object.assign(this.item(integration, p.id, ['queued', 'conflict', 'failed']), { status: 'rejected', note: reason, finishedAt: now(), updatedAt: now() });
        this.returnToWorker(current, item, `Incorporación rechazada: ${reason}`);
        return item;
      });
    }
    if (method === 'merge.run') return this.run(p);
    throw new Error(`Unknown method: ${method}`);
  }

  async run(p) {
    const { w } = this.orchestrator(p);
    return this.execute(w, p.id, { checks: p.checks, by: 'orchestrator' });
  }

  resume() { for (const w of this.store.state.workspaces) void this.drain(w.id); }

  async drain(workspaceId) {
    if (this.draining.has(workspaceId) || this.running.has(workspaceId)) return;
    this.draining.add(workspaceId);
    try {
      while (true) {
        const w = this.store.getWorkspace(workspaceId), integration = this.of(w);
        if (!integration.enabled || !integration.auto || integration.autoBlocked || this.running.has(workspaceId)) break;
        const item = integration.queue.find(item => item.status === 'queued');
        if (!item) break;
        await this.execute(w, item.id, { by: 'auto' });
      }
    } catch (error) {
      try { this.change(workspaceId, integration => { integration.autoBlocked = { reason: error.message, at: now() }; }); } catch { /* Workspace may have been removed. */ }
    } finally { this.draining.delete(workspaceId); }
  }

  async execute(w, requestId, { checks, by }) {
    assert(!this.running.has(w.id), 'Ya hay una incorporación en curso en este proyecto.');
    this.running.add(w.id);
    try {
      const base = await this.base(w), { source } = base;
      const id = this.item(this.of(this.store.getWorkspace(w.id)), requestId, ['queued']).id;
      const precheck = (ok, message) => { if (!ok) { this.checkoutNotice(w.id, id, 'error', message); assert(false, message); } };
      precheck(!await git(source, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).catch(() => ''), 'El checkout del proyecto tiene un merge sin terminar. Termínalo o abórtalo antes de incorporar.');
      const command = checks === false ? '' : checksFor(this.store.getWorkspace(w.id), source);
      if (command) precheck(!await git(source, ['status', '--porcelain', '--untracked-files=no']), `El checkout de ${base.branch} tiene cambios sin commitear; los checks no serían fiables.`);
      const queued = this.change(w.id, integration => { const item = this.item(integration, id, ['queued']); delete item.failure; delete item.error; return Object.assign(item, { status: 'merging', startedAt: now(), by, base: base.branch, updatedAt: now() }); });
      const env = { PHANTOM_MERGE_TOKEN: mergeToken(this.store.dir, w.id) };
      if (!await git(source, ['cat-file', '-e', `${queued.headOid}^{commit}`]).then(() => true, () => false)) {
        this.change(w.id, (integration, current) => {
          const item = Object.assign(this.item(integration, id, ['merging']), { status: 'queued', failure: 'stale', error: `El commit enviado (${queued.headOid.slice(0, 8)}) ya no existe en el repositorio.`, updatedAt: now() });
          this.notice(current, item, 'stale', item.error);
        });
        throw new Error(`El commit enviado por ${queued.branch} ya no existe; vuelve a solicitar la incorporación.`);
      }
      try {
        await git(source, ['merge', '--no-ff', '--no-edit', '-m', `Incorporar ${queued.title} (${queued.branch})`, queued.headOid], { env, timeout: 180000 });
      } catch (error) {
        const conflicts = (await git(source, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split('\n').filter(Boolean);
        if (await git(source, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).catch(() => '')) await git(source, ['merge', '--abort'], { env });
        if (!conflicts.length) {
          // Not a content conflict (dirty checkout, hook, identity…): the request stays queued.
          this.change(w.id, (integration, current) => {
            const item = Object.assign(this.item(integration, id, ['merging']), { status: 'queued', failure: 'error', error: error.message.slice(0, 1000), updatedAt: now() });
            this.notice(current, item, 'error', `No se pudo iniciar el merge en ${base.branch}: ${error.message.split('\n')[0]}`.slice(0, 400));
          });
          throw new Error(`No se pudo incorporar ${queued.branch} en ${base.branch}: ${error.message}`);
        }
        return this.change(w.id, (integration, current) => {
          const item = Object.assign(this.item(integration, id, ['merging']), { status: 'conflict', failure: 'conflict', conflicts: conflicts.slice(0, 100), updatedAt: now() });
          this.returnToWorker(current, item, `Conflicto al incorporar en ${base.branch} (${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? '…' : ''}). Actualiza tu rama desde ${base.branch}, resuelve y vuelve a enviar.`);
          return item;
        });
      }
      let checkEvidence = null;
      if (command) {
        const checks = await runChecks(source, command);
        checkEvidence = { command, ok: checks.ok, code: checks.code, durationMs: checks.durationMs, headOid: queued.headOid, baseOid: base.oid };
        if (!checks.ok) {
          // The merge does not stay; the worker gets the failing output.
          await git(source, ['reset', '--keep', base.oid], { env });
          const failed = { ...checkEvidence, timedOut: checks.timedOut, output: String(checks.output ?? '').slice(-8000) };
          return this.change(w.id, (integration, current) => {
            const item = Object.assign(this.item(integration, id, ['merging']), { status: 'failed', failure: 'checks', checks: failed, note: `Checks fallidos (${command}, código ${checks.code}${checks.timedOut ? ', tiempo agotado' : ''})`.slice(0, 1000), updatedAt: now() });
            this.returnToWorker(current, item, `Los checks fallaron tras incorporar en ${base.branch} (${command}). Corrígelo en tu rama y vuelve a enviar.`);
            return { ...item, checks };
          });
        }
      }
      const mergedOid = await git(source, ['rev-parse', 'HEAD']);
      const fileCount = (await git(source, ['diff', '--name-only', '-z', `${base.oid}..${mergedOid}`])).split('\0').filter(Boolean).length;
      return this.change(w.id, (integration, current) => {
        delete integration.autoBlocked;
        const item = Object.assign(this.item(integration, id, ['merging']), { status: 'merged', mergedOid, fileCount, checks: checkEvidence, finishedAt: now(), updatedAt: now() });
        // The request is settled: its terminal no longer waits for review.
        const node = current.nodes.find(n => n.id === item.nodeId);
        if (node) node.data.agent = { ...node.data.agent, step: `Incorporada en ${base.branch}`, status: 'idle', source: 'agent', updatedAt: now() };
        return item;
      });
    } catch (error) {
      this.change(w.id, integration => {
        const item = integration.queue.find(item => item.id === requestId && item.status === 'merging');
        if (item) Object.assign(item, { status: 'queued', updatedAt: now() });
        if (integration.auto) integration.autoBlocked = { reason: error.message, at: now() };
      });
      throw error;
    } finally { this.polling.invalidate(); this.running.delete(w.id); if (!this.draining.has(w.id)) void this.drain(w.id); }
  }
}
