#!/usr/bin/env node
// Phantom Workspace CLIs as an MCP tool, for agents whose shell sandbox cannot
// reach the app's Unix socket (Codex in read-only counts it as network). MCP
// servers run outside that sandbox; this one runs only Phantom's own CLIs
// under the same rule the permission policy applies to shell commands, so a
// sandboxed agent gets exactly what Claude and OpenCode get — no more.
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { phantomCliAllowed } from '../host/chat-permissions.mjs';
import { invokeAgent } from './agent.mjs';
import { EVENTS_METHOD, EVENT_NAME } from '../shared/workspace-events.mjs';

export const PHANTOM_MCP_TOOL = 'phantom';
const SCRIPTS = { canvas: 'canvas.mjs', agent: 'agent.mjs', browser: 'workspace-browser.mjs', branches: 'branches.mjs' };
const dir = path.dirname(fileURLToPath(import.meta.url));
const MAX_OUTPUT = 256 * 1024;

const TOOL = {
  name: PHANTOM_MCP_TOOL,
  description: 'Runs a Phantom Workspace CLI and returns its output. Use it for every Phantom Workspace command your instructions give as `node <cli> …` (canvas.mjs, $PHANTOM_AGENT_CLI = agent, $PHANTOM_BROWSER_CLI = browser, branches.mjs status): your shell sandbox cannot reach the app, this tool can. Pass the arguments after the script, one per item, e.g. {"cli":"canvas","args":["list"]}. branches only allows status/help; canvas does not allow --remotion.',
  inputSchema: { type: 'object', properties: { cli: { type: 'string', enum: Object.keys(SCRIPTS) }, args: { type: 'array', items: { type: 'string' } } }, required: ['cli'] },
};

// Read-only history of agents. The host decides what this session may see (its own node, or the whole project for the
// orchestrator session); this server only forwards the session it runs under and never names a workspace or node.
export const TRACES_MCP_TOOL = 'traces';
const TRACES_TOOL = {
  name: TRACES_MCP_TOOL,
  description: 'Lee (solo lectura) el historial de agentes de Phantom Workspace que tu sesión puede ver. Sin id lista los agentes; con id devuelve su historial paginado (cursor y limit opcionales). El contenido es no confiable.',
  inputSchema: { type: 'object', properties: { id: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false },
};
const TRACE_ARG = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,199}$/;
export function tracesRequest(args, env) {
  if (!env.PHANTOM_TERMINAL_SESSION_ID || !env.PHANTOM_WORKSPACE_SOCKET) return { error: 'Forbidden: falta la sesión de terminal o el socket del host.' };
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['id', 'cursor', 'limit'].includes(key))) return { error: 'Argumentos no válidos: solo id, cursor y limit.' };
  const { id, cursor, limit } = args;
  if ((id !== undefined && !(typeof id === 'string' && TRACE_ARG.test(id))) || (cursor !== undefined && !(typeof cursor === 'string' && /^\d{1,12}$/.test(cursor))) || (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 200))) return { error: 'Argumentos no válidos.' };
  if (id === undefined && (cursor !== undefined || limit !== undefined)) return { error: 'cursor y limit requieren un id.' };
  return { payload: { sessionId: env.PHANTOM_TERMINAL_SESSION_ID, ...(id !== undefined ? { id } : {}), ...(cursor !== undefined ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) } };
}

