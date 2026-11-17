import net from 'node:net';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function invokeAgent(method, payload, socketPath, timeout=10000) {
  if (!socketPath) return Promise.reject(new Error('Ejecuta este comando dentro de una terminal nueva de Phantom Workspace.'));
  return new Promise((resolve, reject) => {
    const socket=net.createConnection(socketPath);let buffer='';
    const finish=(error,result)=>{socket.destroy();error?reject(error):resolve(result);};
    socket.setEncoding('utf8');socket.setTimeout(timeout,()=>finish(new Error('El host no respondió.')));
    socket.once('error',error=>finish(error));
    socket.once('connect',()=>socket.write(JSON.stringify({id:1,method,payload})+'\n'));
    socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>4*1024*1024)return finish(new Error('Respuesta demasiado grande'));let index;while((index=buffer.indexOf('\n'))>=0){let row;try{row=JSON.parse(buffer.slice(0,index));}catch(error){return finish(error);}buffer=buffer.slice(index+1);if(row.id===1)return finish(row.error?new Error(row.error.message):null,row.result);}});
    socket.once('end',()=>finish(new Error('Se cerró la conexión con el host.')));
  });
}
export function subagentOp(payload) {
  if(!payload || typeof payload!=='object' || Array.isArray(payload))return null;
  const {hook_event_name:event,tool_use_id:id}=payload;
  const valid=value=>typeof value==='string'&&value.length>0;
  if(event==='SessionStart'||event==='SessionEnd')return {op:'reset'};
  if(event==='SubagentStop')return valid(payload.agent_id)?{op:'end',agentId:payload.agent_id}:null;
  if(payload.tool_name!=='Agent'||!valid(id))return null;
  if(event==='PreToolUse') {
    const input=payload.tool_input;
    return {op:'start',id,type:typeof input?.subagent_type==='string'?input.subagent_type.slice(0,80):'',description:typeof input?.description==='string'?input.description.replace(/[\s\x00-\x1f\x7f-\x9f]+/g,' ').trim().slice(0,240):'',background:input?.run_in_background===true};
  }
  if(event==='PostToolUse')return payload.tool_response?.status==='async_launched'&&valid(payload.tool_response.agentId)?{op:'background',id,agentId:payload.tool_response.agentId}:{op:'end',id};
  return event==='PostToolUseFailure'?{op:'end',id}:null;
}
const USAGE='Uso: agent.mjs context | bind ID | report "Paso actual" [idle|working|blocked|review] | run ID [MODELO] | runs\n'
  +'Encargos: projects | handoff [--project ID|NOMBRE] [--title TÍTULO] [--agent claude|codex|opencode|none] (TEXTO | --file RUTA | -)\n'
  +'Procesos: launch [--title TÍTULO] "COMANDO" | processes | output ID [LÍNEAS] | stop ID\n'
  +'Incorporaciones (terminal): queue | submit ["Resumen"] | withdraw\n'
  +'Incorporaciones (sesión orquestadora): plan "Texto" | order ID [ID…] | note ID "Texto" | merge ID | reject ID "Motivo"\n'
  +'Hooks: subagent (lee el evento de Claude Code por stdin)';
