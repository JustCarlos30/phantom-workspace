import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { POLICY_HINTS, agentShims, bootstrapAgentPolicy, mergeAgentConfig, shimmedPath, terminalPolicy } from '../host/agent-policy.mjs';
import { Merges } from '../host/merges.mjs';
import { providerArgs } from '../host/chats.mjs';
import { agentContext } from '../host/agents.mjs';
import { createHost, phantomInstructions } from '../host/server.mjs';
import { main as agentCLI } from '../scripts/agent.mjs';
import { handleIntegration } from '../integrations/index.mjs';
import { CLAUDE_CLIENT, DEFAULT_HARNESS_MODEL, assertClaudeClient, assertContractClaudeOnly, claudeModelCatalog, contractModels, describeExecution, isClaudeModel, resolveHarnessModel } from '../shared/execution-policy.mjs';

test('las reglas de admisión de contrato aparecen en terminalPolicy y phantomInstructions', () => {
  const base = { workspaceId: 'w', nodeId: 'n', cwd: '/tmp/x', branch: 'b' };
  for (const sessionId of ['s1', undefined]) {
    const text = terminalPolicy({ ...base, sessionId });
    assert.ok(text.includes('minNewPassedTests'));
    assert.ok(text.includes('exact files, never directories'));
    assert.ok(text.includes(POLICY_HINTS.contract));
  }
  assert.ok(phantomInstructions({ name: 'p', canonicalPath: '/tmp/p', nodes: [] }).includes(POLICY_HINTS.contract));
});

test('la política incluye la regla de corte paralelo exactamente una vez', () => {
  const texts = [
    terminalPolicy({ workspaceId: 'w', nodeId: 'n', cwd: '/tree' }),
    phantomInstructions({ name: 'Project', canonicalPath: '/project' }),
  ];
  for (const text of texts) assert.equal(text.split(POLICY_HINTS.parallel).length - 1, 1);
  for (const needle of ['coordination.maxConcurrency', 'disjoint files', '`dependencies`']) assert.ok(POLICY_HINTS.parallel.includes(needle));
});

function temporary(t, cleanup = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-policy-test-'));
  if (cleanup) t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function inlineConfig(t, value) {
  const old = process.env.OPENCODE_CONFIG_CONTENT;
  process.env.OPENCODE_CONFIG_CONTENT = value;
  const restore = () => {
    if (old === undefined) delete process.env.OPENCODE_CONFIG_CONTENT;
    else process.env.OPENCODE_CONFIG_CONTENT = old;
  };
  t.after(restore);
  return restore;
}

async function until(fn) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for bootstrap PTY observation');
}

test('central Claude Code policy: defaults, aliases, rejection of other engines, contract walk and provenance', () => {
  assert.equal(DEFAULT_HARNESS_MODEL, 'claude-code/sonnet'); assert.equal(CLAUDE_CLIENT, 'claude');
  assert.deepEqual(resolveHarnessModel(undefined, '', null), { model: 'claude-code/sonnet', source: 'default' });
  assert.deepEqual(resolveHarnessModel('', { model: 'opus' }), { model: 'claude-code/opus', source: 'contract' });
  assert.deepEqual(resolveHarnessModel('claude-code/sonnet', { model: 'claude-code/haiku' }, 'opus'), { model: 'claude-code/haiku', source: 'contract' });
  assert.deepEqual(resolveHarnessModel('sonnet', {}, 'opus'), { model: 'claude-code/sonnet', source: 'payload' });
  assert.deepEqual(resolveHarnessModel(undefined, {}, 'opus'), { model: 'claude-code/opus', source: 'config' });
  assert.throws(() => resolveHarnessModel('sonnet', { model: 'openai/gpt-5' }), /no es Claude Code/);
  assert.equal(resolveHarnessModel('claude-code/claude-sonnet-5-5').model, 'claude-code/claude-sonnet-5-5');
  assert.deepEqual(describeExecution({ requested: 'openai/gpt-5' }).engine, 'desconocido');
  for (const bad of ['openai/gpt-5', 'opencode/x', 'provider/model', 'gpt-test', 'claude-code/', 'sonnet;rm', '--model', 42]) {
    assert.equal(isClaudeModel(bad), false, String(bad));
    assert.throws(() => resolveHarnessModel(bad), /no es Claude Code/);
  }
  assert.throws(() => assertClaudeClient('opencode'), /Claude Code/); assert.throws(() => assertClaudeClient('codex'), /Claude Code/); assert.equal(assertClaudeClient('claude'), 'claude');
  assert.deepEqual(contractModels({ model: 'a', judge: { model: 'b' }, coordination: { children: [{ id: 'c1', model: 'c', coordination: { children: [{ id: 'g', judge: { model: 'd' } }] } }] } }).map(item => item.model), ['a', 'b', 'c', 'd']);
  assert.throws(() => assertContractClaudeOnly({ model: 'claude-code/sonnet', coordination: { children: [{ id: 'x', model: 'openai/gpt' }] } }), /hijo x/);
  assert.equal(assertContractClaudeOnly({ goal: 'sin modelos' }).goal, 'sin modelos');
  assert.deepEqual(claudeModelCatalog().map(item => item.id), ['claude-code/fable', 'claude-code/opus', 'claude-code/sonnet', 'claude-code/haiku']);
  // Provenance: requested is never presented as observed.
  assert.deepEqual(describeExecution({ requested: 'claude-code/opus', requestedSource: 'contract' }), { client: 'claude', engine: 'claude-code', requested: 'claude-code/opus', requestedSource: 'contract', observed: null, status: 'unknown' });
  assert.deepEqual(describeExecution({ requested: 'claude-code/opus', observed: 'claude-opus-5-5' }).status, 'observed');
  assert.equal(describeExecution().requested, 'claude-code/sonnet'); assert.equal(describeExecution().requestedSource, 'default');
});

