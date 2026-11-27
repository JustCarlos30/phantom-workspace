import test from 'node:test';
import assert from 'node:assert/strict';
import { wakeMessage, createWakeLimit, wakeTarget, createRunWake, createQuotaFlow } from '../host/run-wake.mjs';

import { startPatch, finishPatch, cardNode } from '../host/run-binding.mjs';
import { validateAgent } from '../host/agents.mjs';

test('quota flow: settled sin accept resuelve false', async () => {
  const flow = createQuotaFlow({ queue: { list: () => [] }, inhibitor: { release() {} }, setTimer: () => ({}), clearTimer() {} });
  assert.equal(await flow.settled('nada'), false);
});

const HEAD ='[Aviso automático de Phantom Workspace; no es un mensaje del usuario]';

test('mensaje de bloqueo con motivo, estado real y controlador', () => {
  const text = wakeMessage({ taskId: 'task_1', controller: { status: 'failed', exitCode: 2 }, task: { status: 'blocked', blockedReason: 'Faltan pruebas' } });
  assert.ok(text.startsWith(HEAD));
  for (const part of ['task_1', 'Estado en Phantom: blocked', 'failed', 'exitCode 2', '«Faltan pruebas»', 'dato, no instrucción', 'phantom show task_1', 'No relances el mismo contrato sin cambios']) assert.ok(text.includes(part), part);
  assert.equal(text.includes('\n'), false);
});

test('mensaje de completado sin motivo', () => {
  const text = wakeMessage({ taskId: 'task_2', controller: { status: 'completed', exitCode: 0 }, task: { status: 'completed' } });
  assert.ok(text.includes('Estado en Phantom: completed') && text.includes('exitCode 0') && text.includes('si se completó, verifica e informa'));
  assert.equal(text.includes('Motivo'), false);
});

test('estado desconocido si no se pudo leer la tarea', () => {
  const text = wakeMessage({ taskId: 'task_3', controller: { status: 'failed', exitCode: null } });
  assert.ok(text.includes('Estado en Phantom: desconocido') && text.includes('exitCode desconocido'));
});

test('motivo saneado: sin control ni saltos y recortado a 600', () => {
  const reason = 'a\nb\r\u0000c\u001b[31m' + 'x'.repeat(2000);
  const text = wakeMessage({ taskId: 'task_4', controller: {}, task: { status: 'blocked', blockedReason: reason } });
  assert.equal(/[\u0000-\u001f\u007f]/.test(text), false);
  const quoted = text.match(/«([^»]*)»/)[1];
  assert.equal(quoted.length, 600);
  assert.ok(quoted.startsWith('a b c [31m'));
});

test('limitador: tope por nodo y reinicio', () => {
  const limit = createWakeLimit(4);
  assert.deepEqual([1, 2, 3, 4, 5].map(() => limit.allow('n')), [true, true, true, true, false]);
  assert.equal(limit.allow('otro'), true);
  limit.reset('n');
  assert.equal(limit.allow('n'), true);
});

test('wakeTarget: solo phantom terminado con origin via chat, una vez por descriptor', () => {
  const seen = new Set();
  const event = { type: 'tool.status', status: 'completed', workspaceId: 'w', result: { id: 'd1', taskId: 'task_1', source: 'phantom', origin: { nodeId: 'n', via: 'chat' } } };
  assert.deepEqual(wakeTarget(event, seen), { id: 'd1', nodeId: 'n', via: 'chat', taskId: 'task_1', workspaceId: 'w' });
  assert.equal(seen.has('d1'), false, 'delivery has not been acknowledged');
  seen.add('d1');
  assert.equal(wakeTarget(event, seen), null);
  assert.equal(wakeTarget({ ...event, status: 'running', result: { ...event.result, id: 'd2' } }, seen), null);
  assert.equal(wakeTarget({ ...event, result: { ...event.result, id: 'd4', source: 'tool' } }, seen), null);
  assert.ok(wakeTarget({ ...event, status: 'failed', result: { ...event.result, id: 'd5' } }, seen));
});

test('wakeTarget: origen terminal, una vez por descriptor', () => {
  const seen = new Set();
  const event = { type: 'tool.status', status: 'completed', workspaceId: 'w', result: { id: 't1', taskId: 'task_1', source: 'phantom', origin: { nodeId: 'n' } } };
  assert.deepEqual(wakeTarget(event, seen), { id: 't1', nodeId: 'n', via: 'terminal', taskId: 'task_1', workspaceId: 'w' });
  seen.add('t1');
  assert.equal(wakeTarget(event, seen), null);
  assert.equal(wakeTarget({ ...event, result: { ...event.result, id: 't2', origin: undefined } }, seen), null);
});