// Incorporaciones: [payload from arguments, argument check]. Orchestrator actions carry its token.
const MERGE={
  queue:{method:'merge.queue',valid:rest=>!rest.length,payload:()=>({})},
  submit:{method:'merge.submit',valid:rest=>rest.length<=1,payload:rest=>rest[0]?{summary:rest[0]}:{}},
  withdraw:{method:'merge.withdraw',valid:rest=>!rest.length,payload:()=>({})},
  plan:{method:'merge.plan',token:true,valid:rest=>rest.length===1,payload:rest=>({text:rest[0]})},
  order:{method:'merge.order',token:true,valid:rest=>rest.length>=1,payload:rest=>({ids:rest})},
  note:{method:'merge.note',token:true,valid:rest=>rest.length===2,payload:rest=>({id:rest[0],text:rest[1]})},
  merge:{method:'merge.run',token:true,timeout:200000,valid:rest=>rest.length===1,payload:rest=>({id:rest[0]})},
  reject:{method:'merge.reject',token:true,valid:rest=>rest.length===2,payload:rest=>({id:rest[0],reason:rest[1]})},
};
function handoffArguments(args) {
  const payload={},seen=new Set();let source;
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg.startsWith('--')) {
      const key=arg.slice(2);
      if(!['project','title','agent','file'].includes(key)||seen.has(key)||i+1>=args.length||args[i+1].startsWith('-'))throw new Error(USAGE);
      seen.add(key);const value=args[++i];
      if(key==='file'){if(source)throw new Error(USAGE);source={file:value};}else payload[key]=value;
    } else {
      if(source||(arg.startsWith('-')&&arg!=='-'))throw new Error(USAGE);
      source=arg==='-'?{stdin:true}:{brief:arg};
    }
  }
  if(!source||(payload.agent!==undefined&&!['claude','codex','opencode','none'].includes(payload.agent)))throw new Error(USAGE);
  return {...payload,brief:source.stdin?fs.readFileSync(0,'utf8'):source.file?fs.readFileSync(source.file,'utf8'):source.brief};
}
export async function main(args=process.argv.slice(2), env=process.env) {
  if(args[0]==='subagent') {
    try {
      if(args.length!==1)return;
      const chunks=[];let size=0;
      for await(const chunk of process.stdin){size+=Buffer.byteLength(chunk);if(size>1024*1024){process.stdin.destroy();return;}chunks.push(chunk);}
      const op=subagentOp(JSON.parse(Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))).toString('utf8')));
      if(op&&env.PHANTOM_TERMINAL_SESSION_ID&&env.PHANTOM_WORKSPACE_SOCKET)await invokeAgent('terminal.agent.subagent',{sessionId:env.PHANTOM_TERMINAL_SESSION_ID,op},env.PHANTOM_WORKSPACE_SOCKET,3000);
    } catch {}
    return;
  }
  if(['launch','processes','output','stop'].includes(args[0])) {
    const [action,...rest]=args;
    let payload={},method=`terminal.agent.${action}`;
    const line=(value,max)=>typeof value==='string'&&value.trim()&&value.trim().length<=max&&!/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value);
    if(action==='launch') {
      const titled=rest.length===3&&rest[0]==='--title';
      if(!(rest.length===1||titled)||!line(rest.at(-1),2000)||rest.at(-1).startsWith('-')||(titled&&(!line(rest[1],120)||rest[1].length>120)))throw new Error(USAGE);
      payload={command:rest.at(-1),...(titled?{title:rest[1]}:{})};
    } else if(action==='processes') {
      if(rest.length)throw new Error(USAGE);
    } else {
      if(rest.length<1||rest.length>(action==='output'?2:1)||!line(rest[0],512)||rest[0].startsWith('-')||(rest.length===2&&(!/^\d+$/.test(rest[1])||Number(rest[1])<1||Number(rest[1])>400)))throw new Error(USAGE);
      method=`terminal.agent.process.${action}`;
      payload={id:rest[0],...(rest.length===2?{lines:Number(rest[1])}:{})};
    }
    if(!env.PHANTOM_TERMINAL_SESSION_ID)throw new Error('Falta la identidad de terminal; abre una sesión nueva en Phantom Workspace.');
    return invokeAgent(method,{sessionId:env.PHANTOM_TERMINAL_SESSION_ID,...payload},env.PHANTOM_WORKSPACE_SOCKET,action==='launch'?60000:10000);
  }
  const [action,...rest]=args,merge=Object.hasOwn(MERGE,action??'')?MERGE[action]:null;
  if ((!merge && !['context','report','bind','projects','handoff','run','runs'].includes(action)) || (action==='projects'&&rest.length) || (merge && !merge.valid(rest)) || (action==='report' && (!rest[0] || !['idle','working','blocked','review'].includes(rest[1]||'working'))) || (action==='bind' && (rest.length!==1 || !rest[0].trim() || rest[0].startsWith('-') || /[\x00-\x1f\x7f]/.test(rest[0]) || rest[0].length>512)) || (action==='run' && (rest.length<1 || rest.length>2 || !rest[0].trim() || rest[0].startsWith('-') || /[\x00-\x1f\x7f]/.test(rest[0]) || rest[0].length>512 || (rest.length===2 && (!rest[1].trim() || /[\x00-\x1f\x7f]/.test(rest[1]) || rest[1].length>200)))) || (action==='runs' && rest.length)) throw new Error(USAGE);
  const handoff=action==='handoff'?handoffArguments(rest):null;
  if(action==='run' || action==='runs') {
    let workspaceId=env.PHANTOM_WORKSPACE_ID;
    if(!workspaceId) {
      if(!env.PHANTOM_TERMINAL_SESSION_ID)throw new Error('Falta la identidad de terminal; abre una sesión nueva en Phantom Workspace.');
      const context=await invokeAgent('terminal.agent.context',{sessionId:env.PHANTOM_TERMINAL_SESSION_ID},env.PHANTOM_WORKSPACE_SOCKET);
      workspaceId=context.workspaceId;
    }
    if(action==='runs') return invokeAgent('phantom.controllers',{workspaceId},env.PHANTOM_WORKSPACE_SOCKET);
    return invokeAgent('phantom.control',{workspaceId,id:rest[0],action:'run',...(rest.length===2?{model:rest[1]}:{})},env.PHANTOM_WORKSPACE_SOCKET,60000);
  }
  // The project's Phantom conversation orchestrates without a terminal: it reads the queue and runs token commands by workspace.
  if(!env.PHANTOM_TERMINAL_SESSION_ID && merge && env.PHANTOM_WORKSPACE_ID && (merge.token || action==='queue')) {
    if(action==='queue') return invokeAgent('merge.status',{workspaceId:env.PHANTOM_WORKSPACE_ID},env.PHANTOM_WORKSPACE_SOCKET);
    return invokeAgent(merge.method,{workspaceId:env.PHANTOM_WORKSPACE_ID,token:env.PHANTOM_MERGE_TOKEN??'',...merge.payload(rest)},env.PHANTOM_WORKSPACE_SOCKET,merge.timeout);
  }
  if(!env.PHANTOM_TERMINAL_SESSION_ID)throw new Error('Falta la identidad de terminal; abre una sesión nueva en Phantom Workspace.');
  if(handoff)return invokeAgent('terminal.agent.handoff',{sessionId:env.PHANTOM_TERMINAL_SESSION_ID,...handoff},env.PHANTOM_WORKSPACE_SOCKET,60000);
  if(merge) return invokeAgent(merge.method,{sessionId:env.PHANTOM_TERMINAL_SESSION_ID,...(merge.token?{token:env.PHANTOM_MERGE_TOKEN??''}:{}),...merge.payload(rest)},env.PHANTOM_WORKSPACE_SOCKET,merge.timeout);
  if(action==='bind') {
    const context=await invokeAgent('terminal.agent.context',{sessionId:env.PHANTOM_TERMINAL_SESSION_ID},env.PHANTOM_WORKSPACE_SOCKET);
    return invokeAgent('terminal.agent.update',{workspaceId:context.workspaceId,nodeId:context.nodeId,patch:{cardId:rest[0]}},env.PHANTOM_WORKSPACE_SOCKET);
  }
  return invokeAgent(`terminal.agent.${action}`,{sessionId:env.PHANTOM_TERMINAL_SESSION_ID,...(action==='report'?{patch:{step:rest[0],status:rest[1]||'working'}}:{})},env.PHANTOM_WORKSPACE_SOCKET);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().then(value=>{if(process.argv[2]!=='subagent')console.log(JSON.stringify(value,null,2));},error=>{if(process.argv[2]!=='subagent'){console.error(error.message);process.exitCode=1;}});
