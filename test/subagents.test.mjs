import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { subagentOp } from '../scripts/agent.mjs';
import { applySubagent, validateSubagentOp } from '../host/subagents.mjs';
import { createAgentTraceStore, clipTrace, redactText } from '../host/agent-traces.mjs';
import { adaptHookTrace, adaptTraceEvent, adaptTurnTrace, createTraceState, settleTraceAgents, traceRootId } from '../host/agent-trace-adapters.mjs';

const pre={hook_event_name:'PreToolUse',tool_name:'Agent',tool_input:{description:' List\n  files ',prompt:'SECRET',subagent_type:'Explore',run_in_background:false},tool_use_id:'toolu_01T5'};
const start=()=>subagentOp(pre);
const now=Date.parse('2026-01-01T00:00:00Z');

test('normalizes real Agent payload without prompt or messages',()=>{
  assert.deepEqual(start(),{op:'start',id:'toolu_01T5',type:'Explore',description:'List files',background:false});
  const long=subagentOp({...pre,tool_input:{description:'d'.repeat(900),subagent_type:'t'.repeat(100)}});
  assert.equal(long.description.length,240);assert.equal(long.type.length,80);
  for(const payload of [null,[],{},'x',{...pre,tool_name:'Bash'},{...pre,tool_use_id:''},{hook_event_name:'SubagentStop'}])assert.equal(subagentOp(payload),null);
});

test('foreground stop before PostToolUse is harmless and completion ends by tool ID',()=>{
  const list=applySubagent([],start(),now);
  const stopped=applySubagent(list,subagentOp({hook_event_name:'SubagentStop',agent_id:'a4bcd167da3e93c0f',agent_type:'Explore'}));
  assert.deepEqual(stopped,list);
  assert.deepEqual(applySubagent(stopped,subagentOp({hook_event_name:'PostToolUse',tool_name:'Agent',tool_use_id:pre.tool_use_id,tool_response:{status:'completed',agentId:'a4bcd167da3e93c0f'}})),[]);
  assert.deepEqual(subagentOp({hook_event_name:'PostToolUseFailure',tool_name:'Agent',tool_use_id:pre.tool_use_id}),{op:'end',id:pre.tool_use_id});
});

test('background launch retains entry until SubagentStop by agent ID',()=>{
  const list=applySubagent(undefined,start(),now),snapshot=structuredClone(list);
  const background=applySubagent(list,subagentOp({hook_event_name:'PostToolUse',tool_name:'Agent',tool_use_id:pre.tool_use_id,tool_response:{status:'async_launched',agentId:'a1'}}));
  assert.equal(background[0].background,true);assert.equal(background[0].agentId,'a1');
  assert.deepEqual(list,snapshot);
  assert.deepEqual(applySubagent(background,subagentOp({hook_event_name:'SubagentStop',agent_id:'a1'})),[]);
  assert.deepEqual(applySubagent(list,{op:'background',id:'missing',agentId:'a2'}),list);
});

test('start replaces duplicates, stamps ISO and keeps the last twelve',()=>{
  let list=[];
  for(let i=0;i<15;i++)list=applySubagent(list,{...start(),id:`t${i}`},now+i);
  assert.equal(list.length,12);assert.equal(list[0].id,'t3');
  const replaced=applySubagent(list,{...start(),id:'t5'},now);
  assert.equal(replaced.length,12);assert.equal(replaced.at(-1).id,'t5');assert.equal(replaced.at(-1).startedAt,'2026-01-01T00:00:00.000Z');
  assert.notEqual(replaced,list);
});

test('session events reset entries',()=>{
  for(const event of ['SessionStart','SessionEnd'])assert.deepEqual(applySubagent([start()],subagentOp({hook_event_name:event})),[]);
  assert.deepEqual(applySubagent('invalid',{op:'end',id:'missing'}),[]);
});

test('validation rejects unknown fields, invalid IDs and multiline or oversized metadata',()=>{
  for(const op of [start(),{op:'reset'},{op:'end',agentId:'a'},{op:'background',id:'t',agentId:'a'}])assert.equal(validateSubagentOp(op),op);
  for(const op of [null,[],{op:'zap'},{op:'reset',prompt:'secret'},{op:'end'},{op:'end',id:'a\nb'},{op:'background',id:'t'},{...start(),background:1},{...start(),type:'a\nb'},{...start(),description:'d'.repeat(241)},{...start(),id:'x'.repeat(201)}])assert.throws(()=>validateSubagentOp(op));
});

test('hook CLI stays silent and exits zero for malformed input or unavailable host',()=>{
  for(const input of ['', 'invalid',JSON.stringify(pre),'x'.repeat(1024*1024+1)]) {
    const result=spawnSync(process.execPath,['scripts/agent.mjs','subagent'],{input,env:{PATH:process.env.PATH,PHANTOM_TERMINAL_SESSION_ID:'s',PHANTOM_WORKSPACE_SOCKET:'/nonexistent/phantom.sock'},encoding:'utf8',timeout:10000});
    assert.equal(result.status,0);assert.equal(result.stdout+result.stderr,'');
  }
});

// --- Durable agent traces (host/agent-traces.mjs, host/agent-trace-adapters.mjs). Fixtures are synthetic. ---
const W='ws-1',N='node-1';
const clock=()=>{let ms=Date.parse('2026-02-01T00:00:00Z');return()=>ms+=1000;};
const tmp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-traces-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const feed=(store,records)=>records.map(record=>store.record(record));
const agentOf=(store,id,workspaceId=W)=>store.list({workspaceId}).items.find(item=>item.id===id);
const eventsOf=(store,id,workspaceId=W)=>store.detail({workspaceId,id,limit:200}).events;
const files=dir=>fs.readdirSync(dir,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>path.join(entry.parentPath,entry.name));

test('trace store keeps history across restart; sessions left open become interrupted, never done',t=>{
  const dir=tmp(t),now=clock();
  let store=createAgentTraceStore({dataDir:dir,now});
  store.record({workspaceId:W,nodeId:N,id:'root-open',provider:'claude',status:'running',event:{kind:'turn.start',text:'hola'}});
  store.record({workspaceId:W,nodeId:N,id:'root-done',provider:'claude',status:'running'});
  store.record({workspaceId:W,nodeId:N,id:'root-done',status:'done',event:{kind:'result',text:'listo'}});
  store.close();
  assert.throws(()=>store.record({workspaceId:W,nodeId:N,id:'late'}),/closed/);
  store=createAgentTraceStore({dataDir:dir,now});
  const open=agentOf(store,'root-open'),done=agentOf(store,'root-done');
  assert.equal(open.status,'interrupted');assert.equal(open.availability.outcome.available,false);assert.match(open.availability.outcome.reason,/reinici/);
  assert.equal(done.status,'done');assert.equal(done.availability.outcome,undefined);
  assert.deepEqual(eventsOf(store,'root-open').map(event=>event.kind),['turn.start','interrupted']);
  assert.deepEqual(eventsOf(store,'root-done').map(event=>event.text),['listo']);
  // A real outcome that arrives late replaces "interrupted"; a second restart does not touch finished sessions.
  store.record({workspaceId:W,nodeId:N,id:'root-open',status:'stopped'});
  assert.equal(agentOf(store,'root-open').status,'stopped');
  store.close();
  store=createAgentTraceStore({dataDir:dir,now});
  assert.equal(agentOf(store,'root-open').status,'stopped');assert.equal(eventsOf(store,'root-open').length,2);
});

