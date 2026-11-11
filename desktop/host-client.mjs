import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dataHome } from '../host/store.mjs';

export function requestTimeout(method) {
  // Git allocation/validation plus the bounded four-minute dependency setup.
  if(method==='terminal.create')return 360000;
  // Transcription includes conversion plus a provider request capped at 120s.
  if(method==='voice.transcribe')return 180000;
  if(/^(phantom\.|docker\.|automation\.)/.test(method))return 150000;
  return 60000;
}

export async function connectHost({dataDir=dataHome(),nodePath='/usr/bin/node',hostPath=new URL('../host/server.mjs',import.meta.url).pathname,onEvent=()=>{}}={}) {
  dataDir=path.resolve(dataDir);fs.mkdirSync(dataDir,{recursive:true,mode:0o700});fs.chmodSync(dataDir,0o700);
  const socketPath=path.join(dataDir,'host.sock');let socket,closed=false,connecting,pending=new Map(),reconnectTimer;
  const notify=event=>{try{onEvent(event);}catch{}};
  function reconnect(delay=200) {clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>ensure().catch(error=>{if(!closed){notify({type:'connection',status:'error',message:error.message});reconnect(1000);}}),delay);}
  function open() {return new Promise((resolve,reject)=>{
    const s=net.createConnection(socketPath);let buffer='',connected=false;s.setEncoding('utf8');s.setTimeout(1500,()=>s.destroy(new Error('Host connection timed out')));
    s.once('connect',()=>{connected=true;s.setTimeout(0);socket=s;resolve();});
    s.on('data',chunk=>{buffer+=chunk;if(Buffer.byteLength(buffer)>32*1024*1024){s.destroy(new Error('Host message too large'));return;}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let message;try{message=JSON.parse(line);}catch{continue;}if(message.event) notify(message.event);else {const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Object.assign(new Error(message.error.message),{code:message.error.code})):p.resolve(message.result);}}}});
    s.on('error',error=>{if(!connected)reject(error);});
    s.on('close',()=>{for(const [id,p] of pending){if(p.transport===s){clearTimeout(p.timer);p.reject(new Error('Host disconnected; request outcome unknown'));pending.delete(id);}}if(socket!==s)return;socket=undefined;if(!closed){notify({type:'connection',status:'disconnected'});reconnect();}});
  });}
  function launch() {
    const log=path.join(dataDir,'host.log');if(fs.existsSync(log)&&fs.statSync(log).size>1024*1024)fs.renameSync(log,`${log}.1`);
    const fd=fs.openSync(log,'a',0o600);
    // ELECTRON_RUN_AS_NODE is deliberately absent: native PTY loads in the supplied system runtime.
    const env={...process.env,PHANTOM_WORKSPACE_HOME:dataDir};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
    try {const child=spawn(nodePath,[hostPath,'--data',dataDir],{detached:true,stdio:['ignore',fd,fd],env});child.on('error',error=>notify({type:'connection',status:'error',message:error.message}));child.unref();}finally{fs.closeSync(fd);}
  }
  async function ensure() {
    if(closed)throw new Error('Host client closed');if(socket&&!socket.destroyed)return;if(connecting)return connecting;
    connecting=(async()=>{try{await open();return;}catch{}launch();const end=Date.now()+12000;let last;while(!closed&&Date.now()<end){try{await open();return;}catch(e){last=e;await new Promise(r=>setTimeout(r,100));}}throw new Error(`Host startup failed: ${last?.message??'client closed'}`);})().finally(()=>{connecting=undefined;});
    return connecting;
  }
  await ensure();
  return {
    reconnect() {if(closed)return;if(socket&&!socket.destroyed)socket.destroy();else reconnect();},
    async invoke(method,payload={}) {const id=randomUUID(),line=JSON.stringify({id,method,payload})+'\n';if(Buffer.byteLength(line)>32*1024*1024)throw new Error('Host request too large');await ensure();if(!socket||socket.destroyed)throw new Error('Host unavailable');const transport=socket;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Host request timed out; outcome unknown'));},requestTimeout(method));pending.set(id,{resolve,reject,timer,transport});transport.write(line,error=>{if(error){const p=pending.get(id);if(p){pending.delete(id);clearTimeout(timer);reject(error);}}});});},
    close() {closed=true;clearTimeout(reconnectTimer);socket?.destroy();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Host client closed'));}pending.clear();}
  };
}
