import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleIntegration } from '../integrations/index.mjs';
import { stateHome, command } from '../integrations/common.mjs';
import { runTimeoutMs } from '../integrations/phantom.mjs';

const exec = promisify(execFile);
const controllerPreload = fileURLToPath(new URL('../scripts/phantom-fetch.mjs', import.meta.url));
async function fixture(t, git = false) {
  const home = await mkdtemp('/tmp/opencode/adapters-');
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = path.join(home, 'project with spaces'); await mkdir(root);
  const workspace = { id: randomUUID(), path: root, canonicalPath: root, services: [] };
  const events = [], context = { workspace, getWorkspace: id => id === workspace.id ? workspace : undefined, state: { settings: {} }, dataDir: path.join(home, 'state'), sessions: [], emit: event => events.push(event), persist: async () => {}, events };
  const call = async (method, payload = {}) => {
    const response = await handleIntegration(method, { workspaceId: workspace.id, ...payload }, context);
    assert.equal(response.handled, true); return response.result;
  };
  const gitCommand = args => exec('git', args, { cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
  if (git) {
    await gitCommand(['init', '-b', 'main']);
    await writeFile(path.join(root, 'README.md'), '# Fixture\n');
    // This commit is exclusively in the fresh temporary fixture, never in the user repository.
    await gitCommand(['add', '--', 'README.md']); await gitCommand(['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture base']);
  }
  return { root, home, workspace, context, call, gitCommand };
}

test('Git reports real base comparison, dirty paths, branches, and linked worktrees', async t => {
  const f = await fixture(t, true);
  await f.gitCommand(['branch', 'feature;literal']);
  const worktree = path.join(f.home, 'linked worktree');
  await f.gitCommand(['worktree', 'add', worktree, 'feature;literal']);
  await writeFile(path.join(worktree, 'feature.md'), '# Branch change');
  await f.gitCommand(['-C', worktree, 'add', '--', 'feature.md']);
  await f.gitCommand(['-C', worktree, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture branch change']);
  await writeFile(path.join(f.root, 'README.md'), '# Changed\n');
  const filename = 'literal;$(not-a-command)\nname.md'; await writeFile(path.join(f.root, filename), '# Safe');
  const result = await f.call('git.inspect', { base: 'main' });
  assert.equal(result.available, true); assert.equal(result.root, f.root); assert.equal(result.branch, 'main'); assert.equal(result.dirty, true);
  assert.ok(result.changes.some(c => c.path === filename));
  assert.ok(result.branches.some(b => b.name === 'feature;literal' && b.ahead === 1 && b.behind === 0 && !b.merged));
  assert.ok(result.worktrees.some(w => w.path === worktree));
  assert.ok(result.comparison.baseOid.match(/^[0-9a-f]{40,64}$/));
  const unknown = await f.call('git.inspect', { base: '--invalid;literal' });
  assert.equal(unknown.available, false); assert.match(unknown.reason, /Unknown Git base/);
});

test('non-Git repositories and unresolved workspace IDs are explicit', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('git.inspect')).available, false);
  await assert.rejects(f.call('context.scan', { workspaceId: 'other' }), /Unknown workspace/);
});

test('context scan/read excludes secrets, binary, oversized files and traversal/symlinks', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'guide.md'), '# Real guide\nneedle');
  await writeFile(path.join(f.root, 'skill.json'), '{"id":"test"}');
  await writeFile(path.join(f.root, 'binary.md'), Buffer.from([0, 1, 2]));
  await writeFile(path.join(f.root, 'large.md'), 'x'.repeat(140000));
  for (const dir of ['.git', 'node_modules', 'secrets', '.env.local']) { await mkdir(path.join(f.root, dir)); await writeFile(path.join(f.root, dir, 'hidden.md'), '# Secret'); }
  await writeFile(path.join(f.home, 'outside.md'), '# Outside');
  await symlink(path.join(f.home, 'outside.md'), path.join(f.root, 'escape.md'));
  await symlink(f.home, path.join(f.root, 'escape-dir'));
  const scan = await f.call('context.scan');
  assert.deepEqual(scan.items.map(i => i.path).sort(), ['guide.md', 'skill.json']);
  assert.equal(scan.truncated, false);
  assert.equal((await f.call('context.scan', { query: 'needle' })).items.length, 1);
  assert.deepEqual(await f.call('context.read', { path: 'guide.md' }), { path: 'guide.md', text: '# Real guide\nneedle', truncated: false });
  for (const file of ['../outside.md', 'escape.md', 'escape-dir/outside.md', '.git/hidden.md', 'secrets/hidden.md', '.env.local/hidden.md']) await assert.rejects(f.call('context.read', { path: file }), /outside|Symlink|Excluded/);
  await assert.rejects(f.call('context.read', { path: 'binary.md' }), /Binary/);
  assert.equal((await f.call('context.read', { path: 'large.md' })).truncated, true);
  await symlink(f.root, path.join(f.home, 'state-link'));
  await assert.rejects(stateHome({ dataDir: path.join(f.home, 'state-link', 'new-state') }, f.root), /outside workspace/);
});