test('interleaved root and two children keep their own events, parents and order',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()});
  const rec=(id,extra={})=>store.record({workspaceId:W,nodeId:N,id,...extra});
  rec('root',{status:'running',name:'Principal'});
  rec('child-a',{parentId:'root',status:'running',event:{id:'a1',kind:'message',text:'A empieza'}});
  rec('child-b',{parentId:'root',status:'running',event:{id:'b1',kind:'message',text:'B empieza'}});
  rec('root',{event:{id:'r1',kind:'tool',tool:'Agent',status:'running'}});
  rec('child-a',{event:{id:'a2',kind:'tool',tool:'Grep',status:'running'}});
  rec('child-b',{event:{id:'b2',kind:'message',text:'B sigue'}});
  rec('child-a',{status:'done',event:{id:'a3',kind:'result',text:'A termina'}});
  rec('child-b',{status:'error',event:{id:'b3',kind:'error',text:'B falla'}});
  assert.deepEqual(eventsOf(store,'child-a').map(event=>[event.seq,event.id]),[[1,'a1'],[2,'a2'],[3,'a3']]);
  assert.deepEqual(eventsOf(store,'child-b').map(event=>event.id),['b1','b2','b3']);
  assert.deepEqual(eventsOf(store,'root').map(event=>event.id),['r1']);
  assert.deepEqual(['child-a','child-b'].map(id=>[agentOf(store,id).parentId,agentOf(store,id).status]),[['root','done'],['root','error']]);
  assert.equal(agentOf(store,'root').parentId,null);assert.equal(agentOf(store,'root').status,'running');
  assert.equal(agentOf(store,'child-a').currentActivity,null,'finished agents have no current activity');
  assert.equal(agentOf(store,'root').currentActivity.tool,'Agent');
  assert.deepEqual(store.list({workspaceId:W,nodeId:'otro'}).items,[]);
});

test('a finished agent stays finished; only an explicit turn or session start reopens it',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()});
  const rec=extra=>store.record({workspaceId:W,nodeId:N,id:'root',...extra});
  rec({status:'running',event:{kind:'turn.start'}});rec({status:'done',event:{kind:'result',text:'fin'}});
  const ended=agentOf(store,'root').endedAt;
  rec({status:'running',event:{id:'late',kind:'tool',tool:'Read',status:'running'}});
  assert.equal(agentOf(store,'root').status,'done');assert.equal(agentOf(store,'root').currentActivity,null);assert.equal(agentOf(store,'root').endedAt,ended);
  rec({status:'error',event:{kind:'error'}});
  assert.equal(agentOf(store,'root').status,'done','a terminal state is not rewritten by another outcome');
  assert.equal(eventsOf(store,'root').length,4,'late events are still recorded');
  rec({status:'running',event:{kind:'turn.start'}});
  assert.equal(agentOf(store,'root').status,'running');assert.equal(agentOf(store,'root').endedAt,null);
});

test('more than forty events are paginated by cursor and nothing is silently dropped',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()});
  store.record({workspaceId:W,nodeId:N,id:'root',status:'running'});
  for(let i=1;i<=130;i++)store.record({workspaceId:W,nodeId:N,id:'root',event:{id:`e${i}`,kind:'message',text:`mensaje ${i}`}});
  const seen=[];let cursor,pages=0;
  for(;;) {
    const page=store.detail({workspaceId:W,id:'root',cursor,limit:40});pages++;
    assert.ok(page.events.length<=40);seen.push(...page.events.map(event=>event.id));
    if(!page.hasMore){assert.equal(page.cursor,'130');break;}
    cursor=page.cursor;
  }
  assert.equal(pages,4);assert.deepEqual(seen,Array.from({length:130},(_,i)=>`e${i+1}`));
  const first=store.detail({workspaceId:W,id:'root'});
  assert.equal(first.events.length,50);assert.equal(first.hasMore,true);assert.equal(first.availability.truncation.truncated,false);
  assert.equal(store.detail({workspaceId:W,id:'root',limit:5000}).events.length,130);
  for(const bad of [{cursor:'x'},{cursor:'-1'},{cursor:1},{limit:0},{limit:1.5}])assert.throws(()=>store.detail({workspaceId:W,id:'root',...bad}),/Invalid/);
  assert.equal(store.detail({workspaceId:W,id:'root',cursor:'130'}).hasMore,false);
});

test('retention is explicit: oldest events and agents are dropped and the truncation says so',t=>{
  const dir=tmp(t),store=createAgentTraceStore({dataDir:dir,now:clock(),limits:{maxEvents:50,compactSlack:10,maxAgents:3}});
  store.record({workspaceId:W,nodeId:N,id:'root',status:'running'});
  for(let i=1;i<=120;i++)store.record({workspaceId:W,nodeId:N,id:'root',event:{id:`e${i}`,kind:'message',text:`m${i}`}});
  const page=store.detail({workspaceId:W,id:'root',limit:200}),{truncation}=page.availability;
  assert.equal(truncation.truncated,true);assert.equal(truncation.limit,50);
  assert.ok(page.events.length>=50&&page.events.length<=60);
  assert.equal(truncation.dropped+page.events.length,120);assert.equal(page.events[0].seq,truncation.dropped+1);assert.equal(page.events.at(-1).id,'e120');
  for(const id of ['a','b','c','d'])store.record({workspaceId:W,nodeId:N,id,status:'done'});
  const listed=store.list({workspaceId:W});
  assert.equal(listed.items.length,3);assert.equal(listed.truncation.truncated,true);assert.equal(listed.truncation.droppedAgents,2);
  assert.equal(store.detail({workspaceId:W,id:'a'}).availability.available,false,'the oldest finished agent was dropped');
  assert.equal(store.detail({workspaceId:W,id:'root'}).availability.available,true,'a running agent is kept');
  assert.equal(createAgentTraceStore({dataDir:dir,now:clock()}).list({workspaceId:W}).truncation.droppedAgents,2,'the signal survives a restart');
});

