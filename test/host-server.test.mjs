import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import vm from 'node:vm';
import { createHost } from '../host/server.mjs';
import { connectHost, requestTimeout } from '../desktop/host-client.mjs';
import { isHostTransportError } from '../desktop/security.mjs';
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

test('desktop terminal preparation preserves the timeout socket and automatically recovers real transport loss',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-desktop-timeout-'));
  const sockets=new Set(),requests=[],events=[];let client,desktop,connections=0,closes=0,reconnects=0;
  const server=net.createServer(socket=>{
    connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    socket.write(JSON.stringify({event:{type:'connection',status:'connected'}})+'\n');
    socket.setEncoding('utf8');let buffer='';
    socket.on('data',chunk=>{
      buffer+=chunk;let i;
      while((i=buffer.indexOf('\n'))>=0){
        const entry={request:JSON.parse(buffer.slice(0,i)),socket};buffer=buffer.slice(i+1);
        requests.push(entry);server.emit('request',entry);
      }
    });
  });
  await new Promise(r=>server.listen(path.join(root,'host.sock'),r));
  t.after(async()=>{t.mock.timers.reset();client?.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
  client=await connectHost({dataDir:root,onEvent:e=>{events.push(e);desktop?.receiveHostEvent(e);}});
  const close=client.close;client.close=()=>{closes++;close();};
  const reconnect=client.reconnect;client.reconnect=()=>{reconnects++;reconnect();};
  t.mock.timers.enable({apis:['setTimeout']});

  // Execute the production desktop wrapper without importing Electron or starting a real host.
  // Include deadline too so a reintroduced outer deadline is exercised by this regression.
  const main=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
  const deadline=main.slice(main.indexOf('function deadline('),main.indexOf('\nfunction emit('));
  const receiveHostEvent=main.slice(main.indexOf('function receiveHostEvent('),main.indexOf('\nasync function hostClient('));
  const hostInvoke=main.slice(main.indexOf('async function hostInvoke('),main.indexOf('\nfunction trustedContents('));
  assert.ok(deadline.includes('Promise.race'));assert.ok(hostInvoke.includes('connected.invoke'));
  desktop={hostClient:async()=>client,client,hostStatus:{connected:true,error:null},browsers:null,emit:()=>{},isHostTransportError,setTimeout,clearTimeout};
  const invoke=vm.runInNewContext(`${deadline}\n${receiveHostEvent}\n${hostInvoke}\nhostInvoke`,desktop);
  async function start(method,payload={}) {
    const arrival=once(server,'request'),result=invoke(method,payload);
    result.catch(()=>{});
    return {result,entry:(await arrival)[0]};
  }
  function reply(entry,result) {entry.socket.write(JSON.stringify({id:entry.request.id,result})+'\n');}
  const session={id:'existing-session',status:'running'};
  const preparation=await start('terminal.create',{worktree:{enabled:true}});let settled=false;
  preparation.result.then(()=>{settled=true;},()=>{settled=true;});
  t.mock.timers.tick(31000);await new Promise(setImmediate);
  assert.equal(settled,false);assert.equal(closes,0);assert.equal(desktop.hostStatus.connected,true);
  const concurrent=await start('terminal.attach',{sessionId:session.id});
  reply(concurrent.entry,{session,data:'existing terminal output'});
  assert.deepEqual((await concurrent.result).session,session);
  // A full four-minute dependency preparation still fits the terminal.create budget.
  t.mock.timers.tick(210000);await new Promise(setImmediate);assert.equal(settled,false);
  reply(preparation.entry,{session:{id:'new-session',status:'running'}});
  assert.equal((await preparation.result).session.id,'new-session');

  const expired=await start('terminal.create',{worktree:{enabled:true}});
  const timeout=assert.rejects(expired.result,error=>{
    assert.equal(error.code,'HOST_REQUEST_TIMEOUT');assert.match(error.message,/outcome unknown/);
    assert.equal(isHostTransportError(error),false);return true;
  });
  t.mock.timers.tick(requestTimeout('terminal.create')-1);await new Promise(setImmediate);
  assert.equal(closes,0);
  t.mock.timers.tick(1);await timeout;
  assert.equal(closes,0);assert.equal(desktop.client,client);assert.equal(desktop.hostStatus.connected,true);
  assert.equal(reconnects,0);
  assert.equal(events.some(e=>e.status==='disconnected'),false);
  // Late results are ignored by request ID and must not poison subsequent requests or replay creation.
  reply(expired.entry,{session:{id:'late-session'}});
  const after=await start('terminal.attach',{sessionId:session.id});
  assert.equal(after.entry.socket,expired.entry.socket);
  reply(after.entry,{session,data:'existing terminal output'});
  assert.deepEqual((await after.result).session,session);
  assert.equal(connections,1);assert.equal(requests.filter(r=>r.request.method==='terminal.create').length,2);

  t.mock.timers.reset();
  const lost=await start('terminal.create',{worktree:{enabled:true}});
  const disconnected=assert.rejects(lost.result,/Host disconnected; request outcome unknown/);
  lost.entry.socket.destroy();await disconnected;
  assert.equal(closes,0);assert.equal(reconnects,1);assert.equal(desktop.client,client);assert.equal(desktop.hostStatus.connected,false);
  // Recovery must happen with no further IPC, and the ambiguous creation is never replayed.
  await until(()=>connections===2&&desktop.hostStatus.connected);
  assert.equal(desktop.client,client);assert.equal(closes,0);assert.equal(requests.length,5);
  assert.equal(requests.filter(r=>r.request.method==='terminal.create').length,3);
  const recovered=await start('terminal.attach',{sessionId:session.id});
  assert.notEqual(recovered.entry.socket,lost.entry.socket);
  reply(recovered.entry,{session,data:'recovered terminal output'});
  assert.deepEqual((await recovered.result).session,session);
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

test('explicit client reconnect replaces the socket automatically without replay and respects close',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-reconnect-')),sockets=new Set(),requests=[],events=[];let client,connections=0;
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    connections++;socket.write(JSON.stringify({event:{type:'connection',status:'connected',generation:connections}})+'\n');
    socket.setEncoding('utf8');let buffer='';
    socket.on('data',chunk=>{
      buffer+=chunk;let i;
      while((i=buffer.indexOf('\n'))>=0){
        const request=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);requests.push({request,socket});
        if(request.method==='fixture.read')socket.write(JSON.stringify({id:request.id,result:{generation:connections}})+'\n');
        server.emit('request',request);
      }
    });
  });
  await new Promise(r=>server.listen(path.join(root,'host.sock'),r));
  t.after(async()=>{client?.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
  client=await connectHost({dataDir:root,onEvent:e=>events.push(e)});
  const arrival=once(server,'request'),ambiguous=assert.rejects(client.invoke('fixture.write',{data:'once'}),/Host disconnected; request outcome unknown/);
  await arrival;const original=requests[0].socket;
  client.reconnect();client.reconnect();await ambiguous;
  // No invoke may drive this recovery: the client's own loop must deliver fresh events.
  await until(()=>events.some(e=>e.generation===2));
  assert.equal(connections,2);assert.equal(requests.length,1);assert.ok(original.destroyed);
  assert.ok(events.some(e=>e.status==='disconnected'));
  assert.equal((await client.invoke('fixture.read')).generation,2);
  assert.notEqual(requests[1].socket,original);
  assert.equal(requests.filter(r=>r.request.method==='fixture.write').length,1);
  client.close();client.reconnect();await new Promise(r=>setTimeout(r,300));
  assert.equal(connections,2);await assert.rejects(client.invoke('fixture.read'),/Host client closed/);
});

test('desktop transport recovery reconnects without another request and never replays writes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-recovery-'));
  const sockets = new Set(), events = [];
  let client, connections = 0, writes = 0;
  const server = net.createServer(socket => {
    sockets.add(socket); connections++;
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write(JSON.stringify({ event: { type: 'connection', status: 'connected', generation: connections } }) + '\n');
    socket.on('data', () => { writes++; socket.destroy(); });
  });
  await new Promise(resolve => server.listen(path.join(root, 'host.sock'), resolve));
  t.after(async () => {
    client?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  client = await connectHost({ dataDir: root, onEvent: event => events.push(event) });
  await assert.rejects(client.invoke('fixture.write'), /outcome unknown/);
  // The desktop handles the failed IPC request here. Recovery must remain active.
  client.reconnect();
  await until(() => events.some(event => event.generation === 2));
  assert.equal(writes, 1);
  // A deadline can expire while the socket is still open: replace that socket too.
  client.reconnect();
  await until(() => events.some(event => event.generation === 3));
  assert.equal(writes, 1);
  client.close(); client.reconnect();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(connections, 3);
});

