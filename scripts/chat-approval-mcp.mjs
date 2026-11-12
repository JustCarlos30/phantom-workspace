#!/usr/bin/env node
// Approval gate for chat cards: a minimal MCP stdio server that Claude Code
// calls (--permission-prompt-tool) whenever a tool needs permission. It asks
// the Phantom Workspace host, which decides by policy or asks the user in the
// card, and waits as long as the user takes. Only the host's own turn token is
// accepted, so the gate answers for exactly one running turn.
import net from 'node:net';
import { pathToFileURL } from 'node:url';

export const GATE_TOOL = 'approve';

export function askHost(payload, socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let buffer = '', done = false;
    const finish = (error, value) => { if (done) return; done = true; socket.destroy(); error ? reject(error) : resolve(value); };
    socket.setEncoding('utf8');
    socket.once('error', finish);
    socket.once('connect', () => socket.write(JSON.stringify({ id: 1, method: 'chat.permission.request', payload }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk; let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let row; try { row = JSON.parse(line); } catch (error) { return finish(error); }
        if (row.id === 1) return finish(row.error ? new Error(row.error.message) : null, row.result);
      }
    });
    socket.once('close', () => finish(new Error('Se cerró la conexión con el host')));
  });
}

export function serve({ input = process.stdin, output = process.stdout, env = process.env, ask = askHost } = {}) {
  const reply = (id, result, error) => output.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n');
  const handle = async message => {
    const { id, method, params = {} } = message;
    if (id === undefined || id === null) return; // notifications need no answer
    if (method === 'initialize') return reply(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'phantom-workspace-chat', version: '1.0.0' } });
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: [{ name: GATE_TOOL, description: 'Permission gate of the Phantom Workspace chat card. Called by Claude Code itself; do not call it directly.', inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] } }] });
    if (method === 'tools/call') {
      const args = params.arguments || {};
      let decision;
      if (params.name !== GATE_TOOL) decision = { behavior: 'deny', message: 'Herramienta desconocida' };
      else {
        try { decision = await ask({ token: env.PHANTOM_CHAT_TOKEN, tool_name: args.tool_name, input: args.input ?? {}, tool_use_id: args.tool_use_id }, env.PHANTOM_WORKSPACE_SOCKET); }
        catch (error) { decision = { behavior: 'deny', message: `Phantom Workspace no pudo pedir el permiso: ${error.message}` }; }
      }
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(decision) }] });
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve();
