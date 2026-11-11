import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createPhantomFetch } from '../scripts/phantom-fetch.mjs';

async function server(t, handler) {
  const instance = http.createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(() => new Promise(resolve => {
    instance.close(resolve);
    instance.closeAllConnections();
  }));
  return `http://127.0.0.1:${instance.address().port}/session/test/message`;
}

const localFetch = createPhantomFetch(() => { throw new Error('Unexpected delegation'); });

test('delayed HTTP headers, Request body and streamed Response', { timeout: 5000 }, async t => {
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const url = await server(t, async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['x-test'], 'yes');
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(body, '{"message":"hello"}');
    await delay(100);
    res.writeHead(201, { 'content-type': 'text/plain', 'x-result': 'ok' });
    res.write('first');
    await finished;
    res.end('second');
  });
  const response = await localFetch(new Request(url, {
    method: 'POST', headers: { 'x-test': 'yes' }, body: '{"message":"hello"}',
  }));
  assert.ok(response instanceof Response);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('x-result'), 'ok');
  assert.equal(response.url, url);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
  finish();
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += new TextDecoder().decode(value);
  }
  assert.equal(rest, 'second');
});

test('already aborted signal rejects without making an HTTP request', async t => {
  let calls = 0;
  const url = await server(t, (_req, res) => { calls++; res.end(); });
  const controller = new AbortController();
  const reason = new Error('cancelled before fetch');
  controller.abort(reason);
  await assert.rejects(localFetch(url, { method: 'POST', signal: controller.signal }), error => error === reason);
  assert.equal(calls, 0);
});

test('abort while waiting for headers closes the connection', { timeout: 5000 }, async t => {
  let received;
  let closed;
  const arrived = new Promise(resolve => { received = resolve; });
  const disconnected = new Promise(resolve => { closed = resolve; });
  const url = await server(t, (_req, res) => {
    res.on('close', closed);
    received();
  });
  const controller = new AbortController();
  const pending = localFetch(url, { method: 'POST', signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await arrived;
  controller.abort();
  await rejected;
  await disconnected;
});

test('abort after headers errors the body and closes the connection', { timeout: 5000 }, async t => {
  let closed;
  const disconnected = new Promise(resolve => { closed = resolve; });
  const url = await server(t, (_req, res) => {
    res.on('close', closed);
    res.write('partial');
  });
  const controller = new AbortController();
  const response = await localFetch(url, { method: 'POST', signal: controller.signal });
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'partial');
  const rejected = assert.rejects(reader.read(), { name: 'AbortError' });
  controller.abort();
  await rejected;
  await disconnected;
});

test('abort after a completed body is harmless', async t => {
  const url = await server(t, (_req, res) => res.end('done'));
  const controller = new AbortController();
  const response = await localFetch(url, { method: 'POST', signal: controller.signal });
  assert.equal(await response.text(), 'done');
  controller.abort();
  assert.equal(response.bodyUsed, true);
});

test('other methods, paths, protocols and hosts delegate original arguments unchanged', async () => {
  const calls = [];
  const sentinel = new Response('delegated');
  const fetch = createPhantomFetch((...args) => { calls.push(args); return sentinel; });
  const cases = [
    ['http://127.0.0.1/session/id/message', { method: 'GET' }],
    ['http://localhost/session/id/message', undefined],
    ['http://localhost/session/id/message/extra', { method: 'POST' }],
    ['http://localhost/session/id/messages', { method: 'POST' }],
    ['https://localhost/session/id/message', { method: 'POST' }],
    ['http://example.com/session/id/message', { method: 'POST' }],
    ['http://localhost.example.com/session/id/message', { method: 'POST' }],
    ['http://128.0.0.1/session/id/message', { method: 'POST' }],
    [new Request('http://localhost/session/id/message', { method: 'POST' }), { method: 'PUT' }],
    [new URL('http://localhost/other'), { method: 'POST' }],
    ['invalid URL', { method: 'POST' }],
  ];
  for (const [input, init] of cases) {
    assert.equal(await fetch(input, init), sentinel);
    const args = calls.at(-1);
    assert.equal(args[0], input);
    assert.equal(args[1], init);
  }
  assert.equal(calls.length, cases.length);
});
