import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHost } from '../host/server.mjs';
import { connectHost, requestTimeout } from '../desktop/host-client.mjs';
const until=async fn=>{const end=Date.now()+5000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out');};

test('private singleton host, request IDs, async integration, disconnect survival, import validation',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-rpc-'));let client;
  const host=await createHost({dataDir:path.join(root,'state'),handleIntegration:async(method,p,context)=>{await Promise.resolve();return {handled:method==='fixture.context',result:{workspace:context.workspace?.id,sessions:context.sessions,dataDir:context.dataDir}};}});t.after(async()=>{client?.close();await host.close();fs.rmSync(root,{recursive:true,force:true});});
  await assert.rejects(createHost({dataDir:host.store.dir}),/running|starting/);assert.equal(fs.statSync(host.socketPath).mode&0o777,0o600);
  const events=[];client=await connectHost({dataDir:host.store.dir,onEvent:e=>events.push(e)});
  const w=await client.invoke('workspace.open',{path:root});
  const results=await Promise.all([client.invoke('state.get'),client.invoke('system.info')]);assert.equal(results[0].activeWorkspaceId,w.id);assert.equal(results[1].pid,process.pid);
  const integration=await client.invoke('fixture.context',{workspaceId:w.id});assert.equal(integration.workspace,w.id);assert.equal(integration.dataDir,path.join(root,'state'));
  const task=await client.invoke('task.create',{workspaceId:w.id,title:'Verify durable task'});await client.invoke('task.update',{workspaceId:w.id,id:task.id,patch:{status:'done'}});
  await client.invoke('attention.create',{workspaceId:w.id,title:'Review output'});assert.ok(events.some(e=>e.type==='state.changed'));
  const exported=await client.invoke('storage.export');assert.equal(exported.terminalHistory,undefined);assert.equal(exported.workspaces[0].tasks[0].status,'done');
  await assert.rejects(client.invoke('storage.import',{data:{...exported,schemaVersion:999}}),/schema/);
  assert.equal((await client.invoke('state.get')).workspaces[0].tasks.length,1);
  client.close();const other=await connectHost({dataDir:host.store.dir});assert.equal((await other.invoke('system.info')).pid,process.pid);other.close();
});

test('workflow v2 edits persist across restart and invalid versions preserve the last valid edit',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-workflow-'));let host=await createHost({dataDir:path.join(root,'state'),handleIntegration:()=>({handled:false})});t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
  const w=await host.invoke('workspace.open',{path:root}),workflow=await host.invoke('workflow.save',{workspaceId:w.id,title:'Versioned workflow'});
  await host.invoke('workflow.save',{workspaceId:w.id,id:workflow.id,patch:{version:2,steps:['Verify']}});for(const version of [0,-1,1.5,1000001])await assert.rejects(host.invoke('workflow.save',{workspaceId:w.id,id:workflow.id,patch:{version}}),/workflow/);
  await host.close();host=await createHost({dataDir:path.join(root,'state'),handleIntegration:()=>({handled:false})});assert.equal((await host.invoke('state.get')).workspaces[0].workflows[0].version,2);
});

test('bounded drain calls injected shutdown exactly once and persists factual tool attention',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-shutdown-'));let release,shutdowns=0,started=false;
  const done=new Promise(resolve=>{release=resolve;});
  const host=await createHost({dataDir:path.join(root,'state'),handleIntegration:async(method,p,context)=>{started=true;await done;const event={type:'tool.status',workspaceId:p.workspaceId,id:'fixture-run',status:'completed',result:{source:'phantom'}};context.emit(event);context.emit(event);context.emit({...event,id:'failed-run',status:'failed'});return {handled:true,result:{done:true}};},shutdownIntegrations:async()=>{shutdowns++;release();}});
  t.after(async()=>{release();await host.close();fs.rmSync(root,{recursive:true,force:true});});const w=await host.invoke('workspace.open',{path:root});const request=host.invoke('fixture.slow',{workspaceId:w.id});await until(()=>started);
  const close=host.close();assert.equal(close,host.close());await close;assert.equal(shutdowns,1);assert.equal((await request).done,true);
  const saved=JSON.parse(fs.readFileSync(path.join(root,'state','state.json'),'utf8')).workspaces[0].attention;assert.equal(saved.length,2);assert.ok(saved.every(i=>i.runId&&i.createdAt&&i.observedAt&&i.source==='phantom'));assert.deepEqual(new Set(saved.map(i=>i.status)),new Set(['failed','completed']));assert.ok(saved.every(i=>!i.title.includes('aceptad')));
});

