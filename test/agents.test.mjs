import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHost } from '../host/server.mjs';
import { opencodeSessions } from '../integrations/opencode.mjs';
import { main as agentCLI } from '../scripts/agent.mjs';

async function fixture(t) {
  const root=fs.mkdtempSync('/tmp/opencode/phantom-agents-'),dataDir=path.join(root,'state');
  const handleIntegration=async(method,p)=>{
    if(method==='phantom.detail'){
      if(p.id!=='card-owned')throw new Error('Phantom task belongs to another workspace');
      return {handled:true,result:{id:p.id,kind:'card',status:'ready',contract:{goal:'Autenticación'}}};
    }
    if(method==='opencode.sessions')return {handled:true,result:{available:true,items:[{id:'ses_owned'}]}};
    return {handled:false};
  };
  let host=await createHost({dataDir,handleIntegration});
  t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
  const w=await host.invoke('workspace.open',{path:root});
  const {node,session}=await host.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/sh'});
  const update=patch=>host.invoke('terminal.agent.update',{workspaceId:w.id,nodeId:node.id,patch});
  return {root,w,node,session,update,get host(){return host;},restart:async()=>{await host.close();host=await createHost({dataDir,handleIntegration});}};
}

test('identity validates workspace ownership, survives rename/restart and preserves reports through stale presentation saves',async t=>{
  const f=await fixture(t);
  await f.update({name:'Backend · Auth',cardId:'card-owned',providerSessionId:'ses_owned'});
  await assert.rejects(f.update({cardId:'foreign'}),/another workspace/);
  await assert.rejects(f.update({providerSessionId:'ses_foreign'}),/not found/);
  await assert.rejects(f.update({status:'completed'}),/Invalid agent status/);
  await assert.rejects(f.update({step:'invalid\nline'}),/single-line/);
  const stale=structuredClone((await f.host.invoke('state.get')).workspaces[0].nodes[0].data);
  await f.host.invoke('terminal.agent.report',{sessionId:f.session.id,patch:{step:'Validando tokens',status:'working'}});
  await f.host.invoke('node.update',{workspaceId:f.w.id,id:f.node.id,patch:{title:'Auth API',data:{...stale,fontSize:18}}});
  let context=await f.host.invoke('terminal.agent.context',{sessionId:f.session.id});
  assert.equal(context.name,'Auth API');assert.equal(context.step,'Validando tokens');assert.equal(context.source,'agent');assert.equal(context.cardId,'card-owned');
  assert.equal((await f.host.invoke('terminal.list',{workspaceId:f.w.id}))[0].name,'Auth API');
  await f.restart();
  context=await f.host.invoke('terminal.agent.context',{sessionId:f.session.id});
  assert.equal(context.name,'Auth API');assert.equal(context.cardTitle,'Autenticación');assert.equal(context.providerSessionId,'ses_owned');assert.equal(context.step,'Validando tokens');
  await assert.rejects(f.host.invoke('terminal.agent.report',{sessionId:f.session.id,patch:{step:'stale'}}),/current live/);
  await f.update({cardId:''});
  context=await f.host.invoke('terminal.agent.context',{sessionId:f.session.id});assert.equal(context.step,'');assert.equal(context.status,'idle');
});

test('linking a card names a default-titled terminal but never overrides a manual name',async t=>{
  const f=await fixture(t);
  const title=async()=>(await f.host.invoke('state.get')).workspaces[0].nodes.find(n=>n.id===f.node.id).title;
  await f.host.invoke('node.update',{workspaceId:f.w.id,id:f.node.id,patch:{title:'Terminal'}});
  await f.update({cardId:'card-owned'});
  assert.equal(await title(),'Autenticación');
  await f.update({cardId:''});
  assert.equal(await title(),'Autenticación');
  await f.host.invoke('node.update',{workspaceId:f.w.id,id:f.node.id,patch:{title:'Mi agente'}});
  await f.update({cardId:'card-owned'});
  assert.equal(await title(),'Mi agente');
  await f.update({cardId:'',name:'Terminal'});await f.update({cardId:'card-owned',name:'Explícito'});
  assert.equal(await title(),'Explícito');
});

test('agent CLI and PTY injection report into the current terminal without mutating native card status',async t=>{
  const f=await fixture(t);await f.update({cardId:'card-owned'});
  await agentCLI(['report','Ejecutando checks','review'],{PHANTOM_TERMINAL_SESSION_ID:f.session.id,PHANTOM_WORKSPACE_SOCKET:f.host.socketPath});
  let context=await f.host.invoke('terminal.agent.context',{sessionId:f.session.id});assert.equal(context.status,'review');assert.equal(context.source,'agent');
  await assert.rejects(f.host.invoke('terminal.agent.report',{sessionId:f.session.id,patch:{cardId:'foreign'}}),/only update/);
  await f.host.invoke('terminal.write',{sessionId:f.session.id,data:'"$PHANTOM_AGENT_NODE" "$PHANTOM_AGENT_CLI" report "Paso desde PTY" working\n'});
  const end=Date.now()+5000;
  while(Date.now()<end){context=await f.host.invoke('terminal.agent.context',{sessionId:f.session.id});if(context.step==='Paso desde PTY')break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(context.step,'Paso desde PTY');assert.equal(context.status,'working');
  assert.equal((await f.host.invoke('phantom.detail',{workspaceId:f.w.id,topic:'tasks',id:'card-owned'})).status,'ready');
  await f.host.invoke('terminal.stop',{sessionId:f.session.id});
  while(f.host.terminals.get(f.session.id).status==='running')await new Promise(r=>setTimeout(r,30));
  const next=await f.host.invoke('terminal.create',{workspaceId:f.w.id,nodeId:f.node.id,shell:'/bin/sh'});
  await assert.rejects(f.host.invoke('terminal.agent.report',{sessionId:f.session.id,patch:{step:'old generation'}}),/current live/);
  assert.notEqual(next.session.id,f.session.id);assert.equal(next.node.data.agent.cardId,'card-owned');
});

test('OpenCode catalog scopes canonical folders/worktrees and handles missing runtime',async t=>{
  const root=fs.mkdtempSync('/tmp/opencode/phantom-catalog-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const tree=path.join(root,'tree');fs.mkdirSync(tree);
  const context={workspace:{id:'w',path:root},state:{settings:{}},execFile:async(file,args)=>{
    if(file==='git')return {stdout:`worktree ${root}\0\0worktree ${tree}\0\0`};
    assert.deepEqual(args,['session','list','--format','json','--max-count','1000']);
    return {stdout:JSON.stringify([{id:'ses_owned',title:'Main',directory:root},{id:'ses_tree',directory:tree},{id:'ses_foreign',directory:'/tmp'},{id:'--unsafe',directory:root}])};
  }};
  assert.deepEqual((await opencodeSessions({},context)).items.map(s=>s.id),['ses_owned','ses_tree']);
  context.execFile=async()=>{throw new Error('ENOENT');};
  const unavailable=await opencodeSessions({},context);assert.equal(unavailable.available,false);assert.deepEqual(unavailable.items,[]);
});