test('ownership is explicit and immutable; IDs are validated, isolated by workspace and never become paths',t=>{
  const dir=tmp(t),store=createAgentTraceStore({dataDir:dir,now:clock()});
  const base={workspaceId:W,nodeId:N};
  store.record({...base,id:'root',taskId:'task-1',runId:'run-1',status:'running'});
  store.record({...base,id:'orphan',status:'running'});
  assert.equal(agentOf(store,'orphan').parentId,null);assert.equal(agentOf(store,'orphan').taskId,null);
  assert.equal(agentOf(store,'orphan').availability.taskRun.available,false,'no task or run is inferred from order or the last message');
  assert.throws(()=>store.record({...base,nodeId:'other',id:'root'}),/otro nodo/);
  assert.throws(()=>store.record({...base,id:'root',taskId:'task-2'}),/taskId/);
  assert.throws(()=>store.record({...base,id:'root',runId:'run-2'}),/runId/);
  store.record({...base,id:'child',parentId:'root'});
  assert.throws(()=>store.record({...base,id:'child',parentId:'orphan'}),/parentId/);
  assert.throws(()=>store.record({...base,id:'loop',parentId:'loop'}),/padre/);
  store.record({...base,id:'root',taskId:'task-1'});
  for(const bad of ['','../x','a/b','a\\b','.hidden',' a','a b','x'.repeat(201),null,5,{}]) {
    for(const field of ['workspaceId','nodeId','id','parentId','taskId','runId']) {
      if(bad===null&&['parentId','taskId','runId'].includes(field))continue;// null means "not given" for optional links
      assert.throws(()=>store.record({...base,id:'ok',[field]:bad}),/Invalid/,`${field}=${String(bad)}`);
    }
  }
  assert.equal(agentOf(store,'ok'),undefined,'a rejected record leaves nothing behind');
  for(const bad of [{event:'x'},{event:{kind:'Bad Kind'}},{event:{kind:'tool',status:'RUNNING!'}},{event:{kind:'tool',text:5}},{status:'finished'},{model:'claude-x'},{model:'a b',modelSource:'observed'},{modelSource:'guess'},{context:'x'},null])assert.throws(()=>store.record(bad===null?null:{...base,id:'ok',...bad}),/Invalid|requires/);
  // Another workspace sees none of it, even with the same agent ID.
  store.record({workspaceId:'ws-2',nodeId:N,id:'root',status:'running'});
  assert.deepEqual(store.list({workspaceId:'ws-2'}).items.map(item=>item.taskId),[null]);
  assert.equal(store.detail({workspaceId:'ws-3',id:'root'}).availability.available,false);
  assert.equal(store.detail({workspaceId:'ws-3',id:'root'}).agent,null);
  // Weird but valid IDs only exist as data: every file on disk is a digest.
  store.record({...base,id:'toolu_01:a@b+c',event:{kind:'message',text:'x'}});
  for(const file of files(dir))assert.match(path.relative(dir,file),/^agent-traces\/([0-9a-f]{32}\/([0-9a-f]{32}\.jsonl?|workspace\.json))$/);
});

test('secrets are redacted before they reach the disk; files and directories are private',t=>{
  const dir=tmp(t),store=createAgentTraceStore({dataDir:dir,now:clock()});
  process.env.PHANTOM_TEST_API_TOKEN='envsecret-VALUE-0123456';t.after(()=>{delete process.env.PHANTOM_TEST_API_TOKEN;});
  const anthropic=`sk-ant-api03-${'B'.repeat(24)}`,github=`ghp_${'a'.repeat(30)}`;
  store.record({workspaceId:W,nodeId:N,id:'root',status:'running',context:{instructions:`Usa ${anthropic}`,assignment:'token=hunter2hunter2'},event:{kind:'tool',tool:'Bash',
    text:`export GITHUB_TOKEN=${github} && echo ${process.env.PHANTOM_TEST_API_TOKEN}`,
    input:{command:'curl -H "Authorization: Bearer abcdefghijklmnop1234" https://user:pw0rd@host/x',env:{HOME:'/home/x',API_KEY:'hunter22222'},password:'p4ssw0rd'},
    output:'{"access_token":"zzzzzzzzzzzz","ok":true}'}});
  const [event]=store.detail({workspaceId:W,id:'root'}).events;
  for(const secret of [anthropic,github,'envsecret-VALUE-0123456','abcdefghijklmnop1234','pw0rd','hunter22222','hunter2hunter2','p4ssw0rd','zzzzzzzzzzzz'])
    for(const file of files(dir))assert.ok(!fs.readFileSync(file,'utf8').includes(secret),`${secret} no debe persistir`);
  assert.match(event.text,/\[redactado\]/);assert.match(event.input,/"env":"\[redactado\]"/);assert.match(event.output,/"ok":true/);
  assert.equal(agentOf(store,'root').context.instructions.available,true);assert.doesNotMatch(agentOf(store,'root').context.instructions.text,/sk-ant/);
  const root=path.join(dir,'agent-traces');
  assert.equal(fs.statSync(root).mode&0o777,0o700);
  for(const file of files(dir))assert.equal(fs.statSync(file).mode&0o777,0o600);
  for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isDirectory())assert.equal(fs.statSync(path.join(root,entry.name)).mode&0o777,0o700);
  // Oversized fields are bounded and flagged, not silently cut.
  store.record({workspaceId:W,nodeId:N,id:'root',event:{kind:'message',text:'x'.repeat(50000)}});
  const long=store.detail({workspaceId:W,id:'root'}).events.at(-1);assert.ok(long.text.length<=4001);assert.equal(long.truncated,true);
});

test('a symlinked trace directory is refused and nothing is written through it',t=>{
  const dir=tmp(t),outside=tmp(t);
  fs.symlinkSync(outside,path.join(dir,'agent-traces'));
  const store=createAgentTraceStore({dataDir:dir,now:clock()});
  assert.throws(()=>store.record({workspaceId:W,nodeId:N,id:'root',event:{kind:'message',text:'x'}}),/no seguro/);
  assert.throws(()=>store.list({workspaceId:W}),/no seguro/);
  assert.deepEqual(fs.readdirSync(outside),[]);
  // A workspace directory swapped for a symlink after startup is refused too.
  const other=tmp(t),good=createAgentTraceStore({dataDir:other,now:clock()});
  good.record({workspaceId:W,nodeId:N,id:'root',status:'running'});
  const root=path.join(other,'agent-traces'),space=fs.readdirSync(root)[0],target=tmp(t);
  fs.rmSync(path.join(root,space),{recursive:true});fs.symlinkSync(target,path.join(root,space));
  assert.throws(()=>good.record({workspaceId:W,nodeId:N,id:'again',status:'running'}),/no seguro/);
  assert.deepEqual(fs.readdirSync(target),[]);
});

