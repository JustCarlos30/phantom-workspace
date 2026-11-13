import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { assert, object, text, canonicalFolder } from './store.mjs';
import { mergeAgentConfig, terminalPolicy } from './agent-policy.mjs';
import { git, guardState, installGuard, removeGuard, mergeToken, roleEnv, roleOf, integrationPolicy } from './merge-guard.mjs';
import { checksFor, runChecks, validateChecks } from './checks.mjs';

// Incorporaciones: workers request integration of their terminal branch and the
// orchestrator session decides order and merges, one request at a time. The
// queue lives in workspace.integration; Git facts are read on demand.
const OPEN = ['queued', 'merging', 'conflict', 'failed'];
const AGENT_CLI = fileURLToPath(new URL('../scripts/agent.mjs', import.meta.url));
const now = () => new Date().toISOString();
const line = (value, label, max) => { text(value, label, max); assert(!/[\x00-\x1f\x7f]/.test(value), `${label} debe ser una sola línea`); return value.trim(); };
const count = value => value ? value.split('\n').length : 0;

export class Merges {
  constructor({ store, terminals, mutate, emit }) {
    Object.assign(this, { store, terminals, mutate, emit });
    this.running = new Set(); this.bases = new Map();
    // A merge cannot outlive the host: Git either finished it or left it for the next attempt.
    let interrupted = false;
    for (const w of store.state.workspaces) for (const item of w.integration?.queue ?? []) if (item.status === 'merging') { item.status = 'queued'; interrupted = true; }
    if (interrupted) store.persist();
  }
  of(w) { return w.integration ?? { enabled: false, plan: '', queue: [] }; }
  // Mutations re-resolve the workspace: earlier awaits may have let other writes land.
  change(workspaceId, fn) {
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

  async status(w, requestId) {
    const integration = this.of(w), orchestratorNode = w.nodes.find(n => n.type === 'terminal' && n.data?.role === 'orchestrator');
    const live = id => this.terminals.sessions.some(s => s.nodeId === id && s.status === 'running');
    const result = {
      available: false, enabled: integration.enabled, plan: integration.plan ?? '', planUpdatedAt: integration.planUpdatedAt ?? null,
      guard: { installed: false }, orchestrator: orchestratorNode ? { nodeId: orchestratorNode.id, title: orchestratorNode.title, running: live(orchestratorNode.id) } : null,
      active: [], queue: [], history: [], observedAt: now(),
    };
    let base;
    try { base = await this.base(w); } catch (error) { return { ...result, reason: error.message }; }
    const { source } = base;
    const [guard, dirty] = await Promise.all([guardState(source), git(source, ['status', '--porcelain', '--untracked-files=no']).then(count, () => null)]);
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
    const attention = { id: randomUUID(), title: `${item.title}: ${step}`.slice(0, 512), source: 'incorporaciones', ref: item.id, nodeId: item.nodeId, createdAt: now(), observedAt: now() };
    w.attention.push(attention); if (w.attention.length > 1000) w.attention.shift();
    queueMicrotask(() => this.emit({ type: 'attention.new', workspaceId: w.id, item: attention }));
  }

  async handle(method, p) {
    if (method === 'merge.status') return this.status(this.store.getWorkspace(p.workspaceId), p.requestId);
    if (method === 'merge.configure') {
      const w = this.store.getWorkspace(p.workspaceId);
      assert(p.enabled === undefined || typeof p.enabled === 'boolean', 'Invalid enabled'); assert(p.enabled !== undefined || p.checks !== undefined, 'Nada que configurar');
      // checks: a command, '' for none, or null to detect it from the project.
      const checks = p.checks === undefined ? undefined : validateChecks(p.checks);
      const { source } = await this.base(w);
      if (p.enabled === true) await installGuard(source, this.store.dir, w.id); else if (p.enabled === false) await removeGuard(source);
      this.change(w.id, integration => { if (p.enabled !== undefined) integration.enabled = p.enabled; if (checks === null) delete integration.checks; else if (checks !== undefined) integration.checks = checks; });
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
      return this.change(w.id, (integration, current) => {
        let item = integration.queue.find(item => item.nodeId === node.id && OPEN.includes(item.status));
        assert(item?.status !== 'merging', 'Esta solicitud se está incorporando ahora mismo.');
        const cardId = node.data.agent?.cardId || '';
        if (item) { delete item.conflicts; delete item.checks; Object.assign(item, { headOid, cardId, summary: summary || item.summary, status: 'queued', updatedAt: now() }); }
        else { item = { id: randomUUID(), nodeId: node.id, title: node.title, branch, cardId, summary, note: '', status: 'queued', headOid, base: base.branch, requestedAt: now(), updatedAt: now() }; integration.queue.push(item); }
        if (integration.queue.length > 500) integration.queue.splice(integration.queue.findIndex(item => !OPEN.includes(item.status)), 1);
        const target = current.nodes.find(n => n.id === node.id);
        target.data.agent = { ...target.data.agent, step: (summary || 'Listo para incorporar').slice(0, 1000), status: 'review', source: 'agent', updatedAt: now() };
        return { ...item, position: integration.queue.filter(item => OPEN.includes(item.status)).indexOf(item) + 1 };
      });
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
    assert(!this.running.has(w.id), 'Ya hay una incorporación en curso en este proyecto.');
    this.running.add(w.id);
    try {
      const base = await this.base(w), { source } = base;
      const id = this.item(this.of(this.store.getWorkspace(w.id)), p.id, ['queued']).id;
      assert(!await git(source, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).catch(() => ''), 'El checkout del proyecto tiene un merge sin terminar. Termínalo o abórtalo antes de incorporar.');
      const command = p.checks === false ? '' : checksFor(this.store.getWorkspace(w.id), source);
      if (command) assert(!await git(source, ['status', '--porcelain', '--untracked-files=no']), `El checkout de ${base.branch} tiene cambios sin commitear; los checks no serían fiables.`);
      const queued = this.change(w.id, integration => Object.assign(this.item(integration, id, ['queued']), { status: 'merging', base: base.branch, updatedAt: now() }));
      const env = { PHANTOM_MERGE_TOKEN: mergeToken(this.store.dir, w.id) };
      try {
        await git(source, ['cat-file', '-e', `${queued.headOid}^{commit}`]);
        await git(source, ['merge', '--no-ff', '--no-edit', '-m', `Incorporar ${queued.title} (${queued.branch})`, queued.headOid], { env, timeout: 180000 });
      } catch (error) {
        const conflicts = (await git(source, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split('\n').filter(Boolean);
        if (await git(source, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).catch(() => '')) await git(source, ['merge', '--abort'], { env });
        if (!conflicts.length) {
          // Not a content conflict (dirty checkout, hook, identity…): the request stays queued.
          this.change(w.id, integration => Object.assign(this.item(integration, id, ['merging']), { status: 'queued', updatedAt: now() }));
          throw new Error(`No se pudo incorporar ${queued.branch} en ${base.branch}: ${error.message}`);
        }
        return this.change(w.id, (integration, current) => {
          const item = Object.assign(this.item(integration, id, ['merging']), { status: 'conflict', conflicts: conflicts.slice(0, 100), updatedAt: now() });
          this.returnToWorker(current, item, `Conflicto al incorporar en ${base.branch} (${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? '…' : ''}). Actualiza tu rama desde ${base.branch}, resuelve y vuelve a enviar.`);
          return item;
        });
      }
      let checkEvidence = null;
      if (command) {
        const checks = await runChecks(source, command);
        checkEvidence = { command, ok: checks.ok, code: checks.code, headOid: queued.headOid, baseOid: base.oid };
        if (!checks.ok) {
          // The merge does not stay; the worker gets the failing output.
          await git(source, ['reset', '--keep', base.oid], { env });
          return this.change(w.id, (integration, current) => {
            const item = Object.assign(this.item(integration, id, ['merging']), { status: 'failed', checks: { command, ok: checks.ok, code: checks.code, headOid: queued.headOid, baseOid: base.oid }, note: `Checks fallidos (${command}, código ${checks.code}${checks.timedOut ? ', tiempo agotado' : ''})`.slice(0, 1000), updatedAt: now() });
            this.returnToWorker(current, item, `Los checks fallaron tras incorporar en ${base.branch} (${command}). Corrígelo en tu rama y vuelve a enviar.`);
            return { ...item, checks };
          });
        }
      }
      const mergedOid = await git(source, ['rev-parse', 'HEAD']);
      return this.change(w.id, (integration, current) => {
        const item = Object.assign(this.item(integration, id, ['merging']), { status: 'merged', mergedOid, checks: checkEvidence, finishedAt: now(), updatedAt: now() });
        // The request is settled: its terminal no longer waits for review.
        const node = current.nodes.find(n => n.id === item.nodeId);
        if (node) node.data.agent = { ...node.data.agent, step: `Incorporada en ${base.branch}`, status: 'idle', source: 'agent', updatedAt: now() };
        return item;
      });
    } finally { this.running.delete(w.id); }
  }
}