test('bootstrap policy states the Claude Code engine rule and never imposes OpenCode', () => {
  const policy = terminalPolicy({ workspaceId: 'w', nodeId: 'n', sessionId: 's', cwd: '/tmp/x', branch: 'b' });
  assert.ok(policy.includes(POLICY_HINTS.engine)); assert.match(POLICY_HINTS.engine, /claude-code\/sonnet/);
  assert.doesNotMatch(policy, /opencode/i);
  assert.equal(agentContext({ id: 'w', canonicalPath: '/tmp/x' }, { id: 'n', title: 't', data: {} }, null).policy.engine, POLICY_HINTS.engine);
});

test('inline merge preserves all inherited settings and instruction order without mutation', () => {
  const inherited = {
    instructions: ['AGENTS.md', '/personal/rules.md'],
    provider: { local: { options: { baseURL: 'http://localhost:1234', apiKey: 'secret' } } },
    permission: { edit: 'ask', bash: { '*': 'deny' } },
    mcp: { memory: { type: 'local', command: ['node', 'memory.mjs'], enabled: true } },
    model: 'local/model', experimental: { custom: true },
  };
  const original = JSON.stringify(inherited);
  const merged = JSON.parse(mergeAgentConfig(original, '/external/terminal.md', { PHANTOM_TERMINAL_SESSION_ID: 's1' }));
  const { phantom_workspace: added, ...kept } = merged.mcp;
  assert.deepEqual({ ...merged, mcp: kept }, { ...inherited, instructions: [...inherited.instructions, '/external/terminal.md'] });
  assert.equal(added.type, 'local');
  assert.equal(added.enabled, true);
  assert.match(added.command.at(-1), /phantom-mcp\.mjs$/);
  assert.equal(added.environment.PHANTOM_TERMINAL_SESSION_ID, 's1');
  assert.equal(JSON.stringify(inherited), original);
  const fresh = JSON.parse(mergeAgentConfig(undefined, '/policy.md'));
  assert.deepEqual(fresh.instructions, ['/policy.md']);
  assert.deepEqual(Object.keys(fresh.mcp), ['phantom_workspace']);
});

test('inherited phantom_workspace wins and a non-object mcp is refused', () => {
  const own = { type: 'local', command: ['mine'], enabled: false };
  assert.deepEqual(JSON.parse(mergeAgentConfig(JSON.stringify({ mcp: { phantom_workspace: own } }), '/policy.md')).mcp, { phantom_workspace: own });
  for (const mcp of [null, [], 'x', 3]) assert.throws(() => mergeAgentConfig(JSON.stringify({ mcp }), '/policy.md'), /mcp must be an object/);
});

test('malformed inherited JSON and incompatible instructions fail explicitly', async t => {
  for (const value of ['', '{broken', '{"instructions":']) {
    assert.throws(() => mergeAgentConfig(value, '/policy.md'), /Invalid inherited OPENCODE_CONFIG_CONTENT JSON:.*Correct it/s);
  }
  for (const value of ['null', '[]', 'false', '"text"']) {
    assert.throws(() => mergeAgentConfig(value, '/policy.md'), /must be a JSON object/);
  }
  for (const instructions of [null, 'rules.md', [42], [{}]]) {
    assert.throws(() => mergeAgentConfig(JSON.stringify({ instructions }), '/policy.md'), /refusing to replace inherited instructions/);
  }
  const root = temporary(t), stateDir = path.join(root, 'state');
  await assert.rejects(bootstrapAgentPolicy({ stateDir, workspace: { id: 'w', path: root }, env: { OPENCODE_CONFIG_CONTENT: '{bad' }, cwd: root, sessionId: 'bad' }), /Invalid inherited/);
  assert.equal(fs.existsSync(stateDir), false);
});

