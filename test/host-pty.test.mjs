import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHost } from '../host/server.mjs';
import { connectHost } from '../desktop/host-client.mjs';
import { SETUP_MARKER } from '../host/worktree-setup.mjs';

async function until(fn,ms=5000) {const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,30));}throw new Error('Timed out waiting for PTY output');}

function setupRepository(root, mode) {
  const repository = path.join(root, 'repository');
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ name: 'host-setup-fixture', version: '1.0.0', scripts: { install: 'node install.cjs' } }));
  fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({ name: 'host-setup-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'host-setup-fixture', version: '1.0.0', hasInstallScript: true } } }));
  fs.writeFileSync(path.join(repository, '.npmrc'), 'offline=true\nregistry=http://127.0.0.1:1\nignore-scripts=false\n');
  fs.writeFileSync(path.join(repository, 'install.cjs'), `const fs=require('node:fs');
fs.writeFileSync('install-count',String(Number(fs.existsSync('install-count')?fs.readFileSync('install-count','utf8'):0)+1));
if(fs.existsSync('fail')) {console.error('HOST_SETUP_FIXTURE_FAILED');process.exit(7);}
if(fs.existsSync('slow')) {
  const child=require('node:child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
  fs.writeFileSync('descendant-pid',String(child.pid));
  setInterval(()=>{},1000);
}
`);
  fs.writeFileSync(path.join(repository, mode), 'yes');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Offline npm fixture');
  return { repository, git };
}

test('background dependency failure preserves a writable shell; retry, attach and restart preserve worktree', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-host-setup-'));
  const { repository, git } = setupRepository(root, 'fail');
  const dataDir = path.join(root, 'state');
  let host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: repository });
  const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal' });
  const create = () => host.invoke('terminal.create', { workspaceId: workspace.id, nodeId: node.id, shell: '/bin/sh' });
  const initial = await create();
  await until(() => host.terminals.get(initial.session.id).setup?.status === 'failed', 15000);
  assert.match(host.terminals.get(initial.session.id).setup.error, /HOST_SETUP_FIXTURE_FAILED/);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8')).workspaces.find(w => w.id === workspace.id).nodes.find(n => n.id === node.id).data;
  assert.ok(saved.worktree.branch);
  assert.equal(saved.cwd, saved.worktree.path);
  assert.equal(host.terminals.live.size, 1);
  assert.equal(git('worktree', 'list', '--porcelain').match(/^worktree /gm).length, 2);
  assert.equal(fs.existsSync(path.join(repository, 'node_modules')), false);
  fs.writeFileSync(path.join(saved.cwd, 'private-change.txt'), 'preserved');
  fs.unlinkSync(path.join(saved.cwd, 'fail'));
  const launched = initial;
  await host.invoke('terminal.write', {sessionId: initial.session.id, data: "printf 'AGENT_%s\\n' 'READY'\n"});
  await until(async () => (await host.invoke('terminal.attach', {sessionId: initial.session.id})).data.includes('AGENT_READY'));
  await until(() => !host.terminals.setupJobs.size);
  await host.invoke('terminal.setup.retry', {sessionId: initial.session.id});
  await until(() => host.terminals.get(initial.session.id).setup?.status === 'ready', 15000);
  assert.equal(launched.session.cwd, saved.cwd);
  assert.equal(launched.session.worktree.branch, saved.worktree.branch);
  assert.equal(fs.readFileSync(path.join(saved.cwd, 'install-count'), 'utf8'), '2');
  // A changed lock does not install on attach or a new transport connection.
  fs.appendFileSync(path.join(saved.cwd, 'package-lock.json'), '\n');
  const client = await connectHost({ dataDir });
  try { assert.equal((await client.invoke('terminal.attach', { sessionId: launched.session.id })).session.pid, launched.session.pid); }
  finally { client.close(); }
  assert.equal(fs.readFileSync(path.join(saved.cwd, 'install-count'), 'utf8'), '2');
  await host.close();
  host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  assert.equal(fs.readFileSync(path.join(saved.cwd, 'install-count'), 'utf8'), '2');
  assert.equal(host.terminals.live.size, 0);
  const retried = await create();
  assert.equal(retried.session.cwd, saved.cwd);
  await until(() => host.terminals.get(retried.session.id).setup?.status === 'ready', 15000);
  assert.equal(fs.readFileSync(path.join(saved.cwd, 'install-count'), 'utf8'), '3');
  assert.equal(fs.readFileSync(path.join(saved.cwd, 'private-change.txt'), 'utf8'), 'preserved');
  assert.equal(git('worktree', 'list', '--porcelain').match(/^worktree /gm).length, 2);
});

