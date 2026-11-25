import { createHash } from 'node:crypto';
import { clipTrace, isTraceId, isTraceModel } from './agent-traces.mjs';

// Turns what each provider really emits into records for the trace store
// (host/agent-traces.mjs record()). Pure: no I/O, no clocks, nothing is guessed.
//
// API
//   createTraceState()  -> state kept by the caller for one run (one chat turn). It remembers which
//        delegating call owns which child, so nested children keep their real parent.
//   adaptTraceEvent({workspaceId,nodeId,provider,event,state?,rootId?,agentId?,turnId?,model?,taskId?,runId?})
//        -> record[]. provider: 'claude' | 'opencode' | 'codex' | 'mcp'.
//        claude   stream-json events; parent_tool_use_id names the child (child id = the Agent call's
//                 tool_use id; its parent is the agent that made that call, never the root by default).
//        opencode events of host/opencode-chat.mjs; part.sessionID names the agent; a child's parent is
//                 known only when a task call reports metadata.sessionId (until then it is unattached).
//        codex    `exec --json` items; collab_tool_call receivers are child threads of the root.
//        mcp      JSON-RPC tools/call request/response; the caller names the agent with agentId.
//        Reasoning/thinking is never captured. model is the REQUESTED model; the observed one comes from
//        events. taskId/runId are applied to the root only, as the caller's evidence, never inherited.
//   adaptTurnTrace({..., phase:'start'|'end', message?, instructions?, status?, error?, state?})
//        -> record[] for the root's turn boundaries; 'end' also settles children left open.
//   settleTraceAgents({workspaceId,nodeId,provider,state,status,reason}) -> record[] (children still open)
//   adaptHookTrace(payload, identity) -> record[] for one Claude Code hook payload (identity:
//        {workspaceId?,nodeId?,provider?,rootId?}). transcript_path is never read or forwarded. Sub-agent
//        hooks are matched through the provider's agent_id (matchOnly): without a link they are ignored,
//        never attributed to the root. A host receiving these from a client MUST overwrite
//        workspaceId/nodeId from the live session and drop taskId/runId it cannot verify.
//   traceRootId({nodeId,provider,rootId?}) -> the root agent's stable ID.
// Events carry deterministic IDs (`<call>:start`, `<call>:end`) so repeats never duplicate.

const PROVIDERS = new Set(['claude', 'opencode', 'codex', 'mcp']);
const NO_PARENT = 'Sin evidencia explícita de qué llamada delegó este agente';
const ROOT_NAME = 'Agente principal';
const AGENT_TOOL = /^(agent|task)$/i;
const CODEX_CHILD = { completed: 'done', done: 'done', running: 'running', in_progress: 'running', errored: 'error', error: 'error', failed: 'error', shutdown: 'stopped', interrupted: 'interrupted' };

const bound = (value, max = 4000) => clipTrace(value, max).text;
const str = value => typeof value === 'string' ? value : '';
const remember = (map, key, value) => { map.set(key, value); if (map.size > 2000) map.delete(map.keys().next().value); };
const one = value => str(value).replace(/\s+/g, ' ').trim();
const contentText = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(block => str(block?.text)).filter(Boolean).join('\n') : '';
function detail(input) {
  if (!input || typeof input !== 'object') return '';
  const key = ['file_path', 'filePath', 'path', 'command', 'pattern', 'query', 'url', 'description', 'prompt', 'skill'].find(name => typeof input[name] === 'string' && input[name]);
  return key ? bound(one(input[key]), 240) : '';
}
const tokensOf = values => values.every(value => Number.isFinite(value) && value >= 0) ? values.reduce((a, b) => a + b, 0) : null;

export function createTraceState() { return { parents: new Map(), open: new Set(), tools: new Map(), model: null }; }

export function traceRootId({ nodeId, provider, rootId } = {}) {
  if (isTraceId(rootId)) return rootId;
  const id = `root:${nodeId}:${provider}`;
  return isTraceId(id) ? id : `root:${createHash('sha256').update(`${nodeId}:${provider}`).digest('hex').slice(0, 32)}`;
}

