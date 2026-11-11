import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost } from '../host/server.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const temp=await mkdtemp('/tmp/opencode/phantom-agent-desktop-');
const folder=path.join(temp,'SYNTHETIC-agent-workspace');await mkdir(folder);
const evidence=path.join(root,'.impeccable/review');await mkdir(evidence,{recursive:true});
const dataDir=path.join(temp,'profile');
const card={id:'card-fixture',kind:'card',status:'ready',title:'SYNTHETIC · Autenticación',contract:{goal:'SYNTHETIC · Autenticación',workspace:folder},source:'phantom'};
const host=await createHost({dataDir,handleIntegration:async(method,p)=>{
  if(method==='phantom.list')return {handled:true,result:{available:true,items:[{...card,raw:card},{...card,id:'card-rejected',title:'SYNTHETIC · Rejected card'}]}};
  if(method==='phantom.detail'){if(p.id==='card-rejected')throw new Error('SYNTHETIC · Card unavailable; retry another card.');return {handled:true,result:card};}
  if(method==='opencode.sessions')return {handled:true,result:{available:true,items:[{id:'ses_fixture',title:'SYNTHETIC · Backend',directory:folder}]}};
  return {handled:false};
}});
const w=await host.invoke('workspace.open',{path:folder});
const terminal=await host.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/sh'});
const env={...process.env,PHANTOM_WORKSPACE_HOME:dataDir};delete env.ELECTRON_RUN_AS_NODE;delete env.PHANTOM_RENDERER_URL;
let app;
try {
  app=await electron.launch({args:[root],cwd:root,env});const page=await app.firstWindow();page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.waitForSelector('.agent-identity-toggle');
  await page.locator('.agent-identity-toggle').click();
  await page.getByLabel('Nombre del agente',{exact:true}).fill('Backend · Auth');
  await page.getByLabel('Card de Phantom',{exact:true}).selectOption('card-rejected');
  await page.getByRole('button',{name:'Guardar identidad',exact:true}).click();
  await page.locator('.agent-editor [role="alert"]').filter({hasText:'Card unavailable'}).waitFor();
  assert.equal(await page.getByLabel('Nombre del agente',{exact:true}).inputValue(),'Backend · Auth');
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>Promise.reject(new Error('SYNTHETIC · Clipboard denied'))}));
  await page.getByRole('button',{name:'Copiar contexto guardado',exact:true}).click();
  await page.locator('.agent-editor [role="alert"]').filter({hasText:'Clipboard denied'}).waitFor();
  await page.evaluate(()=>delete navigator.clipboard.writeText);
  console.log('PASS rejected save and clipboard errors remain visible inside editor with draft intact');
  await page.getByLabel('Card de Phantom',{exact:true}).selectOption('card-fixture');
  await page.getByLabel('Sesión OpenCode',{exact:true}).selectOption('ses_fixture');
  await page.getByLabel('Paso actual',{exact:true}).fill('Validando tokens');
  await page.getByLabel('Avance declarado',{exact:true}).selectOption('working');
  await page.getByRole('button',{name:'Guardar identidad',exact:true}).click();
  await page.locator('.agent-current-step').filter({hasText:'Validando tokens'}).waitFor();
  assert.equal(await page.locator('.agent-identity-toggle').evaluate(el=>el===document.activeElement),true);
  assert.equal((await host.invoke('terminal.list',{workspaceId:w.id}))[0].name,'Backend · Auth');
  console.log('PASS identity editor uses desktop bridge and saves card/OpenCode association');
  // Live reports must survive saving unrelated fields while the editor is open.
  await page.locator('.agent-identity-toggle').click();
  await host.invoke('terminal.agent.report',{sessionId:terminal.session.id,patch:{step:'Reporte en vivo',status:'blocked'}});
  await page.getByLabel('Nombre del agente',{exact:true}).fill('Backend · Tokens');
  await page.getByRole('button',{name:'Guardar identidad',exact:true}).click();
  await page.locator('.agent-current-step').filter({hasText:'Reporte en vivo'}).waitFor();
  assert.equal((await host.invoke('terminal.agent.context',{sessionId:terminal.session.id})).source,'agent');
  console.log('PASS live report is preserved during an unrelated identity edit');
  await page.getByRole('button',{name:'Ver card vinculada',exact:true}).click();
  await page.locator('.card-agents').getByRole('button',{name:'Ver terminal',exact:true}).click();
  await page.waitForSelector('.focus-mode .agent-identity');
  await page.getByRole('button',{name:'Ver card vinculada',exact:true}).click();
  assert.equal((await host.invoke('state.get')).workspaces[0].nodes.filter(n=>n.type==='tasks').length,1);
  await page.locator('.card-agents').getByRole('button',{name:'Ver terminal',exact:true}).click();
  console.log('PASS card ↔ terminal navigation reuses its panel');
  await page.reload();await page.waitForSelector('.agent-current-step');
  await page.getByRole('button',{name:'Enfocar Backend · Tokens',exact:true}).click();
  for(const [width,height,name] of [[1520,980,'agent-desktop'],[1100,760,'agent-compact']]){
    await app.evaluate(({BrowserWindow},[width,height])=>{const win=BrowserWindow.getAllWindows()[0];win.setResizable(true);win.setMinimumSize(800,600);win.setMaximumSize(10000,10000);win.setContentSize(width,height);const b=win.getBounds();win.setMinimumSize(b.width,b.height);win.setMaximumSize(b.width,b.height);win.setResizable(false);},[width,height]);
    await page.waitForTimeout(350);await page.locator('.agent-identity-toggle').click();
    await page.getByLabel('Nombre del agente',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(evidence,`${name}.png`)});
    await page.getByRole('button',{name:'Cerrar identidad',exact:true}).click();
  }
  assert.deepEqual(errors,[]);console.log('PASS reload persistence, desktop/compact rendering, no renderer errors');
} finally {await app?.close();await host.close();await rm(temp,{recursive:true,force:true});}
