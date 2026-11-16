import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHost } from '../host/server.mjs';
import { prepareTerminalDirectory } from '../host/worktrees.mjs';
import { validateLaunch } from '../host/processes.mjs';
import { main as agentCLI } from '../scripts/agent.mjs';

async function until(fn) {
  const end=Date.now()+5000;
  while(Date.now()<end) {
    const value=await fn();if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error('No se observó el estado esperado del proceso');
}

async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-launch-'));
  let host,time=Date.parse('2026-11-15T12:00:00Z');
  t.after(async()=>{await host?.close();fs.rmSync(root,{recursive:true,force:true});});
  host=await createHost({dataDir:path.join(root,'state'),processOptions:{now:()=>time},handleIntegration:()=>({handled:false})});
  await host.invoke('settings.update',{patch:{shell:'/bin/sh'}});
  const directory=path.join(root,'project');fs.mkdirSync(directory);
  const git=(...args)=>execFileSync('git',['-C',directory,...args],{encoding:'utf8',stdio:'pipe'});
  git('init','-b','main');fs.writeFileSync(path.join(directory,'README.md'),'Fixture\n');git('add','.');
  git('-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Fixture');
  const w=await host.invoke('workspace.open',{path:directory});
  const {node,session}=await host.invoke('terminal.create',{workspaceId:w.id,shell:'/bin/sh'});
  const writes=[],write=host.terminals.write.bind(host.terminals);
  host.terminals.write=(sessionId,data)=>{writes.push({sessionId,data});return {ok:true};};
  const launch=(patch={})=>host.invoke('terminal.agent.launch',{sessionId:session.id,command:'npm run dev',...patch});
  const getNode=result=>host.store.getWorkspace(w.id).nodes.find(n=>n.id===result.nodeId);
  return {root,host,w,node,session,writes,write,launch,getNode,git,advance:ms=>{time+=ms;},env:{PHANTOM_TERMINAL_SESSION_ID:session.id,PHANTOM_WORKSPACE_SOCKET:host.socketPath}};
}

test('lanza un proceso en el workspace y worktree emisor sin crear otro worktree',async t=>{
  const f=await fixture(t),trees=f.git('worktree','list','--porcelain');
  const result=await f.launch({command:'  npm run dev  ',title:'Desarrollo'});
  assert.deepEqual(Object.keys(result).sort(),['processId','nodeId','sessionId','title','command','cwd'].sort());
  const node=f.getNode(result),session=f.host.terminals.get(result.sessionId);
  assert.equal(node.type,'terminal');assert.equal(node.title,'Proceso: Desarrollo');assert.ok(!node.data.hidden);
  assert.deepEqual(node.data.process,{id:result.processId,command:'npm run dev',title:'Desarrollo',cwd:f.session.cwd,from:{nodeId:f.node.id,title:f.node.title},createdAt:'2026-11-15T12:00:00.000Z'});
  assert.equal(result.command,'npm run dev');assert.equal(result.cwd,f.session.cwd);
  assert.equal(session.workspaceId,f.w.id);assert.equal(session.status,'running');assert.notEqual(session.id,f.session.id);
  assert.equal(node.data.sessionId,session.id);assert.equal(session.cwd,fs.realpathSync(f.session.cwd));
  assert.equal(session.worktree,null);assert.equal(node.data.worktree,null);
  assert.equal(session.worktreeReason,'Proceso lanzado por un agente: usa la carpeta de su sesión');
  assert.deepEqual(f.writes,[{sessionId:session.id,data:'npm run dev\r'}]);
  assert.equal(f.git('worktree','list','--porcelain'),trees);
  assert.equal(node.data.launchState,'ready');
  const derived=await f.launch({command:'x'.repeat(90)});assert.equal(derived.title,'x'.repeat(60));
});