async function dockerFixture(t) {
  const f = await fixture(t), calls = [];
  await writeFile(path.join(f.root, 'compose.yml'), 'services: {}');
  await writeFile(path.join(f.home, 'foreign.yml'), 'services: {}');
  const id = 'a'.repeat(64), foreign = 'b'.repeat(64);
  const container = { Id: id, Name: '/real-service', Config: { Image: 'anything', Labels: { 'com.docker.compose.project.working_dir': f.root, 'com.docker.compose.project.config_files': path.join(f.root, 'compose.yml') } }, State: { Status: 'running', Health: { Status: 'healthy' } }, HostConfig: { PortBindings: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '9999' }] } }, NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '8081' }] } } };
  let inspected = [container, { ...container, Id: foreign, Config: { Labels: { ...container.Config.Labels, 'com.docker.compose.project.config_files': path.join(f.home, 'foreign.yml') } } }];
  f.context.execFile = async (file, args, options) => {
    calls.push({ file, args, options }); assert.equal(file, 'docker'); assert.equal(options.shell, false); assert.ok(options.timeout > 0 && options.maxBuffer > 0);
    let output;
    if (args[0] === 'context' && args[1] === 'show') output = 'fixture\n';
    else if (args[0] === 'context') output = JSON.stringify([{ Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } }]);
    else if (args.includes('ps')) { assert.ok(args.includes(`label=com.docker.compose.project.working_dir=${f.root}`)); output = `${id}\n${foreign}\n`; }
    else if (args.includes('inspect')) output = JSON.stringify(inspected);
    else if (args.includes('logs')) output = 'bounded log\n';
    else output = `${id}\n`;
    return { stdout: output, stderr: '' };
  };
  return { ...f, calls, container, id, foreign, setInspected: value => { inspected = value; } };
}

test('Docker binds ownership to Compose canonical paths, daemon/context; actions recheck it', async t => {
  const f = await dockerFixture(t);
  const result = await f.call('docker.list');
  assert.equal(result.available, true); assert.deepEqual(result.items.map(i => i.id), [f.id]);
  assert.equal(result.items[0].context, 'fixture');
  assert.equal((await f.call('docker.logs', { id: f.id, tail: 25 })).text, 'bounded log\n');
  assert.ok(f.calls.some(c => c.args.includes('logs') && c.args.includes('25')));
  await assert.rejects(f.call('docker.action', { id: f.foreign, action: 'stop' }), /not owned/);
  await assert.rejects(f.call('docker.action', { id: f.id, action: 'rm' }), /start, stop, or restart/);
  assert.equal(f.calls.filter(c => c.args.includes('stop')).length, 0);
  const action = await f.call('docker.action', { id: f.id, action: 'restart' });
  assert.deepEqual(action, { id: f.id, action: 'restart', status: 'requested' });
  assert.deepEqual(f.calls.at(-1).args, ['--context', 'fixture', 'restart', f.id]);
  f.setInspected([]);
  await assert.rejects(f.call('docker.action', { id: f.id, action: 'restart' }), /not owned/);
});

test('Docker errors and remote daemon ownership are explicit', async t => {
  const f = await fixture(t);
  f.context.execFile = async () => { throw new Error('daemon unavailable'); };
  assert.match((await f.call('docker.list')).reason, /Docker unavailable.*daemon unavailable/);
  f.context.state.settings.dockerContext = 'remote';
  f.context.execFile = async () => ({ stdout: JSON.stringify([{ Endpoints: { docker: { Host: 'ssh://remote' } } }]), stderr: '' });
  assert.match((await f.call('docker.list')).reason, /local Unix/);
});