test('per-terminal policies are isolated and stored outside project and worktree', async t => {
  const root = temporary(t), project = path.join(root, 'project'), tree = path.join(root, 'tree');
  fs.mkdirSync(project); fs.mkdirSync(tree);
  const inherited = JSON.stringify({ instructions: ['/inherited.md'], permission: { edit: 'ask' } });
  // State inside the worktree must take the external fallback too.
  const stateDir = path.join(tree, 'state'), workspace = { id: 'workspace', canonicalPath: project };
  const policies = await Promise.all(['one', 'two'].map(sessionId => bootstrapAgentPolicy({
    stateDir, workspace, env: { OPENCODE_CONFIG_CONTENT: inherited }, nodeId: `node-${sessionId}`, sessionId, cwd: tree, branch: `feature/${sessionId}`,
  })));
  const paths = policies.map(env => JSON.parse(env.OPENCODE_CONFIG_CONTENT).instructions.at(-1));
  t.after(() => paths.forEach(file => fs.rmSync(file, { force: true })));
  assert.notEqual(paths[0], paths[1]);
  for (const [index, file] of paths.entries()) {
    assert.ok(!file.startsWith(project + path.sep));
    assert.ok(!file.startsWith(tree + path.sep));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const policy = fs.readFileSync(file, 'utf8'), sessionId = index ? 'two' : 'one';
    assert.ok(policy.includes(`"terminalSessionId":"${sessionId}"`));
    assert.ok(policy.includes(`"branch":"feature/${sessionId}"`));
    assert.ok(policy.includes(JSON.stringify(tree)));
    assert.ok(!policy.includes(`"terminalSessionId":"${index ? 'one' : 'two'}"`));
    assert.deepEqual(JSON.parse(policies[index].OPENCODE_CONFIG_CONTENT).instructions, ['/inherited.md', file]);
  }
  assert.equal(fs.existsSync(stateDir), false);
});

test('context keeps existing identity/report fields and exposes worktree and policy hints', () => {
  const agent = { cardId: 'canonical', cardTitle: 'Goal', providerSessionId: 'ses_1', provider: 'opencode', step: 'Checks', status: 'review', source: 'agent', updatedAt: 'now' };
  const node = { id: 'node', title: 'Terminal', data: { agent, cwd: '/saved', worktree: { branch: 'saved' } } };
  const workspace = { id: 'workspace', canonicalPath: '/project' };
  const context = agentContext(workspace, node, { id: 'session', status: 'running', cwd: '/exact-tree', worktree: { branch: 'feature/exact' } });
  for (const [key, value] of Object.entries(agent)) assert.equal(context[key], value);
  assert.equal(context.workspace, '/project'); assert.equal(context.name, 'Terminal');
  assert.equal(context.nodeId, 'node'); assert.equal(context.terminalSessionId, 'session');
  assert.equal(context.cwd, '/exact-tree'); assert.equal(context.branch, 'feature/exact');
  assert.match(context.policy.registration, /exact worktree/);
  assert.match(context.policy.taskKind, /direct tasks.*coordinated cards/);
  assert.match(context.policy.availability, /blocked/);
  assert.match(context.policy.processes, /launch "COMANDO".*processes \/ output ID \/ stop ID/);
  assert.equal(agentContext(workspace, node).cwd, '/saved');
  assert.equal(agentContext(workspace, node).branch, 'saved');
  // A current detached/non-Git session must not inherit a stale saved branch.
  assert.equal(agentContext(workspace, node, { worktree: { branch: null } }).branch, null);
  assert.equal(agentContext(workspace, node, { worktree: null }).branch, null);
  const policy = terminalPolicy({ workspaceId: 'workspace', nodeId: 'node', sessionId: 'session', cwd: '/tree', branch: null });
  assert.match(policy, /servidores, watchers.*launch "COMANDO"/);
  assert.match(policy, /no los dejes en primer plano ni en segundo plano de tu propio turno/);
  assert.match(policy, /Entorno → Procesos/);
  assert.doesNotMatch(policy, /Automatizar → Procesos/);
  assert.match(policy, /servicio de compose\.yaml.*env up.*env run.*env\.service.*launch.*no contenerizable/);
  for (const text of ['context', 'bind ID', 'report', 'run ID', '"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" runs', 'lane direct', 'lane coordinated', 'do/run', 'do not recursively', 'unrelated requests', 'Read-only questions', 'empty shell', 'blocked', 'never completes', '## Communication (Caveman)', 'Lead with the result or the blocker']) assert.ok(policy.includes(text), text);
});

test('plan and routing guidance appears once in terminal and main chat instructions', () => {
  const policy = terminalPolicy({ workspaceId: 'w', nodeId: 'n', cwd: '/tree' });
  const instructions = phantomInstructions({ name: 'Project', canonicalPath: '/project' });
  for (const text of [policy, instructions, POLICY_HINTS.planning]) {
    assert.equal(text.split('card.prepare').length - 1, 1);
    assert.equal(text.split('Plan y ruteo').length - 1, 1);
    assert.ok(text.includes(POLICY_HINTS.planning));
    assert.match(text, /Before registering a task or card.*resolve and load/);
    assert.match(text, /declare it in the contract: lane, children only if justified, model\/variant proportional to difficulty \(fast mechanical work on the economical model\), budget\.maxTokens, and judge when project policy requires it/);
    assert.match(text, /If the skill or those fields are unavailable in the installed harness, continue with the contract it admits and say so in the report; never invent fields/);
  }
});

test('chat execution guidance registers tasks and hands runs to the host', () => {
  const policy = terminalPolicy({ workspaceId: 'w', nodeId: 'n', cwd: '/tree' });
  const instructions = phantomInstructions({ name: 'Project', canonicalPath: '/project' });
  for (const text of [policy, instructions]) {
    const paragraph = text.split('\n\n').find(part => part.startsWith('Do not launch `phantom do`'));
    assert.ok(paragraph);
    for (const command of ['phantom do', 'phantom run', 'phantom create', 'phantom card', 'run ID [MODEL]', 'phantom show ID', 'runs']) {
      assert.ok(paragraph.includes(command), command);
    }
    assert.match(paragraph, /both die when the turn ends/);
    assert.match(paragraph, /scope and checks/);
    assert.match(paragraph, /hands it to the host and survives your turn/);
    assert.match(paragraph, /do not relaunch a task already shown as running/);
  }
});