function context({ workspaceId, nodeId, provider, state = createTraceState(), rootId, agentId, turnId, model, taskId, runId }) {
  assertProvider(provider);
  const root = traceRootId({ nodeId, provider, rootId: agentId ?? rootId });
  const who = agentId && provider === 'mcp' ? { id: agentId }
    : { id: root, name: ROOT_NAME, ...(isTraceModel(model) ? { model, modelSource: 'requested' } : {}), ...(isTraceId(taskId) ? { taskId } : {}), ...(isTraceId(runId) ? { runId } : {}) };
  const child = id => ({ id, ...(state.parents.has(id) ? { parentId: state.parents.get(id) } : { parent: { available: false, reason: NO_PARENT } }) });
  return { workspaceId, nodeId, provider, state, root, who, child, turn: isTraceId(turnId) ? turnId : null,
    scoped: suffix => turnId && isTraceId(turnId) ? `${turnId}:${suffix}` : undefined,
    // MCP calls name an agent that already has its own provider: this record must not rewrite it.
    rec: (agent, extra = {}) => ({ workspaceId, nodeId, ...(provider === 'mcp' ? {} : { provider }), ...agent, ...extra }) };
}
function assertProvider(provider) { if (!PROVIDERS.has(provider)) throw new Error('Unsupported trace provider'); }

// A delegating call that created a child agent (Agent/Task, task, spawn_agent).
function delegation(c, owner, childId, { name, prompt, model, status, evidence }) {
  c.state.parents.set(childId, owner.id);
  if (status === 'running') c.state.open.add(childId);
  return c.rec({ id: childId, parentId: owner.id }, {
    name: bound(one(name) || 'Subagente', 120), ...(status ? { status } : {}), ...(isTraceModel(model) ? { model, modelSource: 'requested' } : {}),
    ...(prompt ? { context: { assignment: bound(prompt) } } : {}),
    event: { id: `${childId}:delegated`, kind: 'delegated', text: bound(evidence || name || 'Delegado', 240), ...(status ? { status } : {}), actorId: owner.id },
  });
}
function conclusion(c, owner, childId, { status, output }) {
  c.state.open.delete(childId);
  return c.rec({ id: childId, parentId: c.state.parents.get(childId) ?? owner.id }, { status, event: { id: `${childId}:result`, kind: 'result', text: bound(output), status } });
}
const assignment = (c, who, id, text) => text ? [c.rec(who, { context: { assignment: bound(text) }, event: { id: `${id}:assignment`, kind: 'assignment', text: bound(text) } })] : [];

