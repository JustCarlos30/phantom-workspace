import { assert } from './store.mjs';

// Live list of a terminal's sub-agents (node.data.subagents): short, in-memory state that resets with the
// session. The durable history (events, parents, outcomes) is host/agent-traces.mjs; both are fed by the hook CLI.

export function validateSubagentOp(op) {
  assert(op && typeof op==='object' && !Array.isArray(op),'Invalid subagent operation');
  const keys={start:['op','id','type','description','background'],background:['op','id','agentId'],end:['op','id','agentId'],reset:['op']};
  assert(Object.hasOwn(keys,op.op),'Invalid subagent operation');
  assert(Object.keys(op).every(key=>keys[op.op].includes(key)),'Unknown subagent field');
  const line=(value,max,min=0)=>typeof value==='string'&&value.length>=min&&value.length<=max&&!/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value);
  for(const key of ['id','agentId'])if(Object.hasOwn(op,key))assert(line(op[key],200,1),'Invalid subagent ID');
  if(op.op==='start')assert(line(op.id,200,1)&&line(op.type,80)&&line(op.description,240)&&typeof op.background==='boolean','Invalid subagent start');
  if(op.op==='background')assert(line(op.id,200,1)&&line(op.agentId,200,1),'Invalid subagent background');
  if(op.op==='end')assert(line(op.id,200,1)||line(op.agentId,200,1),'Invalid subagent end');
  return op;
}

export function applySubagent(list, op, now=Date.now()) {
  const entries=Array.isArray(list)?list:[];
  switch(op.op) {
    case 'start': return [...entries.filter(entry=>entry.id!==op.id),{id:op.id,agentId:'',type:op.type,description:op.description,background:op.background,startedAt:new Date(now).toISOString()}].slice(-12);
    case 'background': return entries.map(entry=>entry.id===op.id?{...entry,agentId:op.agentId,background:true}:entry);
    case 'end': return entries.filter(entry=>op.id?entry.id!==op.id:!entry.agentId||entry.agentId!==op.agentId);
    case 'reset': return [];
    default: return [...entries];
  }
}