test('agent run validates arguments before contacting the host and requires workspace identity', async () => {
  for (const args of [
    ['run'], ['run', '-id'], ['run', 'id', 'model', 'extra'],
    ...['', ' ', 'id\n', 'id\x7f', 'x'.repeat(513)].map(id => ['run', id]),
    ...['', ' ', 'model\n', 'model\x7f', 'x'.repeat(201)].map(model => ['run', 'id', model]),
    ['runs', 'extra'],
  ]) await assert.rejects(agentCLI(args, {}), /Uso/);
  for (const args of [['run', 'id'], ['runs']]) {
    await assert.rejects(agentCLI(args, {}), /Falta la identidad de terminal; abre una sesión nueva en Phantom Workspace\./);
  }
});

test('agent run and runs use host controllers with workspace identity or terminal context', async t => {
  const root = temporary(t), socketPath = path.join(root, 'host.sock'), calls = [];
  const descriptor = { id: 'task-id', status: 'running', pid: 123 };
  const controllers = [descriptor];
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        calls.push({ method: request.method, payload: request.payload });
        const result = request.method === 'terminal.agent.context' ? { workspaceId: 'terminal-workspace' }
          : request.method === 'phantom.control' ? descriptor : controllers;
        socket.write(JSON.stringify({ id: request.id, result }) + '\n');
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  for (const identity of [
    { PHANTOM_WORKSPACE_ID: 'workspace' },
    { PHANTOM_WORKSPACE_ID: 'workspace', PHANTOM_TERMINAL_SESSION_ID: 'session' },
    { PHANTOM_WORKSPACE_ID: 'inconsistent-other-project', PHANTOM_TERMINAL_SESSION_ID: 'session' },
    { PHANTOM_TERMINAL_SESSION_ID: 'session' },
  ]) {
    const env = { ...identity, PHANTOM_WORKSPACE_SOCKET: socketPath };
    const workspaceId = identity.PHANTOM_TERMINAL_SESSION_ID ? 'terminal-workspace' : identity.PHANTOM_WORKSPACE_ID;
    const contextCalls = identity.PHANTOM_TERMINAL_SESSION_ID ? [{ method: 'terminal.agent.context', payload: { sessionId: 'session' } }] : [];
    for (const model of [undefined, 'provider/model']) {
      calls.length = 0;
      assert.deepEqual(await agentCLI(['run', 'task-id', ...(model ? [model] : [])], env), descriptor);
      assert.deepEqual(calls, [...contextCalls, { method: 'phantom.control', payload: { workspaceId, id: 'task-id', action: 'run', ...(identity.PHANTOM_TERMINAL_SESSION_ID ? { sessionId: 'session' } : { main: true }), ...(model ? { model } : {}) } }]);
    }
    calls.length = 0;
    assert.deepEqual(await agentCLI(['runs'], env), controllers);
    assert.deepEqual(calls, [...contextCalls, { method: 'phantom.controllers', payload: { workspaceId } }]);
  }
});

test('policy hints distinguish controlled edits from accepted-work Git finalization without bypass', () => {
  const context = agentContext({ id: 'w', canonicalPath: '/project' }, { id: 'n', data: { cwd: '/tree' } });
  assert.deepEqual(context.policy, POLICY_HINTS);
  assert.match(context.policy.registration, /Before edits.*exact worktree.*writable paths.*acceptance checks/);
  assert.match(context.policy.execution, /Edits and their tests.*do\/run.*scope and acceptance checks.*without nesting/);
  assert.match(context.policy.integration, /After acceptance, the parent may invoke.*agent\.mjs merge ID.*scripts\/branches\.mjs integrate BRANCH.*hooks and integration checks enabled/);
  assert.match(context.policy.integration, /Git finalization belongs to that controller, not do\/run/);
  for (const prohibition of ['merge through harness acceptance checks', 'ask do/run to modify HEAD', 'grant shell to the executor', 'disable hooks or integration checks', 'edit queue state by hand', 'fake completed task status']) {
    assert.ok(context.policy.noBypass.includes(prohibition), prohibition);
  }
});

