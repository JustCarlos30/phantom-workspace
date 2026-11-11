import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Store, assert, object, text, canonicalFolder, validateState, NODE_TYPES, dataHome } from './store.mjs';
import { Terminals } from './terminals.mjs';
import { agentContext, validateAgent } from './agents.mjs';

function publicSettings(settings) {
  return Object.fromEntries(Object.entries(settings).filter(([key])=>!/(secret|token|password|credential|authorization|api.?key)/i.test(key)).map(([key,value])=>[key,value&&typeof value==='object'&&!Array.isArray(value)?publicSettings(value):value]));
}

export function probeSocket(socketPath) { return new Promise(resolve => { const s=net.createConnection(socketPath); const done=value=>{s.destroy();resolve(value);}; s.once('connect',()=>done(true)); s.once('error',()=>done(false)); s.setTimeout(500,()=>done(true)); }); }
async function bounded(promise,milliseconds,label) {
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out`)),milliseconds);})]);}finally{clearTimeout(timer);}
}
export async function createHost({dataDir=dataHome(),handleIntegration,shutdownIntegrations}={}) {
  assert(!process.versions.electron,'Run the host with system Node, never Electron');
  dataDir=path.resolve(dataDir); fs.mkdirSync(dataDir,{recursive:true,mode:0o700}); fs.chmodSync(dataDir,0o700);
  const socketPath=path.join(dataDir,'host.sock'), lockPath=path.join(dataDir,'host.lock');
  // Linux abstract sockets are kernel-arbitrated and disappear on crash. Unlike a
  // stale PID-file takeover there is no unlink race between simultaneous starters.
  const arbitration=net.createServer();
  await new Promise((resolve,reject)=>{arbitration.once('error',()=>reject(new Error('Host already running or starting')));arbitration.listen('\0phantom-workspace-'+createHash('sha256').update(fs.realpathSync(dataDir)).digest('hex'),resolve);});
  try {fs.writeFileSync(lockPath,JSON.stringify({pid:process.pid}),{mode:0o600});}catch(e){arbitration.close();throw e;}
  let store,terminals,server,closingPromise,ownsSocket=false;
  const clients=new Set();
  const send=(s,message)=>{ if(s.destroyed) return; if(s.writableLength>1024*1024) {s.destroy();return;} s.write(JSON.stringify(message)+'\n'); };
  const broadcast=event=>{for(const c of clients)send(c,{event});};
  const emit=event=>{
    const terminalExit=event.type==='terminal.exit',toolFinish=event.type==='tool.status'&&['failed','completed'].includes(event.status);
    const runId=terminalExit?event.sessionId:event.id;
    if((terminalExit||toolFinish)&&runId&&store) {
      const w=store.state.workspaces.find(w=>w.id===event.workspaceId),eventKey=`${terminalExit?'terminal':'tool'}:${runId}:${terminalExit?'exit':event.status}`;
      if(w&&!w.attention.some(item=>item.eventKey===eventKey)) {
        const now=new Date().toISOString(),source=terminalExit?'terminal':event.result?.source==='phantom'?'phantom':'tool';
        const item={id:randomUUID(),eventKey,title:terminalExit?`Terminal finalizada (código ${event.exitCode??'desconocido'})`:`Proceso ${source==='phantom'?'Phantom':'de herramienta'} ${event.status==='failed'?'fallido':'finalizado'}`,source,ref:runId,...(terminalExit?{sessionId:runId,exitCode:event.exitCode}:{runId,status:event.status}),createdAt:now,observedAt:now};
        store.transaction(()=>{w.attention.push(item);if(w.attention.length>1000)w.attention.shift();});
        broadcast({type:'attention.new',workspaceId:w.id,item});broadcast({type:'state.changed',workspaceId:w.id});
      }
    }
    broadcast(event);
  };
  const persist=workspaceId=>{store.persist();emit({type:'state.changed',...(workspaceId?{workspaceId}:{})});};
  const mutate=(workspaceId,fn)=>{ const value=store.transaction(fn); emit({type:'state.changed',...(workspaceId?{workspaceId}:{})}); return value; };
  let integration=handleIntegration,integrationLoad,shutdownIntegration=shutdownIntegrations;
  const inFlightIntegrations=new Set();
  const routeIntegration=async(method,payload)=>{
    const request=(async()=>{
      if(!integration) {const module=await (integrationLoad??=import('../integrations/index.mjs'));integration=module.handleIntegration;shutdownIntegration??=module.shutdownIntegrations;}
      assert(!closingPromise,'Host is shutting down');
      return integration(method,payload,{dataDir,workspace:payload.workspaceId?store.getWorkspace(payload.workspaceId):undefined,getWorkspace:id=>store.getWorkspace(id),state:store.state,persist:()=>persist(payload.workspaceId),emit,sessions:terminals.sessions.filter(s=>s.status==='running').map(s=>terminals.descriptor(s))});
    })();inFlightIntegrations.add(request);try{return await request;}finally{inFlightIntegrations.delete(request);}
  };
  async function invoke(method,p={}) {
    assert(!closingPromise,'Host is shutting down');
    text(method,'method',128); object(p);
    if(method==='system.info') return {platform:process.platform,node:process.version,pid:process.pid,dataDir};
    if(method==='state.get') {const state=structuredClone(store.state);delete state.terminalHistory;state.settings=publicSettings(state.settings);return state;}
    if(method==='settings.update') return mutate(null,()=>{object(p.patch); Object.assign(store.state.settings,p.patch);return publicSettings(store.state.settings);});
    if(method==='workspace.open') return mutate(null,()=>store.open(p.path));
    if(method==='workspace.select') return mutate(p.id,()=>{const w=store.getWorkspace(p.id);store.state.activeWorkspaceId=w.id;return w;});
    if(method==='workspace.update') return mutate(p.id,()=>{const w=store.getWorkspace(p.id);object(p.patch);for(const key of Object.keys(p.patch)) assert(['name','camera'].includes(key),'Unsupported workspace patch');Object.assign(w,p.patch,{updatedAt:new Date().toISOString()});return w;});
    if(method==='workspace.relocate') return mutate(p.id,()=>{const w=store.getWorkspace(p.id),canonical=canonicalFolder(p.path);assert(!store.state.workspaces.some(v=>v.id!==w.id && v.canonicalPath===canonical),'Folder belongs to another workspace');Object.assign(w,{path:canonical,canonicalPath:canonical,updatedAt:new Date().toISOString()});return w;});
    if(method==='node.create') return mutate(p.workspaceId,()=>{
      const w=store.getWorkspace(p.workspaceId); assert(NODE_TYPES.includes(p.type),'Invalid node type'); const node={id:randomUUID(),type:p.type,title:p.title??p.type,x:p.x??0,y:p.y??0,width:p.width??(p.type==='browser'?800:640),height:p.height??(p.type==='browser'?520:400),groupId:null,data:p.data??{}};w.nodes.push(node);return node;
    });
    if(method==='node.update') return mutate(p.workspaceId,()=>{const w=store.getWorkspace(p.workspaceId),n=w.nodes.find(n=>n.id===p.id);assert(n,'Node not found');object(p.patch);for(const key of Object.keys(p.patch)) assert(['title','x','y','width','height','groupId','data'].includes(key),'Unsupported node patch');const patch={...p.patch};if(n.type==='terminal'&&patch.data){object(patch.data);patch.data={...patch.data};delete patch.data.agent;if(n.data.agent)patch.data.agent=n.data.agent;}Object.assign(n,patch);return n;});
    if(method==='node.remove') { const w=store.getWorkspace(p.workspaceId); assert(w.nodes.some(n=>n.id===p.id),'Node not found');assert(!terminals.sessions.some(s=>s.nodeId===p.id&&s.workspaceId===w.id&&s.status==='running'),'Terminal is running: hide this panel (data.hidden) or stop its session before removing it');return mutate(w.id,()=>{store.getWorkspace(w.id).nodes=w.nodes.filter(n=>n.id!==p.id);return {ok:true};}); }
    if(method==='terminal.create') {
      const w=store.getWorkspace(p.workspaceId); let node=p.nodeId?w.nodes.find(n=>n.id===p.nodeId):null; if(p.nodeId) assert(node?.type==='terminal','Terminal node not found');
      if(!node) node=await invoke('node.create',{workspaceId:w.id,type:'terminal'});
      const session=await terminals.create(w,node,p); node=mutate(w.id,()=>{const current=store.getWorkspace(w.id).nodes.find(n=>n.id===node.id);current.data={...current.data,sessionId:session.id};return current;}); return {session,node};
    }
    if(method==='terminal.list') {store.getWorkspace(p.workspaceId);return terminals.sessions.filter(s=>s.workspaceId===p.workspaceId).map(s=>terminals.descriptor(s));}
    if(method==='terminal.agent.context' || method==='terminal.agent.report') {
      const session=terminals.get(p.sessionId),w=store.getWorkspace(session.workspaceId),node=w.nodes.find(n=>n.id===session.nodeId);
      assert(node?.type==='terminal','Terminal node not found');
      if(method==='terminal.agent.context') return agentContext(w,node,session);
      assert(session.status==='running' && node.data.sessionId===session.id,'Report requires the current live terminal session');
      object(p.patch);for(const key of Object.keys(p.patch)) assert(['step','status'].includes(key),'Reports may only update step and status');
      const patch=structuredClone(p.patch);validateAgent(patch);
      return mutate(w.id,()=>{const current=store.getWorkspace(w.id).nodes.find(n=>n.id===node.id);current.data.agent={...current.data.agent,...patch,source:'agent',updatedAt:new Date().toISOString()};return agentContext(w,current,session);});
    }
    if(method==='terminal.agent.update') {
      const w=store.getWorkspace(p.workspaceId),node=w.nodes.find(n=>n.id===p.nodeId);
      assert(node?.type==='terminal','Terminal node not found');object(p.patch);
      for(const key of Object.keys(p.patch)) assert(['name','cardId','providerSessionId','step','status'].includes(key),'Unsupported identity field');
      const patch=structuredClone(p.patch),validated={};
      if(patch.name!==undefined){text(patch.name,'agent name',512);assert(patch.name.trim()&&!/[\x00-\x1f\x7f]/.test(patch.name),'Invalid agent name');}
      for(const key of ['step','status']) if(patch[key]!==undefined)validated[key]=patch[key];
      validateAgent(validated);
      if(patch.cardId!==undefined) {
        text(patch.cardId,'card ID',512);
        if(patch.cardId){const result=await routeIntegration('phantom.detail',{workspaceId:w.id,topic:'tasks',id:patch.cardId});assert(result.handled&&result.result?.kind==='card','Expected a Phantom card');validated.cardId=patch.cardId;validated.cardTitle=result.result.contract.goal;}
        else {validated.cardId='';validated.cardTitle='';}
      }
      if(patch.providerSessionId!==undefined) {
        text(patch.providerSessionId,'OpenCode session',512);
        if(patch.providerSessionId){const result=await routeIntegration('opencode.sessions',{workspaceId:w.id});assert(result.result?.available&&result.result.items.some(s=>s.id===patch.providerSessionId),'OpenCode session not found in this workspace');validated.provider='opencode';validated.providerSessionId=patch.providerSessionId;}
        else {validated.providerSessionId='';}
      }
      // Re-resolve after asynchronous catalogs; other clients may have edited/closed the node.
      return mutate(w.id,()=>{const current=store.getWorkspace(w.id).nodes.find(n=>n.id===p.nodeId);assert(current?.type==='terminal','Terminal node not found');if(patch.name!==undefined)current.title=patch.name.trim();const changedCard=validated.cardId!==undefined&&validated.cardId!==current.data.agent?.cardId;current.data.agent={...current.data.agent,...(changedCard?{step:'',status:'idle'}:{}),...validated,...(patch.step!==undefined||patch.status!==undefined||changedCard?{source:'manual',updatedAt:new Date().toISOString()}: {})};return current;});
    }
    if(method==='terminal.attach') return terminals.attach(p.sessionId,p.fromSeq);
    if(method==='terminal.write') return terminals.write(p.sessionId,p.data);
    if(method==='terminal.resize') return terminals.resize(p.sessionId,p.cols,p.rows);
    if(method==='terminal.stop') return terminals.stop(p.sessionId);
    if(method==='terminal.close') {
      const w=store.getWorkspace(p.workspaceId),node=w.nodes.find(n=>n.id===p.nodeId);
      assert(node?.type==='terminal','Terminal node not found');
      await terminals.closeNode(node.id);
      return mutate(w.id,()=>{store.getWorkspace(w.id).nodes=store.getWorkspace(w.id).nodes.filter(n=>n.id!==node.id);return {ok:true};});
    }
    if(method==='storage.export') { const data=structuredClone(store.state); // Runtime settings may contain credentials: export only portable presentation settings.
      data.settings=Object.fromEntries(Object.entries(data.settings).filter(([k])=>['theme','fontSize','terminalFontSize','language'].includes(k)));
       if(p.includeHistory) {await terminals.flush();data.terminalHistory=terminals.sessions.map(s=>({...terminals.descriptor(s),seq:s.snapshotSeq??s.seq,status:s.status==='running'?'lost':s.status,pid:null,snapshot:s.snapshot}));}return data; }
    if(method==='storage.import') {
      let input=p.data;if(typeof input==='string'){assert(Buffer.byteLength(input)<=16*1024*1024,'Import too large');input=JSON.parse(input);}
      const next=validateState(input);assert(!terminals.live.size,'Stop active terminals before importing');
      // Journal imported histories with the state atomically. Startup completes the transfer after a crash.
      next.terminalHistory=(next.terminalHistory??[]).map(s=>({...s,pid:null,status:s.status==='running'?'lost':s.status}));
      mutate(null,()=>{store.state=next;});terminals.sessions=next.terminalHistory;terminals.save();delete store.state.terminalHistory;store.persist();
      return invoke('state.get');
    }
    if(method==='attention.list') return structuredClone(store.getWorkspace(p.workspaceId).attention);
    const match=/^(task|mission|workflow|context|attention)\.(create|update|remove|save|pin|unpin|ack)$/.exec(method);
    if(match) return mutate(p.workspaceId,()=>{
      const [,kind,action]=match,w=store.getWorkspace(p.workspaceId),key={task:'tasks',mission:'missions',workflow:'workflows',context:'contextRefs',attention:'attention'}[kind],items=w[key];
      assert({task:['create','update','remove'],mission:['create','update','remove'],workflow:['save','remove'],context:['pin','unpin'],attention:['create','ack']}[kind].includes(action),'Unknown operation');
      if(['remove','unpin'].includes(action)) {assert(items.some(v=>v.id===p.id),'Item not found');w[key]=items.filter(v=>v.id!==p.id);return {ok:true};}
      if(action==='ack') {const item=items.find(v=>v.id===p.id);assert(item,'Attention not found');item.acknowledgedAt=new Date().toISOString();return item;}
      if(action==='update' || (action==='save' && p.id)) {const item=items.find(v=>v.id===p.id);assert(item,'Item not found');const patch=object(p.patch??Object.fromEntries(Object.entries(p).filter(([k])=>!['workspaceId','id'].includes(k))));assert(!('id' in patch),'Cannot change identity');Object.assign(item,patch);return item;}
      const {workspaceId,id,...fields}=p; const defaults={task:{kind:'draft',description:'',status:'todo',refs:[]},mission:{notes:'',nextAction:'',refs:[]},workflow:{description:'',steps:[],version:1},context:{kind:'file'},attention:{source:'local'}}[kind];text(fields.title,'title',512);
      const item={...defaults,...fields,id:randomUUID(),createdAt:new Date().toISOString()};items.push(item);if(items.length>1000 && kind==='attention') items.shift();if(kind==='attention') queueMicrotask(()=>emit({type:'attention.new',workspaceId:w.id,item}));return item;
    });
    if(method==='host.shutdown') {setTimeout(()=>close().catch(error=>console.error(error.message)),30);return {ok:true};}
    const answer=await routeIntegration(method,p);assert(answer?.handled,`Unknown method: ${method}`);return answer.result;
  }
  function close() {
    if(closingPromise)return closingPromise;
    closingPromise=(async()=>{
      try {
        // Let short RPCs finish, then stop integration-owned work; never import
        // production adapters solely to close a host using injected fixtures.
        await bounded(Promise.allSettled([...inFlightIntegrations]),500,'Integration drain').catch(()=>{});
        try {if(shutdownIntegration)await bounded(Promise.resolve().then(()=>shutdownIntegration()),5000,'Integration shutdown');}
        finally {await terminals?.close();}
        await bounded(Promise.allSettled([...inFlightIntegrations]),500,'Final integration drain').catch(()=>{});
      }finally {
        for(const c of clients)c.destroy();
        if(server?.listening)await new Promise(resolve=>server.close(resolve));
        if(ownsSocket && fs.existsSync(socketPath))fs.unlinkSync(socketPath);if(fs.existsSync(lockPath))fs.unlinkSync(lockPath);
        await new Promise(resolve=>arbitration.close(resolve));
      }
    })();return closingPromise;
  }
  try {
    assert(!await probeSocket(socketPath),'Host already running'); if(fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    store=new Store(dataDir);terminals=new Terminals(store,emit);
    server=net.createServer(socket=>{
      if(clients.size>=32){socket.destroy();return;}clients.add(socket);socket.setEncoding('utf8');let buffer='',pending=0,pendingBytes=0;
      const queues={control:[],normal:[]},active={control:0,normal:0};
      const priority=new Set(['terminal.write','terminal.stop','terminal.close','terminal.resize','state.get','system.info','host.shutdown']);
      function dispatch(lane) {
        while(!socket.destroyed&&active[lane]<8&&queues[lane].length) {
          const {request,bytes}=queues[lane].shift();active[lane]++;
          // invoke performs synchronous store mutations before yielding. Async
          // integrations occupy only normal slots, never terminal/control slots.
          Promise.resolve().then(()=>invoke(request.method,request.payload??{})).then(result=>send(socket,{id:request.id,result}),error=>send(socket,{id:request.id,error:{message:error.message,code:error.code}})).finally(()=>{active[lane]--;pending--;pendingBytes-=bytes;dispatch(lane);});
        }
      }
      socket.on('error',()=>{});socket.on('close',()=>{clients.delete(socket);queues.control.length=0;queues.normal.length=0;buffer='';});
      socket.on('data',chunk=>{buffer+=chunk;if(Buffer.byteLength(buffer)>32*1024*1024){socket.destroy();return;}let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);const bytes=Buffer.byteLength(line);pendingBytes+=bytes;if(++pending>256 || pendingBytes>32*1024*1024){socket.destroy();return;}
        let request;try {request=JSON.parse(line);assert(typeof request.id==='string'||Number.isSafeInteger(request.id),'Invalid request ID');const lane=priority.has(request.method)?'control':'normal';queues[lane].push({request,bytes});dispatch(lane);}catch(error){pending--;pendingBytes-=bytes;send(socket,{id:request?.id??null,error:{message:error.message}});}
      }});
      send(socket,{event:{type:'connection',status:'connected'}});
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{ownsSocket=true;fs.chmodSync(socketPath,0o600);resolve();});});
    return {invoke,close,store,terminals,server,socketPath,emit};
  } catch(e) {await close();throw e;}
}
export const startHost=createHost;
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--data');
  try { const host=await createHost({dataDir:index>=0?process.argv[index+1]:dataHome()}); console.log(JSON.stringify({ready:true,socketPath:host.socketPath,pid:process.pid}));for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>host.close().then(()=>process.exit(0))); }
  catch(e) {console.error(e.message);process.exitCode=1;}
}
