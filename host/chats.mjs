import fs from 'node:fs';
import os from 'node:os';
import { codexRolloutPath, codexContextReading, probeCodexCompaction } from './codex-context.mjs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicJSON, assert, text } from './store.mjs';
import { permissionDecision, phantomCommand, PHANTOM_SCRIPTS, inside, PERMISSION_MODES } from './chat-permissions.mjs';
import { codexWriteArgs, phantomEnv, phantomMcpConfig, PHANTOM_MCP_HINT } from '../scripts/phantom-mcp.mjs';
import { GATE_TOOL as GATE_NAME } from '../scripts/chat-approval-mcp.mjs';
import { validReasoning } from '../shared/chat-options.mjs';
import { assertClaudeModel, assertClientAllowed, assertClientModel, CLAUDE_MODEL_ALIASES, DEFAULT_POLICY, executionPolicy, isClaudeLike } from '../shared/execution-policy.mjs';
import { claudeRoutingArgs, resolveRouting, roleOfChat } from '../shared/routing.mjs';
import { provisionBrowserTerminal, credentialFile } from './agent-browser.mjs';
import { driveOpenCode, openCodeServerEnv } from './opencode-chat.mjs';
import { codexModels } from './chat-models.mjs';

// Chat cards drive an agent CLI headlessly, one process per turn, and render
// its structured event stream. No PTY is involved: the conversation lives in
// the provider's own session, resumed by ID on every turn.
export const CHAT_PROVIDERS = {
  claude: { label: 'Claude', bin: 'claude', setting: 'claudePath' },
  opencode: { label: 'OpenCode', bin: 'opencode', setting: 'opencodePath' },
  codex: { label: 'Codex', bin: 'codex', setting: 'codexPath' },
};
const MAX_QUEUE = 20, MAX_MESSAGES = 400, MAX_PART = 200_000, MAX_OUTPUT = 6000, MAX_LINE = 8 * 1024 * 1024, MAX_TURNS = 16;

// New chat settings must name an enabled provider; threads of disabled providers stay readable.
export function assertNewChatPolicy(patch, policy = DEFAULT_POLICY) {
  if (patch?.provider !== undefined && patch.provider !== null) assertClientAllowed(patch.provider, policy);
  for (const [provider, model] of Object.entries(patch?.models ?? {})) assertClientModel(provider, model, policy, 'chat');
  return patch;
}
// A model is passed to the CLI as an argument: an identifier, never a flag.
export function validateModel(model) {
  assert(typeof model === 'string' && /^[A-Za-z0-9][\w./:@\[\]-]{0,199}$/.test(model), 'Modelo inválido');
  return model;
}
export function validateChat(chat) {
  assert(chat && typeof chat === 'object' && !Array.isArray(chat), 'Invalid chat settings');
  for (const key of Object.keys(chat)) assert(['provider', 'autoApprove', 'permissionMode', 'models', 'reasoning'].includes(key), 'Unknown chat field');
  if (chat.reasoning !== undefined) {
    assert(chat.reasoning && typeof chat.reasoning === 'object' && !Array.isArray(chat.reasoning), 'Invalid reasoning settings');
    for (const [provider, value] of Object.entries(chat.reasoning)) assert(validReasoning(provider, value), 'Effort/variant inválido');
  }
  if (chat.models !== undefined) {
    assert(chat.models && typeof chat.models === 'object' && !Array.isArray(chat.models), 'Invalid chat models');
    for (const [provider, model] of Object.entries(chat.models)) { assert(Object.hasOwn(CHAT_PROVIDERS, provider), 'Unsupported chat provider'); validateModel(model); }
  }
  assert(chat.provider === undefined || chat.provider === null || Object.hasOwn(CHAT_PROVIDERS, chat.provider), 'Unsupported chat provider');
  assert(chat.autoApprove === undefined || typeof chat.autoApprove === 'boolean', 'Invalid chat autoApprove');
  assert(chat.permissionMode === undefined || PERMISSION_MODES.includes(chat.permissionMode), 'Modo de permisos inválido');
  return chat;
}
// The mode a card was explicitly set to, or null when it never was.
// permissionMode wins; the older boolean autoApprove still reads as auto/ask.
export function explicitMode(chat = {}) {
  if (PERMISSION_MODES.includes(chat?.permissionMode)) return chat.permissionMode;
  if (typeof chat?.autoApprove === 'boolean') return chat.autoApprove ? 'auto' : 'ask';
  return null;
}
// A configure patch for the permission switch: permissionMode keeps the
// boolean in step for older readers; a bare autoApprove drops a stale mode.
export function permissionPatch({ autoApprove, permissionMode }) {
  if (permissionMode !== undefined) {
    assert(PERMISSION_MODES.includes(permissionMode), 'Modo de permisos inválido');
    return { permissionMode, autoApprove: permissionMode !== 'ask' };
  }
  return autoApprove !== undefined ? { autoApprove, permissionMode: undefined } : {};
}
export function applyPatch(chat, patch) {
  const next = { ...chat, ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return next;
}

const realpath = value => { try { return fs.realpathSync(value); } catch { return null; } };
function inOwnWorktree(node, cwd) {
  const tree = node.data?.worktree?.path, here = cwd && realpath(cwd);
  return Boolean(tree && here && realpath(tree) === here);
}
// How a turn handles permissions. 'full': everything except a short list of
// dangerous actions, which still asks. 'auto': the agent works without
// interruptions and asks only for sensitive actions (destructive, commit and
// push, external tools and services, databases). 'ask': every change asks.
// Inside the card's own Phantom worktree the default is 'auto'; elsewhere (the
// original checkout, a folder without Git) it is 'ask'. The card's switch
// overrides either way.
export function chatMode(node, cwd) {
  const chosen = explicitMode(node.data?.chat);
  if (chosen) return chosen;
  return inOwnWorktree(node, cwd) ? 'auto' : 'ask';
}
const GATE_SERVER = 'phantom_workspace_chat';
export const GATE_TOOL = `mcp__${GATE_SERVER}__${GATE_NAME}`;
export function gateConfig({ token, socketPath }) {
  return { mcpServers: { [GATE_SERVER]: { type: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('../scripts/chat-approval-mcp.mjs', import.meta.url))], env: { PHANTOM_CHAT_TOKEN: token, PHANTOM_WORKSPACE_SOCKET: socketPath } } } };
}
// OpenCode asks for the shell command itself (bash) and for reading the CLI
// outside the folder (external_directory); Phantom's own CLIs pass either way.
export function phantomRequest(permission, patterns) {
  if (!patterns.length) return false;
  if (permission === 'bash') return patterns.every(phantomCommand);
  if (permission === 'external_directory') return patterns.every(p => inside(PHANTOM_SCRIPTS, p.replace(/\/\*+$/, '')));
  return false;
}
// OpenCode uses its local server; run's noninteractive auto-reject loop must
// never own the permission replies of a chat card.
// `opencode models --verbose` prints each model id on its own line followed by
// its JSON metadata; `variants` names the effort levels that model accepts.
// Plain output (ids only) still yields the catalog, without variants.
export function openCodeModels(stdout) {
  const lines = String(stdout).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split('\n');
  const isId = line => /^[A-Za-z0-9][\w./:@\[\]-]{0,199}$/.test(line) && line.includes('/');
  const items = new Map();
  for (let i = 0; i < lines.length && items.size < 2000; i++) {
    const id = lines[i].trim(); if (!isId(id) || items.has(id)) continue;
    const item = { id, group: id.slice(0, id.indexOf('/')) };
    let end = i + 1; while (end < lines.length && !isId(lines[end].trim())) end++;
    const body = lines.slice(i + 1, end).join('\n').trim();
    if (body.startsWith('{')) {
      try {
        const variants = JSON.parse(body)?.variants;
        if (variants && typeof variants === 'object' && !Array.isArray(variants)) item.variants = Object.keys(variants).filter(name => validReasoning('opencode', name)).slice(0, 20);
      } catch { /* Metadata is optional; the id is enough to pick the model. */ }
    }
    items.set(id, item); i = end - 1;
  }
  return [...items.values()];
}

