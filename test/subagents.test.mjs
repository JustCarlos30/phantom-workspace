import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { subagentOp } from '../scripts/agent.mjs';
import { applySubagent, validateSubagentOp } from '../host/subagents.mjs';

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
