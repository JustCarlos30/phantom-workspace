import { createSocketOutput } from './socket-output.mjs';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Store, assert, object, text, canonicalFolder, validateState, validateSessionDefaults, NODE_TYPES, dataHome, pushAttention } from './store.mjs';
import { applySubagent, validateSubagentOp } from './subagents.mjs';
import { Terminals } from './terminals.mjs';
import { Chats, validateChat, validateModel, permissionPatch, applyPatch, assertNewChatPolicy } from './chats.mjs';
import { Merges } from './merges.mjs';
import { Branches } from './branches.mjs';
import { Repo } from './repo.mjs';
import { createLimits } from './limits.mjs';
import { agentContext, validateAgent, isDefaultTerminalTitle, cardPanelTitle, cardTitleOf, autoBindings, applyPlanOp } from './agents.mjs';
import { nextPlanStep, planNote } from './plan-chain.mjs';
import { validatePluginPanel } from '../shared/plugins.mjs';
import { roleEnv } from './merge-guard.mjs';
import { handleReference, forgetNode, mentionBrief } from './references.mjs';
import { MobileAccess } from './mobile.mjs';
import { agentProjects, resolveHandoffProject, validateHandoff, handoffCommand, handoffPosition, createHandoffLimit } from './handoffs.mjs';
import { deliverToOrchestrator } from './orchestrator-route.mjs';
import { validateLaunch, createProcessLimit, processList, validateEnv, createEnvLimit } from './processes.mjs';
import { AndroidGateway } from './android-gateway.mjs';
import { publicSettings, portableSettings } from './public-settings.mjs';
import { stateView } from './state-view.mjs';
import { setExecutionPolicy, POLICY_HINTS } from './agent-policy.mjs';
import { createProviders } from './providers.mjs';
import { wakeMessage, createWakeLimit, createRunWake, createQuotaFlow } from './run-wake.mjs';
import { decideRoute, createQuotaQueue } from './quota-queue.mjs';
import { createSleepInhibitor } from './sleep-inhibit.mjs';
import { createHostEvents, EVENTS_METHOD, TRACE_RENDERER_METHODS, traceParams, publicTraceAgent, authorizeTraceRead, sanitizeTraceRecords } from './workspace-events.mjs';
import { createAgentTraceStore, isTraceModel, clipTrace } from './agent-traces.mjs';
import { traceRootId } from './agent-trace-adapters.mjs';
import { createWorkspaceSupervisor } from './workspace-supervisor.mjs';
import { createSupervisorSummarizer } from './supervisor-provider.mjs';
import { startPatch, finishPatch, cardNode } from './run-binding.mjs';
import { createRunWatch, createNoticeLimit, buildRun, stepLine, amendNotice, AMEND_STEP } from './run-watch.mjs';
import { assertClientAllowed, assertClientModel, configurePolicy, executionPolicy } from '../shared/execution-policy.mjs';

// Identity of the project's main conversation: Phantom, the assistant of this
// workspace. It states only what the host knows; it never claims live state.
const CANVAS_CLI=fileURLToPath(new URL('../scripts/canvas.mjs',import.meta.url)),BRANCHES_CLI=fileURLToPath(new URL('../scripts/branches.mjs',import.meta.url));
export function phantomInstructions(w) {
  const panels=(w.nodes||[]).filter(n=>!n.data?.hidden).slice(0,40).map(n=>`- ${n.type}: ${String(n.title).slice(0,80)}${n.data?.worktree?.branch?` (branch ${n.data.worktree.branch})`:''}`);
  return `## Phantom

You are Phantom, the main assistant of the Phantom Workspace project "${w.name}" (folder ${w.canonicalPath}). The user talks to you from the chat docked beside their canvas, by typing or by voice dictation (dictated text may contain transcription errors; interpret it sensibly). Reply in the user's language, concisely.

You work in the project folder itself, not in a worktree. Help the user understand the project, plan work, answer questions and give instructions. Prefer reading and explaining; make changes only when asked. When Phantom tools (MCP server "phantom" or the phantom CLI) are available, use them for cards, decisions, skills and tasks instead of guessing.

Before registering a task or card for a change, resolve and load the card.prepare skill and follow its "Plan y ruteo" section. Decide the plan and declare it in the contract: lane, children only if justified, model/variant proportional to difficulty (fast mechanical work on the economical model), budget.maxTokens, and judge when project policy requires it. If the skill or those fields are unavailable in the installed harness, continue with the contract it admits and say so in the report; never invent fields.

${POLICY_HINTS.parallel}

${POLICY_HINTS.contract}

Do not launch \`phantom do\` or \`phantom run\` from a chat turn's own shell: both die when the turn ends. Register the task with \`phantom create\` (or \`phantom card\`), including its scope and checks, then use \`"\${PHANTOM_AGENT_NODE:-node}" "\${PHANTOM_AGENT_CLI}" run ID [MODEL]\`, which hands it to the host and survives your turn. In a chat, the host sends an automatic notice with the final status when the run ends, so there is no need to poll or wait inside the turn. To reuse tasks, list them with \`phantom list --workspace "$PWD" --scope worktree\` and never show/run/bind a task whose contract.workspace is not the exact cwd. Check its status with \`phantom show ID\` or \`"\${PHANTOM_AGENT_NODE:-node}" "\${PHANTOM_AGENT_CLI}" runs\`; do not relaunch a task already shown as running.

This product's procedures are published as Phantom skills. Before integrating branches, verifying before publishing, preparing a release, organizing the canvas, or doing research, resolve the appropriate skill with the Phantom MCP \`skills_resolve\` tool and follow it: \`branch.integrate\`, \`verify.prepublish\`, \`release.build\`, \`canvas.organize\`, or \`research.collect\`. If the MCP or skill is unavailable, say so and use the CLI help instead. For feedback services and jobs run through Docker compose (previews, long-running services, e2e or migration jobs, full dev environments by profile), resolve the skill actions \`env.service\`, \`env.job\` and \`env.up\` and write them as compose.yaml services with \`x-phantom\`. Each research belongs in its own space created with the canvas CLI \`research\` command, which the user reviews in the Reader panel.

You can organize the user's canvas when they ask (order, group, move, resize, rename, hide panels): run \`"\${PHANTOM_AGENT_NODE:-node}" ${JSON.stringify(CANVAS_CLI)} help\` for usage. Start with \`list\`; prefer \`arrange --by type|branch|status --zones\` for "ordénalo"; hiding a panel never stops its session.

You are also this project's integrator: when the user asks to merge, integrate or ship the work of terminals/worktrees, use the branches CLI: \`"\${PHANTOM_AGENT_NODE:-node}" ${JSON.stringify(BRANCHES_CLI)} help\`. The project checkout stays on the integration branch and clean; never implement features in it. Flow: \`status\` (work, ahead/behind, predicted conflicts, live terminals) → \`commit\` a worktree only when its agent is idle/finished (ask if it is still working) → \`integrate\` (merges --no-ff, runs the project checks, undoes the merge if they fail) → for a predicted conflict on a branch with no live terminal, \`update BRANCH --resolve\`, edit the files in that worktree, \`commit BRANCH "msg"\` concludes the merge (\`abort\` backs out); a live terminal resolves its own conflicts → \`publish\` pushes the integration branch (GitHub marks PRs whose commits land as merged) → \`clean\` removes integrated branches without terminals. Never force, never discard work; report what was integrated, what failed and why.
The canvas is also the user's reference board: images, videos and sites they pasted, each with a "why" note, plus comment pins (on videos, at a timestamp). When they ask you to use their references or address their comments, run the same CLI with \`refs [--zone NAME]\` (local file paths: read them to actually see the references), \`comments\`, \`storyboard ZONE\`; after research, collect what you found with \`board "Name" --from refs.json\` or \`add-image\`/\`add-site\`, always with a note saying why. Answer a thread with \`reply N "…"\`; only \`resolve\` it when the user says it is done.
Audiovisual reviews include immutable media SHA-256/file identity, normalized content region (excluding chrome and letterboxing), declared FPS/time/frame (base 0), instant/range/all scope, and optional element, editable source and PNG capture. Read that exact version. A region is not semantic selection; "all" is user intent, not automatic tracking. Delivering context is not editing the source. Import a changed render with \`add-version ID PATH\` to compare; never overwrite originals or transfer comments to the new version. \`review\` records rich context; \`retry N\` explicitly retries only failed delivery without duplicating a thread. Delivery/queue state does not mean the requested change is completed; the user resolves it.
${panels.length?`
Panels open on the canvas when this turn started:
${panels.join('\n')}
`:''}`;
}