test('services retain pinned unknown health and use actual Docker bindings', async t => {
  const f = await dockerFixture(t);
  const pinned = await f.call('services.pin', { url: 'https://example.invalid', title: 'Explicit pin' });
  assert.equal(pinned.source, 'pinned'); assert.equal(pinned.status, 'unknown');
  assert.equal((await f.call('services.pin', { url: 'https://example.invalid/' })).id, pinned.id);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://user:pass@localhost']) await assert.rejects(f.call('services.pin', { url }), /HTTP|URL/);
  const result = await f.call('services.list');
  assert.ok(result.items.some(i => i.source === 'compose' && i.port === 8081 && i.owner.containerId === f.id));
  assert.ok(!result.items.some(i => i.port === 9999));
  assert.equal(result.items.find(i => i.id === pinned.id).status, 'unknown');
  await f.call('services.remove', { id: pinned.id }); assert.equal(f.workspace.services.length, 0);
});

test('Linux /proc service attribution excludes an unrelated listening process', async t => {
  const f = await fixture(t);
  f.context.execFile = async () => { throw new Error('Docker deliberately disabled'); };
  async function server() {
    const child = spawn(process.execPath, ['-e', 'require("node:http").createServer((q,s)=>s.end("ok")).listen(0,"127.0.0.1",function(){console.log(this.address().port)})'], { cwd: f.root, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill('SIGTERM'));
    const [chunk] = await once(child.stdout, 'data'); return { child, port: Number(chunk.toString().trim()) };
  }
  const managed = await server(), unrelated = await server();
  f.context.sessions.push({ id: 'owned-session', workspaceId: f.workspace.id, pid: managed.child.pid, status: 'running' });
  const result = await f.call('services.list', { probe: true });
  assert.ok(result.items.some(i => i.source === 'managed' && i.port === managed.port && i.owner.sessionId === 'owned-session' && i.health === 'healthy'));
  assert.ok(!result.items.some(i => i.port === unrelated.port));
});

test('native Phantom isolated data: cards, decisions/revisions, immutable skills and scoped normalization', async t => {
  const f = await fixture(t, true);
  f.context.state.settings.phantomData = path.join(f.home, 'native-phantom');
  const input = { goal: 'A real card', lane: 'coordinated', scope: ['README.md'], checks: [{ name: 'never-run', argv: [process.execPath, '--version'] }] };
  const card = await f.call('phantom.create', { kind: 'card', input });
  assert.match(card.id, /^task_/); assert.equal(card.raw.kind, 'card'); assert.equal(card.raw.status, 'ready');
  const again = await f.call('phantom.create', { kind: 'card', input: { checks: input.checks, scope: input.scope, lane: input.lane, goal: input.goal } });
  assert.equal(again.id, card.id);
  const tasks = await f.call('phantom.list', { topic: 'tasks' });
  assert.equal(tasks.available, true); assert.equal(tasks.items.length, 1); assert.equal(tasks.items[0].raw.contract.workspace, f.root); assert.equal(tasks.items[0].source, 'phantom');
  await assert.rejects(f.call('phantom.update', { kind: 'card', id: card.id, input }), /immutable/);
  const replacement = await f.call('phantom.update', { kind: 'card', id: card.id, replace: true, input: { ...input, goal: 'Explicit replacement' } });
  assert.notEqual(replacement.id, card.id); assert.equal(replacement.semantic, 'replacement'); assert.equal(replacement.replaces, card.id);
  const original = await f.call('phantom.detail', { topic: 'tasks', id: card.id }); assert.equal(original.contract.goal, input.goal);
  const memoryInput = { key: 'architecture-choice', title: 'Real decision', body: 'Keep native source authoritative', scope: '.' };
  const memory = await f.call('phantom.create', { kind: 'decision', input: memoryInput });
  assert.match(memory.id, /^mem_/); assert.equal(memory.raw.kind, 'decision'); assert.equal(memory.raw.revision, 1);
  assert.equal((await f.call('phantom.create', { kind: 'decision', input: memoryInput })).id, memory.id);
  const revision = await f.call('phantom.update', { kind: 'decision', id: memory.id, revision: 1, input: { ...memoryInput, body: 'Corrected explicit decision' } });
  assert.equal(revision.raw.revision, 2);
  assert.equal((await f.call('phantom.detail', { topic: 'memories', id: memory.id })).length, 2);
  const memories = await f.call('phantom.list', { topic: 'memories' }); assert.equal(memories.items[0].revision, 2); assert.equal(memories.items[0].status, 'active');
  const skillInput = { id: 'fixture/skill', version: '1.0.0', description: 'Native skill', actions: ['fixture.read'], body: 'Read the fixture only.' };
  const skill = await f.call('phantom.create', { kind: 'skill', input: skillInput });
  assert.equal(skill.id, skillInput.id); assert.equal(skill.ref.version, '1.0.0');
  const skills = await f.call('phantom.list', { topic: 'skills' }); assert.equal(skills.items[0].revision, '1.0.0'); assert.equal(skills.items[0].raw.ref.sha256, skill.ref.sha256);
  const next = await f.call('phantom.update', { kind: 'skill', id: skill.id, revision: '1.0.0', input: { ...skillInput, version: '1.0.1', body: 'New immutable content.' } });
  assert.equal(next.semantic, 'new-version'); assert.equal(next.ref.version, '1.0.1');
  assert.equal((await f.call('phantom.update', { kind: 'skill', id: skill.id, revision: '1.0.0', input: { ...skillInput, version: '1.0.1', body: 'New immutable content.' } })).ref.sha256, next.ref.sha256);
  const historical = await f.call('phantom.detail', { topic: 'skills', id: skill.id, ref: skill.ref });
  assert.equal(historical.manifest.body, skillInput.body); assert.equal(historical.ref.version, '1.0.0');
  await assert.rejects(f.call('phantom.create', { kind: 'card', input: { ...input, surprise: true } }), /desconocido/);
  await assert.rejects(f.call('phantom.create', { kind: 'decision', input: { ...memoryInput, unknown: true } }), /Unknown memory field/);
  await symlink(f.home, path.join(f.root, 'outside'));
  await assert.rejects(f.call('phantom.create', { kind: 'card', input: { ...input, scope: ['outside/x.md'] } }), /Symlink/);
});

test('Phantom task catalog uses a large buffer and explains output-limit failures', async t => {
  const f = await fixture(t);
  f.context.state.settings.phantomPath = process.execPath;
  let seen, fail = false;
  f.context.execFile = async (file, args, options) => {
    if (file === 'git') throw new Error('No Git transport');
    assert.deepEqual(args.slice(1), ['list', '--json']);
    seen = options;
    if (fail) throw new Error('node: stdout maxBuffer length exceeded');
    return { stdout: '[]', stderr: '' };
  };
  const result = await f.call('phantom.list', { topic: 'tasks' });
  assert.equal(result.available, true, result.reason);
  assert.ok(seen.maxBuffer >= 32 * 1024 * 1024);
  assert.equal(seen.timeout, 30000);
  assert.equal(seen.cwd, f.root);
  fail = true;
  const unavailable = await f.call('phantom.list', { topic: 'tasks' });
  assert.equal(unavailable.available, false);
  assert.match(unavailable.reason, /^Phantom unavailable: /);
  assert.match(unavailable.reason, /catálogo/);
  assert.doesNotMatch(unavailable.reason, /maxBuffer/);
});

test('Phantom task catalog reads once with project scope only for Git workspaces and retains family filtering', async t => {
  for (const git of [true, false]) {
    const f = await fixture(t, git), calls = [];
    f.context.state.settings.phantomPath = process.execPath;
    const raw = [f.root, f.home].map((workspace, i) => ({ id: `task_${i}`, kind: 'task', status: 'ready', contract: { goal: `Task ${i}`, workspace } }));
    f.context.execFile = async (file, args, options) => {
      if (file === 'git') return exec(file, args, options);
      calls.push(args.slice(1));
      return { stdout: JSON.stringify(raw), stderr: '' };
    };
    const result = await f.call('phantom.list', { topic: 'tasks' });
    assert.equal(result.available, true, result.reason);
    assert.deepEqual(calls, [git ? ['list', '--workspace', f.root, '--scope', 'project', '--json'] : ['list', '--json']]);
    assert.deepEqual(result.items.map(item => item.id), ['task_0']);
  }
});

test('Phantom task catalog excludes unrelated projects but includes known worktree family', async t => {
  const f = await fixture(t, true);
  // The mocked transport only needs an existing CLI file, independent of any installation.
  const cliPath = path.join(f.home, 'phantom-cli.mjs');
  await writeFile(cliPath, '// Inert CLI fixture: execution is supplied by the transport mock.\n');
  f.context.state.settings.phantomPath = cliPath;
  const linked = path.join(f.home, 'linked'); await f.gitCommand(['worktree', 'add', '-b', 'linked', linked]);
  const other = path.join(f.home, 'unrelated'); await mkdir(other);
  const raw = [f.root, linked, other].map((workspace, i) => ({ id: `task_${i}`, kind: 'card', status: 'blocked', contract: { goal: `Native ${i}`, workspace, lane: 'coordinated' }, nativeExtra: { retained: true } }));
  f.context.execFile = async (file, args, options) => {
    if (file === 'git') return exec(file, args, options);
    assert.equal(file, process.execPath); assert.equal(args[0], cliPath); assert.equal(options.shell, false);
    return { stdout: JSON.stringify(args.includes('show') ? raw[2] : raw), stderr: '' };
  };
  const result = await f.call('phantom.list', { topic: 'tasks' });
  assert.equal(result.available, true, result.reason);
  assert.deepEqual(result.items.map(i => i.id), ['task_0', 'task_1']); assert.equal(result.items[0].status, 'blocked'); assert.deepEqual(result.items[0].raw.nativeExtra, { retained: true });
  await assert.rejects(f.call('phantom.detail', { topic: 'tasks', id: 'task_2' }), /another workspace/);
});

test('Phantom detail reads only bounded authorized run artifacts and preserves both reasons', async t => {
  const f = await fixture(t);
  const cli = path.join(f.home, 'cli.mjs'), nativeHome = path.join(f.home, 'native');
  await writeFile(cli, '// Inert fixture');
  f.context.state.settings.phantomPath = cli;
  f.context.state.settings.phantomData = nativeHome;
  const runId = 'run_3c2a8df1-58a5-4045-94b4-6bf1e19e585b';
  const dir = path.join(nativeHome, 'artifacts', runId);
  await mkdir(dir, { recursive: true });
  const task = { id: 'task_owned', status: 'cancelled', reason: 'Cancelada por Carlos', contract: { workspace: f.root, checks: [{ name: 'build' }] }, run: { id: runId, status: 'failed', reason: 'Baseline falló', turns: 0, result: { artifacts: f.home } } };
  f.context.execFile = async (file, args) => {
    if (file === 'git') throw new Error('No worktree family in fixture');
    assert.ok(args.includes('show'));
    return { stdout: JSON.stringify(task), stderr: '' };
  };
  const read = () => f.call('phantom.detail', { topic: 'tasks', id: task.id });
  assert.equal((await read()).run.evidence.baseline.available, false);
  const checks = [{ name: 'build', passed: true, argv: ['npm', 'run', 'build'], durationMs: 120 }, { name: 'voice-desktop', passed: false, argv: ['node', 'test/voice-desktop.mjs'], executedArgv: ['node', 'test/voice-desktop.mjs'], stderr: 'AssertionError captureBoth línea 57: Cancelar audio cubierto por textarea', durationMs: 99 }];
  const baseline = path.join(dir, 'baseline-checks.json');
  await writeFile(baseline, JSON.stringify(checks));
  let result = await read();
  assert.equal(result.status, 'cancelled'); assert.equal(result.reason, task.reason);
  assert.equal(result.run.reason, 'Baseline falló'); assert.equal(result.run.turns, 0);
  assert.deepEqual(result.run.evidence.baseline.checks, checks);
  assert.ok(result.run.evidence.verification.every(round => !round.available));
  await writeFile(path.join(dir, 'verification-0.json'), JSON.stringify({ round: 0, passed: true, checks: [checks[0]], snapshot: 'PRIVATE', patch: 'PRIVATE' }));
  result = await read();
  assert.equal(result.run.evidence.verification[0].available, true);
  assert.ok(!JSON.stringify(result.run.evidence).includes('PRIVATE'));
  for (const value of ['{invalid', '{}', '[null]', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    await writeFile(baseline, value);
    assert.equal((await read()).run.evidence.baseline.available, false);
  }
  const external = path.join(f.home, 'external.json'); await writeFile(external, JSON.stringify(checks));
  await rm(baseline); await symlink(external, baseline);
  assert.match((await read()).run.evidence.baseline.reason, /Symlink/);
  await rm(dir, { recursive: true });
  const outside = path.join(f.home, 'outside-run'); await mkdir(outside);
  await writeFile(path.join(outside, 'baseline-checks.json'), JSON.stringify(checks));
  await symlink(outside, dir);
  assert.match((await read()).run.evidence.baseline.reason, /Symlink/);
  await rm(dir); await rm(path.dirname(dir), { recursive: true });
  await symlink(f.home, path.dirname(dir));
  assert.match((await read()).run.evidence.baseline.reason, /Symlink/);
  task.run.id = '../external';
  assert.equal((await read()).run.evidence.available, false);
  task.contract.workspace = f.home;
  await assert.rejects(read(), /another workspace/);
  task.contract.workspace = f.root; task.id = 'task_other';
  await assert.rejects(f.call('phantom.detail', { topic: 'tasks', id: 'task_owned' }), /ID mismatch/);
});

test('Phantom failures never report success and ambiguous writes cannot be blindly retried', async t => {
  const f = await fixture(t, true);
  let writes = 0;
  f.context.execFile = async (file, args) => {
    if (file === 'git') throw new Error('no git transport');
    if (args.includes('memory-add')) writes++;
    throw new Error('transport failed after execution may have started');
  };
  const list = await f.call('phantom.list', { topic: 'tasks' }); assert.equal(list.available, false); assert.match(list.reason, /Phantom unavailable/);
  const payload = { kind: 'decision', input: { key: 'key', title: 'Decision', body: 'Explicit body' } };
  await assert.rejects(f.call('phantom.create', payload), /transport failed/);
  await assert.rejects(f.call('phantom.create', payload), /uncertain outcome/); assert.equal(writes, 1);
  await assert.rejects(f.call('phantom.control', { id: 'task_x', action: 'stop' }), /owned by this host/);
});

test('Phantom run timeout defaults to six hours and accepts only integer minutes from 1 to 1440', () => {
  assert.equal(runTimeoutMs(), 6 * 3600000);
  assert.equal(runTimeoutMs({}), 6 * 3600000);
  for (const phantomRunTimeoutMinutes of [undefined, 0, 1441, 2.5, '30']) {
    assert.equal(runTimeoutMs({ phantomRunTimeoutMinutes }), 6 * 3600000);
  }
  for (const phantomRunTimeoutMinutes of [1, 30, 1440]) {
    assert.equal(runTimeoutMs({ phantomRunTimeoutMinutes }), phantomRunTimeoutMinutes * 60000);
  }
});

test('Phantom controllers use host Node argv, owned SIGINT, bounded output and retained events', async t => {
  const f = await fixture(t);
  const task = { id: 'task_owned', kind: 'card', status: 'ready', contract: { workspace: f.root, goal: 'Owned' } };
  const calls = [], children = [];
  f.context.execFile = async (file, args) => {
    calls.push(args); if (file === 'git') throw new Error('no git');
    return { stdout: JSON.stringify(task), stderr: '' };
  };
  f.context.spawn = (file, args, options) => {
    assert.equal(file, process.execPath); assert.equal(options.shell, false);
    assert.deepEqual(args.slice(0, 2), ['--import', controllerPreload]); assert.ok(path.isAbsolute(args[1])); assert.ok(path.isAbsolute(args[2]));
    assert.deepEqual(args.slice(3), ['run', 'task_owned', '--model', 'claude-code/haiku', '--json']);
    const child = new EventEmitter(); child.pid = 123456; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.signals = []; child.kill = signal => { child.signals.push(signal); return true; }; children.push(child); return child;
  };
  const [descriptor, concurrent] = await Promise.all([
    f.call('phantom.control', { id: task.id, action: 'run', model: 'claude-code/haiku' }),
    f.call('phantom.control', { id: task.id, action: 'run', model: 'claude-code/haiku' }),
  ]);
  assert.equal(concurrent.id, descriptor.id);
  assert.equal(descriptor.status, 'running'); assert.equal(children.length, 1);
  // The descriptor records what was requested, never a confirmed runtime.
  assert.equal(descriptor.requestedModel, 'claude-code/haiku'); assert.equal(descriptor.modelSource, 'payload'); assert.equal(descriptor.engine, 'claude-code'); assert.equal(descriptor.observedModel, undefined);
  assert.equal((await f.call('phantom.control', { id: task.id, action: 'verify' })).id, descriptor.id);
  children[0].stdout.write('x'.repeat(1100000));
  await f.call('phantom.control', { id: descriptor.id, action: 'stop' }); assert.deepEqual(children[0].signals, ['SIGINT']);
  children[0].emit('close', 1, 'SIGINT');
  assert.equal(f.workspace.phantomControllers[0].status, 'failed'); assert.equal(f.workspace.phantomControllers[0].truncated, true); assert.ok(f.workspace.phantomControllers[0].output.length <= 65536);
  assert.ok(f.context.events.some(e => e.type === 'tool.output' && e.workspaceId === f.workspace.id));
  assert.ok(f.context.events.some(e => e.type === 'tool.status' && e.status === 'failed'));
  await assert.rejects(f.call('phantom.control', { id: descriptor.id, action: 'stop' }), /No active controller/);
  assert.equal(f.context.events.filter(e => e.type === 'tool.output').reduce((n, e) => n + Buffer.byteLength(e.data), 0), 1048576);
  const cancel = await f.call('phantom.control', { id: task.id, action: 'cancel' }); assert.equal(cancel.id, task.id); assert.ok(calls.some(args => args.includes('cancel')));
});

async function policyRun(t, contract, config = {}) {
  const f = await fixture(t);
  const task = { id: 'task_policy', kind: 'card', status: 'ready', contract: { workspace: f.root, goal: 'Policy', ...contract } };
  const spawned = [];
  f.context.execFile = async (file) => { if (file === 'git') throw new Error('no git'); return { stdout: JSON.stringify(task), stderr: '' }; };
  f.context.spawn = (file, args) => {
    spawned.push(args.slice(3));
    const child = new EventEmitter(); child.pid = 1; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true; return child;
  };
  f.workspace.plugins = { phantom: { enabled: true, config: { phantomPath: '', phantomData: '', model: '', ...config } } };
  return { ...f, task, spawned, run: payload => f.call('phantom.control', { id: task.id, action: 'run', ...payload }) };
}

test('Claude-only: contract, judge and child models must be Claude even when the payload model is Claude', async t => {
  for (const [contract, where] of [
    [{ model: 'opencode/gpt-5' }, /contrato/],
    [{ model: 'claude-code/sonnet', judge: { model: 'openai/gpt-5' } }, /juez del contrato/],
    [{ coordination: { children: [{ id: 'a', model: 'claude-code/haiku' }, { id: 'b', model: 'provider/model' }] } }, /hijo b/],
    [{ coordination: { children: [{ id: 'a', judge: { model: 'gpt-4' } }] } }, /juez del hijo a/],
  ]) {
    const f = await policyRun(t, contract);
    await assert.rejects(f.run({ model: 'claude-code/sonnet' }), where);
    await assert.rejects(f.run({ model: 'claude-code/sonnet' }), /Claude Code/);
    assert.deepEqual(f.spawned, [], 'no process starts and the task is untouched');
    assert.deepEqual(f.workspace.phantomControllers ?? [], []);
  }
});

test('Claude-only: explicit non-Claude payload or stored plugin model blocks; empty falls back to claude-code/sonnet', async t => {
  let f = await policyRun(t, {});
  await assert.rejects(f.run({ model: 'openai/gpt-5' }), /no es Claude Code.*claude-code\/sonnet/);
  assert.deepEqual(f.spawned, []);
  f = await policyRun(t, {}, { model: 'provider/legacy' });
  await assert.rejects(f.run({}), /provider\/legacy.*no es Claude Code/);
  assert.deepEqual(f.spawned, []);
  f = await policyRun(t, {});
  const descriptor = await f.run({});
  assert.deepEqual(f.spawned, [['run', 'task_policy', '--model', 'claude-code/sonnet', '--json']]);
  assert.equal(descriptor.requestedModel, 'claude-code/sonnet'); assert.equal(descriptor.modelSource, 'default');
  f = await policyRun(t, { model: 'claude-code/opus' });
  assert.equal((await f.run({})).requestedModel, 'claude-code/opus');
  f = await policyRun(t, { model: 'claude-code/opus' }, { model: 'claude-code/haiku' });
  // The contract's fixed model wins over payload and plugin config, exactly as the harness runtime does.
  const fixed = await f.run({ model: 'claude-code/sonnet' });
  assert.equal(fixed.requestedModel, 'claude-code/opus'); assert.equal(fixed.modelSource, 'contract');
  assert.deepEqual(f.spawned.at(-1), ['run', 'task_policy', '--model', 'claude-code/opus', '--json']);
  f = await policyRun(t, {}, { model: 'claude-code/haiku' });
  const payloadWins = await f.run({ model: 'sonnet' });
  assert.equal(payloadWins.requestedModel, 'claude-code/sonnet'); assert.equal(payloadWins.modelSource, 'payload');
});

test('Docker rejects names/images without labels, foreign workdirs and config-file symlink escapes', async t => {
  const f = await dockerFixture(t);
  await symlink(path.join(f.home, 'foreign.yml'), path.join(f.root, 'escape-compose.yml'));
  const variants = [
    { ...f.container, Config: { Image: f.root, Labels: {} }, Name: `/project-${path.basename(f.root)}` },
    { ...f.container, Config: { Labels: { ...f.container.Config.Labels, 'com.docker.compose.project.working_dir': f.home } } },
    { ...f.container, Config: { Labels: { ...f.container.Config.Labels, 'com.docker.compose.project.config_files': path.join(f.root, 'escape-compose.yml') } } },
  ];
  for (const container of variants) {
    f.setInspected([container]); assert.equal((await f.call('docker.list')).items.length, 0);
    await assert.rejects(f.call('docker.logs', { id: f.id }), /not owned/);
  }
});

test('Phantom pending creation deduplicates concurrently and rejects conflicting idempotency keys', async t => {
  const f = await fixture(t), input = { key: 'same', title: 'One decision', body: 'No duplicate creation.' };
  let count = 0;
  f.context.execFile = async (file, args) => {
    assert.equal(file, process.execPath); assert.ok(args.includes('memory-add'));
    count++;
    const note = JSON.parse(await readFile(args[args.indexOf('memory-add') + 1], 'utf8'));
    assert.equal(note.kind, 'decision'); assert.ok(args.includes('--workspace'));
    await new Promise(resolve => setTimeout(resolve, 20));
    return { stdout: JSON.stringify({ id: 'mem_once', revision: 1, ...note }), stderr: '' };
  };
  const payload = { kind: 'decision', input, idempotencyKey: 'retry-token' };
  const [first, second] = await Promise.all([f.call('phantom.create', payload), f.call('phantom.create', payload)]);
  assert.equal(first.id, second.id); assert.equal(count, 1);
  await assert.rejects(f.call('phantom.create', { ...payload, input: { ...input, body: 'Different intent' } }), /different input/);
});

test('unknown integrations delegate to the independently supplied automation handler', async t => {
  const f = await fixture(t);
  assert.deepEqual(await handleIntegration('nonexistent.method', {}, f.context), { handled: false });
  const response = await handleIntegration('playground.list', { workspaceId: f.workspace.id }, f.context);
  // When automation has not landed yet, the adapter remains importable and returns unhandled.
  if (response.handled) assert.ok(Array.isArray(response.result.items));
});

test('command transport enforces output and execution-time bounds without a shell', async () => {
  await assert.rejects(command({}, process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { maxBuffer: 1024 }), /maxBuffer/);
  await assert.rejects(command({}, process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 40 }), error => error.killed === true);
});

test('recover and verify use owned native controller argv without models', async t => {
  const f = await fixture(t), children = [], seen = [];
  f.context.execFile = async (file, args) => {
    if (file === 'git') throw new Error('No Git transport');
    return { stdout: JSON.stringify({ id: 'task_recovery', status: 'recovered', contract: { workspace: f.root } }), stderr: '' };
  };
  f.context.spawn = (file, args, options) => {
    seen.push(args); assert.equal(file, process.execPath); assert.equal(options.shell, false); assert.ok(!args.includes('--model'));
    assert.deepEqual(args.slice(0, 2), ['--import', controllerPreload]); assert.ok(path.isAbsolute(args[1])); assert.ok(path.isAbsolute(args[2]));
    const child = new EventEmitter(); child.pid = 98765; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true; children.push(child); return child;
  };
  for (const action of ['recover', 'verify']) {
    const descriptor = await f.call('phantom.control', { id: 'task_recovery', action });
    assert.equal(descriptor.action, action); assert.deepEqual(seen.at(-1).slice(3), [action, 'task_recovery', '--json']);
    children.at(-1).emit('close', 0, null);
  }
  assert.equal(f.workspace.phantomControllers.length, 2); assert.ok(f.workspace.phantomControllers.every(d => d.status === 'completed'));
});