test('valida comando, título y claves antes de crear nodos',async t=>{
  const f=await fixture(t);
  for(const [patch,error] of [
    [{command:''},/vacío/],[{command:'   '},/vacío/],[{command:null},/texto/],[{command:42},/texto/],
    [{command:'x'.repeat(2001)},/2000/],[{command:'uno\ndos'},/una línea/],[{command:'x\r'},/una línea/],
    [{command:'\tx'},/control/],[{command:'x\x00'},/control/],[{command:'x\x7f'},/control/],
    [{command:'x\u0085'},/control/],[{command:'x\u2028'},/una línea/],[{command:'x\u2029'},/una línea/],
    [{title:''},/una línea/],[{title:'  '},/una línea/],[{title:'a\nb'},/una línea/],[{title:'a\x00'},/control/],
    [{title:'x'.repeat(121)},/120/],[{title:null},/título/],[{unknown:true},/Clave de proceso desconocida/],
  ])await assert.rejects(f.launch(patch),error);
  assert.equal(f.host.store.getWorkspace(f.w.id).nodes.length,1);
  const result=await f.launch({command:' '+'x'.repeat(2000)+' ',title:'t'.repeat(120)});
  assert.equal(result.command.length,2000);assert.equal(result.title.length,120);
  assert.equal(validateLaunch({command:'x'},f.node).title,'x');
});

test('exige la sesión viva actual y un proceso no puede lanzar otro',async t=>{
  const f=await fixture(t),result=await f.launch();
  await assert.rejects(f.launch({sessionId:result.sessionId}),/Un proceso no puede lanzar/);
  await assert.rejects(f.launch({sessionId:'inexistente'}),/session not found/);
  const saved=structuredClone(f.node.data);
  await f.host.invoke('node.update',{workspaceId:f.w.id,id:f.node.id,patch:{data:{...saved,sessionId:'otra'}}});
  await assert.rejects(f.launch(),/sesión viva actual/);
  await f.host.invoke('node.update',{workspaceId:f.w.id,id:f.node.id,patch:{data:saved}});
  await f.host.invoke('terminal.stop',{sessionId:f.session.id});
  await until(()=>f.host.terminals.get(f.session.id).status!=='running');
  await assert.rejects(f.launch(),/sesión viva actual/);
  assert.equal((await f.host.invoke('terminal.agent.processes',{sessionId:f.session.id}))[0].processId,result.processId);
  await f.host.invoke('terminal.agent.process.output',{sessionId:f.session.id,id:result.processId});
  assert.deepEqual(await f.host.invoke('terminal.agent.process.stop',{sessionId:f.session.id,id:result.processId}),{ok:true});
});

test('reserva diez lanzamientos por hora síncronamente y expira con reloj inyectado',async t=>{
  const f=await fixture(t);
  const results=await Promise.allSettled(Array.from({length:11},()=>f.launch()));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,10);
  const rejected=results.filter(r=>r.status==='rejected');assert.equal(rejected.length,1);assert.match(rejected[0].reason.message,/máximo 10.*hora/);
  f.advance(3599999);await assert.rejects(f.launch(),/máximo 10/);
  f.advance(1);assert.ok((await f.launch()).processId);
});

test('node.update preserva process sin permitir inyectarlo',async t=>{
  const f=await fixture(t),result=await f.launch(),saved=structuredClone(f.getNode(result).data.process);
  for(const data of [{process:{command:'alterado'}},{},{process:null}]) {
    await f.host.invoke('node.update',{workspaceId:f.w.id,id:result.nodeId,patch:{data}});
    assert.deepEqual(f.getNode(result).data.process,saved);
  }
  await f.host.invoke('node.update',{workspaceId:f.w.id,id:f.node.id,patch:{data:{...f.node.data,process:saved}}});
  assert.equal(f.node.data.process,undefined);
});

test('processes enumera el workspace, cruza estado y marca el panel emisor',async t=>{
  const f=await fixture(t),result=await f.launch();
  const otherDir=path.join(f.root,'other');fs.mkdirSync(otherDir);
  const other=await f.host.invoke('workspace.open',{path:otherDir});
  const {session:otherSession}=await f.host.invoke('terminal.create',{workspaceId:other.id});
  const foreign=await f.launch({sessionId:otherSession.id,title:'Otro proceso'});
  const rows=await f.host.invoke('terminal.agent.processes',{sessionId:f.session.id});
  assert.deepEqual(rows,[{...result,status:'running',createdAt:'2026-11-15T12:00:00.000Z',mine:true}]);
  assert.equal((await f.host.invoke('terminal.agent.processes',{sessionId:result.sessionId}))[0].mine,false);
  for(const method of ['terminal.agent.process.output','terminal.agent.process.stop']) {
    await assert.rejects(f.host.invoke(method,{sessionId:'inexistente',id:result.processId}),/session not found/);
    await assert.rejects(f.host.invoke(method,{sessionId:f.session.id,id:foreign.processId}),/Proceso inexistente/);
    await assert.rejects(f.host.invoke(method,{sessionId:f.session.id,id:'no-existe'}),/Proceso inexistente/);
    await assert.rejects(f.host.invoke(method,{sessionId:f.session.id,id:f.node.id}),/Proceso inexistente/);
  }
  await f.host.invoke('terminal.agent.process.stop',{sessionId:f.session.id,id:result.processId});
  await until(()=>f.host.terminals.get(result.sessionId).status!=='running');
  assert.equal((await f.host.invoke('terminal.agent.processes',{sessionId:f.session.id}))[0].status,'stopped');
  assert.deepEqual(await f.host.invoke('terminal.agent.process.stop',{sessionId:f.session.id,id:result.processId}),{ok:true});
});