test('bootstrap keeps both native authorities and no-bypass guarantees for every integration role', () => {
  for (const sessionId of [undefined, 'session']) {
    for (const role of [undefined, 'worker', 'orchestrator']) {
      const policy = terminalPolicy({ workspaceId: 'w', nodeId: 'n', sessionId, cwd: '/tree', branch: 'feature/work', integration: role ? { role, base: 'main' } : undefined });
      assert.match(policy, /before editing create or reuse a native Phantom task.*exact worktree.*scope.*acceptance checks/);
      assert.match(policy, /Edits and their tests belong to the native Phantom CLI do\/run, with the registered scope and acceptance checks/);
      assert.match(policy, /After acceptance, the parent may invoke.*agent\.mjs merge ID.*scripts\/branches\.mjs integrate BRANCH.*existing role\/authorization requirements, hooks and integration checks/);
      assert.match(policy, /does not remove mandatory task registration, scope, acceptance checks or native closure/);
      assert.match(policy, /Acceptance is not proof that a branch has been integrated/);
      assert.match(policy, /Never merge through harness acceptance checks or ask do\/run to modify HEAD/);
      assert.match(policy, /Do not grant shell to the executor for Git finalization/);
      assert.match(policy, /Do not bypass the native controller, disable hooks.*--no-verify.*core\.hooksPath.*strip guard environment.*disable integration checks.*--no-checks.*checks --none.*edit queue state by hand.*fake completed task status/);
      assert.match(policy, /If acceptance or the authorized integration controller is unavailable, report blocked.*do not substitute raw Git or manual state changes/);
      assert.match(policy, /A report or consult never completes a task; review means ready for review only/);
      assert.doesNotMatch(policy, /All (?:controlled effects|effects of controlled work) belong/);
      if (role === 'worker') assert.match(policy, /Only the orchestrator session integrates work/);
      if (role === 'orchestrator') assert.match(policy, /merge ID.*host merges exactly the submitted commit/);
    }
  }
});

