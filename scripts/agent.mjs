import net from 'node:net';
import { pathToFileURL } from 'node:url';

export function invokeAgent(method, payload, socketPath) {
  if (!socketPath) return Promise.reject(new Error('Ejecuta este comando dentro de una terminal nueva de Phantom Workspace.'));
  return new Promise((resolve, reject) => {
    const socket=net.createConnection(socketPath);let buffer='';
    const finish=(error,result)=>{socket.destroy();error?reject(error):resolve(result);};
    socket.setEncoding('utf8');socket.setTimeout(10000,()=>finish(new Error('El host no respondió.')));
    socket.once('error',error=>finish(error));
    socket.once('connect',()=>socket.write(JSON.stringify({id:1,method,payload})+'\n'));
    socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>1024*1024)return finish(new Error('Respuesta demasiado grande'));let index;while((index=buffer.indexOf('\n'))>=0){let row;try{row=JSON.parse(buffer.slice(0,index));}catch(error){return finish(error);}buffer=buffer.slice(index+1);if(row.id===1)return finish(row.error?new Error(row.error.message):null,row.result);}});
    socket.once('end',()=>finish(new Error('Se cerró la conexión con el host.')));
  });
}
export async function main(args=process.argv.slice(2), env=process.env) {
  const [action,...rest]=args;
  if (!['context','report'].includes(action) || (action==='report' && (!rest[0] || !['idle','working','blocked','review'].includes(rest[1]||'working')))) throw new Error('Uso: agent.mjs context | report "Paso actual" [idle|working|blocked|review]');
  if(!env.PHANTOM_TERMINAL_SESSION_ID)throw new Error('Falta la identidad de terminal; abre una sesión nueva en Phantom Workspace.');
  return invokeAgent(`terminal.agent.${action}`,{sessionId:env.PHANTOM_TERMINAL_SESSION_ID,...(action==='report'?{patch:{step:rest[0],status:rest[1]||'working'}}:{})},env.PHANTOM_WORKSPACE_SOCKET);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().then(value=>console.log(JSON.stringify(value,null,2)),error=>{console.error(error.message);process.exitCode=1;});
