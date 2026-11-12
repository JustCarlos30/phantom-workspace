import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicJSON, assert, text } from './store.mjs';
import { permissionDecision } from './chat-permissions.mjs';
import { GATE_TOOL as GATE_NAME } from '../scripts/chat-approval-mcp.mjs';

// Chat cards drive an agent CLI headlessly, one process per turn, and render
// its structured event stream. No PTY is involved: the conversation lives in
// the provider's own session, resumed by ID on every turn.
export const CHAT_PROVIDERS = {
  claude: { label: 'Claude', bin: 'claude', setting: 'claudePath' },
  opencode: { label: 'OpenCode', bin: 'opencode', setting: 'opencodePath' },
};
const MAX_MESSAGES = 400, MAX_PART = 200_000, MAX_OUTPUT = 6000, MAX_LINE = 8 * 1024 * 1024, MAX_TURNS = 16;

// A model is passed to the CLI as an argument: an identifier, never a flag.
export function validateModel(model) {
  assert(typeof model === 'string' && /^[A-Za-z0-9][\w./:@\[\]-]{0,199}$/.test(model), 'Modelo inválido');
  return model;
}
export function validateChat(chat) {
  assert(chat && typeof chat === 'object' && !Array.isArray(chat), 'Invalid chat settings');
  for (const key of Object.keys(chat)) assert(['provider', 'autoApprove', 'models'].includes(key), 'Unknown chat field');
  if (chat.models !== undefined) {
    assert(chat.models && typeof chat.models === 'object' && !Array.isArray(chat.models), 'Invalid chat models');
    for (const [provider, model] of Object.entries(chat.models)) { assert(Object.hasOwn(CHAT_PROVIDERS, provider), 'Unsupported chat provider'); validateModel(model); }
  }
  assert(chat.provider === undefined || chat.provider === null || Object.hasOwn(CHAT_PROVIDERS, chat.provider), 'Unsupported chat provider');
  assert(chat.autoApprove === undefined || typeof chat.autoApprove === 'boolean', 'Invalid chat autoApprove');
  return chat;
}

const realpath = value => { try { return fs.realpathSync(value); } catch { return null; } };
// How a turn handles permissions. 'auto': the agent works freely inside its
// folder and asks before reaching beyond it. 'ask': every change asks. Inside
// the card's own Phantom worktree the default is 'auto'; elsewhere (the
// original checkout, a folder without Git) it is 'ask'. The card's toggle
// overrides either way.
export function chatMode(node, cwd) {
  const chat = node.data?.chat || {};
  if (typeof chat.autoApprove === 'boolean') return chat.autoApprove ? 'auto' : 'ask';
  const tree = node.data?.worktree?.path, here = cwd && realpath(cwd);
  return tree && here && realpath(tree) === here ? 'auto' : 'ask';
}
const GATE_SERVER = 'phantom_workspace_chat';
export const GATE_TOOL = `mcp__${GATE_SERVER}__${GATE_NAME}`;
export function gateConfig({ token, socketPath }) {
  return { mcpServers: { [GATE_SERVER]: { type: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('../scripts/chat-approval-mcp.mjs', import.meta.url))], env: { PHANTOM_CHAT_TOKEN: token, PHANTOM_WORKSPACE_SOCKET: socketPath } } } };
}
// OpenCode's headless run cannot route a question back, so it keeps the
// explicit switch: --auto only when the card says so.
export function providerArgs(provider, { sessionId, mode = 'ask', autoApprove = false, message, cwd, model, gate, instructions }) {
  if (provider === 'claude') return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    ...(instructions ? ['--append-system-prompt', instructions] : []), ...(model ? ['--model', model] : []), ...(sessionId ? ['--resume', sessionId] : []), ...(mode === 'auto' ? ['--permission-mode', 'acceptEdits'] : []),
    ...(gate ? ['--mcp-config', JSON.stringify(gateConfig(gate)), '--permission-prompt-tool', GATE_TOOL] : [])];
  // A leading dash would be parsed as a flag; the space is invisible to the model.
  return ['run', '--format', 'json', ...(cwd ? ['--dir', cwd] : []), ...(model ? ['--model', model] : []), ...(sessionId ? ['--session', sessionId] : []), ...(autoApprove ? ['--auto'] : []), message.startsWith('-') ? ` ${message}` : message];
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
const describeTool = (part, name, input, cwd) => {
  part.detail = toolDetail(input, cwd) || part.detail;
  const diff = toolDiff(name, input); if (diff) part.diff = diff;
};
const sum = (...values) => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
const toolPart = (message, id, name) => {
  let part = message.parts.find(p => p.type === 'tool' && p.id === id);
  if (!part) { part = { type: 'tool', id, name: String(name || 'tool').slice(0, 120), detail: '', status: 'running' }; message.parts.push(part); }
  return part;
};