test('voice response after 120s remains valid while ordinary requests time out without replay',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-timeout-')),sockets=new Set(),requests=[];let client,received;
  const both=new Promise(r=>{received=r;});
  const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.setEncoding('utf8');let buffer='';socket.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){requests.push({request:JSON.parse(buffer.slice(0,i)),socket});buffer=buffer.slice(i+1);if(requests.length===2)received();}});});
  await new Promise(r=>server.listen(path.join(root,'host.sock'),r));t.after(async()=>{t.mock.timers.reset();client?.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
  client=await connectHost({dataDir:root});t.mock.timers.enable({apis:['setTimeout']});let voiceSettled=false;
  const voice=client.invoke('voice.transcribe',{workspaceId:'fixture'}).finally(()=>{voiceSettled=true;});const ordinary=assert.rejects(client.invoke('terminal.write',{sessionId:'fixture',data:'one write'}),/timed out; outcome unknown/);
  await both;t.mock.timers.tick(65000);await ordinary;assert.equal(voiceSettled,false);t.mock.timers.tick(65000);await Promise.resolve();assert.equal(voiceSettled,false);
  const request=requests.find(r=>r.request.method==='voice.transcribe');request.socket.write(JSON.stringify({id:request.request.id,result:{text:'real response fixture',provider:'fixture'}})+'\n');assert.equal((await voice).text,'real response fixture');assert.equal(requests.filter(r=>r.request.method==='terminal.write').length,1);assert.ok(requestTimeout('voice.transcribe')<=180000);
});

test('concurrent desktop clients start only one detached daemon, stale socket is safe, shutdown replies',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-start-'));const clients=[];let shutdown=false;
  t.after(async()=>{if(!shutdown&&clients[0])try{await clients[0].invoke('host.shutdown');}catch{}for(const c of clients)c.close();await until(()=>!fs.existsSync(path.join(root,'host.sock')));fs.rmSync(root,{recursive:true,force:true});});
  fs.writeFileSync(path.join(root,'host.sock'),'stale socket fixture');
  clients.push(...await Promise.all([connectHost({dataDir:root}),connectHost({dataDir:root})]));
  const [a,b]=await Promise.all(clients.map(c=>c.invoke('system.info')));assert.equal(a.pid,b.pid);assert.notEqual(a.pid,process.pid);
  const response=await clients[0].invoke('host.shutdown');assert.equal(response.ok,true);shutdown=true;for(const c of clients)c.close();
  await until(()=>!fs.existsSync(path.join(root,'host.sock')));
});

test('imported histories are validated and restored lost without process execution',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-import-')),host=await createHost({dataDir:path.join(root,'state'),handleIntegration:()=>({handled:false})});t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
  const w=await host.invoke('workspace.open',{path:root}),node=await host.invoke('node.create',{workspaceId:w.id,type:'terminal'}),data=await host.invoke('storage.export');
  data.terminalHistory=[{id:crypto.randomUUID(),workspaceId:w.id,nodeId:node.id,pid:123,status:'running',cols:80,rows:24,generation:crypto.randomUUID(),seq:1,createdAt:new Date().toISOString(),snapshot:'Recovered screen'}];
  await host.invoke('storage.import',{data});assert.equal(host.terminals.live.size,0);const restored=await host.invoke('terminal.attach',{sessionId:data.terminalHistory[0].id});assert.equal(restored.data,'Recovered screen');assert.equal(restored.session.status,'lost');assert.equal(restored.session.pid,null);
  const invalid=structuredClone(data);invalid.terminalHistory[0].rows=-1;await assert.rejects(host.invoke('storage.import',{data:invalid}),/dimensions/);assert.equal((await host.invoke('terminal.attach',{sessionId:restored.session.id})).data,'Recovered screen');
});

test('client reconnects with fresh events and never replays an ambiguous write or rejected request',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-transport-')),sockets=new Set();let connections=0,writes=0,rejections=0,client;
  const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});connections++;socket.write(JSON.stringify({event:{type:'connection',status:'connected',generation:connections}})+'\n');socket.setEncoding('utf8');let buffer='';socket.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const r=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);if(r.method==='fixture.write'){writes++;socket.destroy();}else if(r.method==='fixture.reject'){rejections++;socket.write(JSON.stringify({id:r.id,error:{message:'not retry safe'}})+'\n');}else socket.write(JSON.stringify({id:r.id,result:{connections}})+'\n');}});});
  await new Promise(r=>server.listen(path.join(root,'host.sock'),r));t.after(async()=>{client?.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
  const events=[];client=await connectHost({dataDir:root,onEvent:e=>events.push(e)});await assert.rejects(client.invoke('fixture.write'),/outcome unknown/);await until(()=>connections>=2);await client.invoke('fixture.read');assert.equal(writes,1);assert.ok(events.some(e=>e.status==='disconnected'));assert.ok(events.some(e=>e.generation===2));
  await assert.rejects(client.invoke('fixture.reject'),/not retry safe/);assert.equal(rejections,1);
});
