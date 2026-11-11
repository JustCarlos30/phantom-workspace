import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { atomicJSON, assert, text, MAX_HISTORY, canonicalFolder, validateHistory } from './store.mjs';
import { prepareTerminalDirectory } from './worktrees.mjs';
import { fileURLToPath } from 'node:url';
import { provisionBrowserTerminal } from './agent-browser.mjs';
import { bootstrapAgentPolicy } from './agent-policy.mjs';
const require = createRequire(import.meta.url);
export function dimensions(cols = 80, rows = 24) { assert(Number.isInteger(cols) && cols >= 2 && cols <= 500 && Number.isInteger(rows) && rows >= 1 && rows <= 300, 'Terminal dimensions out of bounds'); return {cols,rows}; }
function processIdentity(pid) {try {const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const parts=stat.slice(stat.lastIndexOf(')')+2).split(' ');return {pid:Number(pid),parent:Number(parts[1]),session:Number(parts[3]),start:parts[19]};}catch{return null;}}
function ownedProcesses(pid) {
  const rows=fs.readdirSync('/proc').filter(v=>/^\d+$/.test(v)).map(processIdentity).filter(Boolean),owned=new Set([pid]);
  for(let changed=true;changed;) {changed=false;for(const p of rows)if(!owned.has(p.pid)&&(p.session===pid||owned.has(p.parent))){owned.add(p.pid);changed=true;}}
  return rows.filter(p=>owned.has(p.pid));
}
function signalIdentities(identities,signal) {for(const identity of identities)if(processIdentity(identity.pid)?.start===identity.start)try{process.kill(identity.pid,signal);}catch{}}
function snapshotOf(entry,session) {
  let lines=1000,data=entry.serializer.serialize({scrollback:lines});
  while(data.length>MAX_HISTORY && lines>0){lines=Math.floor(lines/2);data=entry.serializer.serialize({scrollback:lines});}
  // Normal-size screens remain complete, including alternate-buffer transitions.
  // Extremely dense maximum-size screens still obey the hard history budget.
  session.historyTruncated ||= lines<1000 || entry.terminal.buffer.normal.baseY>=1000;
  return data.length<=MAX_HISTORY?data:'\x1b[0m'+data.slice(-(MAX_HISTORY-4));
}
const HIGH_WATER=256*1024,LOW_WATER=64*1024;
export class Terminals {
  constructor(store, emit) {
    this.store = store; this.emit = emit; this.live = new Map(); this.sessions = []; this.dirty = false; this.closingNodes = new Map(); this.creating = new Map();
    this.filename = path.join(store.dir, 'terminals.json');
    if (store.state.terminalHistory || fs.existsSync(this.filename)) {
      const saved = validateHistory(store.state.terminalHistory ?? JSON.parse(fs.readFileSync(this.filename,'utf8')),store.state.workspaces);
      this.sessions = saved.map(s => ({...s,status:s.status === 'running' ? 'lost' : s.status,pid:null,snapshot:typeof s.snapshot === 'string' ? s.snapshot.slice(-MAX_HISTORY) : ''}));
      this.save();
      if(store.state.terminalHistory) {delete store.state.terminalHistory;store.persist();}
    }
    this.timer = setInterval(() => {
      if(this.dirty&&!this.flushing) {
        this.flushing=this.flush().then(()=>this.save()).finally(()=>{this.flushing=null;});
        this.flushing.catch(error=>this.emit({type:'host.error',message:`Terminal persistence failed: ${error.message}`}));
      }
    },1000);this.timer.unref();
  }
  descriptor(s) { const {snapshot, ...rest} = s; const w=this.store.state.workspaces.find(w=>w.id===s.workspaceId),n=w?.nodes.find(n=>n.id===s.nodeId); return {...rest,...(n?{name:n.title,agent:n.data.agent??null}:{})}; }
  get(id) { const s = this.sessions.find(s => s.id === id); assert(s,'Terminal session not found'); return s; }
  async create(w, node, options) {
    assert(!this.creating.has(node.id), 'Node already has a terminal being created');
    const pending = this.createSession(w, node, options);
    this.creating.set(node.id, pending);
    try { return await pending; }
    finally { this.creating.delete(node.id); }
  }
  async createSession(w, node, options) {
    assert(!process.versions.electron, 'PTY host requires system Node');
    canonicalFolder(w.path);
    assert(!this.closingNodes.has(node.id), 'Terminal is closing');
    assert(!this.sessions.some(s => s.nodeId === node.id && s.status === 'running'), 'Node already has a running terminal');
    assert(this.live.size < 100, 'Too many terminal sessions');
    const size = dimensions(options.cols,options.rows);
    const shell = options.shell || this.store.state.settings.shell || process.env.SHELL || '/bin/bash'; text(shell,'shell',4096); assert(path.isAbsolute(shell) && fs.statSync(shell).isFile(), 'Shell must be an absolute executable path');
    const pty = require('node-pty');
    const { Terminal } = require('@xterm/headless'); const { SerializeAddon } = require('@xterm/addon-serialize');
    const directory = await prepareTerminalDirectory(this.store, w, node);
    assert(this.store.getWorkspace(w.id).nodes.some(n => n.id === node.id), 'Terminal node not found');
    assert(this.live.size < 100, 'Too many terminal sessions');
    // Save allocation before spawn so a failed launch can reuse the same tree.
    this.store.transaction(() => { node.data = { ...node.data, ...directory }; });
    const terminal = new Terminal({...size,scrollback:1000,allowProposedApi:true}); const serializer = new SerializeAddon(); terminal.loadAddon(serializer);
    const sessionId = randomUUID();
    const agentCLI = fileURLToPath(new URL('../scripts/agent.mjs', import.meta.url));
    const browser = provisionBrowserTerminal(this.store.dir, { sessionId, workspaceId: w.id, nodeId: node.id });
    let child;
    try {
      const policyEnv = await bootstrapAgentPolicy({ stateDir:this.store.dir,workspace:w,env:process.env,nodeId:node.id,sessionId,cwd:directory.cwd,branch:directory.worktree?.branch ?? null });
      child = pty.spawn(shell, [], {...size,name:'xterm-256color',cwd:directory.cwd,env:{...process.env,...policyEnv,...browser.env,TERM:'xterm-256color',COLORTERM:'truecolor',PHANTOM_WORKSPACE_SOCKET:path.join(this.store.dir,'host.sock'),PHANTOM_TERMINAL_SESSION_ID:sessionId,PHANTOM_AGENT_CLI:agentCLI,PHANTOM_AGENT_NODE:process.execPath}});
    }
    catch (error) { browser.revoke(); terminal.dispose(); throw error; }
    const s = {id:sessionId,workspaceId:w.id,nodeId:node.id,pid:child.pid,shell,...directory,status:'running',agentReporting:true,...size,generation:randomUUID(),createdAt:new Date().toISOString(),seq:0,snapshot:''};
    const entry = {child,identity:processIdentity(child.pid),terminal,serializer,chain:Promise.resolve(),pending:0,pendingData:'',pumpQueued:false,stopping:false,snapshotDirty:false,paused:false,maxPending:0,pauseCount:0,resumeCount:0,snapshotCount:0}; this.live.set(s.id,entry); this.sessions.push(s);
    // Never evict a live session, and bound persisted closed history.
    while (this.sessions.length > 100) { const i = this.sessions.findIndex(v => v.status !== 'running'); if (i < 0) { child.kill(); throw new Error('Too many terminal sessions'); } this.sessions.splice(i,1); }
    child.onData(data => {
      entry.pending += Buffer.byteLength(data);
      entry.maxPending=Math.max(entry.maxPending,entry.pending);
      if(entry.pending>=HIGH_WATER&&!entry.paused){child.pause();entry.paused=true;entry.pauseCount++;}
      entry.pendingData+=data;
      if(!entry.pumpQueued) {
        entry.pumpQueued=true;
        // Coalesce tiny OS reads instead of creating a parser promise/timer per
        // character. One waiting batch plus one in-flight batch is byte-bounded.
        entry.chain=entry.chain.then(()=>new Promise(r=>setTimeout(r,4))).then(async()=>{
          const batch=entry.pendingData;entry.pendingData='';entry.pumpQueued=false;
          await new Promise(resolve=>terminal.write(batch,resolve));
          entry.pending-=Buffer.byteLength(batch);s.seq++;entry.snapshotDirty=true;this.dirty=true;
          this.emit({type:'terminal.output',workspaceId:s.workspaceId,sessionId:s.id,data:batch,seq:s.seq});
          if(entry.paused&&entry.pending<=LOW_WATER){entry.paused=false;entry.resumeCount++;child.resume();}
        });
      }
    });
    child.onExit(({exitCode,signal}) => {browser.revoke();entry.exited=true;entry.chain=entry.chain.then(()=>{
      this.capture(s,entry);s.status='exited';s.exitCode=exitCode;s.signal=signal;this.live.delete(s.id);terminal.dispose();this.save();this.emit({type:'terminal.exit',sessionId:s.id,workspaceId:s.workspaceId,exitCode});
    });});
    this.save(); return this.descriptor(s);
  }
  capture(s,e) {if(e.snapshotDirty){s.snapshot=snapshotOf(e,s);s.snapshotSeq=s.seq;e.snapshotDirty=false;e.snapshotCount++;}}
  async flush() {await Promise.all([...this.live].map(([id,e])=>{e.chain=e.chain.then(()=>this.capture(this.get(id),e));return e.chain;}));}
  save() {
    // Prefer recent sessions when the global disk-history budget is exhausted.
    let budget=8*1024*1024;
    for(const s of [...this.sessions].reverse()) {const bytes=Buffer.from(s.snapshot);if(bytes.length>budget){s.historyTruncated=true;s.snapshot=budget?bytes.subarray(bytes.length-budget).toString('utf8'):'';while(Buffer.byteLength(s.snapshot)>budget)s.snapshot=s.snapshot.slice(1);}budget-=Buffer.byteLength(s.snapshot);}
    atomicJSON(this.filename,this.sessions.map(s=>({...s,seq:s.snapshotSeq??s.seq})));this.dirty=[...this.live.values()].some(e=>e.snapshotDirty);
  }
  async attach(id,fromSeq) {
    const s=this.get(id);if(fromSeq!==undefined)assert(Number.isSafeInteger(fromSeq)&&fromSeq>=0,'Invalid sequence');
    const result=()=>({session:this.descriptor(s),data:s.snapshot,seq:s.snapshotSeq??s.seq,truncated:!!s.historyTruncated||(fromSeq!==undefined&&fromSeq!==s.seq)}),e=this.live.get(id);
    if(!e)return result();const attached=e.chain.then(()=>{this.capture(s,e);return result();});e.chain=attached.then(()=>{});return attached;
  }
  write(id,data) { text(data,'terminal input',64*1024); const e=this.live.get(id); assert(e && !e.stopping,'Terminal is not running'); e.child.write(data); return {ok:true}; }
  async resize(id,cols,rows) {dimensions(cols,rows);const e=this.live.get(id);assert(e&&!e.exited,'Terminal is not running');e.chain=e.chain.then(()=>{if(e.exited)return;const s=this.get(id);e.child.resize(cols,rows);e.terminal.resize(cols,rows);Object.assign(s,{cols,rows});e.snapshotDirty=true;this.capture(s,e);this.save();});await e.chain;return {ok:true};}
  stop(id) {
    this.get(id);const e=this.live.get(id);
    if(e && !e.stopping && !e.exited) {
      e.stopping=true;const identities=e.identity && processIdentity(e.child.pid)?.start===e.identity.start?ownedProcesses(e.child.pid):[];
      signalIdentities(identities,'SIGTERM');
      // Saved Linux start-times prevent PID reuse from targeting unrelated users' processes.
      e.killTimer=setTimeout(()=>signalIdentities(identities,'SIGKILL'),700);e.killTimer.unref();
    }
    return {ok:true};
  }
  closeNode(nodeId) {
    if (this.closingNodes.has(nodeId)) return this.closingNodes.get(nodeId);
    const closing = (async () => {
      await this.creating.get(nodeId)?.catch(() => {});
      const sessions = this.sessions.filter(s => s.nodeId === nodeId);
      for (const s of sessions) this.stop(s.id);
      const end = Date.now() + 3000;
      while (sessions.some(s => this.live.has(s.id)) && Date.now() < end) await new Promise(r => setTimeout(r, 25));
      assert(!sessions.some(s => this.live.has(s.id)), 'Terminal did not exit; retry closing');
      // Let the descendant SIGKILL fallback finish even if the shell exited first.
      if (sessions.length) await new Promise(r => setTimeout(r, 725));
      await this.flushing;
      this.sessions = this.sessions.filter(s => s.nodeId !== nodeId);
      this.save();
    })().finally(() => this.closingNodes.delete(nodeId));
    this.closingNodes.set(nodeId, closing);
    return closing;
  }
  async close() {clearInterval(this.timer);await Promise.allSettled([...this.creating.values()]);for(const id of this.live.keys())this.stop(id);const end=Date.now()+2500;while(this.live.size&&Date.now()<end)await new Promise(r=>setTimeout(r,25));await new Promise(r=>setTimeout(r,725));await this.flushing;await this.flush();this.save();}
}
