#!/usr/bin/env node
// Phantom Workspace CLIs as an MCP tool, for agents whose shell sandbox cannot
// reach the app's Unix socket (Codex in read-only counts it as network). MCP
// servers run outside that sandbox; this one runs only Phantom's own CLIs
// under the same rule the permission policy applies to shell commands, so a
// sandboxed agent gets exactly what Claude and OpenCode get — no more.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { phantomCliAllowed } from '../host/chat-permissions.mjs';

export const PHANTOM_MCP_TOOL = 'phantom';
const SCRIPTS = { canvas: 'canvas.mjs', agent: 'agent.mjs', browser: 'workspace-browser.mjs', branches: 'branches.mjs' };
const dir = path.dirname(fileURLToPath(import.meta.url));
const MAX_OUTPUT = 256 * 1024;

const TOOL = {
  name: PHANTOM_MCP_TOOL,
  description: 'Runs a Phantom Workspace CLI and returns its output. Use it for every Phantom Workspace command your instructions give as `node <cli> …` (canvas.mjs, $PHANTOM_AGENT_CLI = agent, $PHANTOM_BROWSER_CLI = browser, branches.mjs status): your shell sandbox cannot reach the app, this tool can. Pass the arguments after the script, one per item, e.g. {"cli":"canvas","args":["list"]}. branches only allows status/help; canvas does not allow --remotion.',
  inputSchema: { type: 'object', properties: { cli: { type: 'string', enum: Object.keys(SCRIPTS) }, args: { type: 'array', items: { type: 'string' } } }, required: ['cli'] },
};

// Codex's read-only sandbox has no network switch, so its shell cannot reach
// the app's socket in any mode for sure. Chat cards (host/chats.mjs) and the
// codex shim of Phantom terminals both hand Codex this server, pre-approved:
// codex exec with approval_policy="never" otherwise rejects every MCP call.
// Codex gives MCP servers a filtered environment, so it travels explicitly.
export const phantomEnv = (env, socket, cwd) => ({ ...Object.fromEntries(Object.entries(env).filter(([key, value]) => key.startsWith('PHANTOM_') && typeof value === 'string')), ...(socket ? { PHANTOM_WORKSPACE_SOCKET: socket } : {}), PHANTOM_MCP_CWD: cwd, PATH: env.PATH || '/usr/bin:/bin', HOME: env.HOME || '' });
export function phantomMcpConfig(env, node = process.execPath) {
  const table = Object.entries(env).filter(([key, value]) => /^[A-Z_][A-Z0-9_]*$/.test(key) && typeof value === 'string').map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ');
  return `mcp_servers.phantom_workspace={ command=${JSON.stringify(node)}, args=[${JSON.stringify(fileURLToPath(import.meta.url))}], env={ ${table} }, default_tools_approval_mode="approve" }`;
}
export const PHANTOM_MCP_HINT = 'Phantom Workspace commands (`node <canvas.mjs|$PHANTOM_AGENT_CLI|$PHANTOM_BROWSER_CLI|branches.mjs> …`) go through the MCP tool phantom_workspace.phantom ({"cli":"canvas|agent|browser|branches","args":[…]}); your shell sandbox cannot reach the app.';

export function runCli({ cli, args = [] } = {}, env = process.env) {
  const name = SCRIPTS[cli];
  if (!name || !Array.isArray(args) || !phantomCliAllowed(name, args)) return Promise.resolve({ isError: true, text: `No permitido por Phantom Workspace: ${cli} ${Array.isArray(args) ? args.join(' ') : ''}`.trim() });
  return new Promise(resolve => execFile(process.execPath, [path.join(dir, name), ...args], { env, cwd: env.PHANTOM_MCP_CWD || process.cwd(), timeout: 120000, maxBuffer: MAX_OUTPUT }, (error, stdout, stderr) => {
    const text = [stdout, stderr].filter(Boolean).join(stdout && stderr ? '\n' : '').slice(0, MAX_OUTPUT) || (error ? error.message : '(sin salida)');
    resolve({ isError: Boolean(error), text });
  }));
}

export function serve({ input = process.stdin, output = process.stdout, env = process.env, run = runCli } = {}) {
  const reply = (id, result, error) => output.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n');
  const handle = async ({ id, method, params = {} }) => {
    if (id === undefined || id === null) return;
    if (method === 'initialize') return reply(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'phantom-workspace', version: '1.0.0' } });
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: [TOOL] });
    if (method === 'tools/call') {
      if (params.name !== PHANTOM_MCP_TOOL) return reply(id, { isError: true, content: [{ type: 'text', text: 'Herramienta desconocida' }] });
      const { isError, text } = await run(params.arguments || {}, env);
      return reply(id, { isError, content: [{ type: 'text', text }] });
    }
    reply(id, undefined, { code: -32601, message: `Method not found: ${method}` });
  };
  let buffer = '';
  input.setEncoding('utf8');
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

// `--codex-config`: the -c value for a codex started in a Phantom terminal.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--codex-config') process.stdout.write(phantomMcpConfig(phantomEnv(process.env, null, process.cwd())));
  else serve();
}