const claudeEvents=[
  {type:'system',subtype:'init',session_id:'sess-1',model:'claude-sonnet-observed'},
  {type:'assistant',message:{id:'m1',model:'claude-sonnet-observed',usage:{input_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:0,output_tokens:5},content:[{type:'thinking',thinking:'PRIVATE_THOUGHT'},{type:'tool_use',id:'toolu_A',name:'Agent',input:{description:'Revisar',prompt:'Mira src/',subagent_type:'Explore',model:'haiku'}}]}},
  {type:'assistant',parent_tool_use_id:'toolu_A',message:{id:'m2',model:'claude-haiku-observed',usage:{input_tokens:100,cache_read_input_tokens:50,cache_creation_input_tokens:0,output_tokens:7},content:[{type:'tool_use',id:'toolu_B',name:'Agent',input:{description:'Nieto',prompt:'Lee a.txt'}},{type:'tool_use',id:'toolu_G',name:'Grep',input:{pattern:'x'}}]}},
  {type:'assistant',parent_tool_use_id:'toolu_B',message:{id:'m3',content:[{type:'text',text:'leyendo'},{type:'tool_use',id:'toolu_R',name:'Read',input:{file_path:'/r/a.txt'}}]}},
  {type:'user',parent_tool_use_id:'toolu_B',message:{content:[{type:'tool_result',tool_use_id:'toolu_R',content:'contenido'}]}},
  {type:'user',parent_tool_use_id:'toolu_A',message:{content:[{type:'tool_result',tool_use_id:'toolu_B',content:[{type:'text',text:'nieto listo'}]}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'toolu_A',content:'hijo listo'}]}},
  {type:'result',subtype:'success',is_error:false,result:'fin',duration_ms:5,usage:{output_tokens:3},modelUsage:{'claude-sonnet-observed':{contextWindow:200000}}},
];
test('Claude adapter keeps nested children under their real parent, model requested apart from observed, and measured context only',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()}),state=createTraceState();
  const base={workspaceId:W,nodeId:N,provider:'claude',state,turnId:'turn-1',model:'sonnet',taskId:'task-9',runId:'run-9'};
  const records=claudeEvents.flatMap(event=>adaptTraceEvent({...base,event}));
  assert.ok(!JSON.stringify(records).includes('PRIVATE_THOUGHT'),'private reasoning is never captured');
  feed(store,records);
  const root=agentOf(store,'root:node-1:claude'),a=agentOf(store,'toolu_A'),b=agentOf(store,'toolu_B');
  assert.deepEqual([root.parentId,a.parentId,b.parentId],[null,root.id,'toolu_A']);
  assert.deepEqual([root.status,a.status,b.status],['done','done','done']);
  assert.deepEqual([root.requestedModel,root.observedModel,root.model,root.modelSource],['sonnet','claude-sonnet-observed','claude-sonnet-observed','observed']);
  assert.deepEqual([a.requestedModel,a.observedModel],['haiku','claude-haiku-observed']);
  assert.deepEqual([root.taskId,root.runId,a.taskId,a.runId,b.taskId],['task-9','run-9',null,null,null],'task and run belong to the root only');
  assert.deepEqual(eventsOf(store,'toolu_B').filter(event=>event.kind==='tool').map(event=>[event.tool,event.status]),[['Read','running'],['Read','done']]);
  assert.ok(!eventsOf(store,root.id).some(event=>event.tool==='Read'||event.text==='leyendo'),'nested work never lands on the root');
  assert.deepEqual(eventsOf(store,'toolu_A').filter(event=>event.tool==='Grep').length,1);
  assert.deepEqual(a.context.tokens,{available:true,measured:157,source:'claude:request-v1',measuredAt:a.context.tokens.measuredAt});
  assert.deepEqual([root.context.tokens.measured,root.context.tokens.window],[35,200000]);
  assert.deepEqual([a.context.assignment.text,a.context.instructions.available,b.context.tokens.available],['Mira src/',false,false]);
  assert.doesNotMatch(JSON.stringify([root.context,a.context]),/percent|ratio|inherit|herencia/i);
  assert.equal(adaptTraceEvent({...base,event:{type:'assistant',parent_tool_use_id:'../x',message:{content:[]}}}).length,0);
  // Events of a child whose delegating call was never seen are unattached, not the root's.
  const orphan=adaptTraceEvent({workspaceId:W,nodeId:N,provider:'claude',event:{type:'assistant',parent_tool_use_id:'toolu_Z',message:{id:'mz',content:[{type:'text',text:'huérfano'}]}}});
  assert.equal(orphan[0].id,'toolu_Z');assert.equal(orphan[0].parentId,undefined);assert.equal(orphan[0].parent.available,false);
  feed(store,orphan);assert.equal(agentOf(store,'toolu_Z').parentId,null);assert.equal(agentOf(store,'toolu_Z').availability.parent.available,false);
});

test('OpenCode and Codex adapters attach children only on explicit evidence and replay without duplicates',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()});
  // OpenCode: a child session streams before the task call names it → unattached until metadata.sessionId links it.
  const oc={workspaceId:W,nodeId:N,provider:'opencode',state:createTraceState(),turnId:'turn-oc'},root={sessionID:'ses_root'};
  const task=(status,extra={})=>({type:'tool_use',...root,part:{sessionID:'ses_root',callID:'k1',tool:'task',state:{status,input:{description:'Revisar CSS',prompt:'Mira chat.css',subagent_type:'general'},...extra}}});
  feed(store,adaptTraceEvent({...oc,event:{type:'tool_use',...root,part:{sessionID:'ses_child',callID:'c1',tool:'read',state:{status:'completed',input:{filePath:'/r/a.css'},output:'css'}}}}));
  feed(store,adaptTraceEvent({...oc,event:task('running')}));
  assert.equal(agentOf(store,'ses_child').parentId,null);assert.equal(agentOf(store,'ses_child').availability.parent.available,false);
  feed(store,adaptTraceEvent({...oc,event:task('completed',{output:'ok',metadata:{sessionId:'ses_child'}})}));
  feed(store,adaptTraceEvent({...oc,event:{type:'step_finish',...root,part:{sessionID:'ses_root',tokens:{total:14915}}}}));
  const child=agentOf(store,'ses_child'),top=agentOf(store,'root:node-1:opencode');
  assert.deepEqual([child.parentId,child.status,child.name,child.availability.parent],[top.id,'done','Revisar CSS',undefined]);
  assert.equal(top.context.tokens.measured,14915);
  assert.deepEqual(eventsOf(store,'ses_child').filter(event=>event.kind==='tool').map(event=>event.id),['c1:end']);
  // Codex: reasoning is skipped, spawn_agent receivers are children of the root, replays add nothing.
  const cx={workspaceId:W,nodeId:'node-cx',provider:'codex',state:createTraceState(),turnId:'turn-cx'};
  const spawned={id:'item_1',type:'collab_tool_call',tool:'spawn_agent',prompt:'Revisa la UI',receiver_thread_ids:['thr-child-1']};
  const codexEvents=[{type:'thread.started',thread_id:'thr-root'},{type:'item.completed',item:{id:'item_0',type:'reasoning',text:'PRIVATE_THOUGHT'}},
    {type:'item.started',item:{...spawned,status:'in_progress'}},{type:'item.completed',item:{...spawned,status:'completed',agents_states:{'thr-child-1':{status:'completed',message:'UI revisada'}}}},
    {type:'item.completed',item:{id:'item_2',type:'command_execution',command:'npm test',exit_code:1,aggregated_output:'failed'}},{type:'turn.completed',usage:{output_tokens:9}}];
  for(const event of codexEvents)feed(store,adaptTraceEvent({...cx,event}));
  const rootId='root:node-cx:codex',count=eventsOf(store,rootId,W).length,childCount=eventsOf(store,'thr-child-1').length;
  assert.deepEqual([agentOf(store,'thr-child-1').parentId,agentOf(store,'thr-child-1').status,agentOf(store,rootId).status],[rootId,'done','done']);
  assert.deepEqual(eventsOf(store,rootId).filter(event=>event.tool==='shell').map(event=>[event.id,event.status]),[['turn-cx:item_2:end','error']]);
  assert.ok(!JSON.stringify(eventsOf(store,rootId)).includes('PRIVATE_THOUGHT'));
  for(const event of codexEvents)feed(store,adaptTraceEvent({...cx,event}));
  assert.deepEqual([eventsOf(store,rootId).length,eventsOf(store,'thr-child-1').length],[count,childCount]);
  // An unknown receiver status is not invented.
  const unknown=adaptTraceEvent({...cx,state:createTraceState(),event:{type:'item.started',item:{...spawned,id:'item_9',receiver_thread_ids:['thr-child-2'],status:'in_progress'}}});
  feed(store,unknown);assert.equal(agentOf(store,'thr-child-2').status,'unknown');
  // MCP: a tools/call pair correlated by JSON-RPC id, attributed to the agent the caller names.
  const mcp={workspaceId:W,nodeId:N,provider:'mcp',agentId:'toolu_A',state:createTraceState()};
  feed(store,[...adaptTraceEvent({...mcp,event:{jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'phantom.context',arguments:{query:'q'}}}}),...adaptTraceEvent({...mcp,event:{jsonrpc:'2.0',id:7,result:{content:[{type:'text',text:'ok'}],isError:false}}})]);
  assert.deepEqual(eventsOf(store,'toolu_A').filter(event=>event.tool==='phantom.context').map(event=>event.status),['running','done']);
  assert.equal(agentOf(store,'toolu_A').provider,null,'an MCP record never assigns a provider');
});