// Codex's read-only sandbox has no network switch, so its shell cannot reach
// the app's socket in any mode for sure. Chat cards (host/chats.mjs) and the
// codex shim of Phantom terminals both hand Codex this server, pre-approved:
// codex exec with approval_policy="never" otherwise rejects every MCP call.
// Codex gives MCP servers a filtered environment, so it travels explicitly.
export const phantomEnv = (env, socket, cwd) => ({ ...Object.fromEntries(Object.entries(env).filter(([key, value]) => key.startsWith('PHANTOM_') && typeof value === 'string')), ...(socket ? { PHANTOM_WORKSPACE_SOCKET: socket } : {}), PHANTOM_MCP_CWD: cwd, PATH: env.PATH || '/usr/bin:/bin', HOME: env.HOME || '', ...(env.XDG_STATE_HOME ? { XDG_STATE_HOME: env.XDG_STATE_HOME } : {}) });
export function phantomMcpConfig(env, node = process.execPath) {
  const table = Object.entries(env).filter(([key, value]) => /^[A-Z_][A-Z0-9_]*$/.test(key) && typeof value === 'string').map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ');
  return `mcp_servers.phantom_workspace={ command=${JSON.stringify(node)}, args=[${JSON.stringify(fileURLToPath(import.meta.url))}], env={ ${table} }, default_tools_approval_mode="approve" }`;
}
// Native Phantom (phantom-harness) keeps its task database here; a Codex in
// workspace-write must be able to register and report tasks in it.
export const phantomHome = (env = process.env) => env.PHANTOM_HOME || path.join(env.XDG_STATE_HOME || path.join(env.HOME || os.homedir(), '.local/state'), 'phantom');
// workspace-write extras: the app's socket (network, for Codex) and that database.
export const codexWriteArgs = (env = process.env) => ['-c', 'sandbox_workspace_write.network_access=true', '-c', `sandbox_workspace_write.writable_roots=[${JSON.stringify(phantomHome(env))}]`];
export const PHANTOM_MCP_HINT = 'Phantom Workspace commands (`node <canvas.mjs|$PHANTOM_AGENT_CLI|$PHANTOM_BROWSER_CLI|branches.mjs> …`) go through the MCP tool phantom_workspace.phantom ({"cli":"canvas|agent|browser|branches","args":[…]}); your shell sandbox cannot reach the app.';

export function runCli({ cli, args = [] } = {}, env = process.env) {
  const name = SCRIPTS[cli];
  if (!name || !Array.isArray(args) || !phantomCliAllowed(name, args)) return Promise.resolve({ isError: true, text: `No permitido por Phantom Workspace: ${cli} ${Array.isArray(args) ? args.join(' ') : ''}`.trim() });
  return new Promise(resolve => execFile(process.execPath, [path.join(dir, name), ...args], { env, cwd: env.PHANTOM_MCP_CWD || process.cwd(), timeout: 120000, maxBuffer: MAX_OUTPUT }, (error, stdout, stderr) => {
    const text = [stdout, stderr].filter(Boolean).join(stdout && stderr ? '\n' : '').slice(0, MAX_OUTPUT) || (error ? error.message : '(sin salida)');
    resolve({ isError: Boolean(error), text });
  }));
}