function claude(c, event) {
  const out = [], { state } = c, owner = event.parent_tool_use_id;
  if (owner !== undefined && owner !== null && !isTraceId(owner)) return out;
  const who = owner ? c.child(owner) : c.who, msg = event.message || {};
  if (event.type === 'system' && event.subtype === 'init') {
    if (isTraceModel(event.model)) state.model = event.model;
    out.push(c.rec(who, { status: 'running', ...(isTraceModel(event.model) ? { model: event.model, modelSource: 'observed' } : {}), event: { id: event.session_id && isTraceId(event.session_id) ? c.scoped(`init:${event.session_id}`) ?? `init:${event.session_id}` : undefined, kind: 'session.start', text: 'Sesión iniciada', status: 'running' } }));
    return out;
  }
  if (event.type === 'assistant') {
    const meta = {}, tokens = tokensOf([msg.usage?.input_tokens, msg.usage?.cache_read_input_tokens, msg.usage?.cache_creation_input_tokens, msg.usage?.output_tokens]);
    if (isTraceModel(msg.model)) { Object.assign(meta, { model: msg.model, modelSource: 'observed' }); if (!owner) state.model = msg.model; }
    if (tokens !== null && tokens > 0) meta.context = { tokens, source: 'claude:request-v1' };
    if (Object.keys(meta).length) out.push(c.rec(who, meta));
    (Array.isArray(msg.content) ? msg.content : []).forEach((block, index) => {
      // One message can arrive as several events (one per block): the text itself keeps each block's ID distinct.
      if (block?.type === 'text' && block.text) out.push(c.rec(who, { event: { id: isTraceId(msg.id) ? `${msg.id}:text:${createHash('sha256').update(`${index}:${block.text}`).digest('hex').slice(0, 12)}` : undefined, kind: 'message', text: bound(block.text) } }));
      if (block?.type !== 'tool_use' || !isTraceId(block.id)) return;
      const name = str(block.name) || 'tool';
      remember(state.tools, block.id, name);
      out.push(c.rec(who, { event: { id: `${block.id}:start`, kind: 'tool', tool: name, text: detail(block.input), input: bound(block.input, 2000), status: 'running' } }));
      if (AGENT_TOOL.test(name)) {
        const input = block.input && typeof block.input === 'object' ? block.input : {};
        out.push(delegation(c, who, block.id, { name: input.description || input.subagent_type, prompt: str(input.prompt), model: input.model, status: 'running', evidence: input.description }));
      }
    });
    return out;
  }
  if (event.type === 'user') {
    if (owner) out.push(...assignment(c, who, owner, contentText(msg.content)));
    for (const block of Array.isArray(msg.content) ? msg.content : []) {
      if (block?.type !== 'tool_result' || !isTraceId(block.tool_use_id)) continue;
      const failed = block.is_error === true, output = contentText(block.content);
      out.push(c.rec(who, { event: { id: `${block.tool_use_id}:end`, kind: 'tool', tool: state.tools.get(block.tool_use_id), output: bound(output), status: failed ? 'error' : 'done' } }));
      if (state.parents.has(block.tool_use_id)) out.push(conclusion(c, who, block.tool_use_id, { status: failed ? 'error' : 'done', output }));
    }
    return out;
  }
  if (event.type === 'result') {
    const failed = event.is_error === true, model = state.model, usage = event.modelUsage || {};
    const key = Object.keys(usage).find(name => model && name.startsWith(`${model}[`) && name.endsWith(']'));
    const window = (usage[model] ?? usage[key])?.contextWindow;
    out.push(c.rec(who, { status: failed ? 'error' : 'done', ...(Number.isFinite(window) && window > 0 ? { context: { window } } : {}),
      event: { id: c.scoped('result'), kind: 'result', status: failed ? 'error' : 'done', text: bound(event.result ?? (event.errors || []).join(' ') ?? ''),
        output: bound({ durationMs: event.duration_ms, costUsd: event.total_cost_usd, turns: event.num_turns, outputTokens: event.usage?.output_tokens }) } }));
  }
  return out;
}

const openCodeStatus = status => status === 'completed' ? 'done' : status === 'error' ? 'error' : 'running';
function opencode(c, event) {
  const out = [], { state } = c, part = event.part || {}, root = event.sessionID;
  const session = typeof part.sessionID === 'string' ? part.sessionID : root, child = typeof session === 'string' && typeof root === 'string' && session !== root;
  if (child && !isTraceId(session)) return out;
  const who = child ? c.child(session) : c.who;
  if (event.type === 'model' && !child && isTraceModel(event.model)) {
    state.model = event.model;
    out.push(c.rec(who, { model: event.model, modelSource: 'observed', ...(Number.isFinite(event.contextWindow) && event.contextWindow > 0 ? { context: { window: event.contextWindow } } : {}) }));
  } else if (event.type === 'text' && part.text) out.push(c.rec(who, { event: { id: isTraceId(part.id) ? `${part.id}:text` : undefined, kind: 'message', text: bound(part.text) } }));
  else if (event.type === 'tool_use') {
    const callId = part.callID || part.id, st = part.state || {}, status = openCodeStatus(st.status), ended = status !== 'running';
    if (!isTraceId(callId)) return out;
    out.push(c.rec(who, { event: { id: `${callId}:${ended ? 'end' : 'start'}`, kind: 'tool', tool: str(part.tool) || 'tool', text: detail(st.input) || bound(one(st.title), 240), input: bound(st.input, 2000), status,
      ...(ended ? { output: bound(st.output ?? st.error) } : {}) } }));
    const sid = st.metadata?.sessionId;
    if (AGENT_TOOL.test(str(part.tool)) && isTraceId(sid) && sid !== root && sid !== who.id) {
      const input = st.input && typeof st.input === 'object' ? st.input : {};
      out.push(delegation(c, who, sid, { name: input.description || input.subagent_type || input.agent, prompt: str(input.prompt), status: ended ? status : 'running', evidence: input.description }));
      if (ended) out.push(conclusion(c, who, sid, { status, output: str(st.output) || str(st.error) }));
    }
  } else if (event.type === 'step_finish') {
    const t = part.tokens || {};
    const tokens = Number.isFinite(t.total) && t.total > 0 ? t.total : t.total === undefined ? tokensOf([t.input, t.output, t.reasoning, t.cache?.read, t.cache?.write]) : null;
    if (tokens) out.push(c.rec(who, { context: { tokens, source: 'opencode:request-v1' } }));
  } else if (event.type === 'error' && !child) {
    out.push(c.rec(who, { status: 'error', event: { id: c.scoped('error'), kind: 'error', status: 'error', text: bound(event.error?.data?.message || event.error?.message || event.error?.name || 'OpenCode terminó con error') } }));
  }
  return out;
}