test('turn boundaries reopen the root, and agents left open are settled without a fake done',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()}),state=createTraceState();
  const base={workspaceId:W,nodeId:N,provider:'claude',state,turnId:'turn-2'};
  feed(store,adaptTurnTrace({...base,phase:'start',message:'haz algo',instructions:'sé breve'}));
  feed(store,claudeEvents.slice(0,3).flatMap(event=>adaptTraceEvent({...base,event})));
  const rootId='root:node-1:claude';
  assert.deepEqual([agentOf(store,rootId).context.assignment.text,agentOf(store,rootId).context.instructions.text],['haz algo','sé breve']);
  assert.equal(agentOf(store,'toolu_B').status,'running');
  const end=adaptTurnTrace({...base,phase:'end',status:'stopped'});
  assert.deepEqual(end.map(record=>[record.id,record.status]),[[rootId,'stopped'],['toolu_A','stopped'],['toolu_B','stopped']]);
  feed(store,end);
  assert.deepEqual(['toolu_A','toolu_B',rootId].map(id=>agentOf(store,id).status),['stopped','stopped','stopped']);
  const next=createTraceState();
  feed(store,adaptTurnTrace({...base,state:next,turnId:'turn-3',phase:'start',message:'otra vez'}));
  assert.equal(agentOf(store,rootId).status,'running');
  feed(store,claudeEvents.slice(1,3).flatMap(event=>adaptTraceEvent({...base,state:next,turnId:'turn-3',event})));
  const ended=adaptTurnTrace({...base,state:next,turnId:'turn-3',phase:'end',status:'done'});
  feed(store,ended);
  assert.equal(agentOf(store,rootId).status,'done');assert.equal(agentOf(store,'toolu_B').status,'stopped','a child that already ended keeps its outcome');
  assert.throws(()=>adaptTurnTrace({...base,phase:'pause'}),/phase/);assert.throws(()=>adaptTraceEvent({...base,provider:'gemini',event:{}}),/provider/);
});

test('hook adapter records the terminal session, links background sub-agents by provider ID and ignores what it cannot attribute',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()}),identity={workspaceId:W,nodeId:N,provider:'claude'};
  const hook=payload=>feed(store,adaptHookTrace({session_id:'sess-1',transcript_path:'/etc/passwd',...payload},identity));
  hook({hook_event_name:'SessionStart',source:'startup',model:'claude-observed'});
  hook({hook_event_name:'PreToolUse',tool_name:'Agent',tool_use_id:'toolu_09',tool_input:{description:'Buscar',prompt:'Encuentra X',subagent_type:'Explore',run_in_background:true}});
  assert.equal(agentOf(store,'toolu_09').parentId,'session:sess-1');assert.equal(agentOf(store,'toolu_09').status,'running');
  hook({hook_event_name:'PostToolUse',tool_name:'Agent',tool_use_id:'toolu_09',tool_response:{status:'async_launched',agentId:'agent-a1'}});
  assert.equal(agentOf(store,'toolu_09').providerAgentId,'agent-a1');assert.equal(agentOf(store,'toolu_09').status,'running');
  // The stop that arrives before any link, and tool events from an unlinked sub-agent, are ignored — never the root's.
  const lost=hook({hook_event_name:'SubagentStop',agent_id:'agent-zzz'}),nested=hook({hook_event_name:'PreToolUse',agent_id:'agent-zzz',tool_name:'Bash',tool_use_id:'toolu_77',tool_input:{command:'ls'}});
  assert.deepEqual([lost[0].ignored,nested[0].ignored],['unresolved','unresolved']);
  assert.equal(agentOf(store,'agent-zzz'),undefined);assert.ok(!eventsOf(store,'session:sess-1').some(event=>event.id==='toolu_77:start'));
  hook({hook_event_name:'SubagentStop',agent_id:'agent-a1',last_assistant_message:'hecho'});
  assert.equal(agentOf(store,'toolu_09').status,'done');assert.equal(eventsOf(store,'toolu_09').at(-1).text,'hecho');
  hook({hook_event_name:'PreToolUse',tool_name:'Bash',tool_use_id:'toolu_10',tool_input:{command:'ls'}});
  hook({hook_event_name:'PostToolUseFailure',tool_name:'Bash',tool_use_id:'toolu_10',error:'falló'});
  assert.deepEqual(eventsOf(store,'session:sess-1').filter(event=>event.tool==='Bash').map(event=>event.status),['running','error']);
  hook({hook_event_name:'SessionEnd',reason:'other'});
  assert.equal(agentOf(store,'session:sess-1').status,'done');assert.equal(agentOf(store,'session:sess-1').observedModel,'claude-observed');
  hook({hook_event_name:'PreToolUse',tool_name:'Read',tool_use_id:'toolu_11',tool_input:{file_path:'/r'}});
  assert.equal(agentOf(store,'session:sess-1').status,'done','a finished terminal session stays finished');
  // The reported transcript path is never forwarded or read.
  assert.ok(!JSON.stringify(adaptHookTrace({session_id:'sess-1',transcript_path:'/etc/passwd',hook_event_name:'SessionStart'},identity)).includes('passwd'));
  assert.deepEqual([null,[],'x',{},{hook_event_name:'Unknown'},{hook_event_name:'PreToolUse',tool_name:'Bash'},{hook_event_name:'PreToolUse',tool_name:'Bash',tool_use_id:'../x'}].map(payload=>adaptHookTrace(payload,identity)),Array(7).fill([]));
});