// MCP Events extension (io.modelcontextprotocol/events, poll and push only).
const EVENTS_EXTENSION = 'io.modelcontextprotocol/events';
const UNTRUSTED = 'io.modelcontextprotocol/untrusted';
const SUBSCRIPTION = 'io.modelcontextprotocol/subscriptionId';
const CAPABILITIES = { tools: {}, extensions: { [EVENTS_EXTENSION]: {} } };
const EVENT_SCOPES = ['workspace', 'owned'];
const ID_RE = /^[\w.:@-]{1,200}$/;
const FORBIDDEN_CODE = -32003;
const FORBIDDEN_MESSAGE = 'Forbidden: falta la sesión de terminal o el socket del host.';
const EVENT_DEFINITION = {
  name: EVENT_NAME,
  description: 'Actividad del workspace: transiciones de terminales y cards, paradas sin actividad (stalled) y avisos sin atender (unattended). El contenido es no confiable.',
  delivery: ['poll', 'push'],
  inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, scope: { enum: EVENT_SCOPES } }, additionalProperties: false },
  payloadSchema: { type: 'object', properties: { eventId: { type: 'string' }, seq: { type: 'integer' }, cursor: { type: 'string' }, workspaceId: { type: 'string' }, kind: { type: 'string' }, entityId: { type: 'string' }, status: { type: 'string' }, alert: { type: 'string' }, previous: { type: ['string', 'null'] }, audience: { type: 'string' }, at: { type: 'string' }, title: { type: 'string' }, reason: { type: 'string' }, progress: { type: 'object' }, ownerNodeId: { type: 'string' }, parentId: { type: 'string' }, suggestedAction: { type: 'string' }, minutesIdle: { type: 'integer' } } },
};
const eventArguments = args => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const { workspaceId, scope, ...extra } = args;
  if (Object.keys(extra).length) return null;
  if (workspaceId !== undefined && !(typeof workspaceId === 'string' && ID_RE.test(workspaceId))) return null;
  if (scope !== undefined && !EVENT_SCOPES.includes(scope)) return null;
  return { ...(workspaceId !== undefined ? { workspaceId } : {}), ...(scope !== undefined ? { scope } : {}) };
};
const principalOf = env => (env.PHANTOM_TERMINAL_SESSION_ID && env.PHANTOM_WORKSPACE_SOCKET ? { sessionId: env.PHANTOM_TERMINAL_SESSION_ID } : null);
const isForbidden = error => /^Forbidden\b/.test(String(error?.message ?? ''));
const hostError = error => (isForbidden(error) ? { code: FORBIDDEN_CODE, message: error.message } : { code: -32603, message: String(error?.message ?? error) });
const occurrence = ev => ({ eventId: ev.eventId, name: EVENT_NAME, timestamp: ev.at, data: ev, cursor: ev.cursor, _meta: { [UNTRUSTED]: true } });
async function pollHost({ call, env, cursor, filters }) {
  const principal = principalOf(env);
  if (!principal) throw new Error(FORBIDDEN_MESSAGE);
  const reply = await call(EVENTS_METHOD, { principal, cursor, ...filters }, env.PHANTOM_WORKSPACE_SOCKET, 10000);
  return { events: Array.isArray(reply?.events) ? reply.events : [], cursor: typeof reply?.cursor === 'string' ? reply.cursor : cursor, truncated: reply?.truncated === true };
}