test('real PTYs inherit isolated bootstrap config for their actual Git worktrees; bind uses host ownership', async t => {
  const root = temporary(t, false), project = path.join(root, 'project'); fs.mkdirSync(project);
  const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' });
  git('init', '-b', 'main');
  fs.writeFileSync(path.join(project, 'tracked.txt'), 'base\n'); git('add', 'tracked.txt');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Fixture');
  const inherited = { instructions: ['/personal/rules.md'], provider: { local: { options: { baseURL: 'http://localhost' } } }, permission: { edit: 'ask' }, mcp: { local: { type: 'local', command: ['node', 'server.mjs'] } } };
  const restore = inlineConfig(t, JSON.stringify(inherited)), calls = [];
  // Only the native CLI transport is a fixture. Use the production integration's
  // detail/ownership checks, including its actual Git worktree-family lookup.
  const catalogPath = path.join(root, 'native-tasks.json'), cliPath = path.join(root, 'native-cli.mjs');
  fs.writeFileSync(cliPath, `import fs from 'node:fs';
const [action, id] = process.argv.slice(2);
if (action !== 'show') throw new Error('Unexpected native effect: ' + action);
const tasks = JSON.parse(fs.readFileSync(${JSON.stringify(catalogPath)}, 'utf8'));
if (!Object.hasOwn(tasks, id)) throw new Error('Unknown native task');
console.log(JSON.stringify(tasks[id]));
`);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: async (method, payload, context) => {
    calls.push({ method, ...payload });
    if (method !== 'phantom.detail') throw new Error(`Unexpected native effect: ${method}`);
    return handleIntegration(method, payload, context);
  } });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await host.invoke('settings.update', { patch: { phantomPath: cliPath, phantomData: path.join(root, 'native-state') } });
  const workspace = await host.invoke('workspace.open', { path: project });
  const one = await host.invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' });
  const two = await host.invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' });
  restore();
  assert.deepEqual(calls, []); // Opening shells registers no automatic native tasks/cards.
  const foreignProject = path.join(root, 'foreign'); fs.mkdirSync(foreignProject);
  const longGoal = 'Objetivo nativo completo: ' + 'detalle '.repeat(100);
  const nativeTasks = {
    'direct-id': { id: 'direct-id', kind: 'task', status: 'ready', contract: { goal: 'Direct goal', lane: 'direct', workspace: one.session.cwd } },
    'coordinated-id': { id: 'coordinated-id', kind: 'card', status: 'ready', contract: { goal: 'Coordinated goal', lane: 'coordinated', workspace: two.session.cwd } },
    'long-direct': { id: 'long-direct', kind: 'task', status: 'ready', contract: { goal: longGoal, lane: 'direct', workspace: one.session.cwd } },
    'long-card': { id: 'long-card', kind: 'card', status: 'ready', contract: { goal: longGoal, lane: 'coordinated', workspace: two.session.cwd } },
    foreign: { id: 'foreign', kind: 'task', status: 'ready', contract: { goal: 'Foreign goal', lane: 'direct', workspace: foreignProject } },
    'foreign-card': { id: 'foreign-card', kind: 'card', status: 'ready', contract: { goal: 'Foreign card', lane: 'coordinated', workspace: foreignProject } },
  };
  for (const [id, kind] of [['invalid-skill', 'skill'], ['invalid-decision', 'decision'], ['invalid-missing', undefined]]) {
    nativeTasks[id] = { id, kind, contract: { goal: 'Invalid binding', workspace: project } };
  }
  fs.writeFileSync(catalogPath, JSON.stringify(nativeTasks));
  const policyPaths = [];
  for (const terminal of [one, two]) {
    const output = path.join(root, `${terminal.session.id}.json`);
    const script = `require('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({config:JSON.parse(process.env.OPENCODE_CONFIG_CONTENT),sessionId:process.env.PHANTOM_TERMINAL_SESSION_ID,cwd:process.cwd(),cli:process.env.PHANTOM_AGENT_CLI,policy:process.env.PHANTOM_AGENT_POLICY,path:process.env.PATH}))`;
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    await host.invoke('terminal.write', { sessionId: terminal.session.id, data: `"$PHANTOM_AGENT_NODE" -e ${quote(script)}\n` });
    await until(() => fs.existsSync(output));
    const observed = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(observed.cwd, terminal.session.cwd);
    assert.equal(observed.sessionId, terminal.session.id);
    assert.ok(observed.cli.endsWith('/scripts/agent.mjs'));
    const policyPath = observed.config.instructions.at(-1); policyPaths.push(policyPath);
    const { phantom_workspace: phantomServer, ...keptMcp } = observed.config.mcp;
    assert.deepEqual(keptMcp, inherited.mcp);
    assert.equal(phantomServer.environment.PHANTOM_TERMINAL_SESSION_ID, terminal.session.id);
    assert.deepEqual({ ...observed.config, mcp: keptMcp }, { ...inherited, instructions: [...inherited.instructions, policyPath] });
    // Claude Code and Codex get the same file through the shims that lead PATH.
    assert.equal(observed.policy, policyPath); assert.equal(observed.path.split(':')[0], agentShims);
    const policy = fs.readFileSync(policyPath, 'utf8');
    assert.ok(policy.includes(JSON.stringify(terminal.session.cwd)));
    assert.ok(policy.includes(JSON.stringify(terminal.session.worktree.branch)));
    const context = await host.invoke('terminal.agent.context', { sessionId: terminal.session.id });
    assert.equal(context.cwd, terminal.session.cwd); assert.equal(context.branch, terminal.session.worktree.branch);
  }
  assert.notEqual(policyPaths[0], policyPaths[1]); assert.notEqual(one.session.cwd, two.session.cwd);
  const env = { PHANTOM_TERMINAL_SESSION_ID: one.session.id, PHANTOM_WORKSPACE_SOCKET: host.socketPath };
  await agentCLI(['bind', 'direct-id'], env);
  assert.equal(calls.at(-1).workspaceId, workspace.id);
  assert.equal(calls.at(-1).topic, 'tasks');
  let context = await agentCLI(['context'], env);
  assert.equal(context.nodeId, one.node.id); assert.equal(context.cardId, 'direct-id');
  assert.equal(context.cardTitle, 'Direct goal'); assert.equal(context.status, 'idle'); assert.equal(context.source, 'manual');
  await agentCLI(['report', 'Direct ready', 'review'], env);
  context = await agentCLI(['context'], env);
  assert.equal(context.status, 'review'); assert.equal(context.source, 'agent');
  await agentCLI(['bind', 'direct-id'], env);
  assert.deepEqual(await agentCLI(['context'], env), context);
  assert.equal((await host.invoke('terminal.agent.context', { sessionId: two.session.id })).cardId, undefined);
  for (const id of ['foreign', 'foreign-card', 'invalid-skill', 'invalid-decision', 'invalid-missing']) {
    await assert.rejects(agentCLI(['bind', id], env), id.startsWith('foreign') ? /another workspace/ : /Expected a Phantom task or card/);
    assert.deepEqual(await agentCLI(['context'], env), context);
  }
  // Exercise the real CLI/socket/store binding path for both native kinds.
  assert.ok(longGoal.length > 512);
  for (const id of ['long-direct', 'long-card']) {
    await agentCLI(['bind', id], env);
    const bound = await agentCLI(['context'], env);
    assert.equal(bound.cardId, id);
    assert.equal(bound.cardTitle, longGoal.slice(0, 512));
    assert.equal(bound.cardTitle.length, 512);
    await agentCLI(['bind', id], env);
    assert.deepEqual(await agentCLI(['context'], env), bound);
    const native = await host.invoke('phantom.detail', { workspaceId: workspace.id, topic: 'tasks', id });
    assert.equal(native.contract.goal, longGoal);
    assert.deepEqual(native, nativeTasks[id]);
  }
  await agentCLI(['bind', 'coordinated-id'], env);
  context = await agentCLI(['context'], env);
  assert.equal(context.cardTitle, 'Coordinated goal'); assert.equal(context.step, '');
  assert.equal(context.status, 'idle'); assert.equal(context.source, 'manual');
  await agentCLI(['report', 'Ready for review', 'review'], env);
  context = await agentCLI(['context'], env);
  assert.equal(context.cardId, 'coordinated-id'); assert.equal(context.status, 'review');
  assert.equal(context.source, 'agent');
  for (const id of ['direct-id', 'coordinated-id']) {
    const native = await host.invoke('phantom.detail', { workspaceId: workspace.id, topic: 'tasks', id });
    assert.deepEqual(native, nativeTasks[id]); // Binding/reporting never mutate native state.
  }
  await assert.rejects(host.invoke('terminal.agent.report', { sessionId: one.session.id, patch: { source: 'manual' } }), /only update step and status/);
  await assert.rejects(agentCLI(['report', 'Done', 'completed'], env), /Uso/);
  assert.ok(calls.every(call => call.method === 'phantom.detail'));
  await assert.rejects(agentCLI(['bind', '--invalid'], env), /Uso/);
  await assert.rejects(agentCLI(['bind', 'id'], { ...env, PHANTOM_TERMINAL_SESSION_ID: 'missing' }), /not found/);
  await host.invoke('terminal.stop', { sessionId: one.session.id });
  await until(() => host.terminals.get(one.session.id).status === 'exited');
  const relaunched = await host.invoke('terminal.create', { workspaceId: workspace.id, nodeId: one.node.id, shell: '/bin/sh' });
  const resumed = await agentCLI(['context'], { ...env, PHANTOM_TERMINAL_SESSION_ID: relaunched.session.id });
  assert.notEqual(resumed.terminalSessionId, one.session.id);
  assert.equal(resumed.cardId, 'coordinated-id');
  assert.equal(resumed.cwd, one.session.cwd);
  assert.equal(resumed.branch, one.session.worktree.branch);
  assert.deepEqual(calls.filter(call => call.method !== 'phantom.detail'), []);
});

