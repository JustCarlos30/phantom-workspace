#!/usr/bin/env node
// Protocol fixture, never calls a model. Used through the real process/HTTP/SSE
// transport so permission UI tests cannot pass by bypassing the adapter.
import http from 'node:http';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

if (process.argv[2] === 'export') { console.log('{}'); process.exit(0); }
if (process.argv[2] !== 'serve') throw new Error('Expected serve');
const clients = new Set(), waiting = new Map();
const emit = event => { for (const client of clients) client.write(`data: ${JSON.stringify(event)}\r\n\r\n`); };
const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`) { res.writeHead(401).end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('directory') !== process.cwd() || process.env.PWD !== process.cwd()) { res.writeHead(400).end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/event') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    clients.add(res); res.write('data: {"type":"server.connected","properties":{}}\r\n\r\n');
    req.on('close', () => clients.delete(res)); return;
  }
  if (url.pathname === '/session' && req.method === 'POST') return json({ id: 'ses_fixture' });
  if (url.pathname === '/session/ses_fixture' && req.method === 'GET') return json({ id: 'ses_fixture' });
  if (url.pathname.startsWith('/permission/')) { waiting.get(url.pathname.split('/')[2])?.(body); return json(true); }
  if (url.pathname.startsWith('/question/')) { waiting.get(url.pathname.split('/')[2])?.(url.pathname.endsWith('/reject') ? { rejected: true } : body); return json(true); }
  if (url.pathname === '/session/ses_fixture/message') {
    const message = body.parts[0].text;
    fs.writeFileSync('transport.json', JSON.stringify({ pid: process.pid, body }));
    if (message === 'crash') process.exit(7);
    const verdicts = [];
    const patterns = message === 'different' ? ['/tmp/other.json'] : ['/tmp/phantom-visual-card.json'];
    // A foreign session's request must never appear in this conversation.
    emit({ type: 'permission.asked', properties: { id: 'foreign', sessionID: 'ses_foreign', permission: 'external_directory', patterns } });
    for (let i = 0; i < (message === 'twice' ? 2 : 1); i++) {
      const id = randomUUID();
      const reply = new Promise(resolve => waiting.set(id, resolve));
      if (message === 'question') emit({ type: 'question.asked', properties: { id, sessionID: 'ses_fixture', questions: [{ question: '¿Cómo continuar?', header: 'Continuar', options: [{ label: 'Revisar', description: 'Inspeccionar primero' }] }] } });
      else emit({ type: 'permission.asked', properties: { id, sessionID: 'ses_fixture', permission: 'external_directory', patterns, metadata: {} } });
      verdicts.push(await reply); waiting.delete(id);
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
