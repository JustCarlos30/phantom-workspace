import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createHost } from '../host/server.mjs';

// Real host + shipping dist + real HTTP/auth. Only the chat/terminal engines
// are controlled fixtures; visiting this test never starts a shell or model.
const evidence = '/tmp/phantom-mobile-evidence';
await fs.mkdir(evidence, { recursive: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-mobile-browser-'));
let host, browser, clock = Date.now();
const results = [], errors = [], actions = [], terminalInputs = [];
try {
  await fs.mkdir(path.join(root, 'project')); await fs.mkdir(path.join(root, 'other'));
  host = await createHost({ dataDir: path.join(root, 'state'), handleIntegration: () => ({ handled: false }), mobileOptions: { now: () => clock } });
  const w = await host.invoke('workspace.open', { path: path.join(root, 'project') });
  await host.invoke('workspace.update', { id: w.id, patch: { name: 'Proyecto móvil · fixture aislado' } });
  const node = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', title: 'Conversación de prueba', data: { chat: { provider: 'claude' } } });
  const terminalNode = await host.invoke('node.create', { workspaceId: w.id, type: 'terminal', title: 'Terminal existente · fixture' });
  const other = await host.invoke('workspace.open', { path: path.join(root, 'other') });
  await host.invoke('node.create', { workspaceId: other.id, type: 'terminal', title: 'PROYECTO AJENO', data: { chat: { provider: 'claude' } } });
  const permission = { type: 'permission', id: 'fixture-permission', tool: 'Herramienta de prueba', detail: 'Permiso sintético sin ejecución', reason: 'Decisión explícita', status: 'pending' };
  const question = { type: 'question', id: 'fixture-question', status: 'pending', questions: [{ question: '¿Qué opción prefieres?', options: [{ label: 'Primera' }, { label: 'Segunda' }] }] };
  const messages = Array.from({ length: 28 }, (_, i) => ({ id: `history-${i}`, role: i % 2 ? 'assistant' : 'user', status: 'done', parts: [{ type: 'text', text: `Historial sintético ${i}. ` + 'Texto legible en el teléfono. '.repeat(8) }] }));
  messages.push({ id: 'pending', role: 'assistant', status: 'done', parts: [permission, question, { type: 'text', text: 'Fin del historial inicial.' }] });
  host.chats.get = () => ({ provider: 'claude', running: false, messages, queue: [] });
  host.chats.send = async (workspace, current, text) => {
    assert.equal(workspace.id, w.id); assert.equal(current.id, node.id); actions.push(text);
    messages.push({ id: `input-${actions.length}`, role: 'user', status: 'done', parts: [{ type: 'text', text }] }, { id: `reply-${actions.length}`, role: 'assistant', status: 'done', parts: [{ type: 'text', text: `Recibido por fixture: ${text}` }] });
    return { ok: true };
  };
  let permissionAnswers = 0, questionAnswers = 0;
  host.chats.answerPermission = (current, requestId, decision) => { assert.equal(current.id, node.id); assert.equal(requestId, permission.id); assert.equal(decision, 'allow'); permission.status = 'allowed'; permissionAnswers++; };
  host.chats.answerQuestion = (current, requestId, answers) => { assert.equal(current.id, node.id); assert.equal(requestId, question.id); assert.equal(answers['¿Qué opción prefieres?'], 'Primera'); question.status = 'answered'; questionAnswers++; };
  const terminal = { id: 'fixture-terminal', workspaceId: w.id, nodeId: terminalNode.id, status: 'running', createdAt: new Date().toISOString(), snapshot: '', seq: 0 };
  host.terminals.sessions.push(terminal);
  host.terminals.tail = async id => { assert.equal(id, terminal.id); return { status: terminal.status, seq: terminal.seq, lines: ['Salida sintética existente', ...terminalInputs.map(value => `Entrada recibida: ${value.trim()}`)] }; };
  host.terminals.write = (id, data) => { assert.equal(id, terminal.id); terminalInputs.push(data); terminal.seq++; return { ok: true }; };
  host.terminals.stop = id => { assert.equal(id, terminal.id); terminal.status = 'exited'; return { ok: true }; };
  const access = await host.invoke('mobile.start', { workspaceId: w.id, address: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(12000);
  const screenshot = name => page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: true });
  const noOverflow = async () => {
    const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(metrics.scroll <= metrics.width && metrics.body <= metrics.width, JSON.stringify(metrics));
  };
  const pair = async code => {
    await page.getByLabel('Código de emparejamiento').fill(code);
    await page.getByRole('button', { name: 'Emparejar', exact: true }).click();
    await page.getByRole('heading', { name: 'Sesiones', exact: true }).waitFor();
  };
  await page.goto(access.url);
  await page.getByRole('heading', { name: 'Emparejar con tu escritorio' }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.phantom), 'undefined');
  await noOverflow(); await screenshot('01-pairing');
  await pair(access.pairing.code);
  await page.getByRole('heading', { name: node.title, exact: true }).waitFor();
  assert.equal(await page.getByText('PROYECTO AJENO').count(), 0);
  assert.equal(host.terminals.live.size, 0); assert.equal(actions.length, 0);
  await screenshot('02-sessions');
  await page.getByRole('button', { name: 'Abrir conversación · claude' }).last().click();
  await page.getByText('Fin del historial inicial.', { exact: true }).waitFor();
  assert.equal(permissionAnswers, 0); assert.equal(questionAnswers, 0);
  await page.getByRole('button', { name: 'Permitir una vez' }).click();
  await page.getByLabel('¿Qué opción prefieres?').fill('Primera');
  await page.getByRole('button', { name: 'Responder', exact: true }).click();
  assert.equal(permissionAnswers, 1); assert.equal(questionAnswers, 1);
  await page.getByLabel('Mensaje', { exact: true }).fill('Hola desde el teléfono');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.getByText('Recibido por fixture: Hola desde el teléfono', { exact: true }).waitFor();
  assert.deepEqual(actions, ['Hola desde el teléfono']);
  assert.equal(await page.getByText('Hola desde el teléfono', { exact: true }).count(), 1);
  await noOverflow(); await screenshot('03-chat');
  await page.locator('.mobile-thread').evaluate(el => { el.scrollTop = 60; el.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await page.getByRole('button', { name: 'Volver al final' }).waitFor();
  const before = await page.locator('.mobile-thread').evaluate(el => el.scrollTop);
  messages.push({ id: 'background-update', role: 'assistant', status: 'done', parts: [{ type: 'text', text: 'Actualización en segundo plano' }] });
  await page.getByText('Actualización en segundo plano', { exact: true }).waitFor();
  assert.ok(Math.abs(await page.locator('.mobile-thread').evaluate(el => el.scrollTop) - before) <= 2, 'Polling must preserve the reading position');
  await page.getByRole('button', { name: 'Volver al final' }).click();
  results.push('pairing, scoped catalog, explicit prompts, chat send, stable reading scroll');

  // Drop only the response AFTER the real server accepts this action. There
  // must be one write, then only reads when the user explicitly reconnects.
  let dropped = false;
  await page.route('**/api/rpc', async route => {
    const request = route.request().postDataJSON();
    if (request.method === 'chat.send' && !dropped) { dropped = true; const response = await route.fetch({ maxRetries: 0 }); assert.equal(response.status(), 200); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByLabel('Mensaje', { exact: true }).fill('Acuse perdido');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.getByRole('button', { name: 'Reconectar', exact: true }).waitFor();
  assert.equal(actions.filter(text => text === 'Acuse perdido').length, 1);
  await screenshot('04-uncertain-response');
  await page.getByRole('button', { name: 'Reconectar', exact: true }).click();
  await page.getByText('Recibido por fixture: Acuse perdido', { exact: true }).waitFor();
  await page.unroute('**/api/rpc');
  assert.equal(actions.filter(text => text === 'Acuse perdido').length, 1);
  results.push('lost response has no automatic write retry; explicit reconnect reads accepted input');

  await page.getByRole('button', { name: '← Sesiones', exact: true }).click();
  await page.getByRole('button', { name: /Abrir terminal/ }).click();
  await page.getByText('Salida sintética existente', { exact: true }).waitFor();
  assert.equal(terminalInputs.length, 0);
  await page.getByLabel('Entrada de terminal', { exact: true }).fill('entrada explícita');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.mobile-thread pre')?.textContent.includes('Entrada recibida: entrada explícita'));
  assert.deepEqual(terminalInputs, ['entrada explícita\r']);
  await page.waitForTimeout(2200); assert.equal(terminalInputs.length, 1);
  await noOverflow(); await screenshot('05-terminal');
  await page.getByRole('button', { name: 'Parar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.mobile-session header span')?.textContent === 'exited');
  assert.equal(host.terminals.live.size, 0);
  results.push('existing terminal snapshot, explicit input once, explicit stop, no process creation');

  const saved = await page.evaluate(() => ({ token: sessionStorage.getItem('phantom:mobile:bearer'), local: Object.keys(localStorage), url: location.href }));
  assert.match(saved.token, /^[A-Za-z0-9_-]{43}$/); assert.equal(saved.local.length, 0); assert.ok(!saved.url.includes(saved.token));
  const devices = (await host.invoke('mobile.status')).devices;
  await host.invoke('mobile.revoke', { id: devices[0].id });
  await page.getByRole('heading', { name: 'Emparejar con tu escritorio' }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('phantom:mobile:bearer')), null);
  await screenshot('06-revoked');
  const expired = await host.invoke('mobile.pairing'); clock += 120001;
  await page.getByLabel('Código de emparejamiento').fill(expired.code);
  await page.getByRole('button', { name: 'Emparejar', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Código caducado' }).waitFor();
  const fresh = await host.invoke('mobile.pairing'); await pair(fresh.code);
  await page.setViewportSize({ width: 360, height: 800 }); await noOverflow(); await screenshot('07-narrow-repaired');
  await host.invoke('mobile.stop');
  await page.getByRole('button', { name: 'Reconectar', exact: true }).waitFor();
  await screenshot('08-disconnected');
  assert.deepEqual(errors, []);
  results.push('sessionStorage-only bearer, revocation, expiry, re-pair, stop/disconnect, 390px and 360px without overflow');
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify({ results, actions, terminalInputs, errors }, null, 2));
  console.log(JSON.stringify({ results, evidence }, null, 2));
} finally {
  await browser?.close(); await host?.close(); await fs.rm(root, { recursive: true, force: true });
}