test('PTY creation fails usefully on malformed host inline config without spawning a shell', async t => {
  const root = temporary(t, false);
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: root });
  const restore = inlineConfig(t, '{invalid');
  await assert.rejects(host.invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' }), /Invalid inherited OPENCODE_CONFIG_CONTENT JSON/);
  restore();
  assert.equal(host.terminals.live.size, 0);
  assert.deepEqual(await host.invoke('terminal.list', { workspaceId: workspace.id }), []);
});

test('terminal PTY env does not inherit PHANTOM_WORKSPACE_ID from the app process', async t => {
  const root = temporary(t, false), output = path.join(root, 'workspace-id');
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: root });
  const previous = process.env.PHANTOM_WORKSPACE_ID;
  process.env.PHANTOM_WORKSPACE_ID = 'app-workspace';
  let terminal;
  try { terminal = await host.invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' }); }
  finally { if (previous === undefined) delete process.env.PHANTOM_WORKSPACE_ID; else process.env.PHANTOM_WORKSPACE_ID = previous; }
  await host.invoke('terminal.write', { sessionId: terminal.session.id, data: `printf '%s' "\${PHANTOM_WORKSPACE_ID-unset}" > '${output}'\n` });
  await until(() => fs.existsSync(output) && fs.readFileSync(output, 'utf8') !== '');
  assert.equal(fs.readFileSync(output, 'utf8'), 'unset');
});

// A fake agent that records its argv, one argument per NUL-terminated record.
function fakeAgents(t) {
  const root = temporary(t), bin = path.join(root, 'bin'), log = path.join(root, 'argv');
  fs.mkdirSync(bin);
  for (const name of ['claude', 'codex']) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nfor arg do printf '%s\\0' "$arg"; done > "${log}"\n`, { mode: 0o755 });
  const policy = path.join(root, 'policy.md');
  fs.writeFileSync(policy, terminalPolicy({ workspaceId: 'w', nodeId: 'n', sessionId: 's', cwd: '/tree', branch: 'phantom/terminal-n', integration: { role: 'worker', base: 'main' } }));
  const run = (name, args, extra = {}) => {
    fs.rmSync(log, { force: true });
    execFileSync(name, args, { env: { PATH: shimmedPath(`${bin}:/usr/bin:/bin`), PHANTOM_AGENT_SHIMS: agentShims, PHANTOM_AGENT_POLICY: policy, ...extra }, stdio: 'pipe' });
    return fs.readFileSync(log, 'utf8').split('\0').slice(0, -1);
  };
  return { run, policy: fs.readFileSync(policy, 'utf8') };
}

test('Claude Code and Codex started in a Phantom terminal receive the terminal policy', t => {
  const { run, policy } = fakeAgents(t);
  assert.equal(shimmedPath(shimmedPath('/usr/bin')).split(':').filter(dir => dir === agentShims).length, 1);
  assert.deepEqual(run('claude', ['--model', 'opus', 'fix "it"']), ['--append-system-prompt', policy.replace(/\n+$/, ''), '--model', 'opus', 'fix "it"']);
  // A subcommand's -c list replaces the global one in codex: ours follows
  // the subcommand. Without one (the TUI) it leads.
  for (const [args, lead, rest] of [[['exec', 'fix it'], ['exec'], ['fix it']], [['fix it'], [], ['fix it']]]) {
    const codex = run('codex', args);
    assert.deepEqual(codex.slice(0, lead.length), lead);
    const [c1, mcp, c2, net, c3, roots, c4, dev, ...tail] = codex.slice(lead.length);
    assert.deepEqual([c1, c2, c3, c4, tail], ['-c', '-c', '-c', '-c', rest]);
    // workspace-write reaches the app's socket and native Phantom's database.
    assert.equal(net, 'sandbox_workspace_write.network_access=true');
    assert.match(roots, /^sandbox_workspace_write\.writable_roots=\[".*\/phantom"\]$/);
    // Phantom's CLIs as a pre-approved MCP tool, outside Codex's sandbox.
    assert.match(mcp, /^mcp_servers\.phantom_workspace=\{ command=".*", args=\[".*phantom-mcp\.mjs"\], env=\{ .* \}, default_tools_approval_mode="approve" \}$/);
    // The value is a TOML multi-line literal string: the policy arrives verbatim.
    assert.ok(dev.startsWith(`developer_instructions='''\n${policy.replace(/\n+$/, '')}\n\nPhantom Workspace commands`), dev.slice(0, 80));
    assert.ok(dev.endsWith("cannot reach the app.'''"));
  }
  assert.ok(!policy.includes("'''"));
});