// Reducers: fold one provider event into the turn. Return true when the
// visible message changed. Sub-agent chatter (parent_tool_use_id) stays hidden.
export function applyClaudeEvent(turn, event) {
  const { message } = turn;
  if (event.session_id && (event.type === 'system' && event.subtype === 'init' || event.type === 'result')) turn.sessionId = event.session_id;
  if (event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string') { turn.model = event.model; return true; }
  if (event.parent_tool_use_id) return false;
  if (event.type === 'stream_event') {
    const e = event.event || {};
    if (e.type === 'message_start' && e.message?.id) turn.streamed.add(e.message.id);
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
    if (usage) turn.contextTokens = sum(usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens, usage.output_tokens);
    for (const block of event.message?.content || []) {
      if (block.type === 'text' && !streamed && block.text) appendText(message, block.text, true);
      if (block.type === 'thinking' && !streamed && block.thinking) appendText(message, block.thinking, true, 'thinking');
      if (block.type === 'tool_use') describeTool(toolPart(message, block.id, block.name), block.name, block.input, turn.cwd);
    }
    return true;
  }
  if (event.type === 'user') {
    let changed = false;
    for (const block of Array.isArray(event.message?.content) ? event.message.content : []) if (block.type === 'tool_result') {
      const part = message.parts.find(p => p.type === 'tool' && p.id === block.tool_use_id);
      if (part) { part.status = block.is_error ? 'error' : 'done'; const output = toolOutput(block.content); if (output) part.output = output; changed = true; }
    }
    return changed;
  }
  if (event.type === 'result') {
    turn.usage = { durationMs: event.duration_ms, costUsd: event.total_cost_usd, outputTokens: event.usage?.output_tokens, steps: event.num_turns };
    const windows = Object.entries(event.modelUsage || {}).map(([model, value]) => [model, value?.contextWindow]).filter(([, value]) => Number.isFinite(value));
    if (windows.length) turn.contextWindow = (windows.find(([model]) => model === turn.model) || windows[0])[1];
    if (event.is_error) turn.error = String(event.result || (event.errors || []).join(' ') || event.subtype || 'El agente terminó con error').slice(0, 2000);
    else if (!message.parts.some(p => p.type === 'text') && typeof event.result === 'string' && event.result) appendText(message, event.result, true);
    return true;
  }
  return false;
}

export function applyOpenCodeEvent(turn, event) {
  const { message } = turn, part = event.part || {};
  if (typeof event.sessionID === 'string') turn.sessionId = event.sessionID;
  if (event.type === 'text' && part.text) { appendText(message, part.text, true); return true; }
  if (event.type === 'tool_use') {
    const tool = toolPart(message, part.callID || part.id, part.tool), state = part.state || {};
    describeTool(tool, part.tool, state.input, turn.cwd); tool.detail ||= String(state.title || '').slice(0, 240);
    tool.status = state.status === 'completed' ? 'done' : state.status === 'error' ? 'error' : 'running';
    const output = toolOutput(state.output ?? state.error); if (output) tool.output = output;
    return true;
  }
  if (event.type === 'step_finish') {
    const tokens = part.tokens || {};
    if (Number.isFinite(tokens.total)) turn.contextTokens = tokens.total;
    turn.usage = { costUsd: sum(turn.usage?.costUsd, part.cost), outputTokens: sum(turn.usage?.outputTokens, tokens.output, tokens.reasoning), steps: sum(turn.usage?.steps, 1) };
    return true;
  }
  if (event.type === 'error') {
    turn.error = String(event.error?.data?.message || event.error?.message || event.error?.name || 'OpenCode terminó con error').slice(0, 2000);
    return true;
  }
  return false;
}

export class Chats {
  // role(workspace, node) → { env, instructions }: the card's identity under Incorporaciones.
  constructor(store, emit, role = () => ({ env: {}, instructions: '' })) {
    this.store = store; this.emit = emit; this.role = role; this.turns = new Map(); this.dirty = false; this.closed = false;
    this.filename = path.join(store.dir, 'chats.json');
    this.nodes = {};
    try { if (fs.existsSync(this.filename)) this.nodes = JSON.parse(fs.readFileSync(this.filename, 'utf8')); } catch { this.nodes = {}; }
    // A turn cannot outlive the host: whatever was streaming was interrupted.
    for (const entry of Object.values(this.nodes)) for (const thread of Object.values(entry.threads || {})) for (const message of thread.messages || []) {
      if (message.status === 'streaming') message.status = 'stopped';
      for (const part of message.parts || []) {
        if (part.type === 'tool' && part.status === 'running') part.status = 'stopped';
        if (part.type === 'permission' && part.status === 'pending') part.status = 'cancelled';
      }
    }
    this.gates = new Map();
    this.timer = setInterval(() => { if (this.dirty) this.save(); }, 2000); this.timer.unref();
  }
  save() { this.dirty = false; atomicJSON(this.filename, this.nodes); }
  thread(nodeId, provider) {
    const entry = this.nodes[nodeId] ??= { threads: {} };
    return entry.threads[provider] ??= { sessionId: null, messages: [] };
  }
  running(nodeId) { return this.turns.has(nodeId); }
  get(node) {
    const provider = node.data.chat?.provider ?? null, thread = provider ? this.nodes[node.id]?.threads?.[provider] : null;
    let cwd = node.data.cwd; try { assert(cwd && fs.statSync(cwd).isDirectory()); } catch { cwd = null; }
    return { provider, autoApprove: !!node.data.chat?.autoApprove, mode: chatMode(node, cwd), model: (provider && node.data.chat?.models?.[provider]) || null, running: this.running(node.id), sessionId: thread?.sessionId ?? null, meta: thread?.meta ?? {}, messages: thread?.messages ?? [] };
  }
  send(workspace, node, message) {
    assert(!this.closed, 'Host is shutting down');
    const provider = node.data.chat?.provider; assert(Object.hasOwn(CHAT_PROVIDERS, provider ?? ''), 'Elige Claude u OpenCode antes de escribir');
    text(message, 'chat message', 64 * 1024); assert(message.trim(), 'Escribe un mensaje');
    assert(!this.turns.has(node.id), 'El agente todavía está respondiendo');
    assert(this.turns.size < MAX_TURNS, 'Demasiados agentes respondiendo a la vez');
    const definition = CHAT_PROVIDERS[provider], thread = this.thread(node.id, provider), now = () => new Date().toISOString();
    let cwd = node.data.cwd; try { assert(cwd && fs.statSync(cwd).isDirectory()); } catch { cwd = workspace.canonicalPath; }
    const user = { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: message }], status: 'done', createdAt: now() };
    const reply = { id: randomUUID(), role: 'assistant', provider, parts: [], status: 'streaming', createdAt: now() };
    thread.messages.push(user, reply);
    if (thread.messages.length > MAX_MESSAGES) thread.messages.splice(0, thread.messages.length - MAX_MESSAGES);
    const turn = { message: reply, sessionId: thread.sessionId, streamed: new Set(), freshText: true, cwd, mode: chatMode(node, cwd), thread, pending: new Map(), token: provider === 'claude' ? randomUUID() : null, error: '', stderr: '', stopped: false, finished: false, timer: null };
    const started = Date.now();
    // Session facts as known right now: the turn's own readings over the thread's.
    const meta = () => ({ ...thread.meta, ...(turn.model ? { model: turn.model } : {}), ...(turn.contextTokens ? { contextTokens: turn.contextTokens } : {}), ...(turn.contextWindow ? { contextWindow: turn.contextWindow } : {}) });
    const publish = extra => this.emit({ type: 'chat.update', workspaceId: workspace.id, nodeId: node.id, provider, running: this.turns.has(node.id), meta: meta(), messages: [structuredClone(reply)], ...extra });
    const schedule = () => { this.dirty = true; turn.timer ??= setTimeout(() => { turn.timer = null; publish(); }, 40); };
    turn.schedule = schedule;
    const apply = provider === 'claude' ? applyClaudeEvent : applyOpenCodeEvent;
    const finish = (code, failure) => {
      if (turn.finished) return; turn.finished = true;
      clearTimeout(turn.timer); clearTimeout(turn.killTimer); this.turns.delete(node.id);
      if (turn.token) this.gates.delete(turn.token);
      // Nobody is left to answer: whatever was still asking is refused.
      for (const request of turn.pending.values()) { request.part.status = 'cancelled'; request.resolve({ behavior: 'deny', message: 'La respuesta terminó antes de aprobar el permiso.' }); }
      turn.pending.clear();
      if (turn.sessionId) thread.sessionId = turn.sessionId;
      const error = failure || turn.error || (!turn.stopped && code ? turn.stderr.trim().split('\n').slice(-6).join('\n').slice(-1500) || `${definition.label} terminó con código ${code}` : '');
      for (const part of reply.parts) if (part.type === 'tool' && part.status === 'running') part.status = 'stopped';
      reply.status = turn.stopped ? 'stopped' : error ? 'error' : 'done';
      if (error && !turn.stopped) reply.error = error;
      reply.finishedAt = now();
      if (turn.model) reply.model = turn.model;
      reply.usage = { durationMs: Number.isFinite(turn.usage?.durationMs) ? turn.usage.durationMs : Date.now() - started, ...(Number.isFinite(turn.usage?.costUsd) ? { costUsd: turn.usage.costUsd } : {}), ...(turn.usage?.outputTokens ? { outputTokens: turn.usage.outputTokens } : {}) };
      thread.meta = { ...meta(), costUsd: sum(thread.meta?.costUsd, turn.usage?.costUsd), turns: sum(thread.meta?.turns, 1) };
      this.save(); publish({ running: false });
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
    let child;
    try {
      // Own process group: stopping a turn must also stop the tools it launched.
      if (turn.token) this.gates.set(turn.token, turn);
      const role = this.role(workspace, node);
      child = spawn(bin, providerArgs(provider, { sessionId: thread.sessionId, mode: turn.mode, autoApprove: node.data.chat.autoApprove === true, message, cwd, model: node.data.chat.models?.[provider], gate: turn.token ? { token: turn.token, socketPath: path.join(this.store.dir, 'host.sock') } : null, instructions: role.instructions }),
        // OpenCode trusts PWD over the real working directory; keep both in step.
        // A permission waits for the user as long as it takes.
        { cwd, env: { ...process.env, PWD: cwd, ...role.env, ...(turn.token ? { MCP_TOOL_TIMEOUT: String(24 * 3600 * 1000) } : {}) }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    } catch (error) { if (turn.token) this.gates.delete(turn.token); thread.messages.splice(thread.messages.indexOf(user), 2); throw error; }
    turn.child = child; this.turns.set(node.id, turn);
    child.on('error', error => finish(null, error.code === 'ENOENT' ? `No se encontró «${bin}». Instálalo o define settings.${definition.setting} con su ruta.` : error.message));
    child.stdin.on('error', () => {});
    // Claude reads the prompt from stdin, so any text is safe from flag parsing.
    child.stdin.end(provider === 'claude' ? message : '');
    let buffer = '';
    const line = raw => { if (!raw.trim()) return; let event; try { event = JSON.parse(raw); } catch { return; } if (event && typeof event === 'object' && apply(turn, event)) schedule(); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk; let index;
      while ((index = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
      if (buffer.length > MAX_LINE) buffer = '';
    });
    child.stderr.on('data', chunk => { turn.stderr = (turn.stderr + chunk).slice(-8000); });
    child.on('close', code => { line(buffer); buffer = ''; finish(code); });
    this.dirty = true;
    this.emit({ type: 'chat.update', workspaceId: workspace.id, nodeId: node.id, provider, running: true, meta: meta(), messages: [structuredClone(user), structuredClone(reply)] });
    return { ok: true, messageId: reply.id };
  }
  // Models the selected provider can run. Claude takes aliases for its latest
  // models (any full model name is also valid); OpenCode lists its own catalog.
  async models(node) {
    const provider = node.data.chat?.provider; assert(Object.hasOwn(CHAT_PROVIDERS, provider ?? ''), 'Elige Claude u OpenCode primero');
    if (provider === 'claude') return { provider, items: ['fable', 'opus', 'sonnet', 'haiku'].map(id => ({ id, group: 'Alias del modelo más reciente' })) };
    const cached = this.catalog;
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
    const bin = this.store.state.settings[CHAT_PROVIDERS.opencode.setting] || CHAT_PROVIDERS.opencode.bin;
    const stdout = await new Promise((resolve, reject) => execFile(bin, ['models'], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (error, out) => error ? reject(new Error(error.code === 'ENOENT' ? `No se encontró «${bin}»` : `OpenCode no pudo listar sus modelos: ${error.message.split('\n')[0]}`)) : resolve(out)));
    const items = stdout.split('\n').map(line => line.trim()).filter(line => /^[A-Za-z0-9][\w./:@\[\]-]{0,199}$/.test(line) && line.includes('/')).slice(0, 2000).map(id => ({ id, group: id.slice(0, id.indexOf('/')) }));
    const value = { provider, items }; this.catalog = { at: Date.now(), value };
    return value;
  }
  // From the approval gate of a running Claude turn. Resolves when policy or
  // the user decides; the promise is the gate's answer.
  requestPermission({ token, tool_name: tool, input = {}, tool_use_id: toolUseId } = {}) {
    text(token, 'permission token', 128); text(tool, 'tool name', 200);
    assert(input && typeof input === 'object' && !Array.isArray(input) && JSON.stringify(input).length <= 1024 * 1024, 'Invalid tool input');
    const turn = this.gates.get(token); assert(turn && !turn.finished, 'Permiso fuera de una respuesta en curso');
    const decision = permissionDecision({ tool, input, cwd: turn.cwd, mode: turn.mode });
    if (decision.allow || turn.thread.grants?.includes(decision.key)) return { behavior: 'allow', updatedInput: input };
    const part = { type: 'permission', id: randomUUID(), tool: tool.slice(0, 120), detail: toolDetail(input, turn.cwd), reason: decision.reason, key: decision.key, status: 'pending', ...(typeof toolUseId === 'string' ? { toolUseId: toolUseId.slice(0, 200) } : {}) };
    turn.message.parts.push(part); turn.schedule();
    return new Promise(resolve => turn.pending.set(part.id, { part, input, resolve }));
  }
  answerPermission(node, requestId, decision) {
    assert(['allow', 'always', 'deny'].includes(decision), 'Respuesta de permiso inválida');
    const turn = this.turns.get(node.id), request = turn?.pending.get(requestId);
    assert(request, 'Ese permiso ya no está pendiente');
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
    const turn = this.turns.get(nodeId);
    if (!turn || turn.stopped) return { ok: true };
    turn.stopped = true;
    const signal = name => { try { process.kill(-turn.child.pid, name); } catch { try { turn.child.kill(name); } catch { /* Already gone. */ } } };
    signal('SIGTERM'); turn.killTimer = setTimeout(() => signal('SIGKILL'), 1500); turn.killTimer.unref();
    return { ok: true };
  }
  // Start over: the provider session is forgotten here, never deleted there.
  clear(workspace, node) {
    assert(!this.turns.has(node.id), 'Detén la respuesta antes de empezar una conversación nueva');
    const provider = node.data.chat?.provider;
    if (provider && this.nodes[node.id]?.threads?.[provider]) { delete this.nodes[node.id].threads[provider]; this.save(); }
    this.emit({ type: 'chat.update', workspaceId: workspace.id, nodeId: node.id, provider, running: false, reset: true, meta: {}, messages: [] });
    return { ok: true };
  }
  removeNode(nodeId) { this.stop(nodeId); if (this.nodes[nodeId]) { delete this.nodes[nodeId]; this.save(); } }
  async close() {
    this.closed = true; clearInterval(this.timer);
    for (const nodeId of this.turns.keys()) this.stop(nodeId);
    const end = Date.now() + 2500;
    while (this.turns.size && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
    this.save();
  }
}