function codex(c, event) {
  const out = [], { who } = c, scope = c.turn ?? 'turn', item = event.item;
  if (event.type === 'thread.started' && isTraceId(event.thread_id)) return [c.rec(who, { status: 'running', event: { id: `${scope}:thread:${event.thread_id}`, kind: 'session.start', text: 'Hilo iniciado', status: 'running' } })];
  if (event.type === 'turn.completed') return [c.rec(who, { status: 'done', event: { id: `${scope}:completed`, kind: 'result', status: 'done', output: bound({ outputTokens: event.usage?.output_tokens }) } })];
  if (event.type === 'error' || event.type === 'turn.failed') return [c.rec(who, { status: 'error', event: { id: `${scope}:failed`, kind: 'error', status: 'error', text: bound(event.error?.message || event.message || 'Codex terminó con error') } })];
  if (!item || !isTraceId(item.id) || !['item.started', 'item.updated', 'item.completed'].includes(event.type)) return out;
  const key = `${scope}:${item.id}`, ended = event.type === 'item.completed';
  if (item.type === 'agent_message') { if (ended && item.text) out.push(c.rec(who, { event: { id: `${key}:text`, kind: 'message', text: bound(item.text) } })); return out; }
  if (['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(item.type)) {
    const failed = item.status === 'failed' || (Number.isInteger(item.exit_code) && item.exit_code !== 0), done = ended || item.status === 'completed' || failed;
    const tool = item.type === 'command_execution' ? 'shell' : item.type === 'file_change' ? 'edit' : item.type === 'mcp_tool_call' ? [item.server, item.tool].filter(Boolean).join('.') || 'mcp' : 'web_search';
    const input = item.type === 'command_execution' ? { command: item.command } : item.type === 'file_change' ? { paths: (item.changes || []).map(change => change?.path).filter(Boolean) } : item.type === 'mcp_tool_call' ? item.arguments : { query: item.query };
    out.push(c.rec(who, { event: { id: `${key}:${done ? 'end' : 'start'}`, kind: 'tool', tool, text: detail(input) || bound((input?.paths || []).join(', '), 240), input: bound(input, 2000), status: done ? (failed ? 'error' : 'done') : 'running',
      ...(done ? { output: bound(item.aggregated_output || item.error?.message || contentText(item.result?.content) || item.result) } : {}) } }));
    return out;
  }
  if (item.type === 'collab_tool_call') {
    const tool = str(item.tool) || 'spawn_agent', threads = (Array.isArray(item.receiver_thread_ids) ? item.receiver_thread_ids : []).filter(isTraceId), done = ended || item.status === 'completed' || item.status === 'failed';
    out.push(c.rec(who, { event: { id: `${key}:${done ? 'end' : 'start'}`, kind: 'tool', tool: `agent:${tool}`.slice(0, 120), text: bound(one(str(item.prompt).split('\n')[0]), 240), input: bound({ prompt: item.prompt, threads }, 2000), status: done ? (item.status === 'failed' ? 'error' : 'done') : 'running' } }));
    const states = item.agents_states && typeof item.agents_states === 'object' ? item.agents_states : {};
    for (const thread of threads) {
      const reported = states[thread], status = CODEX_CHILD[str(reported?.status)];
      if (!c.state.parents.has(thread)) out.push(delegation(c, who, thread, { name: `Hilo ${thread.slice(0, 12)}`, prompt: tool === 'spawn_agent' ? str(item.prompt) : '', status, evidence: item.prompt }));
      if (status && status !== 'running') out.push(conclusion(c, who, thread, { status, output: str(reported?.message) }));
    }
  }
  return out;
}

function mcp(c, event) {
  const { who, state } = c, id = event.id;
  if (!(typeof id === 'string' || Number.isInteger(id)) || !isTraceId(`m${id}`)) return [];
  if (event.method === 'tools/call') {
    const name = str(event.params?.name) || 'mcp'; remember(state.tools, `mcp:${id}`, name);
    return [c.rec(who, { event: { id: `mcp:${id}:start`, kind: 'tool', tool: name, text: detail(event.params?.arguments), input: bound(event.params?.arguments, 2000), status: 'running' } })];
  }
  if (event.result !== undefined || event.error !== undefined) {
    const failed = event.error !== undefined || event.result?.isError === true;
    return [c.rec(who, { event: { id: `mcp:${id}:end`, kind: 'tool', tool: state.tools.get(`mcp:${id}`), status: failed ? 'error' : 'done', output: bound(event.error?.message ?? (contentText(event.result?.content) || event.result)) } })];
  }
  return [];
}

export function adaptTraceEvent(args = {}) {
  const { event, provider } = args;
  assertProvider(provider);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return [];
  const c = context(args);
  return { claude, opencode, codex, mcp }[provider](c, event);
}

export function settleTraceAgents({ workspaceId, nodeId, provider, state, status = 'unknown', reason = 'La respuesta terminó sin confirmar el final de este agente' } = {}) {
  assertProvider(provider);
  const out = [];
  for (const id of [...(state?.open ?? [])]) {
    state.open.delete(id);
    out.push({ workspaceId, nodeId, provider, id, ...(state.parents.has(id) ? { parentId: state.parents.get(id) } : {}), status, event: { id: `${id}:settled`, kind: 'settled', status, text: bound(reason, 240) } });
  }
  return out;
}

export function adaptTurnTrace({ phase, message, instructions, status = 'done', error, ...args } = {}) {
  const c = context(args);
  if (phase === 'start') {
    return [c.rec(c.who, { status: 'running', context: { ...(typeof message === 'string' ? { assignment: bound(message) } : {}), ...(typeof instructions === 'string' && instructions ? { instructions: bound(instructions) } : {}) },
      event: { id: c.scoped('start'), kind: 'turn.start', status: 'running', text: 'Turno iniciado' } })];
  }
  if (phase !== 'end') throw new Error('Invalid trace phase');
  return [c.rec(c.who, { status, event: { id: c.scoped('end'), kind: 'turn.end', status, text: bound(error || (status === 'stopped' ? 'Detenido por el usuario' : '')) } }),
    ...settleTraceAgents({ workspaceId: args.workspaceId, nodeId: args.nodeId, provider: args.provider, state: args.state, status: status === 'stopped' ? 'stopped' : 'unknown', reason: status === 'done' ? undefined : 'El turno terminó antes de que este agente cerrara' })];
}

export function adaptHookTrace(payload, identity = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const provider = PROVIDERS.has(identity.provider) && identity.provider !== 'mcp' ? identity.provider : 'claude';
  const root = isTraceId(identity.rootId) ? identity.rootId : isTraceId(payload.session_id) ? `session:${payload.session_id}` : identity.nodeId ? traceRootId({ nodeId: identity.nodeId, provider }) : `root:${provider}`;
  const base = { workspaceId: identity.workspaceId, nodeId: identity.nodeId, provider };
  const rootWho = { id: root, name: ROOT_NAME };
  const event = payload.hook_event_name, id = payload.tool_use_id, tool = str(payload.tool_name);
  // Events made inside a sub-agent are tied to it through its provider ID or ignored.
  const nested = isTraceId(payload.agent_id) && !['SubagentStart', 'SubagentStop'].includes(event);
  const who = nested ? { id: payload.agent_id, providerAgentId: payload.agent_id, matchOnly: true } : rootWho;
  const rec = (agent, extra) => ({ ...base, ...agent, ...extra });
  const known = isTraceId(id);
  if (event === 'SessionStart') {
    return [rec(rootWho, { status: 'running', ...(isTraceModel(payload.model) ? { model: payload.model, modelSource: 'observed' } : {}), event: { kind: 'session.start', status: 'running', text: bound(`Sesión ${one(payload.source) || 'iniciada'}`, 120) } })];
  }
  if (event === 'SessionEnd') return [rec(rootWho, { status: 'done', event: { kind: 'session.end', status: 'done', text: bound(`Sesión terminada${payload.reason ? `: ${one(payload.reason)}` : ''}`, 120) } })];
  if (event === 'Stop') return [rec(rootWho, { status: 'idle', event: { kind: 'turn.end', status: 'idle', text: 'Turno terminado' } })];
  if (event === 'SubagentStart' && isTraceId(payload.agent_id)) return [rec({ id: payload.agent_id, providerAgentId: payload.agent_id, matchOnly: true }, { status: 'running', event: { id: `${payload.agent_id}:start`, kind: 'session.start', status: 'running', text: bound(one(payload.agent_type) || 'Subagente', 120) } })];
  if (event === 'SubagentStop' && isTraceId(payload.agent_id)) {
    return [rec({ id: payload.agent_id, providerAgentId: payload.agent_id, matchOnly: true }, { status: 'done', event: { id: `${payload.agent_id}:stop`, kind: 'result', status: 'done', text: bound(payload.last_assistant_message ?? '') } })];
  }
  if (!['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(event) || !known || !tool) return [];
  const out = [], isAgent = AGENT_TOOL.test(tool), failed = event === 'PostToolUseFailure';
  if (event === 'PreToolUse') {
    out.push(rec(who, { event: { id: `${id}:start`, kind: 'tool', tool, text: detail(payload.tool_input), input: bound(payload.tool_input, 2000), status: 'running' } }));
    if (isAgent) {
      const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
      out.push(rec({ id, ...(nested ? { parent: { available: false, reason: NO_PARENT } } : { parentId: root }) }, {
        name: bound(one(input.description || input.subagent_type) || 'Subagente', 120), status: 'running', ...(isTraceModel(input.model) ? { model: input.model, modelSource: 'requested' } : {}),
        ...(str(input.prompt) ? { context: { assignment: bound(input.prompt) } } : {}),
        event: { id: `${id}:delegated`, kind: 'delegated', status: 'running', text: bound(input.description || input.subagent_type || 'Delegado', 240), ...(nested ? {} : { actorId: root }) } }));
    }
    return out;
  }
  const response = payload.tool_response, output = failed ? str(payload.error) : contentText(response?.content) || (typeof response === 'string' ? response : '');
  out.push(rec(who, { event: { id: `${id}:end`, kind: 'tool', tool, status: failed ? 'error' : 'done', output: bound(output) } }));
  if (isAgent) {
    const launched = response?.status === 'async_launched', agentId = isTraceId(response?.agentId) ? response.agentId : undefined;
    out.push(rec({ id, ...(agentId ? { providerAgentId: agentId } : {}), matchOnly: true }, launched
      ? { status: 'running', event: { id: `${id}:launched`, kind: 'launched', status: 'running', text: 'Subagente lanzado en segundo plano' } }
      : { status: failed ? 'error' : 'done', event: { id: `${id}:result`, kind: 'result', status: failed ? 'error' : 'done', text: bound(output) } }));
  }
  return out;
}