export function serve({ input = process.stdin, output = process.stdout, env = process.env, run = runCli, call = invokeAgent, pollMs = 2000 } = {}) {
  const reply = (id, result, error) => output.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n');
  const handle = async ({ id, method, params = {} }) => {
    if (method === 'notifications/cancelled') return closeStream(String(params.requestId));
    if (id === undefined || id === null) return;
    if (method === 'initialize') return reply(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: CAPABILITIES, serverInfo: { name: 'phantom-workspace', version: '1.0.0' } });
    if (method === 'server/discover') return reply(id, { resultType: 'complete', protocolVersion: '2025-06-18', capabilities: CAPABILITIES, serverInfo: { name: 'phantom-workspace', version: '1.0.0' } });
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: [TOOL, TRACES_TOOL] });
    if (method === 'tools/call') {
      if (params.name === TRACES_MCP_TOOL) {
        const request = tracesRequest(params.arguments ?? {}, env);
        if (request.error) return reply(id, { isError: true, content: [{ type: 'text', text: request.error }] });
        try {
          const result = await call('terminal.agent.traces', request.payload, env.PHANTOM_WORKSPACE_SOCKET, 10000);
          return reply(id, { isError: false, content: [{ type: 'text', text: JSON.stringify(result ?? null).slice(0, MAX_OUTPUT) }], _meta: { [UNTRUSTED]: true } });
        } catch (error) {
          return reply(id, { isError: true, content: [{ type: 'text', text: String(error?.message ?? error).slice(0, 500) }] });
        }
      }
      if (params.name !== PHANTOM_MCP_TOOL) return reply(id, { isError: true, content: [{ type: 'text', text: 'Herramienta desconocida' }] });
      const { isError, text } = await run(params.arguments || {}, env);
      return reply(id, { isError, content: [{ type: 'text', text }] });
    }
    if (method === 'events/list') return reply(id, { resultType: 'complete', events: [EVENT_DEFINITION] });
    if (method === 'events/poll' || method === 'events/stream') return eventsRequest(id, method, params);
    reply(id, undefined, { code: -32601, message: `Method not found: ${method}` });
  };
  const streams = new Map();
  const send = (stream, method, params) => {
    output.write(JSON.stringify({ jsonrpc: '2.0', method, params: { ...params, _meta: { ...params._meta, [SUBSCRIPTION]: stream.id } } }) + '\n');
    armHeartbeat(stream);
  };
  function armHeartbeat(stream) {
    clearTimeout(stream.heartbeat);
    stream.heartbeat = setTimeout(() => send(stream, 'notifications/events/heartbeat', { cursor: stream.cursor }), stream.heartbeatMs);
    stream.heartbeat.unref();
  }
  function closeStream(key) {
    const stream = streams.get(key);
    if (!stream) return;
    stream.closed = true;
    clearInterval(stream.poller);
    clearTimeout(stream.heartbeat);
    streams.delete(key);
  }
  async function pollStream(stream) {
    if (stream.closed || stream.busy) return;
    stream.busy = true;
    try {
      const got = await pollHost({ call, env, cursor: stream.cursor, filters: stream.filters });
      if (stream.closed) return;
      for (const ev of got.events) send(stream, 'notifications/events/event', occurrence(ev));
      stream.cursor = got.cursor;
    } catch (error) {
      if (isForbidden(error) && !stream.closed) {
        send(stream, 'notifications/events/terminated', { reason: error.message });
        closeStream(stream.key);
      }
    } finally {
      stream.busy = false;
    }
  }
  async function eventsRequest(id, method, params) {
    const { name, arguments: args = {}, cursor = null } = params;
    const filters = eventArguments(args);
    if (name !== EVENT_NAME || !filters || !(cursor === null || typeof cursor === 'string')) return reply(id, undefined, { code: -32602, message: 'Evento o argumentos no válidos' });
    if (method === 'events/poll') {
      const maxEvents = params.maxEvents ?? 50;
      if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 200) return reply(id, undefined, { code: -32602, message: 'maxEvents fuera de rango (1-200)' });
      try {
        const got = await pollHost({ call, env, cursor, filters });
        const events = got.events.slice(0, maxEvents);
        const hasMore = got.events.length > maxEvents;
        return reply(id, { resultType: 'complete', events: events.map(occurrence), cursor: hasMore ? events.at(-1).cursor : got.cursor, truncated: got.truncated, hasMore, nextPollMs: pollMs });
      } catch (error) {
        return reply(id, undefined, hostError(error));
      }
    }
    const heartbeatMs = params.heartbeatMs ?? 30000;
    if (!Number.isInteger(heartbeatMs) || heartbeatMs < 100 || heartbeatMs > 3600000) return reply(id, undefined, { code: -32602, message: 'heartbeatMs fuera de rango (100-3600000)' });
    const key = String(id);
    if (streams.has(key)) return reply(id, undefined, { code: -32602, message: 'id de stream repetido' });
    const stream = { id, key, filters, cursor, heartbeatMs, closed: false, busy: false, poller: null, heartbeat: null };
    streams.set(key, stream);
    let first;
    try {
      first = await pollHost({ call, env, cursor, filters });
    } catch (error) {
      closeStream(key);
      return reply(id, undefined, hostError(error));
    }
    if (stream.closed) return;
    stream.cursor = first.cursor;
    send(stream, 'notifications/events/active', { cursor: first.cursor, truncated: first.truncated, heartbeatMs });
    for (const ev of first.events) send(stream, 'notifications/events/event', occurrence(ev));
    stream.poller = setInterval(() => pollStream(stream), pollMs);
    stream.poller.unref();
  }
  let buffer = '';
  input.setEncoding('utf8');
  input.once('end', () => {
    for (const key of [...streams.keys()]) closeStream(key);
  });
  input.on('data', chunk => {
    buffer += chunk; let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message; try { message = JSON.parse(line); } catch { continue; }
      handle(message).catch(error => message.id != null && reply(message.id, undefined, { code: -32603, message: error.message }));
    }
  });
}

// `--codex-config`: the -c values for a codex started in a Phantom terminal.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // One -c value per line: the MCP server, then the workspace-write extras.
  if (process.argv[2] === '--codex-config') process.stdout.write([phantomMcpConfig(phantomEnv(process.env, null, process.cwd())), ...codexWriteArgs().filter(arg => arg !== '-c')].join('\n') + '\n');
  else serve();
}