test('a paused desktop receives per-terminal resyncs and control replies instead of a shared disconnect', {timeout:15000}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'phantom-slow-reader-'));
  const host = await createHost({dataDir:path.join(root,'state'),handleIntegration:()=>({handled:false})});
  const socket = net.createConnection(host.socketPath);
  t.after(async()=>{socket.destroy();await host.close();fs.rmSync(root,{recursive:true,force:true});});
  socket.on('error',()=>{}); await once(socket,'connect');
  const messages=[]; let buffer='';
  socket.setEncoding('utf8');
  socket.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){messages.push(JSON.parse(buffer.slice(0,i)));buffer=buffer.slice(i+1);}});
  await until(()=>messages.some(m=>m.event?.status==='connected'));
  socket.pause();
  for(let seq=1;seq<=100;seq++)for(let n=0;n<20;n++)host.emit({type:'terminal.output',sessionId:String(n),workspaceId:'fixture',seq,data:'x'.repeat(32768)});
  socket.write(JSON.stringify({id:'responsive-control',method:'system.info'})+'\n');
  await new Promise(resolve=>setTimeout(resolve,30)); socket.resume();
  await until(()=>messages.some(m=>m.id==='responsive-control')&&new Set(messages.filter(m=>m.event?.type==='terminal.resync').map(m=>m.event.sessionId)).size===20);
  assert.equal(socket.destroyed,false);
  assert.equal(messages.filter(m=>m.event?.type==='connection').length,1);
  assert.ok(messages.filter(m=>m.event?.type==='terminal.resync').every(m=>m.event.seq===100));
  assert.equal(messages.find(m=>m.id==='responsive-control').result.pid,process.pid);
});