test('output lee últimas líneas con 80 por defecto y hasta 400, incluso tras detener',async t=>{
  const f=await fixture(t),result=await f.launch();
  f.write(result.sessionId,"i=1; while [ $i -le 110 ]; do printf 'salida-%s\\n' \"$i\"; i=$((i+1)); done\r");
  const output=(lines)=>f.host.invoke('terminal.agent.process.output',{sessionId:f.session.id,id:result.processId,...(lines===undefined?{}:{lines})});
  await until(async()=>(await output()).lines.some(line=>line.includes('salida-110')));
  const tail=await output();assert.equal(tail.lines.length,80);assert.ok(tail.lines.some(line=>line.includes('salida-110')));
  assert.equal((await output(1)).lines.length,1);assert.ok((await output(400)).lines.length>80);
  for(const lines of [0,401,1.5,'80',null])await assert.rejects(output(lines),/entre 1 y 400/);
  await assert.rejects(f.host.invoke('terminal.tail',{sessionId:result.sessionId,lines:41}),/Invalid tail/);
  await f.host.invoke('terminal.agent.process.stop',{sessionId:f.session.id,id:result.processId});
  await until(()=>f.host.terminals.get(result.sessionId).status!=='running');
  assert.equal((await output(1)).lines.length,1);assert.equal((await output(80)).lines.length,80);
  assert.ok((await output(400)).lines.length>80);
});

test('errores de procesos rechazan claves e IDs inválidos y sesiones no disponibles',async t=>{
  const f=await fixture(t),result=await f.launch();
  for(const method of ['terminal.agent.processes','terminal.agent.process.output','terminal.agent.process.stop'])
    await assert.rejects(f.host.invoke(method,{sessionId:f.session.id,id:result.processId,unknown:true}),/Clave de proceso desconocida/);
  for(const id of [undefined,null,42])await assert.rejects(f.host.invoke('terminal.agent.process.output',{sessionId:f.session.id,id}),/identificador/);
  await f.host.invoke('terminal.close',{workspaceId:f.w.id,nodeId:result.nodeId});
  await assert.rejects(f.host.invoke('terminal.agent.process.output',{sessionId:f.session.id,id:result.processId}),/Proceso inexistente/);
  const failed=await f.launch();
  await f.host.invoke('node.update',{workspaceId:f.w.id,id:failed.nodeId,patch:{data:{...f.getNode(failed).data,sessionId:'perdida'}}});
  await assert.rejects(f.host.invoke('terminal.agent.process.output',{sessionId:f.session.id,id:failed.processId}),/sesión disponible/);
  await f.host.invoke('node.update',{workspaceId:f.w.id,id:failed.nodeId,patch:{data:{...f.getNode(failed).data,sessionId:f.session.id}}});
  await assert.rejects(f.host.invoke('terminal.agent.process.stop',{sessionId:f.session.id,id:failed.processId}),/sesión disponible/);
  assert.equal(f.host.terminals.get(f.session.id).status,'running');
});

test('cerrar o quitar el panel del proceso no toca el worktree ni la sesión emisora',async t=>{
  const f=await fixture(t),trees=f.git('worktree','list','--porcelain');
  const file=path.join(f.session.cwd,'sin-guardar.txt');fs.writeFileSync(file,'Contenido del emisor');
  const worktree=structuredClone(f.node.data.worktree);
  for(const method of ['terminal.close','node.remove']) {
    const result=await f.launch();
    if(method==='node.remove') {
      await f.host.invoke('terminal.agent.process.stop',{sessionId:f.session.id,id:result.processId});
      await until(()=>f.host.terminals.get(result.sessionId).status!=='running');
    }
    await f.host.invoke(method,{workspaceId:f.w.id,nodeId:result.nodeId,id:result.nodeId});
    assert.equal(f.getNode(result),undefined);
    assert.equal(fs.readFileSync(file,'utf8'),'Contenido del emisor');
    assert.deepEqual(f.node.data.worktree,worktree);assert.equal(f.host.terminals.get(f.session.id).status,'running');
    assert.equal(f.git('worktree','list','--porcelain'),trees);
  }
});

