import net from 'node:net';
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
const USAGE='Uso: agent.mjs context | bind ID | report "Paso actual" [idle|working|blocked|review]\n'
  +'Incorporaciones (terminal): queue | submit ["Resumen"] | withdraw\n'
  +'Incorporaciones (sesión orquestadora): plan "Texto" | order ID [ID…] | note ID "Texto" | merge ID | reject ID "Motivo"';
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
export async function main(args=process.argv.slice(2), env=process.env) {
  const [action,...rest]=args,merge=Object.hasOwn(MERGE,action??'')?MERGE[action]:null;
  if ((!merge && !['context','report','bind'].includes(action)) || (merge && !merge.valid(rest)) || (action==='report' && (!rest[0] || !['idle','working','blocked','review'].includes(rest[1]||'working'))) || (action==='bind' && (rest.length!==1 || !rest[0].trim() || rest[0].startsWith('-') || /[\x00-\x1f\x7f]/.test(rest[0]) || rest[0].length>512))) throw new Error(USAGE);
  if(!env.PHANTOM_TERMINAL_SESSION_ID)throw new Error('Falta la identidad de terminal; abre una sesión nueva en Phantom Workspace.');
  if(merge) return invokeAgent(merge.method,{sessionId:env.PHANTOM_TERMINAL_SESSION_ID,...(merge.token?{token:env.PHANTOM_MERGE_TOKEN??''}:{}),...merge.payload(rest)},env.PHANTOM_WORKSPACE_SOCKET,merge.timeout);
  if(action==='bind') {
    const context=await invokeAgent('terminal.agent.context',{sessionId:env.PHANTOM_TERMINAL_SESSION_ID},env.PHANTOM_WORKSPACE_SOCKET);
    return invokeAgent('terminal.agent.update',{workspaceId:context.workspaceId,nodeId:context.nodeId,patch:{cardId:rest[0]}},env.PHANTOM_WORKSPACE_SOCKET);
  }
  return invokeAgent(`terminal.agent.${action}`,{sessionId:env.PHANTOM_TERMINAL_SESSION_ID,...(action==='report'?{patch:{step:rest[0],status:rest[1]||'working'}}:{})},env.PHANTOM_WORKSPACE_SOCKET);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().then(value=>console.log(JSON.stringify(value,null,2)),error=>{console.error(error.message);process.exitCode=1;});