test('hook CLI sends the legacy op and the trace records once each, and logs failures without blocking',async t=>{
  const dir=tmp(t),socket=path.join(dir,'h.sock'),calls=[];
  const server=net.createServer(connection=>{let buffer='';connection.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const row=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);calls.push(row);connection.write(JSON.stringify({id:row.id,result:{ok:true}})+'\n');}});});
  await new Promise(resolve=>server.listen(socket,resolve));t.after(()=>server.close());
  const run=(input,env)=>new Promise(resolve=>{const child=spawn(process.execPath,['scripts/agent.mjs','subagent'],{env:{PATH:process.env.PATH,...env},stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('close',code=>resolve({code,output}));child.stdin.end(input);});
  const env={PHANTOM_TERMINAL_SESSION_ID:'s1',PHANTOM_WORKSPACE_SOCKET:socket};
  const done=await run(JSON.stringify({...pre,session_id:'sess-1',transcript_path:'/etc/passwd'}),env);
  assert.deepEqual([done.code,done.output],[0,'']);
  assert.deepEqual(calls.map(call=>call.method).sort(),['terminal.agent.subagent','terminal.agent.trace']);
  const sent=calls.find(call=>call.method==='terminal.agent.trace').payload;
  assert.equal(sent.sessionId,'s1');assert.ok(sent.records.length>=2);
  assert.ok(sent.records.every(record=>record.workspaceId===undefined&&record.nodeId===undefined&&record.taskId===undefined&&record.runId===undefined),'the host, not the client, supplies identity');
  assert.ok(!JSON.stringify(sent).includes('passwd'));assert.equal(new Set(sent.records.flatMap(record=>record.event?.id??[])).size,sent.records.length,'event IDs are deterministic and unique');
  // Events that only the trace cares about (no legacy op) send a single call.
  calls.length=0;await run(JSON.stringify({hook_event_name:'PreToolUse',tool_name:'Bash',tool_use_id:'toolu_5',tool_input:{command:'ls'}}),env);
  assert.deepEqual(calls.map(call=>call.method),['terminal.agent.trace']);
  // An unavailable host: silent, exit 0, failure logged where the operator asked.
  const log=path.join(dir,'hooks.log'),failed=await run(JSON.stringify(pre),{...env,PHANTOM_WORKSPACE_SOCKET:path.join(dir,'missing.sock'),PHANTOM_AGENT_HOOK_LOG:log});
  assert.deepEqual([failed.code,failed.output],[0,'']);
  const lines=fs.readFileSync(log,'utf8').trim().split('\n').map(row=>JSON.parse(row));
  assert.deepEqual(lines.map(row=>row.method).sort(),['terminal.agent.subagent','terminal.agent.trace']);assert.equal(lines[0].hook,'PreToolUse');
});

// --- Store and adapter edge cases (synthetic fixtures; no provider ran) ---
test('a repeated event id is reported as duplicate and appends nothing',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()});
  const first=store.record({workspaceId:W,nodeId:N,id:'root',event:{id:'e1',kind:'message',text:'hola'}});
  const again=store.record({workspaceId:W,nodeId:N,id:'root',event:{id:'e1',kind:'message',text:'otro texto'}});
  assert.equal(first.duplicate,undefined);assert.equal(first.event.seq,1);
  assert.equal(again.duplicate,true);assert.equal(again.event,null);
  assert.deepEqual(eventsOf(store,'root').map(event=>event.text),['hola']);
});

test('onChange fires once per real change, never for a duplicate, and its failures are counted instead of thrown',t=>{
  const seen=[];let boom=false;
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock(),onChange:change=>{seen.push(change);if(boom)throw new Error('observador roto');}});
  store.record({workspaceId:W,nodeId:N,id:'root',status:'running',event:{id:'e1',kind:'message',text:'x'}});
  store.record({workspaceId:W,nodeId:N,id:'root',event:{id:'e1',kind:'message',text:'x'}});
  assert.deepEqual(seen,[{workspaceId:W,nodeId:N,id:'root'}]);
  boom=true;
  assert.doesNotThrow(()=>store.record({workspaceId:W,nodeId:N,id:'root',event:{id:'e2',kind:'message',text:'y'}}));
  assert.deepEqual([store.health().onChangeErrors,store.health().lastError],[1,'observador roto']);
  assert.equal(eventsOf(store,'root').length,2);
});

test('an observed model replaces the requested one in the view while both are kept',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()});
  store.record({workspaceId:W,nodeId:N,id:'a',model:'sonnet',modelSource:'requested'});
  assert.deepEqual(['model','modelSource','requestedModel','observedModel'].map(key=>agentOf(store,'a')[key]),['sonnet','requested','sonnet',null]);
  store.record({workspaceId:W,nodeId:N,id:'a',model:'claude-sonnet-5-5',modelSource:'observed'});
  assert.deepEqual(['model','modelSource','requestedModel','observedModel'].map(key=>agentOf(store,'a')[key]),['claude-sonnet-5-5','observed','sonnet','claude-sonnet-5-5']);
  assert.equal(agentOf(store,'a').availability.model.available,true);
  store.record({workspaceId:W,nodeId:N,id:'b'});
  const b=agentOf(store,'b');
  assert.deepEqual([b.model,b.modelSource,b.availability.model.available],[null,'unknown',false]);
});

test('measured tokens keep the window across later measures and a window alone is not a measure',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()}),rec=context=>store.record({workspaceId:W,nodeId:N,id:'a',context});
  rec({window:1000});
  let tokens=agentOf(store,'a').context.tokens;
  assert.deepEqual([tokens.available,tokens.window],[false,1000]);assert.ok(tokens.reason);
  rec({tokens:150,source:'claude:request-v1'});
  tokens=agentOf(store,'a').context.tokens;
  assert.deepEqual([tokens.available,tokens.measured,tokens.window,tokens.source],[true,150,1000,'claude:request-v1']);
  rec({tokens:200,window:2000});
  tokens=agentOf(store,'a').context.tokens;
  assert.deepEqual([tokens.measured,tokens.window,tokens.source],[200,2000,'provider']);
  rec({tokens:-5});
  assert.equal(agentOf(store,'a').context.tokens.measured,200,'an invalid measure never replaces a real one');
});