// Deliberate change: the durable agent history needs the tool events of the root and of every sub-agent (not only the
// Agent call) plus SubagentStart and Stop. The hook CLI forwards them to the host, which attributes them to the live
// session; hooks stay async and never block the agent. Nothing about permissions or the policy changes here.
test('Claude shim adds eight async hooks only when terminal hooks are enabled and settings are free', t => {
  const { run, policy }=fakeAgents(t);
  const env={PHANTOM_AGENT_CLI:'/x/agent.mjs',PHANTOM_TERMINAL_SESSION_ID:'s'};
  const argv=run('claude',['hi'],env);
  assert.deepEqual(argv.slice(0,3),['--append-system-prompt',policy.replace(/\n+$/,''),'--settings']);
  assert.equal(argv[4],'hi');
  const hooks=JSON.parse(argv[3]).hooks;
  assert.deepEqual(Object.keys(hooks).sort(),['PostToolUse','PostToolUseFailure','PreToolUse','SessionEnd','SessionStart','Stop','SubagentStart','SubagentStop']);
  for(const [event,entries] of Object.entries(hooks)) {
    assert.equal(entries.length,1);
    assert.equal(entries[0].matcher,undefined,`${event} covers every tool: the trace attributes each call to its agent`);
    assert.deepEqual(entries[0].hooks,[{type:'command',command:'"${PHANTOM_AGENT_NODE:-node}" "$PHANTOM_AGENT_CLI" subagent',async:true}]);
  }
  for(const args of [['--settings','{}','hi'],['--settings={}','hi']])assert.deepEqual(run('claude',args,env),['--append-system-prompt',policy.replace(/\n+$/,''),...args]);
  assert.deepEqual(run('claude',['hi'],{...env,PHANTOM_AGENT_HOOKS_OFF:'1'}),['--append-system-prompt',policy.replace(/\n+$/,''),'hi']);
  assert.ok(!run('codex',['hi'],env).includes('--settings'));
});

test('agent shims stay out of the way when there is nothing to add', t => {
  const { run } = fakeAgents(t);
  assert.deepEqual(run('claude', ['mcp', 'list']), ['mcp', 'list']);
  assert.deepEqual(run('claude', ['--version']), ['--version']);
  assert.deepEqual(run('codex', ['--help']), ['--help']);
  assert.deepEqual(run('claude', ['--append-system-prompt', 'mine', 'hi']), ['--append-system-prompt', 'mine', 'hi']);
  assert.deepEqual(run('claude', ['hi'], { PHANTOM_AGENT_POLICY_OFF: '1' }), ['hi']);
  assert.deepEqual(run('codex', ['hi'], { PHANTOM_AGENT_POLICY: '/nonexistent/policy.md' }), ['hi']);
});

test('chat cards carry the registration policy for every provider, with or without Incorporaciones', async t => {
  const root = temporary(t), project = path.join(root, 'project'), home = path.join(root, 'home');
  fs.mkdirSync(project);
  inlineConfig(t, JSON.stringify({ instructions: ['/inherited.md'], permission: { edit: 'ask' } }));
  const store = { dir: home, state: { workspaces: [] } }, merges = new Merges({ store, terminals: { sessions: [] }, mutate: () => {}, emit: () => {} });
  const workspace = { id: 'workspace', path: project, canonicalPath: project };
  const node = { id: 'node', type: 'terminal', data: { cwd: project, chat: { provider: 'claude' } } };
  const role = merges.agentContext(workspace, node);
  assert.ok(role.instructions.includes('before editing create or reuse a native Phantom task'));
  assert.ok(role.instructions.includes(JSON.stringify(project)));
  assert.ok(role.instructions.includes('no terminal session yet'));
  assert.ok(!role.instructions.includes('Incorporaciones'));
  // Claude takes the text; OpenCode a file appended to its inherited inline config.
  assert.deepEqual(providerArgs('claude', { message: 'hola', instructions: role.instructions }).slice(5, 7), ['--append-system-prompt', role.instructions]);
  const config = JSON.parse(role.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config.permission, { edit: 'ask' });
  assert.equal(config.instructions[0], '/inherited.md');
  assert.equal(fs.readFileSync(config.instructions[1], 'utf8'), role.instructions);
  assert.ok(!config.instructions[1].startsWith(project + path.sep));

  const withSession = merges.agentContext({ ...workspace, integration: { enabled: true } }, { ...node, data: { ...node.data, sessionId: 'session', worktree: { branch: 'phantom/terminal-node' } } });
  assert.ok(withSession.instructions.includes('"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" context'));
  assert.ok(withSession.instructions.includes('before editing create or reuse a native Phantom task'));
  assert.ok(withSession.instructions.includes('Incorporaciones'));
  assert.equal(withSession.env.PHANTOM_TERMINAL_SESSION_ID, 'session');
});