test('prepareTerminalDirectory canonicaliza la carpeta del proceso y rechaza carpetas ausentes',async t=>{
  const f=await fixture(t),link=path.join(f.root,'link');fs.symlinkSync(f.session.cwd,link,'dir');
  const directory=await prepareTerminalDirectory(f.host.store,f.w,{data:{process:{cwd:link}}});
  assert.equal(directory.cwd,fs.realpathSync(f.session.cwd));assert.equal(directory.worktree,null);
  await assert.rejects(prepareTerminalDirectory(f.host.store,f.w,{data:{process:{cwd:path.join(f.root,'ausente')}}}),/ENOENT/);
  await assert.rejects(prepareTerminalDirectory(f.host.store,f.w,{data:{process:{cwd:path.join(f.session.cwd,'README.md')}}}),/not a folder/);
});

test('fallo de arranque conserva el proceso y consume la reserva sin escribir',async t=>{
  const f=await fixture(t);
  await f.host.invoke('settings.update',{patch:{shell:'/no/existe/phantom-shell'}});
  for(let i=0;i<10;i++)await assert.rejects(f.launch(),/ENOENT/);
  await assert.rejects(f.launch(),/máximo 10/);
  const processes=f.host.store.getWorkspace(f.w.id).nodes.filter(n=>n.data.process);
  assert.equal(processes.length,10);assert.ok(processes.every(n=>n.data.launchState==='failed'));assert.equal(f.writes.length,0);
});

test('CLI launch, processes, output y stop llegan al host con identidad de terminal',async t=>{
  const f=await fixture(t),result=await agentCLI(['launch','--title','CLI','printf listo'],f.env);
  assert.equal(result.title,'CLI');assert.equal(result.command,'printf listo');
  assert.deepEqual(f.writes.at(-1),{sessionId:result.sessionId,data:'printf listo\r'});
  assert.equal((await agentCLI(['processes'],f.env))[0].processId,result.processId);
  const calls=[],tail=f.host.terminals.tail.bind(f.host.terminals);
  f.host.terminals.tail=(...args)=>{calls.push(args);return tail(...args);};
  await agentCLI(['output',result.processId],f.env);assert.deepEqual(calls.at(-1),[result.sessionId,80,400]);
  await agentCLI(['output',result.processId,'12'],f.env);assert.deepEqual(calls.at(-1),[result.sessionId,12,400]);
  assert.deepEqual(await agentCLI(['stop',result.processId],f.env),{ok:true});
  await until(()=>f.host.terminals.get(result.sessionId).status!=='running');
  assert.equal((await agentCLI(['processes'],f.env))[0].status,'stopped');
  assert.equal((await agentCLI(['launch','echo hola'],f.env)).title,'echo hola');
});

test('CLI argumentos inválidos dan USAGE antes de consultar identidad o host',async()=>{
  for(const args of [
    ['launch'],['launch','a','b'],['launch','--title'],['launch','--unknown','T','echo hola'],
    ['launch','--title','A','--title','B','echo hola'],['launch','--title','','x'],['launch','--title','a\nb','x'],
    ['launch',''],['launch','  '],['launch','a\nb'],['launch','x'.repeat(2001)],['launch','--title','x'.repeat(121),'x'],
    ['processes','extra'],['output'],['output','id','0'],['output','id','401'],['output','id','1.5'],['output','id','1','extra'],
    ['output','id','abc'],['output','--id'],['stop'],['stop','id','extra'],['stop',''],['stop','id\n'],
  ])await assert.rejects(agentCLI(args,{}),/Uso: agent.mjs.*\nEncargos:.*\nProcesos:/);
  for(const args of [['launch','echo hola'],['processes'],['output','id'],['stop','id']])
    await assert.rejects(agentCLI(args,{}),/Falta la identidad de terminal/);
});
