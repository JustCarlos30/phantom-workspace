import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { atomicJSON, assert, text, MAX_HISTORY, canonicalFolder, validateHistory } from './store.mjs';
import { prepareTerminalDirectory } from './worktrees.mjs';
import { fileURLToPath } from 'node:url';
import { provisionBrowserTerminal } from './agent-browser.mjs';
import { bootstrapAgentPolicy, shimmedPath } from './agent-policy.mjs';
import { prepareWorktree } from './worktree-setup.mjs';
import { roleEnv, roleOf } from './merge-guard.mjs';
import { inheritClaudeTrust } from './claude-trust.mjs';
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
// Agents recognised in the PTY foreground process group (comm, argv basenames or install path).
const AGENTS=[['opencode','OpenCode'],['claude','Claude Code'],['codex','Codex'],['gemini','Gemini CLI'],['aider','Aider'],['amp','Amp'],['crush','Crush'],['cursor-agent','Cursor Agent'],['goose','Goose'],['qwen','Qwen Code']];
const PATH_AGENTS=[['/claude-code/','Claude Code'],['/@openai/codex/','Codex'],['/@google/gemini-cli/','Gemini CLI'],['/opencode','OpenCode']];
export function detectAgent(comm,argv=[]) {
  const names=[comm,...argv.slice(0,3).map(a=>path.basename(a))].filter(Boolean).map(n=>n.toLowerCase().replace(/\.(c?m?js|exe)$/,''));
  const direct=AGENTS.find(([key])=>names.some(n=>n===key||n.startsWith(`${key}-`)));
  if(direct) return direct[1];
  const joined=argv.slice(0,3).join(' ');
  return PATH_AGENTS.find(([fragment])=>joined.includes(fragment))?.[1]??null;
}
function foregroundOf(pid) {
  try {
    const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),tpgid=Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[5]);
    if(!(tpgid>0)) return null;
    const comm=fs.readFileSync(`/proc/${tpgid}/comm`,'utf8').trim();
    const argv=fs.readFileSync(`/proc/${tpgid}/cmdline`,'utf8').split('\0').filter(Boolean);
    return {command:comm.slice(0,64),agent:detectAgent(comm,argv),shell:tpgid===pid};
  } catch { return null; }
}
// Plain-text tail of the parsed screen for Phantom's map card: logical lines
// (soft wraps rejoined), trailing blank rows dropped. Alternate-screen TUIs
// return their visible screen instead, since their last rows are input chrome.
export function tailLines(terminal,count) {
  const buffer=terminal.buffer.active,alternate=buffer.type==='alternate',out=[];
  const row=i=>buffer.getLine(i);
  if(alternate) {
    let first=buffer.viewportY,last=buffer.viewportY+terminal.rows-1;
    while(last>=first&&!row(last)?.translateToString(true).trim())last--;
    while(first<=last&&!row(first)?.translateToString(true).trim())first++;
    for(let i=Math.max(first,last-59);i<=last;i++)out.push((row(i)?.translateToString(true)??'').slice(0,240));
    return {screen:'alternate',lines:out};
  }
  let i=buffer.length-1,acc='',nextWrapped=false;
  while(i>=0&&!row(i)?.translateToString(true).trim())i--;
  for(;i>=0&&out.length<count;i--) {
    const line=row(i); if(!line) continue;
    acc=line.translateToString(!nextWrapped)+acc;nextWrapped=line.isWrapped;
    if(!line.isWrapped){out.unshift(acc.slice(-240));acc='';}
  }
  return {screen:'normal',lines:out};
}
// What the screen says about whose turn it is. Agent TUIs print a stable
// "esc to interrupt" hint while they work and a numbered/yes-no question when
// they need approval; nothing is inferred beyond those visible signals.
const TRUST_PROMPT=[/\bquick safety check\b/i,/\bis this a project you (created|trust)\b/i,/\byes, i trust this folder\b/i,/\baccessing workspace:/i];
const WORKING=/\besc(ape)?\b.{0,4}\b(to )?(interrupt|cancel)\b/i;
const APPROVAL=[/\bdo you want to (proceed|make|create|run|allow|continue|apply|overwrite|delete)\b/i,/\bwould you like to (run|proceed|allow|make|apply|continue)\b/i,/\ballow (once|always)\b/i,/\bpermission required\b/i,/\brequires? (your )?approval\b/i,/^\s*[❯›>]\s*1\.\s*(yes|allow|approve)\b/i,/\((y\/n|yes\/no)\)|\[(y\/n|Y\/n|y\/N)\]/,/\bpress enter to (continue|confirm)\b/i];
export function screenSignal(lines) {
  const recent=lines.filter(l=>l.trim()).slice(-14);
  if(recent.some(l=>TRUST_PROMPT.some(r=>r.test(l)))) return 'awaiting_approval';
  if(recent.some(l=>WORKING.test(l))) return 'working';
  if(recent.some(l=>APPROVAL.some(r=>r.test(l)))) return 'awaiting_approval';
  return null;
}
// Turn bookkeeping: an agent that was seen working and went quiet hands the turn to you.
export function nextScreenState(previous,signal,agent) {
  if(signal) return signal;
  if(!agent) return null;
  return previous?'awaiting_input':null;
}
const HIGH_WATER=256*1024,LOW_WATER=64*1024;
// /proc reads are cheap but frequent: reuse one result per session for a second.
function cachedForeground(entry) {
  const now=Date.now();
  if(!entry.fg||now-entry.fg.at>=1000) entry.fg={at:now,value:foregroundOf(entry.child.pid)};
  return entry.fg.value;
}
export class Terminals {
  constructor(store, emit) {
    this.store = store; this.emit = emit; this.live = new Map(); this.sessions = []; this.dirty = false; this.closingNodes = new Map(); this.creating = new Map(); this.setupControllers = new Map(); this.setupJobs = new Map(); this.closed = false;
    this.filename = path.join(store.dir, 'terminals.json');
    if (store.state.terminalHistory || fs.existsSync(this.filename)) {
      const saved = validateHistory(store.state.terminalHistory ?? JSON.parse(fs.readFileSync(this.filename,'utf8')),store.state.workspaces);
      this.sessions = saved.map(s => ({...s,status:s.status === 'running' ? 'lost' : s.status,setup:s.setup && ['queued','checking','installing'].includes(s.setup.status) ? {...s.setup,status:'cancelled',error:'El host se reinició durante la preparación. Inicia una nueva sesión para reintentar.'} : s.setup,pid:null,snapshot:typeof s.snapshot === 'string' ? s.snapshot.slice(-MAX_HISTORY) : ''}));
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
  descriptor(s) { const {snapshot, ...rest} = s; const w=this.store.state.workspaces.find(w=>w.id===s.workspaceId),n=w?.nodes.find(n=>n.id===s.nodeId); return {...rest,screenState:this.live.get(s.id)?.screenState??null,screenStateAt:this.live.get(s.id)?.screenStateAt??null,...(n?{name:n.title,agent:n.data.agent??null}:{})}; }
  get(id) { const s = this.sessions.find(s => s.id === id); assert(s,'Terminal session not found'); return s; }
  foreground(id) { const entry=this.live.get(id);return entry&&!entry.exited?foregroundOf(entry.child.pid):null; }
  async create(w, node, options) {
    assert(!this.closed, 'Terminal host is closing');
    assert(!this.setupJobs.has(node.id), 'Las dependencias de esta terminal todavía se están deteniendo');
    assert(!this.creating.has(node.id), 'Node already has a terminal being created');
    const controller = new AbortController();
    this.setupControllers.set(node.id, controller);
    const pending = this.createSession(w, node, options, controller.signal);
    this.creating.set(node.id, pending);
    try { return await pending; }
    finally { this.creating.delete(node.id); if (!this.setupJobs.has(node.id)) this.setupControllers.delete(node.id); }
  }
  async createSession(w, node, options, signal) {
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
    signal.throwIfAborted();
    assert(!this.closed && !this.closingNodes.has(node.id), 'Terminal is closing');
    assert(this.store.getWorkspace(w.id).nodes.some(n => n.id === node.id), 'Terminal node not found');
    assert(this.live.size < 100, 'Too many terminal sessions');
    const terminal = new Terminal({...size,scrollback:1000,allowProposedApi:true}); const serializer = new SerializeAddon(); terminal.loadAddon(serializer);
    const sessionId = randomUUID();
    const agentCLI = fileURLToPath(new URL('../scripts/agent.mjs', import.meta.url));
    const browser = provisionBrowserTerminal(this.store.dir, { sessionId, workspaceId: w.id, nodeId: node.id });
    let child;
    try {
      const branch = directory.worktree?.branch ?? null;
      // Incorporaciones: the policy states the terminal's role and the guard reads it from the environment.
      const integration = w.integration?.enabled ? { role: roleOf(node), base: await this.integrationBase?.(w).catch(() => null) ?? null } : null;
      const policyEnv = { ...await bootstrapAgentPolicy({ stateDir:this.store.dir,workspace:w,env:process.env,nodeId:node.id,sessionId,cwd:directory.cwd,branch,integration }), ...roleEnv({ stateDir:this.store.dir,workspace:w,node,branch }) };
      if (directory.worktree) await inheritClaudeTrust(this.store, w, directory).catch(() => {});
      signal.throwIfAborted();
      assert(!this.closed && !this.closingNodes.has(node.id), 'Terminal is closing');
      child = pty.spawn(shell, [], {...size,name:'xterm-256color',cwd:directory.cwd,env:{...process.env,...policyEnv,...browser.env,PATH:shimmedPath(browser.env.PATH),TERM:'xterm-256color',COLORTERM:'truecolor',PHANTOM_WORKSPACE_SOCKET:path.join(this.store.dir,'host.sock'),PHANTOM_TERMINAL_SESSION_ID:sessionId,PHANTOM_AGENT_CLI:agentCLI,PHANTOM_AGENT_NODE:process.execPath}});
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
        entry.chain=entry.chain.then(()=>new Promise(r=>setTimeout(r,16))).then(async()=>{
          const batch=entry.pendingData;entry.pendingData='';entry.pumpQueued=false;
          await new Promise(resolve=>terminal.write(batch,resolve));
          entry.pending-=Buffer.byteLength(batch);s.seq++;entry.snapshotDirty=true;this.dirty=true;
          this.emit({type:'terminal.output',workspaceId:s.workspaceId,sessionId:s.id,data:batch,seq:s.seq});this.observeScreen(s,entry);
          if(entry.paused&&entry.pending<=LOW_WATER){entry.paused=false;entry.resumeCount++;child.resume();}
        });
      }
    });
    child.onExit(({exitCode,signal}) => {this.setupControllers.get(node.id)?.abort(new Error('Preparación cancelada al terminar terminal'));browser.revoke();entry.exited=true;clearTimeout(entry.screenTimer);entry.chain=entry.chain.then(()=>{
      this.capture(s,entry);s.status='exited';s.exitCode=exitCode;s.signal=signal;this.live.delete(s.id);terminal.dispose();this.save();this.emit({type:'terminal.exit',sessionId:s.id,workspaceId:s.workspaceId,exitCode});
    });});
    if (directory.worktree) this.startSetup(s, this.setupControllers.get(node.id));
    this.save(); return this.descriptor(s);
  }
  startSetup(session, controller = new AbortController()) {
    const nodeId = session.nodeId;
    assert(!this.setupJobs.has(nodeId), 'Las dependencias de esta terminal ya se están preparando');
    this.setupControllers.set(nodeId, controller);
    const update = progress => {
      session.setup = { ...session.setup, ...progress, updatedAt: new Date().toISOString() };
      this.dirty = true;
      this.emit({ type: 'terminal.setup', sessionId: session.id, workspaceId: session.workspaceId, setup: session.setup });
    };
    update({ status: 'queued', output: '', error: '', reason: null, startedAt: new Date().toISOString() });
    // Yield to the create response: an interactive PTY is available before npm.
    const job = new Promise(resolve => setImmediate(resolve)).then(() => prepareWorktree(session.cwd, {
      signal: controller.signal, onProgress: update,
    })).then(result => update({ status: result.status === 'skipped' ? 'skipped' : 'ready', reason: result.reason, error: '' }),
      error => update({ status: controller.signal.aborted ? 'cancelled' : 'failed', error: error.message }));
    this.setupJobs.set(nodeId, job);
    job.finally(() => {
      this.setupJobs.delete(nodeId);
      if (this.setupControllers.get(nodeId) === controller) this.setupControllers.delete(nodeId);
      this.save();
    }).catch(error => this.emit({ type: 'host.error', message: error.message }));
    return job;
  }
  retrySetup(id) {
    const session = this.get(id);
    assert(!this.closed && session.status === 'running' && this.live.has(id), 'Terminal is not running');
    assert(session.worktree, 'Esta terminal no tiene worktree');
    assert(!this.setupJobs.has(session.nodeId), 'Las dependencias de esta terminal ya se están preparando');
    this.startSetup(session);
    return this.descriptor(session);
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
  tail(id,count=12,maxCount=40) {
    assert(Number.isInteger(count)&&count>=1&&count<=maxCount,'Invalid tail line count');
    const s=this.get(id),e=this.live.get(id),base={status:e?s.status:s.status==='running'?'lost':s.status,seq:s.seq,cols:s.cols,rows:s.rows};
    if(e&&!e.exited) return {...base,...tailLines(e.terminal,count),foreground:cachedForeground(e),screenState:e.screenState??null};
    // Closed sessions: parse the persisted snapshot once per sequence.
    const key=s.snapshotSeq??s.seq,cached=this.tails?.get(id);
    if(cached?.key===key&&cached.count===count) return {...base,...cached.value,foreground:null};
    const { Terminal } = require('@xterm/headless');
    const terminal=new Terminal({cols:s.cols||80,rows:s.rows||24,scrollback:1000,allowProposedApi:true});
    return new Promise(resolve=>terminal.write(s.snapshot||'',()=>{
      const value=tailLines(terminal,count);terminal.dispose();
      (this.tails??=new Map()).set(id,{key,count,value});
      resolve({...base,...value,foreground:null});
    }));
  }
  write(id,data) { text(data,'terminal input',64*1024); const e=this.live.get(id); assert(e && !e.stopping,'Terminal is not running'); e.child.write(data); if(e.screenState==='awaiting_input'&&/[\r\n]/.test(data)) this.setScreenState(this.get(id),e,null); return {ok:true}; }
  // Throttled, trailing: a spinner repaint never starves the read, and the
  // last read lands after the screen settles, which is when a turn ends.
  observeScreen(s,e) {
    if(e.screenTimer||e.exited) return;
    e.screenTimer=setTimeout(()=>{
      e.screenTimer=null; if(e.exited) return;
      const buffer=e.terminal.buffer.active,lines=[];
      for(let i=Math.max(0,buffer.viewportY);i<buffer.viewportY+e.terminal.rows;i++) lines.push(buffer.getLine(i)?.translateToString(true)??'');
      const agent=cachedForeground(e)?.agent??null;
      this.setScreenState(s,e,nextScreenState(e.screenState??null,screenSignal(lines),agent));
    },450);
    e.screenTimer.unref?.();
  }
  setScreenState(s,e,state) {
    if((e.screenState??null)===state) return;
    e.screenState=state;
    e.screenStateAt=state===null?null:Date.now();
    this.emit({type:'session.changed',workspaceId:s.workspaceId,sessionId:s.id,screenState:state,screenStateAt:e.screenStateAt});
  }
  async resize(id,cols,rows) {dimensions(cols,rows);const e=this.live.get(id);assert(e&&!e.exited,'Terminal is not running');e.chain=e.chain.then(()=>{if(e.exited)return;const s=this.get(id);e.child.resize(cols,rows);e.terminal.resize(cols,rows);Object.assign(s,{cols,rows});e.snapshotDirty=true;this.capture(s,e);this.save();});await e.chain;return {ok:true};}
  stop(id) {
    const session=this.get(id);this.setupControllers.get(session.nodeId)?.abort(new Error('Preparación cancelada al detener terminal'));const e=this.live.get(id);
    if(e && !e.stopping && !e.exited) {
      e.stopping=true;const identities=e.identity && processIdentity(e.child.pid)?.start===e.identity.start?ownedProcesses(e.child.pid):[];
      // Hang-up is what closing a terminal means: an interactive shell ignores
      // SIGTERM but exits on SIGHUP and passes it on to its jobs.
      signalIdentities(identities,'SIGHUP');signalIdentities(identities,'SIGTERM');
      // Saved Linux start-times prevent PID reuse from targeting unrelated users' processes.
      e.identities=identities;e.killAt=Date.now()+700;
      e.killTimer=setTimeout(()=>signalIdentities(identities,'SIGKILL'),700);e.killTimer.unref();
    }
    return {ok:true};
  }
  closeNode(nodeId) {
    if (this.closingNodes.has(nodeId)) return this.closingNodes.get(nodeId);
    this.setupControllers.get(nodeId)?.abort(new Error('Preparación cancelada al cerrar terminal'));
    const closing = (async () => {
      await this.creating.get(nodeId)?.catch(() => {});
      await this.setupJobs.get(nodeId);
      const sessions = this.sessions.filter(s => s.nodeId === nodeId);
      const entries = sessions.map(s => this.live.get(s.id)).filter(Boolean);
      for (const s of sessions) this.stop(s.id);
      const end = Date.now() + 3000;
      while (sessions.some(s => this.live.has(s.id)) && Date.now() < end) await new Promise(r => setTimeout(r, 25));
      assert(!sessions.some(s => this.live.has(s.id)), 'Terminal did not exit; retry closing');
      // Descendants may outlive the shell: wait only while one is still alive,
      // and never past the SIGKILL fallback that ends it.
      const alive = () => entries.some(e => e.identities?.some(id => processIdentity(id.pid)?.start === id.start));
      const killed = Math.max(0, ...entries.map(e => e.killAt || 0)) + 25;
      while (alive() && Date.now() < killed) await new Promise(r => setTimeout(r, 15));
      await this.flushing;
      for (const s of sessions) this.tails?.delete(s.id);
      this.sessions = this.sessions.filter(s => s.nodeId !== nodeId);
      this.save();
    })().finally(() => this.closingNodes.delete(nodeId));
    this.closingNodes.set(nodeId, closing);
    return closing;
  }
  async close() {this.closed=true;clearInterval(this.timer);for(const controller of this.setupControllers.values())controller.abort(new Error('Preparación cancelada al cerrar host'));await Promise.allSettled([...this.creating.values()]);await Promise.allSettled([...this.setupJobs.values()]);for(const id of this.live.keys())this.stop(id);const end=Date.now()+2500;while(this.live.size&&Date.now()<end)await new Promise(r=>setTimeout(r,25));await new Promise(r=>setTimeout(r,725));await this.flushing;await this.flush();this.save();}
}