for (const action of ['host', 'terminal']) test(`closing ${action} during npm ci cancels setup and reaps lifecycle descendants`, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-host-setup-close-'));
  const { repository } = setupRepository(root, 'slow');
  const dataDir = path.join(root, 'state');
  let host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const workspace = await host.invoke('workspace.open', { path: repository });
  const node = await host.invoke('node.create', { workspaceId: workspace.id, type: 'terminal' });
  const launched = await host.invoke('terminal.create', { workspaceId: workspace.id, nodeId: node.id, shell: '/bin/sh' });
  assert.equal(launched.session.status, 'running');
  assert.equal(launched.session.setup.status, 'queued');
  const cwd = await until(() => {
    const cwd = host.store.getWorkspace(workspace.id).nodes.find(n => n.id === node.id).data.cwd;
    return cwd && fs.existsSync(path.join(cwd, 'descendant-pid')) && cwd;
  }, 15000);
  const pid = Number(fs.readFileSync(path.join(cwd, 'descendant-pid'), 'utf8'));
  if (action === 'host') await host.close();
  else await host.invoke('terminal.close', { workspaceId: workspace.id, nodeId: node.id });
  assert.equal(host.terminals.setupJobs.size, 0);
  assert.equal(host.terminals.live.size, 0);
  await until(() => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z'); } catch { return true; } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules', SETUP_MARKER), 'utf8')).state, 'incomplete');
  if (action === 'host') {
    host = await createHost({ dataDir, handleIntegration: () => ({ handled: false }) });
    assert.equal(fs.readFileSync(path.join(cwd, 'install-count'), 'utf8'), '1');
    fs.unlinkSync(path.join(cwd, 'slow'));
    const retry = await host.invoke('terminal.create', { workspaceId: workspace.id, nodeId: node.id, shell: '/bin/sh' });
    assert.equal(retry.session.cwd, cwd);
    await until(() => host.terminals.get(retry.session.id).setup?.status === 'ready', 15000);
    assert.equal(fs.readFileSync(path.join(cwd, 'install-count'), 'utf8'), '2');
  } else assert.equal(host.store.getWorkspace(workspace.id).nodes.some(n => n.id === node.id), false);
});

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
test('configured shell is used for new sessions and explicit per-session shell takes precedence',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-shell-pref-'));
  const host=await createHost({dataDir:path.join(root,'state'),handleIntegration:()=>({handled:false})});
  t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
  const w=await host.invoke('workspace.open',{path:root});
  await host.invoke('settings.update',{patch:{shell:'/bin/sh'}});
  const preferred=await host.invoke('terminal.create',{workspaceId:w.id});
  assert.equal(preferred.session.shell,'/bin/sh');assert.equal(preferred.session.cwd,w.canonicalPath);
  await host.invoke('terminal.write',{sessionId:preferred.session.id,data:"printf 'CONFIGURED_SHELL_%s\\n' \"$0\"\n"});
  await until(async()=>/CONFIGURED_SHELL_.*sh/.test((await host.invoke('terminal.attach',{sessionId:preferred.session.id})).data));
  const explicit=await host.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/bash'});
  assert.equal(explicit.session.shell,'/bin/bash');
  await host.close();
  const history=JSON.parse(fs.readFileSync(path.join(root,'state','terminals.json'),'utf8'));
  assert.equal(history.find(s=>s.id===preferred.session.id).shell,'/bin/sh');
});
test('real PTY write/resize, isolated output, ANSI reattach, explicit shutdown',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-pty-'));let c;
  const events=[],host=await createHost({dataDir:path.join(root,'state'),handleIntegration:()=>({handled:false})});t.after(async()=>{c?.close();await host.close();fs.rmSync(root,{recursive:true,force:true});});
  const a=await host.invoke('workspace.open',{path:root});const otherFolder=path.join(root,'other');fs.mkdirSync(otherFolder);const b=await host.invoke('workspace.open',{path:otherFolder});
  host.emit=e=>events.push(e);
  c=await connectHost({dataDir:host.store.dir,onEvent:e=>events.push(e)});
  const one=await c.invoke('terminal.create',{workspaceId:a.id,shell:'/bin/bash'}),two=await c.invoke('terminal.create',{workspaceId:b.id,shell:'/bin/bash'});
  assert.ok(one.session.pid>0);await assert.rejects(c.invoke('terminal.create',{workspaceId:a.id,nodeId:one.node.id}),/already/);
  await c.invoke('terminal.resize',{sessionId:one.session.id,cols:100,rows:32});await assert.rejects(c.invoke('terminal.resize',{sessionId:one.session.id,cols:0,rows:24}),/bounds/);
  await c.invoke('terminal.write',{sessionId:one.session.id,data:"printf '\\033[31mPTY_MARKER_RED\\033[0m\\n'; stty size\n"});
  const snap=await until(async()=>{const s=await c.invoke('terminal.attach',{sessionId:one.session.id});return s.data.includes('PTY_MARKER_RED')&&s.data.includes('32 100')?s:null;});assert.equal(snap.session.cols,100);assert.ok(snap.seq>0);assert.match(snap.data,/\x1b\[/);
  assert.ok(!(await c.invoke('terminal.attach',{sessionId:two.session.id})).data.includes('PTY_MARKER_RED'));
  assert.ok(events.filter(e=>e.type==='terminal.output'&&e.data.includes('PTY_MARKER_RED')).every(e=>e.workspaceId===a.id));
  await c.invoke('terminal.write',{sessionId:one.session.id,data:"printf '\\033[?1049h\\033[2J\\033[HALTERNATE_SCREEN_MARKER'; sleep 0.2\n"});
  await until(async()=>{const s=await c.invoke('terminal.attach',{sessionId:one.session.id});return s.data.includes('ALTERNATE_SCREEN_MARKER')&&s.data.includes('\x1b[?1049h');});
  await c.invoke('terminal.write',{sessionId:one.session.id,data:"printf '\\033[?1049l'; sleep 60 & printf 'OWNED_CHILD:%s\\n' \"$!\"; wait\n"});
  const childSnapshot=await until(async()=>{const s=await c.invoke('terminal.attach',{sessionId:one.session.id});return /OWNED_CHILD:\d+/.test(s.data)?s:null;});const childPid=Number(/OWNED_CHILD:(\d+)/.exec(childSnapshot.data)[1]);
  c.close();const reattach=await connectHost({dataDir:host.store.dir});assert.equal((await reattach.invoke('terminal.attach',{sessionId:one.session.id})).session.pid,one.session.pid);reattach.close();
  await host.close();assert.equal(host.terminals.get(one.session.id).status,'exited');assert.equal(host.terminals.live.size,0);
  await until(()=>{try{return fs.readFileSync(`/proc/${childPid}/stat`,'utf8').split(') ')[1].startsWith('Z');}catch{return true;}});
});
test('cold daemon restart restores readable snapshot as lost, never spawns restored sessions',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-cold-'));const dataDir=path.join(root,'state');let client,restored;
  const child=spawn(process.execPath,[new URL('../host/server.mjs',import.meta.url).pathname,'--data',dataDir],{stdio:['ignore','pipe','pipe']});
  t.after(async()=>{client?.close();if(child.exitCode===null && child.signalCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await done;}await restored?.close();fs.rmSync(root,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error(`Host exited ${code}`)));});
  client=await connectHost({dataDir});const w=await client.invoke('workspace.open',{path:root});const {session}=await client.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/bash'});
  await client.invoke('terminal.write',{sessionId:session.id,data:"printf 'COLD_SCREEN_MARKER\\n'\n"});await until(async()=>{const file=path.join(dataDir,'terminals.json');return fs.existsSync(file)&&fs.readFileSync(file,'utf8').includes('COLD_SCREEN_MARKER');});
  client.close();const exited=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exited;
  restored=await createHost({dataDir,handleIntegration:()=>({handled:false})});
  const snap=await restored.invoke('terminal.attach',{sessionId:session.id});assert.equal(snap.session.status,'lost');assert.equal(snap.session.pid,null);assert.match(snap.data,/COLD_SCREEN_MARKER/);assert.equal(restored.terminals.live.size,0);
  await assert.rejects(restored.invoke('terminal.write',{sessionId:session.id,data:'echo no\n'}),/not running/);
});