const cliModel = (model, where) => assertClaudeModel(model, where).slice('claude-code/'.length);

export function providerArgs(provider, { sessionId, mode = 'ask', autoApprove = false, access = autoApprove ? 'auto' : 'ask', message, cwd, model, reasoning, gate, instructions, phantom, routing }) {
  assert(Object.hasOwn(CHAT_PROVIDERS, provider), 'Unsupported chat provider');
  if (reasoning) assert(validReasoning(provider, reasoning), 'Effort/variant inválido');
  const sandbox = access === 'full' ? 'danger-full-access' : access === 'auto' ? 'workspace-write' : 'read-only';
  // Phantom's CLIs reach the app through its Unix socket, which Codex's
  // sandbox counts as network, and native Phantom writes its own database:
  // workspace-write opens both so Codex works like Claude and OpenCode do.
  // read-only has no switch for either; the MCP servers cover it.
  if (provider === 'codex') return ['exec', ...(sessionId ? ['resume'] : []), '--json', '--skip-git-repo-check',
    '-c', `sandbox_mode=${JSON.stringify(sandbox)}`, '-c', 'approval_policy="never"',
    ...(sandbox === 'workspace-write' ? codexWriteArgs(phantom || process.env) : []),
    ...(model ? ['--model', model] : []), ...(reasoning ? ['-c', `model_reasoning_effort=${JSON.stringify(reasoning)}`] : []),
    ...(phantom ? ['-c', phantomMcpConfig(phantom)] : []),
    ...(instructions || phantom ? ['-c', `developer_instructions=${JSON.stringify([instructions, phantom && PHANTOM_MCP_HINT].filter(Boolean).join('\n\n'))}`] : []), ...(sessionId ? [sessionId] : []), '-'];
  if (provider === 'claude') {
    // The CLI takes bare names: a stored «claude-code/sonnet» becomes «sonnet»; anything that is not Claude is refused before spawn.
    if (model) model = cliModel(model, 'chat');
    const routed = claudeRoutingArgs(routing?.config, routing?.role, { model, reasoning });
    model = routed.model ? cliModel(routed.model, 'enrutamiento') : routed.model; reasoning = routed.effort;
    return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    ...(reasoning ? ['--effort', reasoning] : []),
    ...(instructions ? ['--append-system-prompt', instructions] : []), ...(model ? ['--model', model] : []), ...(sessionId ? ['--resume', sessionId] : []), ...(mode === 'auto' || mode === 'full' ? ['--permission-mode', 'acceptEdits'] : []),
    ...(gate ? ['--mcp-config', JSON.stringify(gateConfig(gate)), '--permission-prompt-tool', GATE_TOOL] : []), ...routed.extra];
  }
  return ['serve', '--hostname', '127.0.0.1', '--port', '0'];
}

