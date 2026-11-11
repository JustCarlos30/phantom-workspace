import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bootstrapAgentPolicy, mergeAgentConfig, terminalPolicy } from '../host/agent-policy.mjs';
import { agentContext } from '../host/agents.mjs';
import { createHost } from '../host/server.mjs';
import { main as agentCLI } from '../scripts/agent.mjs';
import { handleIntegration } from '../integrations/index.mjs';

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

test('inline merge preserves all inherited settings and instruction order without mutation', () => {
  const inherited = {
    instructions: ['AGENTS.md', '/personal/rules.md'],
    provider: { local: { options: { baseURL: 'http://localhost:1234', apiKey: 'secret' } } },
    permission: { edit: 'ask', bash: { '*': 'deny' } },
    mcp: { memory: { type: 'local', command: ['node', 'memory.mjs'], enabled: true } },
    model: 'local/model', experimental: { custom: true },
  };
  const original = JSON.stringify(inherited);
  assert.deepEqual(JSON.parse(mergeAgentConfig(original, '/external/terminal.md')), {
    ...inherited, instructions: [...inherited.instructions, '/external/terminal.md'],
  });
  assert.equal(JSON.stringify(inherited), original);
  assert.deepEqual(JSON.parse(mergeAgentConfig(undefined, '/policy.md')), { instructions: ['/policy.md'] });
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
  assert.equal(agentContext(workspace, node).cwd, '/saved');
  assert.equal(agentContext(workspace, node).branch, 'saved');
  // A current detached/non-Git session must not inherit a stale saved branch.
  assert.equal(agentContext(workspace, node, { worktree: { branch: null } }).branch, null);
  assert.equal(agentContext(workspace, node, { worktree: null }).branch, null);
  const policy = terminalPolicy({ workspaceId: 'workspace', nodeId: 'node', sessionId: 'session', cwd: '/tree', branch: null });
  for (const text of ['context', 'bind ID', 'report', 'lane direct', 'lane coordinated', 'do/run', 'do not recursively', 'unrelated requests', 'Read-only questions', 'empty shell', 'blocked', 'never completes']) assert.ok(policy.includes(text), text);
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
  const nativeTasks = {
    'direct-id': { id: 'direct-id', kind: 'task', status: 'ready', contract: { goal: 'Direct goal', lane: 'direct', workspace: one.session.cwd } },
    'coordinated-id': { id: 'coordinated-id', kind: 'card', status: 'ready', contract: { goal: 'Coordinated goal', lane: 'coordinated', workspace: two.session.cwd } },
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
    const script = `require('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({config:JSON.parse(process.env.OPENCODE_CONFIG_CONTENT),sessionId:process.env.PHANTOM_TERMINAL_SESSION_ID,cwd:process.cwd(),cli:process.env.PHANTOM_AGENT_CLI}))`;
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    await host.invoke('terminal.write', { sessionId: terminal.session.id, data: `"$PHANTOM_AGENT_NODE" -e ${quote(script)}\n` });
    await until(() => fs.existsSync(output));
    const observed = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(observed.cwd, terminal.session.cwd);
    assert.equal(observed.sessionId, terminal.session.id);
    assert.ok(observed.cli.endsWith('/scripts/agent.mjs'));
    const policyPath = observed.config.instructions.at(-1); policyPaths.push(policyPath);
    assert.deepEqual(observed.config, { ...inherited, instructions: [...inherited.instructions, policyPath] });
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