test('same-socket terminal controls and state bypass saturated slow integrations', {timeout:15000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-priority-'));let client,started=0,release;
  const gate=new Promise(r=>{release=r;}),events=[];
  const host=await createHost({dataDir:path.join(root,'state'),handleIntegration:async(method,p)=>{started++;await gate;return {handled:true,result:{token:p.token}};}});
  t.after(async()=>{release();client?.close();await host.close();fs.rmSync(root,{recursive:true,force:true});});
  client=await connectHost({dataDir:host.store.dir,onEvent:e=>events.push(e)});const w=await client.invoke('workspace.open',{path:root}),{session}=await client.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/bash'});
  const slow=Array.from({length:12},(_,token)=>client.invoke('fixture.slow',{workspaceId:w.id,token}));await until(()=>started===8);
  const state=await client.invoke('state.get');assert.equal(state.activeWorkspaceId,w.id);
  await client.invoke('terminal.write',{sessionId:session.id,data:"printf 'PRIORITY_%s\\n' 'READY'\n"});
  await until(()=>events.some(e=>e.type==='terminal.output'&&e.sessionId===session.id&&e.data.includes('PRIORITY_READY')));
  assert.equal(started,8);await client.invoke('terminal.stop',{sessionId:session.id});await until(()=>host.terminals.get(session.id).status==='exited');
  release();assert.deepEqual(await Promise.all(slow),Array.from({length:12},(_,token)=>({token})));
});