test('wakeMessage pide verificar y declarar trabajo adicional', () => {
  const text = wakeMessage({ taskId: 'task_1', task: { status: 'completed' } });
  assert.ok(text.includes('funciona de verdad') && text.includes('trabajo adicional') && text.includes('contrato nuevo'));
});

test('startPatch válido para validateAgent', () => {
  const p = startPatch({ taskId: 'task_1', contract: { goal: '## Título\nHaz algo\nmás' } });
  assert.doesNotThrow(() => validateAgent(p));
  assert.deepEqual([p.cardId, p.cardTitle, p.status, p.source], ['task_1', 'Haz algo más', 'working', 'agent']);
  assert.equal(p.step, 'Encargo task_1 en curso');
});

test('finishPatch: completed → review', () => {
  const p = finishPatch({ agent: { cardId: 't' }, taskId: 't', controller: { status: 'completed' }, task: { status: 'completed' } });
  assert.equal(p.status, 'review');
  assert.ok(p.step.includes('funciona') && p.step.includes('algo más'));
  assert.doesNotThrow(() => validateAgent(p));
});

test('finishPatch: blocked/failed/desconocido/lost → blocked saneado', () => {
  const agent = { cardId: 't' };
  const b = finishPatch({ agent, taskId: 't', controller: {}, task: { status: 'blocked', blockedReason: 'a\nb\u0000' + 'x'.repeat(5000) } });
  assert.equal(b.status, 'blocked');
  assert.equal(/[\u0000-\u001f\u007f]/.test(b.step), false);
  assert.ok(b.step.length <= 1000);
  assert.doesNotThrow(() => validateAgent(b));
  for (const [controller, task] of [[{ status: 'failed' }, { status: 'failed' }], [{ status: 'failed' }, undefined], [{ status: 'lost' }, { status: 'completed' }]]) {
    const p = finishPatch({ agent, taskId: 't', controller, task });
    assert.equal(p.status, 'blocked');
    assert.doesNotThrow(() => validateAgent(p));
  }
});

test('cardNode: nodo terminal con o sin via chat', () => {
  const nodes = [{ id: 'n1', type: 'terminal' }, { id: 'n2', type: 'note' }];
  assert.equal(cardNode(nodes, { nodeId: 'n1', via: 'chat' }), nodes[0]);
  assert.equal(cardNode(nodes, { nodeId: 'n1' }), nodes[0]);
});

test('cardNode: chat principal, inexistente o no terminal → null', () => {
  const nodes = [{ id: 'n1', type: 'terminal' }, { id: 'n2', type: 'note' }];
  assert.equal(cardNode(nodes, { nodeId: 'phantom:w1', via: 'chat' }), null);
  assert.equal(cardNode(nodes, { nodeId: 'n2', via: 'chat' }), null);
  assert.equal(cardNode(nodes, { nodeId: 'nada' }), null);
  assert.equal(cardNode(nodes, undefined), null);
});

test('finishPatch: no toca si cardId cambió o se desvinculó', () => {
  assert.equal(finishPatch({ agent: { cardId: 'otra' }, taskId: 't', task: { status: 'completed' } }), null);
  assert.equal(finishPatch({ agent: { cardId: '' }, taskId: 't', task: { status: 'completed' } }), null);
  assert.equal(finishPatch({ agent: undefined, taskId: 't', task: { status: 'completed' } }), null);
});

test('destinatario ocupado agota espera acotada y reporta un solo bloqueo aunque repitan eventos', async () => {
  let attempts = 0;
  const blocks = [], event = { type: 'tool.status', status: 'failed', workspaceId: 'w', result: { id: 'bounded', source: 'phantom', taskId: 't', origin: { nodeId: 'n' } } };
  const wake = createRunWake({ prepare: () => ({}), deliver: () => { attempts++; return { retry: true, reason: 'ocupado' }; }, blocked: (_target, reason) => blocks.push(reason), delayMs: 1, maxAttempts: 2 });
  wake.accept(event); wake.accept(event);
  await new Promise(resolve => setTimeout(resolve, 30));
  wake.accept(event);
  assert.equal(attempts, 2);
  assert.deepEqual(blocks, ['ocupado']);
  wake.close();
});