test('instructions are bounded and flagged, blank ones stay unavailable and non-text ones are refused',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()});
  store.record({workspaceId:W,nodeId:N,id:'a',context:{instructions:'x'.repeat(5000),assignment:'   '}});
  const {instructions,assignment}=agentOf(store,'a').context;
  assert.deepEqual([instructions.available,instructions.truncated,instructions.chars,instructions.text.length],[true,true,5000,4001]);
  assert.deepEqual(assignment,{available:false,reason:'No expuesto por el proveedor'});
  assert.throws(()=>store.record({workspaceId:W,nodeId:N,id:'a',context:{instructions:42}}),/Invalid context instructions/);
});

test('a missing-parent note is dropped once the parent is really recorded',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()});
  store.record({workspaceId:W,nodeId:N,id:'c',parent:{available:false,reason:'Sin evidencia'},status:'running'});
  assert.deepEqual(agentOf(store,'c').availability.parent,{available:false,reason:'Sin evidencia'});
  store.record({workspaceId:W,nodeId:N,id:'c',parentId:'root'});
  assert.equal(agentOf(store,'c').parentId,'root');assert.equal(agentOf(store,'c').availability.parent,undefined);
});

test('a provider agent id keeps resolving to its agent after a restart',t=>{
  const dir=tmp(t),now=clock();
  let store=createAgentTraceStore({dataDir:dir,now});
  store.record({workspaceId:W,nodeId:N,id:'toolu_1',providerAgentId:'agent-9',status:'running'});
  store.close();
  store=createAgentTraceStore({dataDir:dir,now});
  assert.equal(agentOf(store,'toolu_1').status,'interrupted');
  store.record({workspaceId:W,nodeId:N,id:'agent-9',matchOnly:true,status:'done',event:{id:'agent-9:stop',kind:'result',text:'listo'}});
  assert.equal(agentOf(store,'toolu_1').status,'done');
  assert.equal(agentOf(store,'agent-9'),undefined,'the provider id never becomes an agent of its own');
  assert.deepEqual(eventsOf(store,'toolu_1').map(event=>event.kind),['interrupted','result']);
});

test('an unknown status never regresses a known one unless the run is explicitly settled',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()}),rec=extra=>store.record({workspaceId:W,nodeId:N,id:'a',...extra});
  rec({status:'running',event:{id:'t1:start',kind:'tool',tool:'Read',status:'running'}});
  assert.equal(agentOf(store,'a').currentActivity.tool,'Read');
  rec({status:'unknown'});
  assert.equal(agentOf(store,'a').status,'running');
  rec({status:'unknown',event:{id:'a:settled',kind:'settled',status:'unknown',text:'La respuesta terminó'}});
  assert.deepEqual([agentOf(store,'a').status,agentOf(store,'a').currentActivity],['unknown',null]);
  rec({status:'running'});
  assert.equal(agentOf(store,'a').status,'running','a settled-unknown agent can still report a real state');
});

test('a replayed turn start never reopens a finished agent but a new one does',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()}),rec=extra=>store.record({workspaceId:W,nodeId:N,id:'root',...extra});
  rec({status:'running',event:{id:'t1:start',kind:'turn.start'}});
  rec({status:'done',event:{id:'t1:end',kind:'turn.end'}});
  rec({status:'running',event:{id:'t1:start',kind:'turn.start'}});
  assert.equal(agentOf(store,'root').status,'done');
  rec({status:'running',event:{id:'t2:start',kind:'turn.start'}});
  assert.deepEqual([agentOf(store,'root').status,agentOf(store,'root').endedAt],['running',null]);
});

test('the store needs an absolute data directory',()=>{
  assert.throws(()=>createAgentTraceStore({dataDir:'relative/dir'}),/absolute/);
  assert.throws(()=>createAgentTraceStore(),/absolute/);
});

test('clipTrace redacts before it bounds and marks what it cut',()=>{
  assert.deepEqual(clipTrace(undefined),{text:'',truncated:false});
  assert.deepEqual(clipTrace(null),{text:'',truncated:false});
  const cut=clipTrace('a'.repeat(50),10);
  assert.deepEqual([cut.text,cut.truncated],['a'.repeat(10)+'…',true]);
  assert.equal(clipTrace({password:'abc',user:'u'}).text,'{"password":"[redactado]","user":"u"}');
  const loop={name:'x'};loop.self=loop;
  assert.match(clipTrace(loop).text,/\[circular\]/);
  assert.equal(clipTrace(5).text,'5');
});

test('redactText hides credentials in the shapes agents print and leaves plain text alone',()=>{
  assert.equal(redactText('password=hunter2'),'password=[redactado]');
  assert.equal(redactText('Authorization: Bearer abcdefghijklmnop1234'),'Authorization: Bearer [redactado]');
  assert.equal(redactText('https://user:pw0rd@host/x'),'https://[redactado]@host/x');
  assert.equal(redactText(`export GITHUB_TOKEN=ghp_${'a'.repeat(30)}`),'export GITHUB_TOKEN=[redactado]');
  assert.equal(redactText(`usa sk-ant-api03-${'B'.repeat(24)} ahora`),'usa [redactado] ahora');
  assert.equal(redactText('a\u0001b'),'ab');
  assert.equal(redactText('hola mundo'),'hola mundo');
});

test('the root agent id is deterministic, honours a valid explicit id and hashes ids that would not fit',()=>{
  assert.equal(traceRootId({nodeId:'n1',provider:'claude'}),'root:n1:claude');
  assert.equal(traceRootId({nodeId:'n1',provider:'claude',rootId:'session:abc'}),'session:abc');
  assert.equal(traceRootId({nodeId:'n1',provider:'claude',rootId:'../x'}),'root:n1:claude');
  const long=traceRootId({nodeId:'x'.repeat(250),provider:'codex'});
  assert.match(long,/^root:[0-9a-f]{32}$/);
  assert.equal(long,traceRootId({nodeId:'x'.repeat(250),provider:'codex'}));
  assert.notEqual(long,traceRootId({nodeId:'x'.repeat(250),provider:'claude'}));
});

test('turn boundaries carry the assignment, the requested model and the real outcome',()=>{
  const base={workspaceId:W,nodeId:N,provider:'claude',turnId:'t1'};
  const [start]=adaptTurnTrace({...base,phase:'start',message:'hola',model:'sonnet'});
  assert.deepEqual([start.id,start.status,start.event.id,start.event.kind,start.context,start.model,start.modelSource],['root:node-1:claude','running','t1:start','turn.start',{assignment:'hola'},'sonnet','requested']);
  const failed=adaptTurnTrace({...base,phase:'end',status:'error',error:'fallo'});
  assert.deepEqual([failed.length,failed[0].status,failed[0].event.id,failed[0].event.text],[1,'error','t1:end','fallo']);
  assert.equal(adaptTurnTrace({...base,phase:'end',status:'stopped'})[0].event.text,'Detenido por el usuario');
});

