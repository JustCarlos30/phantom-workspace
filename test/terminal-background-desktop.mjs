import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { killElectronGroup } from './support/electron-process.mjs';

// Real Electron/PTY/npm, synthetic offline repository and private profile. No models.
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp('/tmp/phantom-background-desktop-');
const repo = path.join(temp, 'repo'); await fs.mkdir(repo);
const git = (...args) => execFileSync('git', ['-C', repo, ...args]);
git('init','-b','main');
await fs.writeFile(path.join(repo,'package.json'),JSON.stringify({name:'desktop-background-fixture',version:'1.0.0',scripts:{install:'node install.cjs'}}));
await fs.writeFile(path.join(repo,'package-lock.json'),JSON.stringify({name:'desktop-background-fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'desktop-background-fixture',version:'1.0.0',hasInstallScript:true}}}));
await fs.writeFile(path.join(repo,'.npmrc'),'offline=true\nignore-scripts=false\nregistry=http://127.0.0.1:1\n');
await fs.writeFile(path.join(repo,'fail'),'yes');
await fs.writeFile(path.join(repo,'install.cjs'),`const fs=require('node:fs');console.log('DEPENDENCIES_RUNNING');const timer=setInterval(()=>{if(fs.existsSync('release')){clearInterval(timer);if(fs.existsSync('fail')){console.error('OFFLINE_FIXTURE_FAILURE');process.exitCode=7;}}},50);`);
git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Synthetic background install');
const env={...process.env,PHANTOM_WORKSPACE_HOME:path.join(temp,'profile'),PHANTOM_NODE_BINARY:process.execPath,SHELL:'/bin/sh'};
delete env.ELECTRON_RUN_AS_NODE;delete env.PHANTOM_RENDERER_URL;
const app=await electron.launch({executablePath:process.env.PHANTOM_TEST_EXECUTABLE,args:process.env.PHANTOM_TEST_EXECUTABLE?[]:[root],cwd:root,env,timeout:20000});
const page=await app.firstWindow(); page.setDefaultTimeout(10000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const invoke=(method,payload={})=>page.evaluate(([m,p])=>window.phantom.invoke(m,p),[method,payload]);
const until=async fn=>{const end=Date.now()+12000;while(Date.now()<end){if(await fn())return;await page.waitForTimeout(50);}throw new Error('Desktop condition timed out');};
let session;
try {
  await page.locator('.app-shell').waitFor();
  const w=await invoke('workspace.open',{path:repo});await page.reload();
  await page.locator('.app-shell').waitFor();
  await page.evaluate(()=>{window.connectionEvents=[];window.phantom.onEvent(e=>{if(e.type==='connection')window.connectionEvents.push(e.status);});});
  await page.locator('.create-dock').getByRole('button',{name:'Terminal',exact:true}).click();
  await until(async()=>{session=(await invoke('terminal.list',{workspaceId:w.id}))[0];return session?.setup?.status==='installing';});
  assert.equal(session.status,'running');
  await page.getByLabel('Preparación de dependencias',{exact:true}).waitFor();
  await page.getByText('Ver avance',{exact:true}).click();
  await page.getByText('DEPENDENCIES_RUNNING',{exact:false}).waitFor();
  await page.locator('.canvas-node').getByRole('button',{name:'Enfocar panel',exact:true}).click();
  const screen=await page.locator('.xterm-screen').elementHandle();
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type("printf 'AGENT_%s\\n' 'INTERACTIVE'");await page.keyboard.press('Enter');
  await until(async()=>(await invoke('terminal.attach',{sessionId:session.id})).data.includes('AGENT_INTERACTIVE'));
  await page.screenshot({path:path.join(temp,'installing.png')});
  await fs.writeFile(path.join(session.cwd,'release'),'yes');
  await page.getByRole('button',{name:'Reintentar instalación',exact:true}).waitFor();
  assert.equal((await invoke('terminal.attach',{sessionId:session.id})).session.pid,session.pid);
  await page.screenshot({path:path.join(temp,'failed.png')});
  await fs.unlink(path.join(session.cwd,'fail'));
  await page.getByRole('button',{name:'Reintentar instalación',exact:true}).click();
  await page.getByLabel('Preparación de dependencias',{exact:true}).waitFor({state:'detached'});
  assert.equal((await invoke('terminal.attach',{sessionId:session.id})).session.setup.status,'ready');
  assert.equal((await invoke('terminal.attach',{sessionId:session.id})).session.pid,session.pid);
  assert.equal(await screen.evaluate(element=>element.isConnected),true);
  assert.deepEqual(await page.evaluate(()=>window.connectionEvents.filter(s=>s==='disconnected')),[]);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,evidence:temp,checks:['interactive shell during offline npm','visible live install output','failure retained shell','retry without remount or PID change','no disconnects or page errors']}));
} finally {
  await invoke('host.shutdown').catch(()=>{});
  try { await app.close(); } finally { killElectronGroup(app.process()); }
}
