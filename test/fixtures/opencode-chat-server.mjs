#!/usr/bin/env node
// Protocol fixture, never calls a model. Used through the real process/HTTP/SSE
// transport so permission UI tests cannot pass by bypassing the adapter.
import http from 'node:http';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

if (process.argv[2] === 'export') { console.log('{}'); process.exit(0); }
if (process.argv[2] !== 'serve') throw new Error('Expected serve');
const clients = new Set(), waiting = new Map(), pending = new Map();
let scenario, attempts = 0, delivered = 0, connections = 0;
const record = () => fs.writeFileSync('control.json', JSON.stringify({ attempts, delivered, connections }));
const emit = event => { for (const client of clients) client.write(`data: ${JSON.stringify(event)}\r\n\r\n`); };
const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`) { res.writeHead(401).end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('directory') !== process.cwd() || process.env.PWD !== process.cwd()) { res.writeHead(400).end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/event') {
    connections++; record();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    clients.add(res); res.write('data: {"type":"server.connected","properties":{}}\r\n\r\n');
    if (scenario === 'sse-exhausted') res.end();
    req.on('close', () => clients.delete(res)); return;
  }
  if (url.pathname === '/session' && req.method === 'POST') return json({ id: 'ses_fixture' });
  if (url.pathname === '/session/ses_fixture' && req.method === 'GET') return json({ id: 'ses_fixture' });
  if (url.pathname === '/permission' || url.pathname === '/question') {
    const requests = [...pending.values()].filter(p => (url.pathname === '/question') === !!p.questions);
    // Replay alongside catch-up to exercise the live/list request-id dedupe.
    for (const properties of requests) emit({ type: properties.questions ? 'question.asked' : 'permission.asked', properties });
    return json(requests);
  }
  if (url.pathname.startsWith('/permission/') || url.pathname.startsWith('/question/')) {
    attempts++; record();
    if ((scenario.includes('transient') && attempts === 1) || scenario === 'persistent' || scenario === 'cancel-backoff') { res.writeHead(503).end(); return; }
    if (scenario === 'network-transient' && attempts === 2) { req.socket.destroy(); return; }
    const id = url.pathname.split('/')[2];
    delivered++; record();
    waiting.get(id)?.(url.pathname.endsWith('/reject') ? { rejected: true } : body);
    if (scenario === 'gone') { res.writeHead(404).end(); return; }
    return json(true);
  }
  if (url.pathname === '/session/ses_fixture/message') {
    const message = body.parts[0].text;
    scenario = message; attempts = 0; delivered = 0; record();
    fs.writeFileSync('transport.json', JSON.stringify({ pid: process.pid, body }));
    if (message === 'crash') process.exit(7);
    if (message === 'sse-exhausted') { for (const client of clients) client.end(); return; }
    if (['subtask-fail', 'child-abort', 'main-recovered', 'main-failed', 'main-transport-failed'].includes(message)) {
      const child = message === 'subtask-fail' || message === 'child-abort';
      if (child) emit({ type: 'session.created', properties: { info: { id: 'ses_child', parentID: 'ses_fixture' } } });
      const error = { name: message === 'child-abort' ? 'AbortError' : 'APIError', data: { message: 'Bad Gateway' } };
      emit({ type: 'session.error', properties: { sessionID: child ? 'ses_child' : 'ses_fixture', error } });
      await new Promise(resolve => setTimeout(resolve, 10));
      if (message === 'main-transport-failed') { res.writeHead(503).end(); return; }
      const parts = [
        ...(child ? [{ id: randomUUID(), sessionID: 'ses_fixture', type: 'tool', tool: 'task', state: { status: 'error', input: {}, error: 'Subagent failed (task_id: child): Bad Gateway' } }] : []),
        { id: randomUUID(), sessionID: 'ses_fixture', type: 'text', text: 'Respuesta final del agente principal', time: { end: 1 } },
      ];
      for (const part of parts) emit({ type: 'message.part.updated', properties: { part } });
      return json({ info: message === 'main-failed' ? { error: { name: 'APIError', data: { message: 'Final failure' } } } : {}, parts });
    }
    const verdicts = [];
    const patterns = message === 'different' ? ['/tmp/other.json'] : ['/tmp/phantom-visual-card.json'];
    // A foreign session's request must never appear in this conversation.
    emit({ type: 'permission.asked', properties: { id: 'foreign', sessionID: 'ses_foreign', permission: 'external_directory', patterns } });
    if (message === 'child-denied') emit({ type: 'session.created', properties: { info: { id: 'ses_child', parentID: 'ses_fixture' } } });
    for (let i = 0; i < (['twice', 'child-denied', 'main-denied'].includes(message) ? 2 : 1); i++) {
      const id = randomUUID();
      const reply = new Promise(resolve => waiting.set(id, resolve));
      const question = message.includes('question');
      const properties = question ? { id, sessionID: 'ses_fixture', questions: [{ question: '¿Cómo continuar?', header: 'Continuar', options: [{ label: 'Revisar', description: 'Inspeccionar primero' }] }] }
        : { id, sessionID: message === 'child-denied' ? 'ses_child' : 'ses_fixture', permission: 'external_directory', patterns, metadata: {} };
      pending.set(id, properties);
      if (message.startsWith('sse-drop')) {
        // The request exists but its event is lost with the first connection.
        for (const client of clients) client.end();
      } else emit({ type: question ? 'question.asked' : 'permission.asked', properties });
      verdicts.push(await reply); waiting.delete(id); pending.delete(id);
    }
    const parts = [
      { id: randomUUID(), sessionID: 'ses_fixture', type: 'text', text: JSON.stringify(verdicts), time: { end: 1 } },
      { id: randomUUID(), sessionID: 'ses_fixture', type: 'step-finish', cost: .01, tokens: { total: 20, output: 2 } },
    ];
    for (const part of parts) emit({ type: 'message.part.updated', properties: { part } });
    return json({ info: {}, parts });
  }
  res.writeHead(404).end();
});
server.listen(0, '127.0.0.1', () => console.log(`opencode server listening on http://127.0.0.1:${server.address().port}`));