test('agents left open are settled once as unknown and keep the parent that delegated them',()=>{
  const state=createTraceState(),base={workspaceId:W,nodeId:N,provider:'claude'};
  adaptTraceEvent({...base,state,event:{type:'assistant',message:{id:'m1',content:[{type:'tool_use',id:'toolu_A',name:'Agent',input:{description:'Buscar',prompt:'x'}}]}}});
  assert.deepEqual([...state.open],['toolu_A']);
  const settled=settleTraceAgents({...base,state});
  assert.equal(settled.length,1);
  assert.deepEqual([settled[0].id,settled[0].parentId,settled[0].status,settled[0].event.id,settled[0].event.kind],['toolu_A','root:node-1:claude','unknown','toolu_A:settled','settled']);
  assert.deepEqual(settleTraceAgents({...base,state}),[]);
  assert.throws(()=>settleTraceAgents({...base,provider:'gemini',state}),/provider/);
});

test('Claude adapter marks a failed delegated call as an error on the child and keeps the tool outcome',()=>{
  const state=createTraceState(),base={workspaceId:W,nodeId:N,provider:'claude',state,turnId:'t1'};
  adaptTraceEvent({...base,event:{type:'assistant',message:{id:'m1',content:[{type:'tool_use',id:'toolu_E',name:'Agent',input:{description:'Falla',prompt:'x'}}]}}});
  assert.deepEqual([...state.open],['toolu_E']);
  const records=adaptTraceEvent({...base,event:{type:'user',message:{content:[{type:'tool_result',tool_use_id:'toolu_E',is_error:true,content:'boom'}]}}});
  const child=records.find(record=>record.id==='toolu_E'),tool=records.find(record=>record.event?.id==='toolu_E:end');
  assert.deepEqual([child.status,child.event.kind,child.event.text],['error','result','boom']);
  assert.deepEqual([tool.event.tool,tool.event.status,tool.event.output],['Agent','error','boom']);
  assert.deepEqual([...state.open],[]);
});

test('Claude adapter reads the context window of the observed model and reports an error result',()=>{
  const state=createTraceState(),base={workspaceId:W,nodeId:N,provider:'claude',state,turnId:'t1'};
  adaptTraceEvent({...base,event:{type:'system',subtype:'init',session_id:'s1',model:'claude-x'}});
  const [fin]=adaptTraceEvent({...base,event:{type:'result',is_error:true,errors:['boom','peor'],modelUsage:{'claude-x[1m]':{contextWindow:1000000}}}});
  assert.deepEqual([fin.status,fin.context,fin.event.kind,fin.event.text],['error',{window:1000000},'result','boom peor']);
});

test('Codex adapter reports a failed turn, skips reasoning and ignores events that are not objects',()=>{
  const base={workspaceId:W,nodeId:'node-cx',provider:'codex',state:createTraceState(),turnId:'t9'};
  const [failed]=adaptTraceEvent({...base,event:{type:'turn.failed',error:{message:'sin cuota'}}});
  assert.deepEqual([failed.status,failed.event.id,failed.event.kind,failed.event.text],['error','t9:failed','error','sin cuota']);
  assert.deepEqual(adaptTraceEvent({...base,event:{type:'item.completed',item:{id:'i1',type:'reasoning',text:'PRIVATE_THOUGHT'}}}),[]);
  assert.deepEqual(adaptTraceEvent({...base,event:[]}),[]);
  assert.deepEqual(adaptTraceEvent({...base,event:null}),[]);
});

test('OpenCode adapter sums only complete token readings and reports its own error',()=>{
  const base={workspaceId:W,nodeId:N,provider:'opencode',state:createTraceState(),turnId:'t5'},root={sessionID:'ses_r'};
  const total=adaptTraceEvent({...base,event:{type:'step_finish',...root,part:{sessionID:'ses_r',tokens:{input:1,output:2,reasoning:0,cache:{read:3,write:4}}}}});
  assert.deepEqual(total.map(record=>[record.context.tokens,record.context.source]),[[10,'opencode:request-v1']]);
  assert.deepEqual(adaptTraceEvent({...base,event:{type:'step_finish',...root,part:{sessionID:'ses_r',tokens:{input:1}}}}),[],'a partial reading is not a measure');
  const [err]=adaptTraceEvent({...base,event:{type:'error',...root,error:{message:'sin red'}}});
  assert.deepEqual([err.status,err.event.kind,err.event.text,err.event.id],['error','error','sin red','t5:error']);
});

test('hook records name the root from the explicit id, the session or the node and never take the MCP provider',()=>{
  const [start]=adaptHookTrace({hook_event_name:'SessionStart',source:'resume'},{workspaceId:W,nodeId:'n1',provider:'mcp'});
  assert.deepEqual([start.id,start.provider,start.status,start.event.text],['root:n1:claude','claude','running','Sesión resume']);
  const [bySession]=adaptHookTrace({hook_event_name:'SessionEnd',session_id:'s-9',reason:'clear'},{workspaceId:W,nodeId:'n1'});
  assert.deepEqual([bySession.id,bySession.status,bySession.event.text],['session:s-9','done','Sesión terminada: clear']);
  const [explicit]=adaptHookTrace({hook_event_name:'Stop',session_id:'s-9'},{rootId:'root-fixed',workspaceId:W,nodeId:'n1'});
  assert.deepEqual([explicit.id,explicit.status,explicit.event.kind],['root-fixed','idle','turn.end']);
});

test('a hook Stop leaves the session idle and a later tool still shows its activity until it ends',t=>{
  const store=createAgentTraceStore({dataDir:tmp(t),now:clock()}),identity={workspaceId:W,nodeId:N,provider:'claude'};
  const hook=payload=>feed(store,adaptHookTrace({session_id:'s1',...payload},identity));
  hook({hook_event_name:'SessionStart'});hook({hook_event_name:'Stop'});
  assert.equal(agentOf(store,'session:s1').status,'idle');
  hook({hook_event_name:'PreToolUse',tool_name:'Bash',tool_use_id:'toolu_1',tool_input:{command:'ls'}});
  const busy=agentOf(store,'session:s1');
  assert.deepEqual([busy.status,busy.currentActivity.tool,busy.currentActivity.callId],['idle','Bash','toolu_1']);
  hook({hook_event_name:'PostToolUse',tool_name:'Bash',tool_use_id:'toolu_1',tool_response:{content:[{type:'text',text:'ok'}]}});
  assert.equal(agentOf(store,'session:s1').currentActivity,null);
  assert.equal(eventsOf(store,'session:s1').at(-1).output,'ok');
});