test('removing a live terminal rejects, hiding preserves it, stopped removal keeps history and one exit attention',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-remove-')),host=await createHost({dataDir:path.join(root,'state'),handleIntegration:()=>({handled:false})});t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
  const w=await host.invoke('workspace.open',{path:root}),{session,node}=await host.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/bash'});
  await assert.rejects(host.invoke('node.remove',{workspaceId:w.id,id:node.id}),/hide.*stop/);assert.equal(host.terminals.get(session.id).status,'running');
  await host.invoke('node.update',{workspaceId:w.id,id:node.id,patch:{data:{...node.data,hidden:true}}});assert.equal(host.terminals.get(session.id).status,'running');
  await host.invoke('terminal.write',{sessionId:session.id,data:"printf 'REMOVAL_%s\\n' 'HISTORY'; exit 7\n"});await until(()=>host.terminals.get(session.id).status==='exited');
  await host.invoke('node.remove',{workspaceId:w.id,id:node.id});assert.equal(host.store.getWorkspace(w.id).nodes.length,0);
  for(let i=0;i<3;i++)assert.match((await host.invoke('terminal.attach',{sessionId:session.id})).data,/REMOVAL_HISTORY/);
  const attention=await host.invoke('attention.list',{workspaceId:w.id});assert.equal(attention.length,1);assert.equal(attention[0].sessionId,session.id);assert.equal(attention[0].source,'terminal');assert.equal(attention[0].exitCode,7);assert.ok(attention[0].observedAt);
  await host.close();const restored=await createHost({dataDir:path.join(root,'state'),handleIntegration:()=>({handled:false})});try{assert.match((await restored.invoke('terminal.attach',{sessionId:session.id})).data,/REMOVAL_HISTORY/);assert.equal((await restored.invoke('attention.list',{workspaceId:w.id})).length,1);}finally{await restored.close();}
});