export function probeSocket(socketPath) { return new Promise(resolve => { const s=net.createConnection(socketPath); const done=value=>{s.destroy();resolve(value);}; s.once('connect',()=>done(true)); s.once('error',()=>done(false)); s.setTimeout(500,()=>done(true)); }); }
async function bounded(promise,milliseconds,label) {
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out`)),milliseconds);})]);}finally{clearTimeout(timer);}
}
export async function createHost({dataDir=dataHome(),handleIntegration,shutdownIntegrations,mobileOptions,handoffOptions,processOptions,providerOptions,traceOptions,supervisorOptions}={}) {
  assert(!process.versions.electron,'Run the host with system Node, never Electron');
  dataDir=path.resolve(dataDir); fs.mkdirSync(dataDir,{recursive:true,mode:0o700}); fs.chmodSync(dataDir,0o700);
  const socketPath=path.join(dataDir,'host.sock'), lockPath=path.join(dataDir,'host.lock');
  // Linux abstract sockets are kernel-arbitrated and disappear on crash. Unlike a
  // stale PID-file takeover there is no unlink race between simultaneous starters.
  const arbitration=net.createServer();
  await new Promise((resolve,reject)=>{arbitration.once('error',()=>reject(new Error('Host already running or starting')));arbitration.listen('\0phantom-workspace-'+createHash('sha256').update(fs.realpathSync(dataDir)).digest('hex'),resolve);});
  try {fs.writeFileSync(lockPath,JSON.stringify({pid:process.pid}),{mode:0o600});}catch(e){arbitration.close();throw e;}
  let store,terminals,chats,merges,branches,repo,server,mobile,android,providers,traces,supervisor,closingPromise,ownsSocket=false;
  const clients=new Set();
  const limits=providerOptions?.limits??createLimits();let unsubscribeLimits;
  // Effective provider policy: read from settings on every use, never cached as a fallback.
  const policy=()=>executionPolicy(store.state.settings);
  const publishPolicy=()=>{try{setExecutionPolicy(policy());}catch{/* Invalid stored settings: execution throws on use; the hint keeps the last valid policy. */}};
  const reserveHandoff=createHandoffLimit(handoffOptions);
  const reserveProcess=createProcessLimit(processOptions);
  const reserveEnv=createEnvLimit(processOptions);
  const outputs = new WeakMap();
  const send=(socket,message)=>outputs.get(socket)?.(message);
  const broadcast=event=>{for(const c of clients)send(c,{event});};
  // The renderer feed also feeds the supervisor's local feed: the same events, no second source.
  const hostEvents=createHostEvents({broadcast:event=>{broadcast(event);if(event.type==='workspace.event')feedSupervisor(event.event);}});
  function feedSupervisor(event){try{if(supervisor&&!closingPromise)supervisor.ingest({...event,...(event.kind==='card'&&event.entityId?{taskId:event.entityId}:{})});}catch{}}
  const emit=event=>{
    try{if(store&&!closingPromise)hostEvents.feed(event,sessionId=>terminals?.sessions.find(s=>s.id===sessionId)?.nodeId);}catch{}
    const terminalExit=event.type==='terminal.exit',toolFinish=event.type==='tool.status'&&['failed','completed'].includes(event.status);
    const runId=terminalExit?event.sessionId:event.id;
    if((terminalExit||toolFinish)&&runId&&store) {
      const w=store.state.workspaces.find(w=>w.id===event.workspaceId),eventKey=`${terminalExit?'terminal':'tool'}:${runId}:${terminalExit?'exit':event.status}`;
      if(w&&!w.attention.some(item=>item.eventKey===eventKey)) {
        const now=new Date().toISOString(),source=terminalExit?'terminal':event.result?.source==='phantom'?'phantom':'tool';
        const item={id:randomUUID(),eventKey,title:terminalExit?`Terminal finalizada (código ${event.exitCode??'desconocido'})`:`Proceso ${source==='phantom'?'Phantom':'de herramienta'} ${event.status==='failed'?'fallido':'finalizado'}`,source,ref:runId,...(terminalExit?{sessionId:runId,exitCode:event.exitCode}:{runId,status:event.status}),createdAt:now,observedAt:now};
        store.transaction(()=>{pushAttention(w,item);});
        broadcast({type:'attention.new',workspaceId:w.id,item});markChanged(w.id);
      }
    }
    broadcast(event);
    try{
      const r=event.result;
      if(store&&!closingPromise&&event.type==='tool.status'&&event.status==='running'&&r?.source==='phantom'&&r.action==='run'&&typeof r.origin?.nodeId==='string')bindRunStart(r,event.workspaceId).catch(()=>{});
      if(store&&!closingPromise&&event.type==='tool.status'&&r?.source==='phantom'&&r.action==='run'&&typeof r.origin?.nodeId==='string'&&typeof r.taskId==='string'){
        const target={id:r.id,taskId:r.taskId,workspaceId:event.workspaceId??r.workspaceId,nodeId:r.origin.nodeId,via:r.origin.via==='chat'?'chat':'terminal',startedAt:r.createdAt};
        if(event.status==='running')runWatch.track(target);
        else if(['completed','failed','stopped'].includes(event.status)){runWatch.untrack(r.id);finishCard(target,r).catch(()=>{});}
      }
      if(store&&!closingPromise&&event.type==='tool.status'&&event.status==='failed'&&r?.source==='phantom'&&r.action==='run'&&typeof r.taskId==='string')quota.accept({id:r.id,taskId:r.taskId,workspaceId:event.workspaceId??r.workspaceId,nodeId:r.origin?.nodeId,via:r.origin?.via==='chat'?'chat':'terminal'},r);
      if(store&&!closingPromise)runWake.accept(event);
    }catch{}
    try{const step=store&&!closingPromise?planTarget(event):null;if(step)planChain(step).catch(()=>{});}catch{}
    try{if(store&&traces&&!closingPromise){traceRun(event);traceExit(event);}}catch{}
    // The owner terminal left: its ephemeral services go with it. During shutdown they stay registered.
    if(terminalExit&&store&&!closingPromise)envRelease(event.workspaceId,event.sessionId,null);
  };
  // A chat that launched a Phantom run hears once when it ends; capped per node until the user writes again.
  const wakeLimit=createWakeLimit(4);
  const wakeNode=target=>{
    const w=store.getWorkspace(target.workspaceId);
    return target.nodeId===Chats.mainId(w)?chats.mainNode(w):w.nodes.find(n=>n.id===target.nodeId&&n.type==='terminal');
  };
  const runWake=createRunWake({
    ready:(target,recipient)=>{
      if(closingPromise||recipient.cancelled)return false;
      if(target.via==='chat')return !chats.running(target.nodeId);
      const s=terminals.get(recipient.sessionId);return s?.status==='running'&&Boolean(terminals.foreground(s.id)?.agent);
    },
    prepare:target=>{
      let node;try{node=wakeNode(target);}catch{}
      return {node,chat:JSON.stringify(node?.data.chat),thread:chats.nodes[target.nodeId]?.threads?.[node?.data.chat?.provider],sessionId:node?.data.sessionId};
    },
    deliver:async(target,controller,recipient)=>{
      let task;try{const answer=await routeIntegration('phantom.detail',{workspaceId:target.workspaceId,topic:'tasks',id:target.taskId});if(answer?.handled)task=answer.result;}catch{}
      if(closingPromise||recipient.cancelled)return {};
      const node=wakeNode(target),main=target.nodeId.startsWith('phantom:');
      if(!node||(!main&&node!==recipient.node)||JSON.stringify(node.data.chat)!==recipient.chat||node.data.sessionId!==recipient.sessionId||chats.nodes[target.nodeId]?.threads?.[node.data.chat?.provider]!==recipient.thread)return {reason:'El destinatario cambió o se cerró'};
      const message=wakeMessage({taskId:target.taskId,controller,task});
      if(target.via==='chat'){
        if(!node.data.chat?.provider)return {reason:'El chat ya no tiene agente configurado'};
        if(chats.running(node.id)||chats.turns.size+chats.operations.size>=16||chats.get(node).queue.length)return {retry:true,reason:'El chat sigue ocupado; no se pudo entregar el aviso'};
        if(!wakeLimit.available(node.id))return {reason:'Tope de avisos automáticos alcanzado'};
        await chats.send(store.getWorkspace(target.workspaceId),node,message);
        wakeLimit.allow(node.id);
        return {};
      }
      let session;try{session=terminals.get(node.data.sessionId);}catch{}
      if(!session||session.status!=='running'||session.nodeId!==node.id)return {reason:'El PTY no está disponible; no se puede continuar esta sesión'};
      if(!terminals.foreground(session.id)?.agent)return {retry:true,reason:'No hay un agente en primer plano; aviso sin entregar'};
      if(!wakeLimit.available(node.id))return {reason:'Tope de avisos automáticos alcanzado'};
      try{terminals.write(session.id,message+'\r');}catch(error){return {retry:true,reason:error.message};}
      wakeLimit.allow(node.id);
      return {};
    },
    blocked:(target,reason)=>{
      if(closingPromise)return;
      let w;try{w=store.getWorkspace(target.workspaceId);}catch{return;}
      const now=new Date().toISOString(),item={id:randomUUID(),eventKey:`wake-blocked:${target.id}`,title:`Continuación bloqueada para ${target.taskId}: ${reason}`,source:'phantom',ref:target.id,runId:target.id,status:'failed',createdAt:now,observedAt:now};
      mutate(w.id,()=>pushAttention(w,item));broadcast({type:'attention.new',workspaceId:w.id,item});
    },
  });
  // Rate limit at the end of a run: reroute or queue it; neither counts as a failure nor spends budget.
  const quotaEvent=event=>{broadcast(event);try{if(store&&!closingPromise)hostEvents.feed(event,()=>undefined);}catch{}};
  const quotaTask=async target=>{try{const a=await routeIntegration('phantom.detail',{workspaceId:target.workspaceId,topic:'tasks',id:target.taskId});return a?.handled?a.result:undefined;}catch{return undefined;}};
  const quota=createQuotaFlow({
    decide:decideRoute,limits,emit:quotaEvent,fetchTask:quotaTask,
    queue:providerOptions?.quotaQueue??createQuotaQueue({file:path.join(dataDir,'quota-queue.json')}),
    inhibitor:providerOptions?.sleepInhibitor??createSleepInhibitor(),
    enabledEngines:()=>{const p=policy();return [['claude','claude-code'],['codex','codex'],['opencode','opencode']].filter(([id])=>p?.providers?.[id]?.enabled===true).map(([,engine])=>engine);},
    commitWip:async(target,task)=>{
      const dir=task?.contract?.workspace,w=store.getWorkspace(target.workspaceId),node=w.nodes.find(n=>n.type==='terminal'&&n.data?.worktree?.path===dir);
      if(!node?.data.worktree.branch)return;
      try{await branches.handle('branch.commit',{workspaceId:w.id,branch:node.data.worktree.branch,message:`WIP: ${target.taskId} interrumpido por límite de cuota`});}catch{/* nothing to save */}
    },
    createContract:async(target,task,to)=>{
      const c=task?.contract??{},input={goal:c.goal,scope:c.scope,checks:c.checks,budget:c.budget,lane:'coordinated',model:`${to.client}/${to.model}`};
      const a=await routeIntegration('phantom.create',{workspaceId:target.workspaceId,kind:'card',input});assert(a?.handled,'Phantom no está disponible');return a.result;
    },
    run:async item=>{
      const model=item.client&&item.model?`${item.client}/${item.model}`:undefined;
      const a=await routeIntegration('phantom.control',{workspaceId:item.workspaceId,id:item.taskId,action:'run',...(model?{model}:{}),...(item.nodeId&&!item.nodeId.startsWith('phantom:')?{sessionId:terminals?.sessions.find(s=>s.nodeId===item.nodeId)?.id}:{})});
      assert(a?.handled!==false,'Phantom no está disponible');
    },
  });
  quota.sync();
  // End of a run: a terminal card still bound to that task shows review/blocked, whether it was told by chat or by PTY.
  const applyFinish=(workspaceId,nodeId,taskId,controller,task)=>{
    if(controller?.action!=='run')return;
    let node;try{node=store.getWorkspace(workspaceId).nodes.find(n=>n.id===nodeId&&n.type==='terminal');}catch{}
    if(!node)return;
    const patch=finishPatch({agent:node.data.agent,taskId,controller,task});if(!patch)return;
    validateAgent(patch);
    mutate(workspaceId,()=>{const current=store.getWorkspace(workspaceId).nodes.find(n=>n.id===nodeId);if(current?.data.agent?.cardId===taskId)current.data.agent={...current.data.agent,...patch};});
  };
  // Live follow-up: card step/run refreshed from the same events view as phantom.events health; sparse notices to the orchestrator.
  const fetchHealth=async target=>{const a=await routeIntegration('phantom.events',{workspaceId:target.workspaceId,id:target.taskId,view:'health'});if(!a?.handled)throw new Error('Phantom no está disponible');return a.result;};
  const applyLive=(target,{step,run})=>{
    if(target.nodeId.startsWith('phantom:'))return true;
    let node;try{node=store.getWorkspace(target.workspaceId).nodes.find(n=>n.id===target.nodeId&&n.type==='terminal');}catch{return false;}
    if(!node)return false;
    if(node.data.agent?.cardId!==target.taskId)return true;
    const patch={step,run,updatedAt:new Date().toISOString()};validateAgent(patch);
    mutate(target.workspaceId,()=>{const current=store.getWorkspace(target.workspaceId).nodes.find(n=>n.id===target.nodeId);if(current?.data.agent?.cardId===target.taskId)current.data.agent={...current.data.agent,...patch};});
    return true;
  };
  const noticeLimit=createNoticeLimit({max:6});
  const deliverNotice=async(target,kind,message)=>{
    if(closingPromise)return {};
    let node;try{node=wakeNode(target);}catch{}
    if(!node)return {};
    if(target.via==='chat'){
      if(!node.data.chat?.provider||chats.running(node.id)||chats.turns.size+chats.operations.size>=16||chats.get(node).queue.length)return {};
      await chats.send(store.getWorkspace(target.workspaceId),node,message);return {delivered:true};
    }
    let session;try{session=terminals.get(node.data.sessionId);}catch{}
    if(!session||session.status!=='running'||session.nodeId!==node.id||!terminals.foreground(session.id)?.agent)return {};
    try{terminals.write(session.id,message+'\r');return {delivered:true};}catch{return {};}
  };
  const runWatch=createRunWatch({fetchHealth,fetchTask:async target=>{const a=await routeIntegration('phantom.detail',{workspaceId:target.workspaceId,topic:'tasks',id:target.taskId});return a?.handled?a.result:undefined;},apply:applyLive,notify:deliverNotice,limit:noticeLimit,onTick:()=>runWake.flush()});
  runWatch.start();
  // The run ended: the card always gets its final state, whatever happens to the notice or its recipient.
  const finishCard=async(target,controller)=>{
    if(closingPromise)return;
    try{const run=buildRun({health:await fetchHealth(target),taskId:target.taskId,startedAt:target.startedAt});applyLive(target,{step:stepLine(run),run});}catch{}
    let task;try{const answer=await routeIntegration('phantom.detail',{workspaceId:target.workspaceId,topic:'tasks',id:target.taskId});if(answer?.handled)task=answer.result;}catch{}
    if(closingPromise)return;
    applyFinish(target.workspaceId,target.nodeId,target.taskId,controller,task);
  };
  // A terminal that launches a run gets the task bound and "working" on its card; the same mutation path as terminal.agent.update.
  const bindRunStart=async(r,workspaceId)=>{
    const answer=await routeIntegration('phantom.detail',{workspaceId,topic:'tasks',id:r.taskId});
    if(!answer?.handled||!['task','card'].includes(answer.result?.kind))return;
    const patch=startPatch({taskId:r.taskId,contract:answer.result.contract});validateAgent(patch);
    mutate(workspaceId,()=>{const current=cardNode(store.getWorkspace(workspaceId).nodes,r.origin);if(!current)return;
      if(patch.cardId!==current.data.agent?.cardId&&isDefaultTerminalTitle(current.title)){const named=cardPanelTitle(patch.cardTitle);if(named)current.title=named;}
      current.data.agent={...current.data.agent,...patch};});
  };
  // A finished Phantom run backing a terminal plan's running phase closes it and, with chain, launches the next registered one.
  const planSeen=new Set();
  const planTarget=event=>{
    if(event?.type!=='tool.status'||!['completed','failed'].includes(event.status))return null;
    const r=event.result;if(r?.source!=='phantom'||!r.id||typeof r.taskId!=='string'||planSeen.has(r.id))return null;
    const workspaceId=event.workspaceId??r.workspaceId,w=store.state.workspaces.find(w=>w.id===workspaceId);
    const node=w?.nodes.find(n=>n.type==='terminal'&&n.data.plan?.phases.some(p=>p.status==='running'&&p.taskId===r.taskId));
    if(!node)return null;
    planSeen.add(r.id);return {workspaceId,nodeId:node.id,taskId:r.taskId,controller:r};
  };
  const planChain=async({workspaceId,nodeId,taskId,controller})=>{
    const save=fn=>mutate(workspaceId,()=>{const n=store.getWorkspace(workspaceId).nodes.find(n=>n.id===nodeId);if(!n?.data.plan)return null;const plan=fn(n.data.plan);if(plan)n.data.plan=plan;return n;});
    const block=(id,message)=>{try{save(plan=>{const phase=plan.phases.find(p=>p.taskId===id&&p.status==='running');return phase?applyPlanOp(plan,{type:'block',key:phase.key,note:planNote(message)}):null;});}catch{}};
    let launch=null,node;
    try{
      const answer=await routeIntegration('phantom.detail',{workspaceId,topic:'tasks',id:taskId});assert(answer?.handled,'Phantom no está disponible');
      node=save(plan=>{const step=nextPlanStep(plan,{taskId,taskStatus:answer.result?.status,controllerStatus:controller?.status});launch=step.launch;return step.plan;});
    }catch(error){block(taskId,error.message);return;}
    if(!launch||closingPromise)return;
    try{const answer=await routeIntegration('phantom.control',{workspaceId,id:launch,action:'run',sessionId:node.data.sessionId});assert(answer?.handled!==false,'Phantom no está disponible');}
    catch(error){block(launch,error.message);}
  };
  // Environment owners are registered in the workspace state; releases are serialized so racing triggers do not repeat work.
  let envChain=Promise.resolve();
  const envRelease=(workspaceId,sessionId,nodeId)=>envChain=envChain.then(async()=>{
    let w;try{w=store.getWorkspace(workspaceId);}catch{return;}
    if(!(w.envOwners||[]).some(e=>(sessionId&&e.ownerSessionId===sessionId)||(nodeId&&e.ownerNodeId===nodeId)))return;
    try{const answer=await routeIntegration('env.release',{workspaceId,sessionId,nodeId});if(answer?.handled){const result=answer.result;for(const group of result?.removedEnvironments??[{services:result?.removed}])closeEnvBrowsers(workspaceId,group.services,group.environmentId);}}catch{}
  });
  const closeEnvBrowsers=(workspaceId,names,environmentId)=>{
    if(!names?.length)return;
    const gone=n=>n.type==='browser'&&names.includes(n.data?.envService)&&(n.data?.envEnvironmentId??null)===(environmentId??null);
    if(store.getWorkspace(workspaceId).nodes.some(gone))mutate(workspaceId,()=>{const w=store.getWorkspace(workspaceId);for(const n of w.nodes.filter(gone))forgetNode(w,n,dataDir);w.nodes=w.nodes.filter(n=>!gone(n));});
  };
  async function envBrowser(w,sender,service) {
    const existing=store.getWorkspace(w.id).nodes.find(n=>n.type==='browser'&&n.data?.agentTerminal===sender.id&&n.data?.envService===service.name&&(n.data?.envEnvironmentId??null)===(service.environmentId??null));
    if(existing){if(existing.data.url!==service.url)await invoke('node.update',{workspaceId:w.id,id:existing.id,patch:{data:{...existing.data,url:service.url}}});return existing.id;}
    const node=await invoke('node.create',{workspaceId:w.id,type:'browser',title:`Entorno: ${service.name}`,...handoffPosition(store.getWorkspace(w.id)),data:{url:service.url,agentTerminal:sender.id,envService:service.name,...(service.environmentId?{envEnvironmentId:service.environmentId}:{})}});
    return node.id;
  }
  // The project's Phantom conversation integrates for the user: to the Git guard it is the orchestrator.
  const mainEnv=w=>({...roleEnv({stateDir:dataDir,workspace:w,node:{data:{role:'orchestrator'}},branch:null}),PHANTOM_WORKSPACE_ID:w.id});
  // Coalesce state.changed: one event per workspace (plus one global) per tick.
  const dirtyWorkspaces=new Set();let dirtyGlobal=false,dirtyTimer;
  const markChanged=workspaceId=>{
    if(workspaceId)dirtyWorkspaces.add(workspaceId);else dirtyGlobal=true;
    dirtyTimer??=setImmediate(()=>{dirtyTimer=undefined;const ids=[...dirtyWorkspaces],global=dirtyGlobal;dirtyWorkspaces.clear();dirtyGlobal=false;for(const workspaceId of ids)broadcast({type:'state.changed',workspaceId});if(global)broadcast({type:'state.changed'});});
  };
  const persist=workspaceId=>{store.persist();markChanged(workspaceId);};
  const mutate=(workspaceId,fn)=>{ const value=store.transaction(fn); merges?.polling.invalidate(); markChanged(workspaceId); return value; };
  let integration=handleIntegration,integrationLoad,shutdownIntegration=shutdownIntegrations;
  const inFlightIntegrations=new Set();
  const routeIntegration=async(method,payload,envCwd)=>{
    const request=(async()=>{
      if(!integration) {const module=await (integrationLoad??=import('../integrations/index.mjs'));integration=module.handleIntegration;shutdownIntegration??=module.shutdownIntegrations;}
      assert(!closingPromise,'Host is shutting down');
      return integration(method,payload,{dataDir,workspace:payload.workspaceId?store.getWorkspace(payload.workspaceId):undefined,getWorkspace:id=>store.getWorkspace(id),state:store.state,persist:()=>persist(payload.workspaceId),emit,chatRunning:nodeId=>chats?.turns.has(nodeId),sessions:terminals.sessions.map(s=>terminals.descriptor(s)),...(envCwd!==undefined?{envCwd}:{})});
    })();inFlightIntegrations.add(request);try{return await request;}finally{inFlightIntegrations.delete(request);}
  };
  // --- Agent observability: durable traces (host/agent-traces.mjs) and the workspace supervisor ---------------------
  // Ownership is explicit data. A Phantom run is attributed to the node its verified origin names; a chat root is
  // the deterministic root of that node and provider; PTY sub-agents arrive only through their live session.
  const RUN_STATUS={running:'running',completed:'done',failed:'error',stopped:'stopped'};
  const traceNode=(w,nodeId)=>nodeId===Chats.mainId(w)?chats.mainNode(w):w.nodes.find(n=>n.id===nodeId&&n.type==='terminal');
  function traceRun(event){
    const r=event?.result;
    if(event?.type!=='tool.status'||r?.source!=='phantom'||r.action!=='run'||!RUN_STATUS[event.status])return;
    if(typeof r.id!=='string'||typeof r.taskId!=='string'||typeof r.origin?.nodeId!=='string')return;
    const workspaceId=event.workspaceId??r.workspaceId,w=store.state.workspaces.find(w=>w.id===workspaceId);
    let node;try{node=w&&traceNode(w,r.origin.nodeId);}catch{}
    if(!node)return; // an owner the host cannot verify is not recorded
    const id=`run:${r.id}`,nodeId=r.origin.nodeId,existing=traces.list({workspaceId,nodeId}).items;
    const known=existing.find(agent=>agent.id===id);
    const parent={};
    if(!known){
      const parentRun=typeof r.parentTaskId==='string'?existing.find(agent=>agent.provider==='phantom'&&agent.taskId===r.parentTaskId):null;
      const provider=r.origin.via==='chat'?node.data?.chat?.provider:null;
      if(parentRun)parent.parentId=parentRun.id;
      else if(['claude','codex','opencode'].includes(provider))parent.parentId=traceRootId({nodeId,provider});
      else parent.parent={available:false,reason:'Sin evidencia explícita de qué sesión del origen lanzó esta ejecución'};
    }
    const title=clipTrace(r.title??r.goal??'',120).text.replace(/\s+/g,' ').trim()||`Encargo ${r.taskId.slice(-8)}`;
    traces.record({workspaceId,nodeId,id,...parent,provider:'phantom',name:title,
      ...(isTraceModel(r.requestedModel)?{model:r.requestedModel,modelSource:'requested'}:{}),
      status:RUN_STATUS[event.status],taskId:r.taskId,runId:r.id,
      event:{id:`${id}:${event.status}`,kind:'run',status:RUN_STATUS[event.status],text:`Ejecución ${{running:'en curso',completed:'terminada',failed:'fallida',stopped:'detenida'}[event.status]}`}});
    scheduleSnapshot(workspaceId);
  }
  // A PTY that ends closes the agents it hosted; what they achieved is not invented, only that the session ended.
  function traceExit(event){
    if(event?.type!=='terminal.exit'||typeof event.sessionId!=='string')return;
    const session=terminals.sessions.find(s=>s.id===event.sessionId);if(!session)return;
    const {workspaceId,nodeId}=session;
    for(const agent of traces.list({workspaceId,nodeId}).items){
      if(agent.provider==='phantom'||['done','error','stopped','cancelled','interrupted'].includes(agent.status))continue;
      traces.record({workspaceId,nodeId,id:agent.id,status:'stopped',event:{id:`exit:${event.sessionId}`,kind:'session.end',status:'stopped',text:`La terminal terminó${Number.isInteger(event.exitCode)?` (código ${event.exitCode})`:''}`}});
    }
  }
  const traceLookup=workspaceId=>{
    const map=new Map();
    for(const agent of traces.list({workspaceId}).items){map.set(agent.id,agent);if(agent.providerAgentId)map.set(agent.providerAgentId,agent);}
    return id=>map.get(id)??null;
  };
  const traceReads=new Map();
  function traceReadLimit(sessionId){
    const now=Date.now(),recent=(traceReads.get(sessionId)??[]).filter(t=>now-t<1000);
    assert(recent.length<20,'Demasiadas consultas de trazas; espera un momento');
    recent.push(now);traceReads.set(sessionId,recent);
    if(traceReads.size>500)for(const [key,value] of traceReads)if(!value.some(t=>now-t<1000))traceReads.delete(key);
  }
  const sessionLookup={session:id=>terminals.sessions.find(s=>s.id===id),workspaces:()=>store.state.workspaces};
  // Hooks of an agent running in a live PTY: the host imposes workspace and node from that session.
  function traceIngest(p){
    for(const key of Object.keys(p))assert(['sessionId','records'].includes(key),`Clave de traza desconocida: ${key}`);
    const session=terminals.get(p.sessionId),w=store.getWorkspace(session.workspaceId),node=w.nodes.find(n=>n.id===session.nodeId);
    assert(node?.type==='terminal'&&session.status==='running'&&node.data.sessionId===session.id,'Las trazas requieren la sesión viva actual del panel');
    const cardId=node.data.agent?.cardId;
    const records=sanitizeTraceRecords(p.records,{workspaceId:w.id,nodeId:node.id,taskId:typeof cardId==='string'&&cardId?cardId:undefined,resolveAgent:traceLookup(w.id)});
    const rejected=[];let recorded=0,duplicates=0;
    records.forEach((record,index)=>{try{const result=traces.record(record);if(result.duplicate)duplicates++;else recorded++;}catch(error){rejected.push({index,reason:String(error.message).slice(0,200)});}});
    assert(rejected.length<records.length,rejected[0]?.reason);
    return {recorded,duplicates,rejected};
  }
  // Read-only view for an agent: its own node (worker) or its workspace (orchestrator). Another project is never visible.
  function traceAgentRead(p){
    const q=traceParams('terminal.agent.traces',p);
    traceReadLimit(q.sessionId);
    const grant=authorizeTraceRead(q.sessionId,sessionLookup);
    if(q.id===undefined){const list=traces.list({workspaceId:grant.workspaceId,...(grant.nodeId?{nodeId:grant.nodeId}:{})});return {...list,items:list.items.map(publicTraceAgent)};}
    const detail=traces.detail({workspaceId:grant.workspaceId,id:q.id,cursor:q.cursor,limit:q.limit});
    if(detail.agent&&grant.nodeId&&detail.agent.nodeId!==grant.nodeId)return {agent:null,events:[],cursor:q.cursor??null,hasMore:false,availability:{available:false,reason:'Agente no encontrado'}};
    return {...detail,agent:detail.agent?publicTraceAgent(detail.agent):null};
  }
  // Supervisor snapshot: real agents, integration queue and declared task dependencies of that project; unknown stays unavailable.
  const snapshots=new Map(),snapshotTimers=new Map();
  const FULL_TASK=/^(?:task|card)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function buildSnapshot(workspaceId){
    const w=store.getWorkspace(workspaceId),snapshot={};
    try{
      snapshot.agents={available:true,items:traces.list({workspaceId}).items.map(a=>({id:a.id,...(a.parentId?{parentId:a.parentId}:{}),...(a.taskId?{taskId:a.taskId}:{}),...(a.runId?{runId:a.runId}:{}),name:a.name??undefined,
        status:{running:'working'}[a.status]??a.status,provider:a.provider??undefined,model:a.model??undefined,currentActivity:a.currentActivity?.text||a.currentActivity?.tool||undefined,lastActivityAt:a.lastActivityAt}))};
    }catch(error){snapshot.agents={available:false,reason:'Las trazas no están disponibles'};}
    try{
      const status=await bounded(merges.status(w),8000,'Merge status');
      if(!status.available)snapshot.merges={available:false,reason:status.reason||'La cola de integración no está disponible'};
      else if(!status.enabled)snapshot.merges={available:false,reason:'Incorporaciones está desactivado en este proyecto'};
      else snapshot.merges={available:true,items:status.queue.map(item=>({id:item.id,status:item.status,title:item.summary||undefined,queuedAt:item.requestedAt,
        // Ready only with host evidence: a queued request whose submitted commit is inspectable, current and already contains the base.
        ready:item.status==='queued'&&item.inspection?.available===true&&item.stale===false&&item.behind===0}))};
    }catch(error){snapshot.merges={available:false,reason:'No se pudo leer la cola de integración'};}
    try{
      const answer=await bounded(routeIntegration('phantom.list',{workspaceId,topic:'tasks'}),5000,'Phantom tasks');
      if(!answer?.handled||!answer.result?.available||!Array.isArray(answer.result.items))snapshot.dependencies={available:false,reason:answer?.result?.reason||'Phantom no informó las tareas'};
      else{
        // Task dependencies only (declared in a task's contract); software dependencies are not inferred here.
        const items=[];
        for(const item of answer.result.items){const raw=item?.raw??item,from=raw?.id??item?.id,deps=raw?.contract?.dependencies;if(!FULL_TASK.test(from??'')||!Array.isArray(deps))continue;for(const to of deps)if(typeof to==='string'&&FULL_TASK.test(to))items.push({id:`task:${from}:${to}`,source:'declared',from,to});}
        snapshot.dependencies={available:true,reason:'Solo dependencias de tareas declaradas en el contrato; las de software no se infieren',items};
      }
    }catch(error){snapshot.dependencies={available:false,reason:'No se pudieron leer las tareas de Phantom'};}
    return snapshot;
  }
  async function ensureSnapshot(workspaceId,force=false){
    if(!supervisor||closingPromise)return;
    let entry=snapshots.get(workspaceId);if(!entry){entry={at:0,sig:null,inflight:null};snapshots.set(workspaceId,entry);}
    if(entry.inflight)return entry.inflight;
    if(!force&&Date.now()-entry.at<10000)return;
    entry.inflight=(async()=>{
      try{const snapshot=await buildSnapshot(workspaceId);if(closingPromise)return;entry.at=Date.now();const sig=JSON.stringify(snapshot);if(sig!==entry.sig){entry.sig=sig;supervisor.updateSnapshot(workspaceId,snapshot);}}
      catch{/* An unreadable workspace keeps its previous snapshot. */}
      finally{entry.inflight=null;}
    })();
    return entry.inflight;
  }
  // Disabled supervisors cost nothing: the snapshot is only rebuilt for projects that enabled it.
  function scheduleSnapshot(workspaceId){
    if(!supervisor||closingPromise||snapshotTimers.has(workspaceId))return;
    const timer=setTimeout(()=>{snapshotTimers.delete(workspaceId);try{if(supervisor.read({workspaceId}).config.enabled)ensureSnapshot(workspaceId,true);}catch{}},1500);
    timer.unref?.();snapshotTimers.set(workspaceId,timer);
  }
  async function traceRenderer(method,p){
    const q=traceParams(method,p);
    store.getWorkspace(q.workspaceId);
    if(method==='agent.traces.list'){const list=traces.list(q);return {...list,items:list.items.map(publicTraceAgent)};}
    if(method==='agent.traces.detail'){const detail=traces.detail(q);return {...detail,agent:detail.agent?publicTraceAgent(detail.agent):null};}
    if(method==='supervisor.read'){if(supervisor.read(q).config.enabled)await ensureSnapshot(q.workspaceId);return supervisor.read(q);}
    if(method==='supervisor.configure'){const result=supervisor.configure(q);if(result.config.enabled)ensureSnapshot(q.workspaceId,true).catch(()=>{});return result;}
    await ensureSnapshot(q.workspaceId,true);
    return supervisor.refresh(q);
  }
  async function invoke(method,p={}) {
    assert(!closingPromise,'Host is shutting down');
    text(method,'method',128); object(p);
    if(TRACE_RENDERER_METHODS.includes(method)) return traceRenderer(method,p);
    if(method==='terminal.agent.trace') return traceIngest(p);
    if(method==='terminal.agent.traces') return traceAgentRead(p);
    if(method===EVENTS_METHOD) return hostEvents.query(p,{session:id=>terminals.sessions.find(s=>s.id===id),workspaces:()=>store.state.workspaces});
    if(method==='mobile.status') return mobile.status();
    if(method==='mobile.start') return mobile.start(p);
    if(method==='mobile.stop') return mobile.stop();
    if(method==='mobile.pairing') return mobile.pairing();
    if(method==='mobile.revoke') return mobile.revoke(p);
    if(method==='mobile.approve') return mobile.approve(p);
    if(method==='mobile.reject') return mobile.reject(p);
    if(method==='mobile.audit') return mobile.auditLog();
    if(method==='android.status') return android.status();
    if(method==='android.configure') return android.configure(p);
    if(method==='android.start') return android.start(p);
    if(method==='android.link') return android.link(p);
    if(method==='android.stop') return android.stop();
    if(method==='android.pairing') return android.pairing();
    if(method==='android.bootstrap') return android.bootstrap();
    if(method==='android.approve') return android.approve(p);
    if(method==='android.revoke') return android.revoke(p);
    if(method==='system.info') return {platform:process.platform,node:process.version,pid:process.pid,dataDir};
    if(method==='state.get') return stateView(store.state,{workspaceId:p?.workspaceId});
    if(method==='settings.update') {
      object(p.patch);
      // Provider policy keys are validated as a whole; providers.configure is the dedicated path.
      // A non-object `providers` is a legacy settings shape, not the policy; execution still refuses it explicitly.
      const policyPatch=v=>v&&typeof v==='object'&&!Array.isArray(v);
      if(policyPatch(p.patch.providers)||p.patch.executionDefaults!==undefined) executionPolicy({...store.state.settings,...p.patch});
      const result=mutate(null,()=>{Object.assign(store.state.settings,p.patch);return publicSettings(store.state.settings);});
      publishPolicy();providers.invalidate();return result;
    }
    if(method==='providers.list') return providers.list({force:p.force===true});
    if(method==='providers.models') return providers.models(p.provider,{force:p.force===true});
    if(method==='providers.configure') {
      const next=configurePolicy(store.state.settings,p);
      mutate(null,()=>{store.state.settings.providers=next.providers;store.state.settings.executionDefaults=next.executionDefaults;});
      publishPolicy();
      return {policy:policy()};
    }
    if(method==='workspace.open') return mutate(null,()=>store.open(p.path));
    if(method==='workspace.select') return mutate(p.id,()=>{return store.activate(store.getWorkspace(p.id));});
    if(method==='plugin.get') { const {getPluginDescriptor,pluginSettings}=await import('../src/plugins/registry.js');assert(getPluginDescriptor(p.id),'Plugin desconocido');return pluginSettings(store.getWorkspace(p.workspaceId),p.id); }
    if(method==='plugin.update') {
      const {validatePluginSettings}=await import('../src/plugins/registry.js');const settings=validatePluginSettings(p.id,p.settings);
      return mutate(p.workspaceId,()=>{const w=store.getWorkspace(p.workspaceId);w.plugins={...w.plugins,[p.id]:{...w.plugins?.[p.id],...settings,config:w.plugins?.[p.id]?.config??{}}};w.updatedAt=new Date().toISOString();return settings;});
    }
    if(method==='workspace.update') return mutate(p.id,()=>{const w=store.getWorkspace(p.id);object(p.patch);for(const key of Object.keys(p.patch)) assert(['name','camera','spaces','sessionDefaults'].includes(key),'Unsupported workspace patch');const patch={...p.patch};if(Object.hasOwn(patch,'sessionDefaults')&&patch.sessionDefaults!==null)patch.sessionDefaults={...validateSessionDefaults(patch.sessionDefaults)};Object.assign(w,patch,{updatedAt:new Date().toISOString()});if(w.sessionDefaults===null)delete w.sessionDefaults;return w;});
    if(method==='workspace.relocate') return mutate(p.id,()=>{const w=store.getWorkspace(p.id),canonical=canonicalFolder(p.path);assert(!store.state.workspaces.some(v=>v.id!==w.id && v.canonicalPath===canonical),'Folder belongs to another workspace');Object.assign(w,{path:canonical,canonicalPath:canonical,updatedAt:new Date().toISOString()});return w;});
    if(method==='node.create') return mutate(p.workspaceId,()=>{
       const w=store.getWorkspace(p.workspaceId); assert(NODE_TYPES.includes(p.type),'Invalid node type'); const node={id:randomUUID(),type:p.type,title:p.title??p.type,x:p.x??0,y:p.y??0,width:p.width??(p.type==='browser'?800:640),height:p.height??(p.type==='terminal'?640:p.type==='browser'?520:400),groupId:null,data:p.data??{}};validatePluginPanel(node.type,node.data);if(node.data.chat!==undefined){assert(node.type==='terminal','Only terminal cards chat');validateChat(node.data.chat);assertNewChatPolicy(node.data.chat,policy());}
       if(node.type==='terminal'&&node.data.chat?.provider&&w.sessionDefaults&&!Object.hasOwn(node.data.chat,'permissionMode')&&!Object.hasOwn(node.data.chat,'autoApprove'))node.data={...node.data,chat:{...node.data.chat,...permissionPatch(w.sessionDefaults)}};
       // One orchestrator session per project.
       if(node.data.role!==undefined){assert(node.type==='terminal'&&node.data.role==='orchestrator','Invalid terminal role');assert(w.integration?.enabled,'Activa Incorporaciones en este proyecto antes de abrir la sesión orquestadora');assert(!w.nodes.some(n=>n.data?.role==='orchestrator'),'Este proyecto ya tiene una sesión orquestadora');}
       w.nodes.push(node);return node;
    });
     if(method==='node.update') return mutate(p.workspaceId,()=>{const w=store.getWorkspace(p.workspaceId),n=w.nodes.find(n=>n.id===p.id);assert(n,'Node not found');object(p.patch);for(const key of Object.keys(p.patch)) assert(['title','x','y','width','height','groupId','data'].includes(key),'Unsupported node patch');const patch={...p.patch};if(n.type==='reference'&&patch.data){for(const key of ['file','hash','kind','mime','previousVersion']) assert(patch.data[key]===undefined||patch.data[key]===n.data[key],'La identidad de la referencia es inmutable; importa una nueva versión');patch.data={...patch.data};for(const key of ['file','hash','kind','mime','previousVersion']) if(n.data[key]!==undefined)patch.data[key]=n.data[key];}if(n.type==='terminal'&&patch.data){object(patch.data);patch.data={...patch.data};delete patch.data.agent;if(n.data.agent)patch.data.agent=n.data.agent;delete patch.data.handoff;if(n.data.handoff)patch.data.handoff=n.data.handoff;delete patch.data.process;if(n.data.process)patch.data.process=n.data.process;delete patch.data.chat;if(n.data.chat)patch.data.chat=n.data.chat;delete patch.data.role;if(n.data.role)patch.data.role=n.data.role;delete patch.data.plan;if(n.data.plan)patch.data.plan=n.data.plan;}if(patch.data!==undefined){object(patch.data);patch.data={...patch.data};validatePluginPanel(n.type,patch.data);}Object.assign(n,patch);return n;});
    if(method==='node.remove') { const w=store.getWorkspace(p.workspaceId); assert(w.nodes.some(n=>n.id===p.id),'Node not found');assert(!terminals.sessions.some(s=>s.nodeId===p.id&&s.workspaceId===w.id&&s.status==='running'),'Terminal is running: hide this panel (data.hidden) or stop its session before removing it');chats.removeNode(p.id);await envRelease(w.id,null,p.id);return mutate(w.id,()=>{const current=store.getWorkspace(w.id),node=current.nodes.find(n=>n.id===p.id);forgetNode(current,node,dataDir);current.nodes=current.nodes.filter(n=>n.id!==p.id);return {ok:true};}); }
    if(method.startsWith('reference.')||method.startsWith('comment.')) return handleReference(method,p,{store,mutate,dataDir,brief:(w,comment)=>mentionBrief(w,comment,dataDir,CANVAS_CLI),mention:(w,comment,brief)=>chats.send(w,chats.mainNode(w),brief)});
    if(method==='terminal.create') {
      const w=store.getWorkspace(p.workspaceId); let node=p.nodeId?w.nodes.find(n=>n.id===p.nodeId):null; if(p.nodeId) assert(node?.type==='terminal','Terminal node not found');
      if(!node) node=await invoke('node.create',{workspaceId:w.id,type:'terminal'});
      mutate(w.id,()=>{node.data={...node.data,launchState:'creating',launchError:''};});
      let session;
      try { session=await terminals.create(w,node,p); }
      catch(error) { if(w.nodes.includes(node)) mutate(w.id,()=>{node.data={...node.data,launchState:'failed',launchError:error.message};}); throw error; }
      node=mutate(w.id,()=>{const current=store.getWorkspace(w.id).nodes.find(n=>n.id===node.id);current.data={...current.data,sessionId:session.id,launchState:'ready',launchError:''};return current;}); return {session,node};
    }
    if(method==='terminal.list') {store.getWorkspace(p.workspaceId);return terminals.sessions.filter(s=>s.workspaceId===p.workspaceId).map(s=>terminals.descriptor(s));}
    if(['terminal.agent.launch','terminal.agent.processes','terminal.agent.process.output','terminal.agent.process.stop'].includes(method)) {
      const sender=terminals.get(p.sessionId),w=store.getWorkspace(sender.workspaceId),from=w.nodes.find(n=>n.id===sender.nodeId);
      assert(from?.type==='terminal','No se encuentra el panel emisor del proceso');
      if(method==='terminal.agent.launch') {
        assert(sender.status==='running'&&from.data.sessionId===sender.id,'El lanzamiento requiere la sesión viva actual del panel');
        const fields=validateLaunch(p,from),createdAt=reserveProcess(sender.id),process={id:randomUUID(),...fields,cwd:sender.cwd,from:{nodeId:from.id,title:from.title},createdAt};
        const node=await invoke('node.create',{workspaceId:w.id,type:'terminal',title:`Proceso: ${fields.title}`,...handoffPosition(w),data:{process}});
        const {session}=await invoke('terminal.create',{workspaceId:w.id,nodeId:node.id,cols:120,rows:32});
        terminals.write(session.id,fields.command+'\r');
        return {processId:process.id,nodeId:node.id,sessionId:session.id,...fields,cwd:process.cwd};
      }
      const keys=method==='terminal.agent.processes'?['sessionId']:method==='terminal.agent.process.output'?['sessionId','id','lines']:['sessionId','id'];
      for(const key of Object.keys(p))assert(keys.includes(key),`Clave de proceso desconocida: ${key}`);
      if(method==='terminal.agent.processes')return processList(w.nodes,terminals.sessions,from.id);
      text(p.id,'identificador del proceso',512);
      const node=w.nodes.find(n=>n.type==='terminal'&&n.data.process?.id===p.id);
      assert(node,'Proceso inexistente en este workspace');
      assert(node.data.sessionId&&terminals.sessions.some(s=>s.id===node.data.sessionId&&s.nodeId===node.id&&s.workspaceId===w.id),'El proceso no tiene una sesión disponible');
      if(method==='terminal.agent.process.stop')return terminals.stop(node.data.sessionId);
      const lines=p.lines===undefined?80:p.lines;
      assert(Number.isInteger(lines)&&lines>=1&&lines<=400,'Las líneas deben ser un entero entre 1 y 400');
      return terminals.tail(node.data.sessionId,lines,400);
    }
    if(['terminal.agent.env.list','terminal.agent.env.up','terminal.agent.env.run','terminal.agent.env.down'].includes(method)) {
      const action=method.slice('terminal.agent.env.'.length),sender=terminals.get(p.sessionId),w=store.getWorkspace(sender.workspaceId),from=w.nodes.find(n=>n.id===sender.nodeId);
      assert(from?.type==='terminal','No se encuentra el panel emisor del entorno');
      assert(typeof sender.cwd==='string'&&path.isAbsolute(sender.cwd),'La sesión no tiene un directorio de entorno válido');
      const fields=validateEnv(action,p),ask=async(name,extra)=>{const answer=await routeIntegration(name,{workspaceId:w.id,...extra},sender.cwd);assert(answer?.handled,'El entorno no está disponible');return answer.result;};
      if(action==='list'){const result=await ask('env.list');return {...result,services:result.services.map(s=>({...s,mine:s.owner?.ownerSessionId===sender.id}))};}
      assert(sender.status==='running'&&from.data.sessionId===sender.id,'El entorno requiere la sesión viva actual del panel');
      reserveEnv(sender.id);
      const result=await ask(`env.${action}`,{owner:{sessionId:sender.id,nodeId:from.id},actor:'agent',...fields});
      if(action==='up'){result.browsers=[];for(const s of result.services)if(s.url)result.browsers.push({service:s.name,nodeId:await envBrowser(w,sender,s)});}
      if(action==='down')closeEnvBrowsers(w.id,result.down,result.environmentId);
      return result;
    }
    // UI: observe the environment and bring a service down (any lifecycle) from the Entorno panel.
    if(method==='env.list'||method==='env.down') {
      for(const key of Object.keys(p))assert(['workspaceId',...(method==='env.down'?['service','environmentId']:[])].includes(key),`Clave de entorno desconocida: ${key}`);
      store.getWorkspace(p.workspaceId);
      const answer=await routeIntegration(method,{workspaceId:p.workspaceId,...(method==='env.down'?{service:p.service,actor:'ui',...(p.environmentId!==undefined?{environmentId:p.environmentId}:{})}:{})});assert(answer?.handled,'El entorno no está disponible');
      if(method==='env.down')closeEnvBrowsers(p.workspaceId,answer.result.down,answer.result.environmentId);
      return answer.result;
    }
    assert(!method.startsWith('env.'),`Unknown method: ${method}`);
    if(method==='terminal.agent.projects') {
      const session=terminals.get(p.sessionId);
      return agentProjects(store.state.workspaces,session.workspaceId);
    }
    if(method==='terminal.agent.handoff') {
      const sender=terminals.get(p.sessionId),source=store.getWorkspace(sender.workspaceId),fromNode=source.nodes.find(n=>n.id===sender.nodeId);
      assert(fromNode?.type==='terminal','No se encuentra el panel emisor del encargo');
      assert(sender.status==='running'&&fromNode.data.sessionId===sender.id,'El encargo requiere la sesión viva actual del panel');
      const rules=policy(),fields=validateHandoff(p,fromNode,terminals.foreground(sender.id)?.agent,rules),target=resolveHandoffProject(store.state.workspaces,p.project,source.id);
      const createdAt=reserveHandoff(sender.id),handoff={id:randomUUID(),from:{workspaceId:source.id,workspaceName:source.name,nodeId:fromNode.id,title:fromNode.title},...fields,createdAt};
      const node=await invoke('node.create',{workspaceId:target.id,type:'terminal',title:`Encargo: ${fields.title}`,...handoffPosition(target),data:{handoff}});
      const {session}=await invoke('terminal.create',{workspaceId:target.id,nodeId:node.id,cols:120,rows:32});
      const command=handoffCommand(fields.agent,rules);
      if(command)terminals.write(session.id,command);
      const item={id:randomUUID(),eventKey:`handoff:${handoff.id}`,title:`Encargo recibido: ${fields.title}`,source:'terminal',ref:session.id,sessionId:session.id,workspaceId:target.id,createdAt,observedAt:createdAt};
      mutate(target.id,()=>{const w=store.getWorkspace(target.id);pushAttention(w,item);});
      emit({type:'attention.new',workspaceId:target.id,item});
      return {handoffId:handoff.id,workspaceId:target.id,workspaceName:target.name,nodeId:node.id,sessionId:session.id,title:fields.title,agent:fields.agent,launched:!!command};
    }
    // Browser bridge: is this chat card's capability backed by a live turn? Desktop-only, not renderer IPC.
    if(method==='chat.browser.active') {store.getWorkspace(p.workspaceId);return chats.browserActive(p);}
    if(method==='terminal.agent.subagent') {
      const session=terminals.get(p.sessionId),w=store.getWorkspace(session.workspaceId),node=w.nodes.find(n=>n.id===session.nodeId);
      assert(node?.type==='terminal','Terminal node not found');
      assert(session.status==='running' && node.data.sessionId===session.id,'Report requires the current live terminal session');
      const op=validateSubagentOp(p.op),list=applySubagent(node.data.subagents,op);
      if(JSON.stringify(list)!==JSON.stringify(node.data.subagents))mutate(w.id,()=>{const current=store.getWorkspace(w.id).nodes.find(n=>n.id===node.id);current.data.subagents=applySubagent(current.data.subagents,op);});
      return {count:list.length};
    }
    if(method==='terminal.agent.context' || method==='terminal.agent.report') {
      const session=terminals.get(p.sessionId),w=store.getWorkspace(session.workspaceId),node=w.nodes.find(n=>n.id===session.nodeId);
      assert(node?.type==='terminal','Terminal node not found');
      if(method==='terminal.agent.context') return agentContext(w,node,session);
      assert(session.status==='running' && node.data.sessionId===session.id,'Report requires the current live terminal session');
      object(p.patch);for(const key of Object.keys(p.patch)) assert(['step','status'].includes(key),'Reports may only update step and status');
      const patch=structuredClone(p.patch);validateAgent(patch);
      const reported=mutate(w.id,()=>{const current=store.getWorkspace(w.id).nodes.find(n=>n.id===node.id);const prev=current.data.agent;if(prev?.source==='agent'&&Object.keys(patch).every(k=>prev[k]===patch[k]))return {context:agentContext(w,current,session),agent:prev};current.data.agent={...current.data.agent,...patch,source:'agent',updatedAt:new Date().toISOString()};return {context:agentContext(w,current,session),agent:current.data.agent};});
      try{hostEvents.report({workspaceId:w.id,nodeId:node.id,agent:reported.agent});}catch{}
      return reported.context;
    }
    if(method==='terminal.agent.plan') {
      for(const key of Object.keys(p))assert(['sessionId','op'].includes(key),`Clave de plan desconocida: ${key}`);
      const session=terminals.get(p.sessionId),w=store.getWorkspace(session.workspaceId),node=w.nodes.find(n=>n.id===session.nodeId);
      assert(node?.type==='terminal','Terminal node not found');
      assert(node.data.sessionId===session.id,'El plan requiere la sesión actual del panel');
      object(p.op);const op=structuredClone(p.op);
      applyPlanOp(node.data.plan,op);
      if(['start','task'].includes(op.type)&&op.taskId!==undefined){const result=await routeIntegration('phantom.detail',{workspaceId:w.id,topic:'tasks',id:op.taskId});assert(result.handled&&['task','card'].includes(result.result?.kind),'Expected a Phantom task or card');}
      return mutate(w.id,()=>{const current=store.getWorkspace(w.id).nodes.find(n=>n.id===node.id);assert(current?.data.sessionId===session.id,'El plan requiere la sesión actual del panel');const plan=applyPlanOp(current.data.plan,op);if(plan)current.data.plan=plan;else delete current.data.plan;return plan;});
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
        if(patch.cardId){const result=await routeIntegration('phantom.detail',{workspaceId:w.id,topic:'tasks',id:patch.cardId});assert(result.handled&&['task','card'].includes(result.result?.kind),'Expected a Phantom task or card');validated.cardId=patch.cardId;validated.cardTitle=cardTitleOf(result.result.contract.goal);}
        else {validated.cardId='';validated.cardTitle='';}
      }
      if(patch.providerSessionId!==undefined) {
        text(patch.providerSessionId,'provider session',512);
        // Binding a new OpenCode session requires OpenCode enabled; an existing one stays readable and can be cleared.
        if(patch.providerSessionId) {
          assertClientAllowed('opencode',policy(),'Vincular sesiones: el agente');
          const result=await routeIntegration('opencode.sessions',{workspaceId:w.id});
          assert(result.handled&&result.result?.available,`No se pudo comprobar la sesión OpenCode: ${result.result?.reason??'catálogo no disponible'}`);
          assert(result.result.items.some(item=>item.id===patch.providerSessionId),'La sesión OpenCode no pertenece a este workspace');
          validated.providerSessionId=patch.providerSessionId;validated.provider='opencode';
        }
        else {validated.providerSessionId='';}
      }
      // Re-resolve after asynchronous catalogs; other clients may have edited/closed the node.
      return mutate(w.id,()=>{const current=store.getWorkspace(w.id).nodes.find(n=>n.id===p.nodeId);assert(current?.type==='terminal','Terminal node not found');const changedCard=validated.cardId!==undefined&&validated.cardId!==current.data.agent?.cardId;if(patch.name!==undefined)current.title=patch.name.trim();else if(changedCard&&isDefaultTerminalTitle(current.title)){const named=cardPanelTitle(validated.cardTitle||'');if(named)current.title=named;}current.data.agent={...current.data.agent,...(changedCard?{step:'',status:'idle'}:{}),...validated,...(patch.step!==undefined||patch.status!==undefined||changedCard?{source:'manual',updatedAt:new Date().toISOString()}: {})};return current;});
    }
    if(method==='orchestrator.send') return deliverToOrchestrator({store,terminals,chats,invoke},p);
    if(method==='terminal.setup.retry') return terminals.retrySetup(p.sessionId);
    if(method==='terminal.attach') return terminals.attach(p.sessionId,p.fromSeq);
    if(method==='terminal.tail') return terminals.tail(p.sessionId,p.lines);
    if(method==='terminal.write') {
      // Host-originated notices call terminals.write directly, so this RPC is user input: it restarts the notice cap.
      try{const s=terminals.get(p.sessionId);wakeLimit.reset(s.nodeId);noticeLimit.reset(s.nodeId);runWake.reset(s.nodeId);}catch{}
      return terminals.write(p.sessionId,p.data);
    }
    if(method==='terminal.trust') return terminals.trust(p.sessionId);
    if(method==='terminal.resize') return terminals.resize(p.sessionId,p.cols,p.rows);
    if(method==='terminal.stop') {runWake.cancel(terminals.get(p.sessionId).nodeId);return terminals.stop(p.sessionId);}
    if(method==='terminal.close') {
      const w=store.getWorkspace(p.workspaceId),node=w.nodes.find(n=>n.id===p.nodeId);
      assert(node?.type==='terminal','Terminal node not found');
      runWake.cancel(node.id,'La terminal se cerró');
      await terminals.closeNode(node.id);chats.removeNode(node.id);await envRelease(w.id,null,node.id);
      return mutate(w.id,()=>{const current=store.getWorkspace(w.id);forgetNode(current,node,dataDir);current.nodes=current.nodes.filter(n=>n.id!==node.id);return {ok:true};});
    }
    // Chat cards: a terminal node whose data.chat.provider selects an agent CLI
    // driven headlessly. data.chat changes only through chat.configure.
    // The approval gate of a running turn proves itself with that turn's token.
    // Plan quotas of the signed-in agent CLIs: percentages only, never tokens.
    if(method==='limits.read') return limits.read({force:p.force===true});
    if(method==='chat.permission.request') return chats.requestPermission(p);
    if(['chat.get','chat.configure','chat.send','chat.stop','chat.clear','chat.compaction.capabilities','chat.compact','chat.continue','chat.queue.remove','chat.queue.send','chat.models','chat.permission.answer','chat.question.answer'].includes(method)) {
      const w=store.getWorkspace(p.workspaceId),main=p.nodeId===Chats.mainId(w),node=main?chats.mainNode(w):w.nodes.find(n=>n.id===p.nodeId);
      assert(node?.type==='terminal','Chat card not found');
      if(['chat.compaction.capabilities','chat.compact','chat.continue'].includes(method)) {
        const keys=method==='chat.continue'?['workspaceId','nodeId','summary']:['workspaceId','nodeId'];
        assert(Object.keys(p).every(key=>keys.includes(key)),'Unknown context operation field');
        if(method==='chat.continue') return chats.continueSession(w,node,p.summary);
        return chats.compaction(w,node,method==='chat.compact'?'compact':'capabilities');
      }
      // The project's Phantom conversation keeps its settings in the chat store.
      if(main&&method==='chat.configure') {const result=chats.configureMain(w,{provider:p.provider,autoApprove:p.autoApprove,permissionMode:p.permissionMode,model:p.model,reasoning:p.reasoning});if(p.provider!==undefined&&p.provider!==node.data.chat.provider)runWake.cancel(node.id,'El proveedor del chat cambió');return result;}
      if(method==='chat.get') return chats.get(node);
      if(method==='chat.send'){wakeLimit.reset(node.id);noticeLimit.reset(node.id);runWake.reset(node.id);return chats.send(w,node,p.text);}
      if(method==='chat.stop') {runWake.cancel(node.id);return chats.stop(node.id);}
      if(method==='chat.clear') {const result=chats.clear(w,node);runWake.cancel(node.id,'La conversación se reinició');return result;}
      if(method==='chat.queue.remove') return chats.removeQueued(w,node,p.id);
      if(method==='chat.queue.send') return chats.sendQueued(w,node,p.id);
      if(method==='chat.models') return chats.models(w,node);
      if(method==='chat.permission.answer') return chats.answerPermission(node,p.requestId,p.decision);
      if(method==='chat.question.answer') return chats.answerQuestion(node,p.requestId,p.answers===undefined?null:p.answers);
      // permissionMode ('ask'|'auto'|'full') wins over the older boolean autoApprove.
      const patch=permissionPatch({autoApprove:p.autoApprove,permissionMode:p.permissionMode});if(p.provider!==undefined)patch.provider=p.provider;validateChat(patch);
      const rules=policy();
      if(patch.provider!==(node.data.chat?.provider??null))assertNewChatPolicy(patch,rules);
      assert(patch.provider===undefined||patch.provider===(node.data.chat?.provider??null)||!chats.running(node.id),'Detén la respuesta antes de cambiar de agente');
      // model: the choice for the provider in effect after this call; null returns to the CLI's default.
      if(p.model!==undefined&&p.model!==null){validateModel(p.model);const provider=patch.provider===undefined?node.data.chat?.provider:patch.provider;if(provider)assertClientModel(provider,p.model,rules,'chat');}
      assert((p.model===undefined&&p.reasoning===undefined)||!chats.running(node.id),'Detén la respuesta antes de cambiar modelo o effort/variant');
      if(patch.provider!==undefined&&patch.provider!==node.data.chat?.provider)runWake.cancel(node.id,'El proveedor del chat cambió');
      return mutate(w.id,()=>{const current=store.getWorkspace(w.id).nodes.find(n=>n.id===node.id);assert(current,'Chat card not found');const chat=applyPatch(current.data.chat,patch);for(const [field,key] of [['model','models'],['reasoning','reasoning']])if(p[field]!==undefined){assert(chat.provider,'Elige un agente primero');const values={...chat[key]};if(p[field]===null)delete values[chat.provider];else values[chat.provider]=p[field];chat[key]=values;}validateChat(chat);current.data={...current.data,chat};return current;});
    }
    if(method.startsWith('merge.')) return merges.handle(method,p);
    if(method.startsWith('branch.')) return branches.handle(method,p);
    if(method==='repo.file.write') { merges.polling.invalidate(); try { return await repo.handle(method,p); } finally { merges.polling.invalidate(); } }
    if(method.startsWith('repo.')) return repo.handle(method,p);
    if(method==='storage.export') { const data=structuredClone(store.state); // Runtime settings may contain credentials: export only portable presentation settings.
      data.settings=portableSettings(data.settings);
       if(p.includeHistory) {await terminals.flush();data.terminalHistory=terminals.sessions.map(s=>({...terminals.descriptor(s),seq:s.snapshotSeq??s.seq,status:s.status==='running'?'lost':s.status,pid:null,snapshot:s.snapshot}));}return data; }
    if(method==='storage.import') {
      let input=p.data;if(typeof input==='string'){assert(Buffer.byteLength(input)<=16*1024*1024,'Import too large');input=JSON.parse(input);}
      // Old UI snapshots did not carry plugin preferences; absence is not a reset.
      const incoming=structuredClone(object(input));
      for(const workspace of incoming.workspaces??[]) if(workspace.plugins===undefined) {const current=store.state.workspaces.find(w=>w.id===workspace.id&&w.canonicalPath===workspace.canonicalPath);if(current?.plugins)workspace.plugins=structuredClone(current.plugins);}
      const next=validateState(incoming);assert(!terminals.live.size,'Stop active terminals before importing');
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
      const item={...defaults,...fields,id:randomUUID(),createdAt:new Date().toISOString()};if(kind==='attention') pushAttention(w,item); else items.push(item);if(kind==='attention') queueMicrotask(()=>emit({type:'attention.new',workspaceId:w.id,item}));return item;
    });
    if(method==='host.shutdown') {setTimeout(()=>close().catch(error=>console.error(error.message)),30);return {ok:true};}
    const answer=await routeIntegration(method,p);assert(answer?.handled,`Unknown method: ${method}`);
    if(method==='phantom.control'&&p.action==='amend'&&answer.result?.action==='amend'){
      try{
        const w=store.getWorkspace(p.workspaceId),node=w.nodes.find(n=>n.type==='terminal'&&n.data.agent?.cardId===p.id);
        if(node){
          const delivered=await deliverNotice({workspaceId:w.id,nodeId:node.id,via:'terminal'},'amend',amendNotice(p.id,answer.result));
          if(!delivered?.delivered)mutate(w.id,()=>{const current=store.getWorkspace(w.id).nodes.find(n=>n.id===node.id);if(current?.data.agent?.cardId===p.id)current.data.agent={...current.data.agent,step:AMEND_STEP,updatedAt:new Date().toISOString()};});
        }
      }catch{}
    }
    // The full task catalog (no query filter) is what proves a unique match.
    if(method==='phantom.list'&&p.topic==='tasks'&&!p.query&&answer.result?.available&&Array.isArray(answer.result.items)) autoBind(p.workspaceId,answer.result.items);
    return answer.result;
  }
  function autoBind(workspaceId,tasks) {
    let w;try{w=store.getWorkspace(workspaceId);}catch{return;}
    const bindings=autoBindings(w.nodes,tasks,canonicalFolder);
    if(!bindings.length)return;
    mutate(w.id,()=>{
      const current=store.getWorkspace(w.id);
      for(const {nodeId,cardId,cardTitle} of bindings){
        // Re-check: the node may have been linked, unlinked or closed meanwhile.
        const node=current.nodes.find(n=>n.id===nodeId);if(node?.type!=='terminal'||node.data.agent?.cardId!==undefined)continue;
        if(isDefaultTerminalTitle(node.title)){const named=cardPanelTitle(cardTitle);if(named)node.title=named;}
        // Keep any progress the agent already reported; only the link is new.
        node.data.agent={...node.data.agent,cardId,cardTitle};
      }
    });
  }
  function close() {
    if(closingPromise)return closingPromise;
    runWatch.stop();runWake.close();quota.close();hostEvents.close();unsubscribeLimits?.();limits.stop?.();
    // Cancels any summary in flight (its Claude Code process included) and every pending timer.
    for(const timer of snapshotTimers.values())clearTimeout(timer);snapshotTimers.clear();traceReads.clear();
    try{supervisor?.close();}catch{}
    closingPromise=(async()=>{
      try {
        try { await Promise.all([mobile?.stop(),android?.stop()]); } finally {
          // Let short RPCs finish, then stop integration-owned work; never import
          // production adapters solely to close a host using injected fixtures.
          await bounded(Promise.allSettled([...inFlightIntegrations]),500,'Integration drain').catch(()=>{});
          try {if(shutdownIntegration)await bounded(Promise.resolve().then(()=>shutdownIntegration()),5000,'Integration shutdown');}
          finally {try {await chats?.close();await terminals?.close();} finally {traces?.close();store?.close();}}
          await bounded(Promise.allSettled([...inFlightIntegrations]),500,'Final integration drain').catch(()=>{});
          store?.flush();
        }
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
    store=new Store(dataDir);
    // Persistent under dataDir. The supervisor stays disabled per project until the operator enables it; its default
    // summarizer runs Claude Code only under the execution policy, and tests inject their own.
    unsubscribeLimits=limits.subscribe?.(data=>broadcast({type:'limits.changed',data}));
    traces=createAgentTraceStore({dataDir,now:traceOptions?.now,limits:traceOptions?.limits,onChange:({workspaceId})=>{broadcast({type:'agent.traces.changed',workspaceId});limits.poke?.()?.catch?.(()=>{});scheduleSnapshot(workspaceId);}});
    supervisor=createWorkspaceSupervisor({dataDir,...supervisorOptions,
      summarize:supervisorOptions?.summarize??createSupervisorSummarizer({settings:()=>store.state.settings,workspaceOf:id=>store.state.workspaces.find(w=>w.id===id)}),
      onChange:({workspaceId})=>broadcast({type:'supervisor.changed',workspaceId})});
    terminals=new Terminals(store,emit);merges=new Merges({store,terminals,mutate,emit});merges.resume();branches=new Branches({store,terminals,mutate,merges});repo=new Repo({store});terminals.integrationBase=w=>merges.baseName(w);chats=new Chats(store,emit,(w,node)=>node.data.main?{env:{...merges.agentContext(w,node).env,...mainEnv(w)},instructions:phantomInstructions(w)}:merges.agentContext(w,node),{onTrace:record=>traces.record(record)});
    providers=createProviders({...providerOptions,limits,settings:()=>store.state.settings,cwd:()=>{try{return store.getWorkspace(store.state.activeWorkspaceId).canonicalPath;}catch{return dataDir;}}});publishPolicy();limits.start?.();
    mobile=new MobileAccess({...mobileOptions,dataDir,store,terminals,chats});
    android=new AndroidGateway({hostDataDir:dataDir,listWorkspaces:()=>store.state.workspaces});
    server=net.createServer(socket=>{
      if(clients.size>=32){socket.destroy();return;}clients.add(socket);outputs.set(socket,createSocketOutput(socket));socket.setEncoding('utf8');let buffer='',pending=0,pendingBytes=0;
      const queues={control:[],normal:[]},active={control:0,normal:0};
      const priority=new Set(['terminal.attach','terminal.setup.retry','terminal.write','terminal.stop','terminal.close','terminal.resize','chat.get','chat.configure','chat.send','chat.stop','chat.clear','chat.queue.remove','chat.queue.send','chat.permission.answer','chat.question.answer','state.get','system.info','host.shutdown']);
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
    return {invoke,close,store,terminals,chats,merges,traces,supervisor,server,socketPath,emit};
  } catch(e) {await close();throw e;}
}
export const startHost=createHost;
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--data');
  try { const host=await createHost({dataDir:index>=0?process.argv[index+1]:dataHome()}); console.log(JSON.stringify({ready:true,socketPath:host.socketPath,pid:process.pid}));for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>host.close().then(()=>process.exit(0))); }
  catch(e) {console.error(e.message);process.exitCode=1;}
}