// One line that says what a tool call is doing, from its most telling input.
export function toolDetail(input, cwd = '') {
  if (!input || typeof input !== 'object') return '';
  const key = ['file_path', 'filePath', 'path', 'command', 'pattern', 'query', 'url', 'description', 'prompt', 'skill'].find(k => typeof input[k] === 'string' && input[k]);
  let value = key ? input[key] : Object.values(input).find(v => typeof v === 'string' && v) || '';
  if (cwd && value.startsWith(`${cwd}/`)) value = value.slice(cwd.length + 1);
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

const appendText = (message, chunk, fresh, type = 'text') => {
  const last = message.parts.at(-1);
  if (!fresh && last?.type === type) { if (last.text.length < MAX_PART) last.text += chunk; }
  else message.parts.push({ type, text: String(chunk).slice(0, MAX_PART) });
};
const lines = value => typeof value === 'string' && value ? value.split('\n').length : 0;
// What an edit changed, counted from the tool's own input (no file reads).
export function toolDiff(name, input) {
  if (!input || typeof input !== 'object') return undefined;
  const kind = String(name).toLowerCase(), before = input.old_string ?? input.oldString, after = input.new_string ?? input.newString;
  if (typeof before === 'string' || typeof after === 'string') return { added: lines(after), removed: lines(before) };
  if (kind === 'write' && typeof input.content === 'string') return { added: lines(input.content), removed: 0 };
  return undefined;
}
// Tool results arrive as a string or as content blocks; keep a bounded excerpt.
export function toolOutput(content) {
  const value = typeof content === 'string' ? content : Array.isArray(content) ? content.map(block => typeof block?.text === 'string' ? block.text : '').filter(Boolean).join('\n') : '';
  return value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}\n… (${value.length - MAX_OUTPUT} caracteres más)` : value;
}
// The text an edit replaced and wrote, bounded, so the card can draw the diff.
const clipChange = value => value.length > MAX_OUTPUT ? value.slice(0, MAX_OUTPUT) : value;
export function toolChange(name, input) {
  if (!input || typeof input !== 'object') return undefined;
  const before = input.old_string ?? input.oldString, after = input.new_string ?? input.newString;
  if (typeof before === 'string' || typeof after === 'string') return { before: clipChange(String(before ?? '')), after: clipChange(String(after ?? '')) };
  if (String(name).toLowerCase() === 'write' && typeof input.content === 'string') return { before: '', after: clipChange(input.content) };
  return undefined;
}
const describeTool = (part, name, input, cwd) => {
  part.detail = toolDetail(input, cwd) || part.detail;
  const diff = toolDiff(name, input); if (diff) part.diff = diff;
  const change = toolChange(name, input); if (change) part.change = change;
};
const sum = (...values) => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
const validTokens = value => Number.isFinite(value) && value >= 0;
function contextReading(turn, source, values) {
  const total = values.every(validTokens) ? sum(...values) : undefined;
  if (!Number.isFinite(total) || total <= 0) return;
  turn.contextTokens = total;
  turn.contextSource = source;
}
const toolPart = (message, id, name) => {
  let part = message.parts.find(p => p.type === 'tool' && p.id === id);
  if (!part) { part = { type: 'tool', id, name: String(name || 'tool').slice(0, 120), detail: '', status: 'running' }; message.parts.push(part); }
  return part;
};

// Delegation: a call to Agent/Task (Claude), task (OpenCode) or spawn_agent
// (Codex) runs a sub-agent. Its own steps are folded into that call's part as
// `agent` so the card shows who was delegated, what it is doing and how it
// ended. Bounded: only the latest steps and an excerpt of its last words stay.
const MAX_AGENT_STEPS = 40, MAX_AGENT_TEXT = 1200, MAX_AGENT_PROMPT = 2000;
export const isAgentTool = name => /^(agent|task|spawn_agent)$/i.test(String(name || ''));
const clipText = (value, max) => String(value ?? '').replace(/\s+$/, '').slice(0, max);
const agentOf = part => (part.agent ||= { steps: [], total: 0 });
function describeAgent(part, input) {
  if (!input || typeof input !== 'object') return;
  const agent = agentOf(part), type = input.subagent_type ?? input.subagentType ?? input.agent;
  if (typeof type === 'string' && type) agent.type = type.slice(0, 80);
  if (typeof input.prompt === 'string' && input.prompt) agent.prompt = clipText(input.prompt, MAX_AGENT_PROMPT);
  if (typeof input.description === 'string' && input.description) part.detail = clipText(input.description, 240);
}
function agentStep(agent, id, name) {
  let step = agent.steps.find(s => s.id === id);
  if (!step) {
    step = { id: String(id), name: String(name || 'tool').slice(0, 120), detail: '', status: 'running' };
    agent.steps.push(step); agent.total = (agent.total || 0) + 1;
    if (agent.steps.length > MAX_AGENT_STEPS) agent.steps.splice(0, agent.steps.length - MAX_AGENT_STEPS);
  }
  return step;
}
// When the delegating call ends, nothing the sub-agent left open keeps spinning.
export function settleAgent(part, status = part.status) {
  for (const step of part.agent?.steps || []) if (step.status === 'running') step.status = status === 'running' ? 'running' : status === 'error' ? 'error' : status === 'done' ? 'done' : 'stopped';
}
const settleTool = (part, status) => { part.status = status; if (part.agent) settleAgent(part, status); };

// Claude: sub-agent events carry parent_tool_use_id = the Agent call's id.
function applyClaudeSubagent(turn, event) {
  const part = turn.message.parts.find(p => p.type === 'tool' && p.id === event.parent_tool_use_id);
  if (!part || !['assistant', 'user'].includes(event.type)) return false;
  const agent = agentOf(part);
  if (event.type === 'assistant') {
    if (typeof event.message?.model === 'string') agent.model = event.message.model.slice(0, 120);
    for (const block of event.message?.content || []) {
      if (block.type === 'text' && block.text) agent.text = clipText(block.text, MAX_AGENT_TEXT);
      if (block.type === 'tool_use') { const step = agentStep(agent, block.id, block.name); step.detail = toolDetail(block.input, turn.cwd) || step.detail; }
    }
    return true;
  }
  let changed = false;
  for (const block of Array.isArray(event.message?.content) ? event.message.content : []) if (block.type === 'tool_result') {
    const step = agent.steps.find(s => s.id === block.tool_use_id);
    if (step) { step.status = block.is_error ? 'error' : 'done'; changed = true; }
  }
  return changed;
}

// Reducers: fold one provider event into the turn. Return true when the
// visible message changed. Sub-agent events nest under their delegating call.
export function applyClaudeEvent(turn, event) {
  const { message } = turn;
  if (event.session_id && (event.type === 'system' && event.subtype === 'init' || event.type === 'result')) turn.sessionId = event.session_id;
  if (event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string') { turn.model = event.model; return true; }
  if (event.parent_tool_use_id) return applyClaudeSubagent(turn, event);
  if (event.type === 'stream_event') {
    const e = event.event || {};
    if (e.type === 'message_start') {
      if (e.message?.id) turn.streamed.add(e.message.id);
      const usage = e.message?.usage;
      contextReading(turn, 'claude:request-v1', [usage?.input_tokens, usage?.cache_read_input_tokens, usage?.cache_creation_input_tokens, usage?.output_tokens]);
      return true;
    }
    if (e.type === 'content_block_start' && ['text', 'thinking'].includes(e.content_block?.type)) { turn.freshText = true; return false; }
    if (e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta' && e.delta.thinking) { appendText(message, e.delta.thinking, turn.freshText, 'thinking'); turn.freshText = false; return true; }
    if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') { toolPart(message, e.content_block.id, e.content_block.name); return true; }
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) { appendText(message, e.delta.text, turn.freshText); turn.freshText = false; return true; }
    return false;
  }
  if (event.type === 'assistant') {
    const streamed = turn.streamed.has(event.message?.id), usage = event.message?.usage;
    if (typeof event.message?.model === 'string') turn.model = event.message.model;
    // The prompt of the latest request is what the conversation occupies now.
    contextReading(turn, 'claude:request-v1', [usage?.input_tokens, usage?.cache_read_input_tokens, usage?.cache_creation_input_tokens, usage?.output_tokens]);
    for (const block of event.message?.content || []) {
      if (block.type === 'text' && !streamed && block.text) appendText(message, block.text, true);
      if (block.type === 'thinking' && !streamed && block.thinking) appendText(message, block.thinking, true, 'thinking');
      if (block.type === 'tool_use') { const part = toolPart(message, block.id, block.name); describeTool(part, block.name, block.input, turn.cwd); if (isAgentTool(block.name)) describeAgent(part, block.input); }
    }
    return true;
  }
  if (event.type === 'user') {
    let changed = false;
    for (const block of Array.isArray(event.message?.content) ? event.message.content : []) if (block.type === 'tool_result') {
      const part = message.parts.find(p => p.type === 'tool' && p.id === block.tool_use_id);
      if (part) { settleTool(part, block.is_error ? 'error' : 'done'); const output = toolOutput(block.content); if (output) part.output = output; changed = true; }
    }
    return changed;
  }
  if (event.type === 'result') {
    turn.usage = { durationMs: event.duration_ms, costUsd: event.total_cost_usd, outputTokens: event.usage?.output_tokens, steps: event.num_turns };
    const key = Object.keys(event.modelUsage || {}).find(key => key.startsWith(`${turn.model}[`) && key.endsWith(']'));
    const window = (event.modelUsage?.[turn.model] ?? event.modelUsage?.[key])?.contextWindow;
    if (Number.isFinite(window) && window > 0) turn.contextWindow = window;
    if (event.is_error) turn.error = String(event.result || (event.errors || []).join(' ') || event.subtype || 'El agente terminó con error').slice(0, 2000);
    else if (!message.parts.some(p => p.type === 'text') && typeof event.result === 'string' && event.result) appendText(message, event.result, true);
    return true;
  }
  return false;
}

const openCodeStatus = status => status === 'completed' ? 'done' : status === 'error' ? 'error' : 'running';
// OpenCode: the task tool opens a child session; its parts arrive with that
// session's ID. They belong to the task call that owns the session, or, before
// the call names it, to the latest task still running.
function applyOpenCodeChild(turn, event, part) {
  const tasks = turn.message.parts.filter(p => p.type === 'tool' && isAgentTool(p.name));
  let owner = tasks.find(p => p.agent?.sessionId === part.sessionID);
  if (!owner) { owner = tasks.findLast(p => p.status === 'running' && !p.agent?.sessionId); if (owner) agentOf(owner).sessionId = part.sessionID; }
  if (!owner) return false;
  const agent = agentOf(owner);
  if (event.type === 'text' && part.text) { agent.text = clipText(part.text, MAX_AGENT_TEXT); return true; }
  if (event.type === 'tool_use') {
    const state = part.state || {}, step = agentStep(agent, part.callID || part.id, part.tool);
    step.detail = toolDetail(state.input, turn.cwd) || clipText(state.title, 240) || step.detail;
    step.status = openCodeStatus(state.status);
    return true;
  }
  return false;
}

export function applyOpenCodeEvent(turn, event) {
  if (turn.stopped || turn.finished) return false;
  const { message } = turn, part = event.part || {};
  if (typeof event.sessionID === 'string') turn.sessionId = event.sessionID;
  if (typeof part.sessionID === 'string' && typeof event.sessionID === 'string' && part.sessionID !== event.sessionID) return applyOpenCodeChild(turn, event, part);
  if (event.type === 'model') {
    if (turn.model !== event.model) delete turn.contextWindow;
    turn.model = event.model;
    if (Number.isFinite(event.contextWindow) && event.contextWindow > 0) turn.contextWindow = event.contextWindow;
    return true;
  }
  if (event.type === 'text' && part.text) { appendText(message, part.text, true); return true; }
  if (event.type === 'tool_use') {
    const tool = toolPart(message, part.callID || part.id, part.tool), state = part.state || {};
    describeTool(tool, part.tool, state.input, turn.cwd); tool.detail ||= String(state.title || '').slice(0, 240);
    if (isAgentTool(part.tool)) {
      describeAgent(tool, state.input);
      const meta = state.metadata || {}, agent = agentOf(tool);
      if (typeof meta.sessionId === 'string') agent.sessionId = meta.sessionId;
      // The call's own summary lists the child's tools when the stream missed them.
      for (const item of Array.isArray(meta.summary) ? meta.summary : []) if (item?.id) {
        const step = agentStep(agent, item.id, item.tool);
        step.detail ||= clipText(item.state?.title, 240);
        if (item.state?.status) step.status = openCodeStatus(item.state.status);
      }
    }
    settleTool(tool, openCodeStatus(state.status));
    const output = toolOutput(state.output ?? state.error); if (output) tool.output = output;
    return true;
  }
  if (event.type === 'step_finish') {
    const tokens = part.tokens || {};
    if (typeof event.sessionID === 'string' && part.sessionID === event.sessionID) {
      contextReading(turn, 'opencode:request-v1', Number.isFinite(tokens.total) && tokens.total > 0 ? [tokens.total] : tokens.total === undefined ? [tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write] : [undefined]);
    } else contextReading(turn, null, [undefined]);
    turn.usage = { costUsd: sum(turn.usage?.costUsd, part.cost), outputTokens: sum(turn.usage?.outputTokens, tokens.output, tokens.reasoning), steps: sum(turn.usage?.steps, 1) };
    return true;
  }
  if (event.type === 'error') {
    turn.error = String(event.error?.data?.message || event.error?.message || event.error?.name || 'OpenCode terminó con error').slice(0, 2000);
    return true;
  }
  return false;
}

export function applyCodexEvent(turn, event) {
  if (event.type === 'thread.started' && typeof event.thread_id === 'string') { turn.sessionId = event.thread_id; return true; }
  if (event.type === 'error' || event.type === 'turn.failed') { turn.error = String(event.error?.message || event.message || 'Codex terminó con error').slice(0, 2000); return true; }
  if (event.type === 'turn.completed') {
    turn.completed = true;
    const usage = event.usage || {};
    turn.usage = { outputTokens: usage.output_tokens }; return true;
  }
  const item = event.item;
  if (!item || !['item.started', 'item.updated', 'item.completed'].includes(event.type)) return false;
  if (['agent_message', 'reasoning'].includes(item.type)) {
    let part = turn.message.parts.find(p => p.id === item.id);
    if (!part) { part = { id: item.id, type: item.type === 'reasoning' ? 'thinking' : 'text', text: '' }; turn.message.parts.push(part); }
    part.text = String(item.text || '').slice(0, MAX_PART); return true;
  }
  if (['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(item.type)) {
    const part = toolPart(turn.message, item.id, item.type === 'command_execution' ? 'shell' : item.type === 'file_change' ? 'edit' : item.tool || 'web_search');
    part.detail = String(item.command || item.query || (item.changes || []).map(change => change.path).join(', ') || toolDetail(item.arguments, turn.cwd)).slice(0, 240);
    part.status = item.status === 'failed' || (Number.isInteger(item.exit_code) && item.exit_code !== 0) ? 'error' : event.type === 'item.completed' ? 'done' : 'running';
    const output = toolOutput(item.aggregated_output || item.error?.message || item.result?.content); if (output) part.output = output;
    return true;
  }
  // Codex multi-agent: spawn_agent/send_input/wait act on child threads whose
  // latest state (status + message) is reported on the call itself.
  if (item.type === 'collab_tool_call') {
    const tool = String(item.tool || 'spawn_agent'), part = toolPart(turn.message, item.id, tool === 'spawn_agent' ? 'spawn_agent' : `agent:${tool}`.slice(0, 120));
    const agent = agentOf(part), threads = Array.isArray(item.receiver_thread_ids) ? item.receiver_thread_ids : [];
    if (typeof item.prompt === 'string' && item.prompt) { agent.prompt = clipText(item.prompt, MAX_AGENT_PROMPT); part.detail ||= clipText(item.prompt.split('\n')[0], 240); }
    if (threads.length) agent.type = threads.length > 1 ? `${threads.length} hilos` : `hilo ${String(threads[0]).slice(0, 12)}`;
    const states = item.agents_states && typeof item.agents_states === 'object' ? Object.values(item.agents_states) : [];
    const said = states.map(s => s?.message).filter(m => typeof m === 'string' && m).at(-1); if (said) agent.text = clipText(said, MAX_AGENT_TEXT);
    settleTool(part, item.status === 'failed' ? 'error' : event.type === 'item.completed' || item.status === 'completed' ? 'done' : 'running');
    return true;
  }
  return false;
}

// AskUserQuestion is not a permission: the agent waits for the user's choice.
// Claude Code reads the answers back from updatedInput.answers, keyed by the
// question text; without them it tells the model "the user did not answer".
export const QUESTION_TOOL = 'AskUserQuestion';
const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
export function normalizeQuestions(questions) {
  assert(Array.isArray(questions) && questions.length >= 1 && questions.length <= 8, 'Preguntas inválidas');
  return questions.map(q => {
    assert(q && typeof q.question === 'string' && q.question.trim(), 'Pregunta inválida');
    const options = (Array.isArray(q.options) ? q.options : []).filter(o => o && typeof o.label === 'string' && o.label.trim()).slice(0, 8)
      .map(o => ({ label: clip(o.label, 200), ...(o.description ? { description: clip(o.description, 600) } : {}), ...(o.preview ? { preview: clip(o.preview, 4000) } : {}) }));
    return { question: clip(q.question, 1000), ...(q.header ? { header: clip(q.header, 40) } : {}), multiSelect: q.multiSelect === true, options };
  });
}

export class Chats {
  // role(workspace, node) → { env, instructions }: the card's identity under Incorporaciones.
  constructor(store, emit, role = () => ({ env: {}, instructions: '' }), { codexHome } = {}) {
    this.codexHome = codexHome;
    this.store = store; this.emit = emit; this.role = role; this.turns = new Map(); this.operations = new Map(); this.dirty = false; this.closed = false;
    this.filename = path.join(store.dir, 'chats.json');
    this.nodes = {};
    try { if (fs.existsSync(this.filename)) this.nodes = JSON.parse(fs.readFileSync(this.filename, 'utf8')); } catch { this.nodes = {}; }
    // A turn cannot outlive the host: whatever was streaming was interrupted.
    for (const entry of Object.values(this.nodes)) for (const thread of Object.values(entry.threads || {})) for (const message of thread.messages || []) {
      if (message.status === 'streaming') message.status = 'stopped';
      for (const part of message.parts || []) {
        if (part.type === 'tool') settleTool(part, part.status === 'running' ? 'stopped' : part.status);
        if ((part.type === 'permission' || part.type === 'question') && part.status === 'pending') part.status = 'cancelled';
      }
      // Waiting messages survive a restart, paused until the user resumes them.
      thread.queue = Array.isArray(thread.queue) ? thread.queue.filter(item => typeof item?.id === 'string' && typeof item.text === 'string' && item.text.trim()).slice(0, MAX_QUEUE) : [];
    }
    this.gates = new Map();
    for (const entry of Object.values(this.nodes)) for (const thread of Object.values(entry.threads || {})) {
      for (const record of [...(thread.compactions || []), ...(thread.continuations || [])]) if (record.status === 'running') {
        record.status = 'interrupted'; record.error = 'Host interrumpido; resultado sin verificar'; record.finishedAt = new Date().toISOString(); this.dirty = true;
        if (record.fromSessionId && !thread.sessionId) thread.sessionId = record.fromSessionId;
      }
    }
    this.timer = setInterval(() => { if (this.dirty) this.save(); }, 2000); this.timer.unref();
  }
  save() { this.dirty = false; atomicJSON(this.filename, this.nodes); }
  thread(nodeId, provider) {
    const entry = this.nodes[nodeId] ??= { threads: {} };
    const thread = entry.threads[provider] ??= { sessionId: null, messages: [] };
    if (thread.meta && (thread.meta.contextSource !== `${provider}:request-v1` || !validTokens(thread.meta.contextTokens) || thread.meta.contextTokens <= 0)) {
      delete thread.meta.contextTokens; delete thread.meta.contextSource; delete thread.meta.contextWindow;
    }
    return thread;
  }
  running(nodeId) { return this.turns.has(nodeId) || this.operations.has(nodeId); }
  // Read on every call: providers.configure changes it while the host runs.
  policy() { return executionPolicy(this.store.state?.settings); }
  // The canvas browser bridge, for chat cards as for PTYs. One stable identity
  // per card so its preview panels survive across turns; the capability itself
  // lives only while a turn runs (written at spawn, revoked at finish).
  browserSession(nodeId) {
    const entry = this.nodes[nodeId] ??= { threads: {} };
    if (!entry.browserSession) { entry.browserSession = randomUUID(); this.dirty = true; }
    return entry.browserSession;
  }
  browserActive({ workspaceId, sessionId, nodeId } = {}) {
    const turn = this.turns.get(nodeId);
    return { active: Boolean(turn && !turn.finished && turn.workspaceId === workspaceId && turn.browserSession && turn.browserSession === sessionId) };
  }
  get(node) {
    const provider = node.data.chat?.provider ?? null, thread = provider ? this.thread(node.id, provider) : null;
    let cwd = node.data.cwd; try { assert(cwd && fs.statSync(cwd).isDirectory()); } catch { cwd = null; }
    return { provider, autoApprove: ['auto', 'full'].includes(explicitMode(node.data.chat)), permissionMode: explicitMode(node.data.chat), mode: chatMode(node, cwd), model: (provider && node.data.chat?.models?.[provider]) || null, models: node.data.chat?.models || {}, reasoning: node.data.chat?.reasoning || {}, running: this.running(node.id), operation: this.operations.get(node.id)?.kind ?? null, compactions: thread?.compactions ?? [], continuations: thread?.continuations ?? [], sessionId: thread?.sessionId ?? null, meta: thread?.meta ?? {}, messages: thread?.messages ?? [], queue: thread?.queue ?? [] };
  }
  async compaction(workspace, node, kind = 'compact') {
    assert(['compact', 'capabilities'].includes(kind), 'Operación de contexto inválida');
    assert(!this.closed, 'Host is shutting down');
    assert(!this.running(node.id), 'La sesión está ocupada');
    const provider = node.data.chat?.provider, policy = this.policy();
    assertClientAllowed(provider, policy);
    assert(['opencode', 'codex'].includes(provider), 'Compactación explícita no disponible para este proveedor; el historial se conserva');
    const thread = this.thread(node.id, provider);
    assert(!thread.queue?.length, 'Vacía o resuelve la cola antes de compactar');
    assert(kind === 'capabilities' || provider === 'opencode', 'Codex no tiene compactación verificada en este transporte; usa la continuación explícita con resumen');
    const model = node.data.chat.models?.[provider] || thread.meta?.model;
    if (model) assertClientModel(provider, model, policy, 'compactación');
    if (kind === 'compact') { assert(thread.sessionId, 'No hay sesión para compactar'); assert(model, 'Elige un modelo explícito antes de compactar'); }
    assert(this.turns.size + this.operations.size < MAX_TURNS, 'Demasiados agentes activos');
    let cwd = node.data.cwd; try { assert(cwd && fs.statSync(cwd).isDirectory()); } catch { cwd = workspace.canonicalPath; }
    const operation = { kind, controller: new AbortController() };
    this.operations.set(node.id, operation);
    const publish = () => this.emit({ type: 'chat.update', workspaceId: workspace.id, nodeId: node.id, provider, running: this.running(node.id), operation: this.operations.get(node.id)?.kind ?? null, meta: thread.meta ?? {}, compactions: structuredClone(thread.compactions ?? []), messages: [] });
    const record = kind === 'compact' ? { id: randomUUID(), sessionId: thread.sessionId, model, status: 'running', startedAt: new Date().toISOString(), before: structuredClone(thread.meta ?? {}) } : null;
    if (record) { (thread.compactions ??= []).push(record); this.save(); }
    publish();
    try {
      const definition = CHAT_PROVIDERS[provider], bin = this.store.state.settings[definition.setting] || definition.bin;
      let result;
      if (provider === 'codex') result = await probeCodexCompaction(bin, cwd, operation.controller.signal);
      else {
        const env = openCodeServerEnv({ ...process.env, PWD: cwd });
        const child = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
        child.stdin.on('error', () => {}); child.stdin.end(); child.stderr.resume();
        operation.child = child;
        result = await driveOpenCode(child, { cwd, sessionId: thread.sessionId, model, password: env.OPENCODE_SERVER_PASSWORD, operation: kind, signal: operation.controller.signal,
          onEvent: () => {}, onPermission: async () => ({ behavior: 'deny', message: 'La compactación no autoriza herramientas' }), onQuestion: async () => ({ behavior: 'deny' }) });
      }
      operation.controller.signal.throwIfAborted();
      if (record) {
        Object.assign(record, result, { status: 'done', finishedAt: new Date().toISOString() });
        // A summarizer's input is not the size of the next request.
        delete thread.meta?.contextTokens; delete thread.meta?.contextSource; delete thread.meta?.contextWindow;
      }
      return result;
    } catch (error) {
      if (record) Object.assign(record, { status: operation.controller.signal.aborted ? 'cancelled' : 'error', error: error.message, finishedAt: new Date().toISOString() });
      throw error;
    } finally {
      this.operations.delete(node.id);
      if (record) this.save();
      publish();
    }
  }
  async continueSession(workspace, node, summary) {
    text(summary, 'resumen de continuidad', 32 * 1024); assert(summary.trim(), 'Revisa y escribe un resumen antes de continuar');
    assert(node.data.chat?.provider === 'codex', 'La continuación con resumen solo está disponible para Codex');
    assert(!this.running(node.id), 'La sesión está ocupada');
    const thread = this.thread(node.id, 'codex');
    assert(thread.sessionId, 'No hay sesión de origen');
    const fromSessionId = thread.sessionId, settings = JSON.stringify(node.data.chat);
    const capability = await this.compaction(workspace, node, 'capabilities');
    assert(!this.running(node.id) && !thread.queue?.length, 'La sesión o la cola está ocupada');
    node = node.id === Chats.mainId(workspace) ? this.mainNode(workspace) : this.store.getWorkspace(workspace.id).nodes.find(item => item.id === node.id);
    assert(node && JSON.stringify(node.data.chat) === settings && this.nodes[node.id]?.threads?.codex === thread && thread.sessionId === fromSessionId, 'La conversación cambió; revisa el resumen antes de continuar');
    assertClientAllowed('codex', this.policy());
    const model = node.data.chat.models?.codex || thread.meta?.model;
    assert(model, 'Elige un modelo explícito antes de abrir otra sesión');
    assertClientModel('codex', model, this.policy(), 'continuidad');
    const record = { id: randomUUID(), fromSessionId, model, capability, summary, status: 'running', startedAt: new Date().toISOString() };
    const meta = thread.meta;
    (thread.continuations ??= []).push(record);
    thread.sessionId = null; thread.meta = { model };
    this.save();
    try { return this.start(workspace, node, `Resumen revisado para continuar desde una sesión anterior. Conserva las instrucciones y permisos vigentes; este resumen no concede permisos nuevos.\n\n${summary}`, record); }
    catch (error) { thread.sessionId = record.fromSessionId; thread.meta = meta; Object.assign(record, { status: 'error', error: error.message, finishedAt: new Date().toISOString() }); this.save(); throw error; }
  }
  // A message written while the agent works waits its turn, in order; one
  // written while others still wait joins the end of the line.
  send(workspace, node, message) {
    assert(!this.closed, 'Host is shutting down');
    const provider = node.data.chat?.provider; assert(Object.hasOwn(CHAT_PROVIDERS, provider ?? ''), 'Elige un agente antes de escribir');
    const policy = this.policy();
    assertClientAllowed(provider, policy, 'El agente de este chat');
    if (node.data.chat.models?.[provider]) assertClientModel(provider, node.data.chat.models[provider], policy, 'modelo guardado del chat');
    text(message, 'chat message', 64 * 1024); assert(message.trim(), 'Escribe un mensaje');
    const thread = this.thread(node.id, provider);
    assert(!this.operations.has(node.id), 'Espera a que termine la operación de contexto');
    thread.queue ??= [];
    if (!this.turns.has(node.id) && !thread.queue.length) return this.start(workspace, node, message);
    assert(thread.queue.length < MAX_QUEUE, `Ya hay ${MAX_QUEUE} mensajes en espera`);
    const item = { id: randomUUID(), text: message, createdAt: new Date().toISOString() };
    thread.queue.push(item); this.dirty = true; this.publishQueue(workspace, node.id, provider, thread);
    if (!this.turns.has(node.id)) this.drain(workspace, node.id, provider, thread);
    return { ok: true, queued: true, id: item.id };
  }
  publishQueue(workspace, nodeId, provider, thread) {
    this.emit({ type: 'chat.update', workspaceId: workspace.id, nodeId, provider, running: this.turns.has(nodeId), meta: thread.meta ?? {}, messages: [], queue: structuredClone(thread.queue ?? []) });
  }
  // Starts the next waiting message if the thread is still current and idle.
  drain(workspace, nodeId, provider, thread) {
    if (this.closed || this.running(nodeId) || !thread.queue?.length || this.nodes[nodeId]?.threads?.[provider] !== thread) return;
    let node = null;
    try { node = nodeId === Chats.mainId(workspace) ? this.mainNode(workspace) : this.store.getWorkspace(workspace.id).nodes.find(n => n.id === nodeId); } catch { /* Project closed. */ }
    if (node?.data?.chat?.provider !== provider) return;
    const item = thread.queue.shift();
    try { this.start(workspace, node, item.text); }
    catch (error) { thread.queue.unshift(item); this.publishQueue(workspace, nodeId, provider, thread); throw error; }
  }
  removeQueued(workspace, node, id) {
    const provider = node.data.chat?.provider, thread = provider ? this.nodes[node.id]?.threads?.[provider] : null;
    const index = thread?.queue?.findIndex(item => item.id === id) ?? -1;
    assert(index >= 0, 'Ese mensaje ya no está en espera');
    const [item] = thread.queue.splice(index, 1);
    this.dirty = true; this.publishQueue(workspace, node.id, provider, thread);
    return { ok: true, text: item.text };
  }
  // Resumes a paused line; with an ID, that message goes first.
  sendQueued(workspace, node, id) {
    assert(!this.running(node.id), 'El agente todavía está respondiendo');
    const provider = node.data.chat?.provider, thread = provider ? this.nodes[node.id]?.threads?.[provider] : null;
    assert(thread?.queue?.length, 'No hay mensajes en espera');
    if (id !== undefined && id !== null) {
      const index = thread.queue.findIndex(item => item.id === id); assert(index >= 0, 'Ese mensaje ya no está en espera');
      thread.queue.unshift(...thread.queue.splice(index, 1));
    }
    this.drain(workspace, node.id, provider, thread);
    return { ok: true };
  }
  start(workspace, node, message, continuation) {
    const provider = node.data.chat.provider;
    assert(!this.running(node.id), 'El agente todavía está respondiendo');
    assert(this.turns.size + this.operations.size < MAX_TURNS, 'Demasiados agentes respondiendo a la vez');
    const definition = CHAT_PROVIDERS[provider], thread = this.thread(node.id, provider), now = () => new Date().toISOString();
    let cwd = node.data.cwd; try { assert(cwd && fs.statSync(cwd).isDirectory()); } catch { cwd = workspace.canonicalPath; }
    const user = { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: message }], status: 'done', createdAt: now() };
    const reply = { id: randomUUID(), role: 'assistant', provider, parts: [], status: 'streaming', createdAt: now() };
    thread.messages.push(user, reply);
    if (!thread.continuations?.length && !thread.compactions?.length && thread.messages.length > MAX_MESSAGES) thread.messages.splice(0, thread.messages.length - MAX_MESSAGES);
    const turn = { message: reply, sessionId: thread.sessionId, streamed: new Set(), freshText: true, cwd, ownBranch: inOwnWorktree(node, cwd), mode: chatMode(node, cwd), autoApprove: ['auto', 'full'].includes(explicitMode(node.data.chat)), thread, pending: new Map(), token: provider === 'claude' ? randomUUID() : null, error: '', stderr: '', stopped: false, finished: false, timer: null };
    const started = Date.now();
    turn.model = continuation?.model || node.data.chat.models?.[provider] || thread.meta?.model;
    // Session facts as known right now: the turn's own readings over the thread's.
    const meta = () => {
      const value = { ...thread.meta };
      if (turn.model !== thread.meta?.model) delete value.contextWindow;
      return { ...value, ...(turn.model ? { model: turn.model } : {}), ...(turn.contextSource ? { contextTokens: turn.contextTokens, contextSource: turn.contextSource } : {}), ...(turn.contextWindow > 0 ? { contextWindow: turn.contextWindow } : {}) };
    };
    const publish = extra => this.emit({ type: 'chat.update', workspaceId: workspace.id, nodeId: node.id, provider, sessionId: thread.sessionId, running: this.turns.has(node.id), meta: meta(), messages: [structuredClone(reply)], ...extra });
    const schedule = () => { this.dirty = true; turn.timer ??= setTimeout(() => { turn.timer = null; publish(); }, 40); };
    turn.schedule = schedule;
    const apply = provider === 'claude' ? applyClaudeEvent : provider === 'codex' ? applyCodexEvent : applyOpenCodeEvent;
    const finish = (code, failure) => {
      if (turn.finished) return; turn.finished = true;
      clearTimeout(turn.timer); clearTimeout(turn.killTimer); this.turns.delete(node.id);
      if (turn.token) this.gates.delete(turn.token);
      turn.browser?.revoke();
      // Nobody is left to answer: whatever was still asking is refused.
      for (const request of turn.pending.values()) { request.part.status = 'cancelled'; request.resolve({ behavior: 'deny', message: 'La respuesta terminó antes de aprobar el permiso.' }); }
      turn.pending.clear();
      if (turn.sessionId) thread.sessionId = turn.sessionId;
      const error = failure || turn.error || (continuation && (!turn.sessionId || turn.sessionId === continuation.fromSessionId || !turn.completed) ? 'Codex no confirmó una sesión nueva y un turno completo' : '') || (!turn.stopped && code ? turn.stderr.trim().split('\n').slice(-6).join('\n').slice(-1500) || `${definition.label} terminó con código ${code}` : '');
      for (const part of reply.parts) if (part.type === 'tool') settleTool(part, part.status === 'running' ? 'stopped' : part.status);
      reply.status = turn.stopped ? 'stopped' : error ? 'error' : 'done';
      if (error && !turn.stopped) reply.error = error;
      else delete reply.error;
      reply.finishedAt = now();
      if (continuation) {
        Object.assign(continuation, { status: reply.status, toSessionId: turn.sessionId || null, finishedAt: reply.finishedAt, ...(error ? { error } : {}) });
        if (!turn.sessionId) thread.sessionId = continuation.fromSessionId;
      }
      if (turn.model) reply.model = turn.model;
      reply.usage = { durationMs: Number.isFinite(turn.usage?.durationMs) ? turn.usage.durationMs : Date.now() - started, ...(Number.isFinite(turn.usage?.costUsd) ? { costUsd: turn.usage.costUsd } : {}), ...(turn.usage?.outputTokens ? { outputTokens: turn.usage.outputTokens } : {}) };
      thread.meta = { ...meta(), costUsd: sum(thread.meta?.costUsd, turn.usage?.costUsd), turns: sum(thread.meta?.turns, 1) };
      this.save(); publish({ running: false, continuations: structuredClone(thread.continuations ?? []) });
      // The line moves on after a clean reply; a stop or a failure pauses it.
      if (reply.status === 'done') setImmediate(() => { try { this.drain(workspace, node.id, provider, thread); } catch { /* Stays waiting; the user resumes it. */ } });
      // OpenCode's stream never names the model; its session record does.
      if (provider === 'opencode' && !thread.meta.model && thread.sessionId) execFile(bin, ['export', thread.sessionId], { cwd, env: { ...process.env, PWD: cwd }, timeout: 15000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
        try {
          const model = JSON.parse(stdout.slice(stdout.indexOf('{'))).info?.model;
          if (error || typeof model?.id !== 'string' || this.nodes[node.id]?.threads?.[provider] !== thread) return;
          thread.meta.model = [model.providerID, model.id].filter(Boolean).join('/').slice(0, 200); reply.model = thread.meta.model;
          this.dirty = true; publish({ running: this.turns.has(node.id) });
        } catch { /* The model stays unknown; nothing else depends on it. */ }
      });
    };
    const bin = this.store.state.settings[definition.setting] || definition.bin;
    let child, env;
    try {
      // Own process group: stopping a turn must also stop the tools it launched.
      if (turn.token) this.gates.set(turn.token, turn);
      const role = this.role(workspace, node);
      turn.browserSession = this.browserSession(node.id); turn.workspaceId = workspace.id;
      // A capability left by an interrupted host is stale; replace it.
      fs.rmSync(credentialFile(this.store.dir, turn.browserSession), { force: true });
      turn.browser = provisionBrowserTerminal(this.store.dir, { sessionId: turn.browserSession, workspaceId: workspace.id, nodeId: node.id });
      env = { ...process.env, PWD: cwd, ...role.env, ...turn.browser.env, ...(turn.token ? { MCP_TOOL_TIMEOUT: String(24 * 3600 * 1000), CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: '0' } : {}) };
      if (provider === 'opencode') env = openCodeServerEnv(env);
      child = spawn(bin, providerArgs(provider, { sessionId: thread.sessionId, mode: turn.mode, access: explicitMode(node.data.chat) || 'ask', message, cwd, model: continuation?.model || node.data.chat.models?.[provider], reasoning: node.data.chat.reasoning?.[provider], gate: turn.token ? { token: turn.token, socketPath: path.join(this.store.dir, 'host.sock') } : null, instructions: role.instructions, phantom: provider === 'codex' ? phantomEnv(env, path.join(this.store.dir, 'host.sock'), cwd) : null, ...(provider === 'claude' ? { routing: { role: roleOfChat(node), config: resolveRouting(this.store.state.settings) } } : {}) }),
        // OpenCode trusts PWD over the real working directory; keep both in step.
        // A permission waits for the user as long as it takes.
        { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    } catch (error) { if (turn.token) this.gates.delete(turn.token); turn.browser?.revoke(); thread.messages.splice(thread.messages.indexOf(user), 2); throw error; }
    turn.child = child; this.turns.set(node.id, turn);
    if (provider !== 'opencode') child.on('error', error => finish(null, error.code === 'ENOENT' ? `No se encontró «${bin}». Instálalo o define settings.${definition.setting} con su ruta.` : error.message));
    child.stdin.on('error', () => {});
    // Claude reads the prompt from stdin, so any text is safe from flag parsing.
    child.stdin.end(provider === 'claude' || provider === 'codex' ? message : '');
    let buffer = '';
    let contextRead = Promise.resolve(), lastContextRead = -Infinity;
    const readContext = () => {
      lastContextRead = Date.now();
      contextRead = contextRead.then(async () => {
        this.codexPaths ??= new Map();
        const id = turn.sessionId;
        const file = this.codexPaths.get(id) || await codexRolloutPath(id, this.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
        if (file) this.codexPaths.set(id, file);
        const reading = await codexContextReading(file);
        if (!reading || turn.finished || this.turns.get(node.id) !== turn) return;
        turn.contextTokens = reading.tokens; turn.contextSource = 'codex:request-v1'; turn.contextWindow = reading.window;
        schedule();
      }).catch(() => {});
    };
    const line = raw => {
      if (!raw.trim()) return;
      let event; try { event = JSON.parse(raw); } catch { return; }
      if (!event || typeof event !== 'object') return;
      if (apply(turn, event)) schedule();
      if (provider === 'codex' && (event.type === 'turn.completed' || event.type === 'item.completed' && Date.now() - lastContextRead >= 2000)) readContext();
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    if (provider !== 'opencode') child.stdout.on('data', chunk => {
      buffer += chunk; let index;
      while ((index = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
      if (buffer.length > MAX_LINE) buffer = '';
    });
    child.stderr.on('data', chunk => { turn.stderr = (turn.stderr + chunk).slice(-8000); });
    if (provider === 'opencode') turn.controller = new AbortController();
    if (provider === 'opencode') driveOpenCode(child, {
      signal: turn.controller.signal,
      cwd, sessionId: thread.sessionId, message, model: node.data.chat.models?.[provider], reasoning: node.data.chat.reasoning?.[provider], password: env.OPENCODE_SERVER_PASSWORD,
      onEvent: event => { if (!turn.finished && !turn.stopped && apply(turn, event)) schedule(); },
      onPermission: request => this.requestOpenCodePermission(turn, request),
      onQuestion: async request => {
        if (turn.finished || turn.stopped) return { behavior: 'deny' };
        const decision = await this.askQuestion(turn, { questions: request.questions }, request.tool?.callID);
        // The shared question UI returns one textual answer per question,
        // including a custom response. OpenCode expects an array per answer.
        return { ...decision, answers: decision.behavior === 'allow' ? decision.updatedInput.questions.map(q => [decision.updatedInput.answers[q.question.slice(0, 1000)]]) : undefined };
      },
    }).then(() => finish(0), error => finish(1, error.code === 'ENOENT' ? `No se encontró «${bin}». Instálalo o define settings.${definition.setting} con su ruta.` : [error.message, turn.stderr.trim().slice(-1500)].filter(Boolean).join('\n')));
    else child.on('close', async code => {
      line(buffer); buffer = '';
      if (provider === 'codex') {
        let timer;
        await Promise.race([contextRead, new Promise(resolve => { timer = setTimeout(resolve, 1500); })]);
        clearTimeout(timer);
      }
      finish(code);
    });
    this.dirty = true;
    this.emit({ type: 'chat.update', workspaceId: workspace.id, nodeId: node.id, provider, running: true, meta: meta(), messages: [structuredClone(user), structuredClone(reply)], queue: structuredClone(thread.queue ?? []) });
    return { ok: true, messageId: reply.id };
  }
  // Models the selected provider can run. Claude takes aliases for its latest
  // models (any full model name is also valid); other providers list their
  // catalog without Claude models, which run only through Claude Code.
  async models(workspace, node) {
    const provider = node.data.chat?.provider; assert(Object.hasOwn(CHAT_PROVIDERS, provider ?? ''), 'Elige un agente primero');
    assertClientAllowed(provider, this.policy(), 'El agente de este chat');
    if (provider === 'claude') return { provider, items: CLAUDE_MODEL_ALIASES.map(id => ({ id, group: 'Alias del modelo más reciente' })) };
    let cwd = node.data.cwd; try { assert(cwd && fs.statSync(cwd).isDirectory()); } catch { cwd = workspace.canonicalPath; }
    const definition = CHAT_PROVIDERS[provider], bin = this.store.state.settings[definition.setting] || definition.bin;
    const key = JSON.stringify([provider, bin, cwd]);
    this.catalogs ??= new Map();
    const cached = this.catalogs.get(key);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
    let items;
    if (provider === 'codex') items = await codexModels(bin, cwd);
    else {
      const stdout = await new Promise((resolve, reject) => execFile(bin, ['models', '--verbose'], { cwd, env: { ...process.env, PWD: cwd }, timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (error, out) => error ? reject(new Error(error.code === 'ENOENT' ? `No se encontró «${bin}»` : `OpenCode no pudo listar sus modelos: ${error.message.split('\n')[0]}`)) : resolve(out)));
      items = openCodeModels(stdout);
      if (!items.length) throw new Error('OpenCode no pudo listar sus modelos: el catálogo está vacío');
    }
    items = items.filter(item => !isClaudeLike(item.id));
    const value = { provider, items }; this.catalogs.delete(key); this.catalogs.set(key, { at: Date.now(), value });
    while (this.catalogs.size > 50) this.catalogs.delete(this.catalogs.keys().next().value);
    return value;
  }
  // From the approval gate of a running Claude turn. Resolves when policy or
  // the user decides; the promise is the gate's answer.
  requestPermission({ token, tool_name: tool, input = {}, tool_use_id: toolUseId } = {}) {
    text(token, 'permission token', 128); text(tool, 'tool name', 200);
    assert(input && typeof input === 'object' && !Array.isArray(input) && JSON.stringify(input).length <= 1024 * 1024, 'Invalid tool input');
    const turn = this.gates.get(token); assert(turn && !turn.finished, 'Permiso fuera de una respuesta en curso');
    if (tool === QUESTION_TOOL) return this.askQuestion(turn, input, toolUseId);
    const decision = permissionDecision({ tool, input, cwd: turn.cwd, mode: turn.mode, ownBranch: turn.ownBranch });
    if (decision.allow || turn.thread.grants?.includes(decision.key)) return { behavior: 'allow', updatedInput: input };
    const part = { type: 'permission', id: randomUUID(), tool: tool.slice(0, 120), detail: toolDetail(input, turn.cwd), reason: decision.reason, key: decision.key, status: 'pending', ...(typeof toolUseId === 'string' ? { toolUseId: toolUseId.slice(0, 200) } : {}) };
    turn.message.parts.push(part); turn.schedule();
    return new Promise(resolve => turn.pending.set(part.id, { part, input, resolve }));
  }
  async requestOpenCodePermission(turn, request) {
    if (turn.finished || turn.stopped) return { behavior: 'deny', message: 'La respuesta se detuvo en Phantom Workspace.' };
    const patterns = Array.isArray(request.patterns) ? request.patterns.filter(p => typeof p === 'string') : [];
    // Keep grants exact: approving /tmp/a must not also approve /tmp/b or a
    // different permission. OpenCode's explicit deny rules still take precedence.
    const key = `OpenCode:${JSON.stringify([request.permission, [...patterns].sort()])}`;
    turn.denied ??= new Set();
    if (turn.denied.has(key)) return { behavior: 'deny', ...(request.child ? {} : { message: 'El usuario rechazó este permiso en Phantom Workspace.' }) };
    if (turn.autoApprove || phantomRequest(request.permission, patterns) || turn.thread.grants?.includes(key)) return { behavior: 'allow' };
    const part = { type: 'permission', id: randomUUID(), tool: String(request.permission).slice(0, 120), detail: patterns.join(', ').slice(0, 240), reason: 'OpenCode solicita tu aprobación', key, status: 'pending', ...(request.tool?.callID ? { toolUseId: request.tool.callID } : {}) };
    turn.message.parts.push(part); turn.schedule();
    const decision = await new Promise(resolve => turn.pending.set(part.id, { part, input: {}, resolve }));
    if (decision.behavior !== 'allow') {
      turn.denied.add(key);
      if (request.child) return { behavior: 'deny' };
    }
    return decision;
  }
  askQuestion(turn, input, toolUseId) {
    const part = { type: 'question', id: randomUUID(), questions: normalizeQuestions(input.questions), status: 'pending', ...(typeof toolUseId === 'string' ? { toolUseId: toolUseId.slice(0, 200) } : {}) };
    turn.message.parts.push(part); turn.schedule();
    return new Promise(resolve => turn.pending.set(part.id, { part, input, resolve }));
  }
  // answers: { [question text]: answer } or null to decline answering.
  answerQuestion(node, requestId, answers) {
    const turn = this.turns.get(node.id), request = turn?.pending.get(requestId);
    assert(request?.part.type === 'question', 'Esa pregunta ya no está pendiente');
    if (answers === null) {
      turn.pending.delete(requestId); request.part.status = 'skipped';
      request.resolve({ behavior: 'deny', message: 'El usuario prefirió no responder en Phantom Workspace. Continúa con tu mejor criterio y dilo explícitamente.' });
    } else {
      assert(answers && typeof answers === 'object' && !Array.isArray(answers), 'Respuestas inválidas');
      const clean = {};
      for (const { question } of request.part.questions) {
        const value = answers[question];
        assert(typeof value === 'string' && value.trim(), 'Responde todas las preguntas');
        text(value, 'answer', 4000); clean[question] = value.trim();
      }
      turn.pending.delete(requestId); request.part.status = 'answered'; request.part.answers = clean;
      request.resolve({ behavior: 'allow', updatedInput: { ...request.input, answers: clean } });
    }
    turn.schedule();
    return { ok: true };
  }
  answerPermission(node, requestId, decision) {
    assert(['allow', 'always', 'deny'].includes(decision), 'Respuesta de permiso inválida');
    const turn = this.turns.get(node.id), request = turn?.pending.get(requestId);
    assert(request?.part.type === 'permission', 'Ese permiso ya no está pendiente');
    const settle = (entry, status) => {
      turn.pending.delete(entry.part.id); entry.part.status = status;
      entry.resolve(status === 'denied' ? { behavior: 'deny', message: 'El usuario rechazó este permiso en Phantom Workspace.' } : { behavior: 'allow', updatedInput: entry.input });
    };
    if (decision === 'always') {
      turn.thread.grants = [...new Set([...(turn.thread.grants || []), request.part.key])].slice(-200);
      for (const entry of [...turn.pending.values()]) if (entry.part.key === request.part.key) settle(entry, entry === request ? 'always' : 'allowed');
    } else settle(request, decision === 'allow' ? 'allowed' : 'denied');
    turn.schedule();
    return { ok: true };
  }
  stop(nodeId) {
    const operation = this.operations.get(nodeId);
    if (operation) { operation.controller.abort(new Error('Operación de contexto cancelada; resultado sin verificar')); return { ok: true }; }
    const turn = this.turns.get(nodeId);
    if (!turn || turn.stopped) return { ok: true };
    turn.stopped = true;
    turn.controller?.abort(new Error('La respuesta se detuvo en Phantom Workspace.'));
    const signal = name => { try { process.kill(-turn.child.pid, name); } catch { try { turn.child.kill(name); } catch { /* Already gone. */ } } };
    signal('SIGTERM'); turn.killTimer = setTimeout(() => signal('SIGKILL'), 1500); turn.killTimer.unref();
    return { ok: true };
  }
  // Start over: the provider session is forgotten here, never deleted there.
  clear(workspace, node) {
    assert(!this.running(node.id), 'Detén la respuesta antes de empezar una conversación nueva');
    const provider = node.data.chat?.provider;
    if (provider && this.nodes[node.id]?.threads?.[provider]) { delete this.nodes[node.id].threads[provider]; this.save(); }
    this.emit({ type: 'chat.update', workspaceId: workspace.id, nodeId: node.id, provider, running: false, reset: true, meta: {}, messages: [] });
    return { ok: true };
  }
  // The project's own conversation with Phantom. It is not a canvas card: its
  // settings live beside its threads and its node is synthesized per call, so
  // it survives any layout change and always works in the project folder.
  static mainId(workspace) { return `phantom:${workspace.id}`; }
  mainNode(workspace) {
    const id = Chats.mainId(workspace), settings = this.nodes[id]?.settings || {};
    return { id, type: 'terminal', title: 'Phantom', data: { main: true, cwd: workspace.canonicalPath, chat: { provider: 'claude', ...settings } } };
  }
  configureMain(workspace, { provider, autoApprove, permissionMode, model, reasoning }) {
    const node = this.mainNode(workspace), patch = permissionPatch({ autoApprove, permissionMode });
    if (provider !== undefined) patch.provider = provider;
    validateChat(patch);
    assert(patch.provider !== null, 'Phantom necesita un agente');
    const policy = this.policy();
    if (patch.provider !== undefined) assertClientAllowed(patch.provider, policy);
    if (model !== undefined || reasoning !== undefined) assertClientAllowed(patch.provider ?? node.data.chat.provider, policy, 'El agente de este chat');
    if (typeof model === 'string') assertClientModel(patch.provider ?? node.data.chat.provider, model, policy, 'chat de Phantom');
    assert(patch.provider === undefined || patch.provider === node.data.chat.provider || !this.running(node.id), 'Detén la respuesta antes de cambiar de agente');
    if (model !== undefined && model !== null) validateModel(model);
    const entry = this.nodes[node.id] ??= { threads: {} }, chat = applyPatch(node.data.chat, patch);
    assert((model === undefined && reasoning === undefined) || !this.running(node.id), 'Detén la respuesta antes de cambiar modelo o effort/variant');
    for (const [field, key] of [['model', 'models'], ['reasoning', 'reasoning']]) {
      const value = field === 'model' ? model : reasoning;
      if (value === undefined) continue;
      const values = { ...chat[key] };
      if (value === null) delete values[chat.provider]; else values[chat.provider] = value;
      chat[key] = values;
    }
    validateChat(chat);
    entry.settings = chat; this.save();
    const next = this.mainNode(workspace);
    this.emit({ type: 'chat.update', workspaceId: workspace.id, nodeId: next.id, provider: chat.provider, running: this.running(next.id), reset: true, meta: {}, messages: [] });
    return this.get(next);
  }
  removeNode(nodeId) { this.stop(nodeId); if (this.nodes[nodeId]) { delete this.nodes[nodeId]; this.save(); } }
  async close() {
    this.closed = true; clearInterval(this.timer);
    for (const nodeId of this.turns.keys()) this.stop(nodeId);
    for (const nodeId of this.operations.keys()) this.stop(nodeId);
    const end = Date.now() + 2500;
    while ((this.turns.size || this.operations.size) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
    this.save();
  }
}