test('closing a terminal removes its process tree, panel and session without affecting another terminal',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-close-')),dataDir=path.join(root,'state');
  const host=await createHost({dataDir,handleIntegration:()=>({handled:false})});
  t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
  const w=await host.invoke('workspace.open',{path:root});
  const one=await host.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/bash'}),two=await host.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/bash'});
  await host.invoke('terminal.write',{sessionId:one.session.id,data:"sleep 60 & printf 'CLOSE_CHILD:%s\\n' \"$!\"; wait\n"});
  const snap=await until(async()=>{const s=await host.invoke('terminal.attach',{sessionId:one.session.id});return /CLOSE_CHILD:\d+/.test(s.data)?s:null;});
  const childPid=Number(/CLOSE_CHILD:(\d+)/.exec(snap.data)[1]);
  const close=host.invoke('terminal.close',{workspaceId:w.id,nodeId:one.node.id});
  await assert.rejects(host.invoke('terminal.create',{workspaceId:w.id,nodeId:one.node.id}),/closing/);
  await close;
  assert.deepEqual((await host.invoke('terminal.list',{workspaceId:w.id})).map(s=>s.id),[two.session.id]);
  assert.equal(host.store.getWorkspace(w.id).nodes.some(n=>n.id===one.node.id),false);
  assert.equal(host.terminals.live.has(one.session.id),false);
  await until(()=>{try{return fs.readFileSync(`/proc/${childPid}/stat`,'utf8').split(') ')[1].startsWith('Z');}catch{return true;}});
  await assert.rejects(host.invoke('terminal.attach',{sessionId:one.session.id}),/not found/);
  await host.invoke('terminal.write',{sessionId:two.session.id,data:"printf 'STILL_%s\\n' 'WRITABLE'\n"});
  await until(async()=>(await host.invoke('terminal.attach',{sessionId:two.session.id})).data.includes('STILL_WRITABLE'));
  await host.close();
  const restored=await createHost({dataDir,handleIntegration:()=>({handled:false})});
  try {assert.deepEqual((await restored.invoke('terminal.list',{workspaceId:w.id})).map(s=>s.id),[two.session.id]);}
  finally {await restored.close();}
});

test('noisy offscreen PTY pauses/resumes instead of dying and an independent shell remains responsive',{timeout:30000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-noisy-')),host=await createHost({dataDir:path.join(root,'state'),handleIntegration:()=>({handled:false})});t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
  const w=await host.invoke('workspace.open',{path:root}),noisy=await host.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/bash'}),quiet=await host.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/bash'}),entry=host.terminals.live.get(noisy.session.id);
  // Exercise actual PTY flow control under a deliberately slow headless consumer.
  const write=entry.terminal.write.bind(entry.terminal);entry.terminal.write=(data,callback)=>write(data,()=>setTimeout(callback,100));
  let outputTail='';const outputListener=entry.child.onData(data=>{outputTail=(outputTail+data).slice(-1024);});t.after(()=>outputListener.dispose());
  await host.invoke('terminal.write',{sessionId:noisy.session.id,data:`'${process.execPath}' -e "for(let i=0;i<30000;i++)process.stdout.write('x'.repeat(79)+'\\n');console.log('NOISY_'+'DONE')"\n`});
  await until(()=>entry.pauseCount>0,10000);assert.equal(host.terminals.get(noisy.session.id).status,'running');entry.terminal.write=write;
  await host.invoke('terminal.write',{sessionId:quiet.session.id,data:"printf 'QUIET_%s\\n' 'RESPONSIVE'\n"});
  await until(async()=>{const snapshot=await host.invoke('terminal.attach',{sessionId:quiet.session.id});return snapshot.data.includes('QUIET_RESPONSIVE');},3000);
  await until(()=>outputTail.includes('NOISY_DONE'),20000);
  assert.equal(host.terminals.get(noisy.session.id).status,'running');assert.ok(entry.pauseCount>0&&entry.resumeCount>0);assert.ok(entry.maxPending<=512*1024,`Parser backlog exceeded bound: ${entry.maxPending}`);
  assert.ok(entry.snapshotCount<host.terminals.get(noisy.session.id).seq/2,'Snapshots should not serialize every chunk');
  const snapshot=await host.invoke('terminal.attach',{sessionId:noisy.session.id});assert.match(snapshot.data,/NOISY_DONE/);assert.ok(snapshot.truncated);assert.ok(snapshot.data.length<=256*1024);await host.terminals.flush();host.terminals.save();assert.ok(fs.statSync(host.terminals.filename).size<9*1024*1024);
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
