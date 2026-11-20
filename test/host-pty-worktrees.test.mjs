import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHost } from '../host/server.mjs';
import { connectHost } from '../desktop/host-client.mjs';
import { until, setupRepository } from './support/host-pty-fixture.mjs';

test('new terminals use independent Git branches/worktrees and relaunch preserves uncommitted work', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-worktrees-'));
  const repository = path.join(root, 'repository'), dataDir = path.join(root, 'state');
  fs.mkdirSync(repository);
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  git(repository, 'init', '-b', 'main');
  fs.writeFileSync(path.join(repository, 'tracked.txt'), 'committed\n');
  git(repository, 'add', 'tracked.txt');
  git(repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Fixture base');
  const host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: repository });
  const [one, two] = await Promise.all([1, 2].map(() => host.invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' })));
  assert.notEqual(one.session.cwd, repository);
  assert.notEqual(one.session.cwd, two.session.cwd);
  assert.notEqual(one.session.worktree.branch, two.session.worktree.branch);
  assert.equal(git(one.session.cwd, 'branch', '--show-current'), one.session.worktree.branch);
  assert.equal(one.node.data.cwd, one.session.cwd);
  await host.invoke('terminal.write', { sessionId: one.session.id, data: 'printf "WORKTREE_CWD:%s\\n" "$PWD"\n' });
  await until(async () => (await host.invoke('terminal.attach', { sessionId: one.session.id })).data.includes(`WORKTREE_CWD:${one.session.cwd}`));
  fs.writeFileSync(path.join(one.session.cwd, 'tracked.txt'), 'private uncommitted change\n');
  assert.equal(fs.readFileSync(path.join(two.session.cwd, 'tracked.txt'), 'utf8'), 'committed\n');
  assert.equal(git(repository, 'status', '--porcelain'), '');
  await host.invoke('terminal.stop', { sessionId: one.session.id });
  await until(() => host.terminals.get(one.session.id).status === 'exited');
  const relaunched = await host.invoke('terminal.create', { workspaceId: workspace.id, nodeId: one.node.id, shell: '/bin/sh' });
  assert.equal(relaunched.session.cwd, one.session.cwd);
  assert.equal(fs.readFileSync(path.join(relaunched.session.cwd, 'tracked.txt'), 'utf8'), 'private uncommitted change\n');
  assert.equal(git(repository, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 3);
  await host.close();
  const restored = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  try {
    const resumed = await restored.invoke('terminal.create', { workspaceId: workspace.id, nodeId: one.node.id, shell: '/bin/sh' });
    assert.equal(resumed.session.cwd, one.session.cwd);
    assert.equal(fs.readFileSync(path.join(resumed.session.cwd, 'tracked.txt'), 'utf8'), 'private uncommitted change\n');
    assert.equal(git(repository, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 3);
  } finally { await restored.close(); }
});

test('non-Git and unborn repositories open normal terminals with an explicit reason; concurrent launches cannot duplicate a node', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-worktree-fallback-'));
  // Even a Node/npm-looking folder must not install without a Git worktree.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'non-git-node', scripts: { install: 'node -e "process.exit(9)"' } }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), 'deliberately invalid: setup must not run');
  const host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: root });
  const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal' });
  const results = await Promise.allSettled([1, 2].map(() => host.invoke('terminal.create', { workspaceId: workspace.id, nodeId: node.id, shell: '/bin/sh' })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const normal = results.find(result => result.status === 'fulfilled').value;
  assert.equal(normal.session.cwd, root);
  assert.equal(normal.session.worktree, null);
  assert.match(normal.session.worktreeReason, /sin repositorio Git/);
  execFileSync('git', ['init', '-b', 'main', root]);
  const unborn = await host.invoke('terminal.create', { workspaceId: workspace.id, shell: '/bin/sh' });
  assert.equal(unborn.session.cwd, root);
  assert.equal(unborn.session.worktree, null);
  assert.match(unborn.session.worktreeReason, /sin commits/);
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
});

test('twenty real terminals retain independent worktrees and stable transport under concurrent output', {timeout:30000}, async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-twenty-'));
  const {repository}=setupRepository(root,'ready');
  // This load test concerns PTYs and output; a lockless repository skips npm.
  fs.unlinkSync(path.join(repository,'package-lock.json'));
  execFileSync('git',['-C',repository,'add','-u']);
  execFileSync('git',['-C',repository,'-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Lockless terminal load fixture']);
  const events=[];
  const host=await createHost({dataDir:path.join(root,'state'),handleIntegration:()=>({handled:false})});
  let client;
  t.after(async()=>{client?.close();await host.close();fs.rmSync(root,{recursive:true,force:true});});
  client=await connectHost({dataDir:host.store.dir,onEvent:event=>events.push(event.type==='terminal.output'?{type:event.type}:event)});
  const w=await client.invoke('workspace.open',{path:repository});
  const terminals=await Promise.all(Array.from({length:20},()=>client.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/sh'})));
  assert.equal(new Set(terminals.map(t=>t.session.cwd)).size,20);
  await Promise.all(terminals.map(({session},n)=>client.invoke('terminal.write',{sessionId:session.id,data:`'${process.execPath}' -e "for(let i=0;i<1500;i++)console.log('terminal-${n} '+ 'x'.repeat(100));console.log('DONE_'+ '${n}')"\n`})));
  await until(async()=>{
    const snapshots=await Promise.all(terminals.map(({session})=>client.invoke('terminal.attach',{sessionId:session.id})));
    return snapshots.every((snapshot,n)=>snapshot.data.includes(`DONE_${n}`));
  },20000);
  assert.equal(host.terminals.live.size,20);
  assert.equal(events.filter(e=>e.type==='connection'&&e.status==='connected').length,1);
  assert.equal(events.some(e=>e.type==='connection'&&e.status==='disconnected'),false);
});
