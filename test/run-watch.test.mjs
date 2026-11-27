import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRunHealth } from '../integrations/run-health.mjs';
import { buildRun, stepLine, noticeMessage, createNoticeLimit, createRunWatch, NOTICE_HEAD, NOTICE_STALL_MS, amendNotice, AMEND_STEP } from '../host/run-watch.mjs';
import { createRunWake, wakeMessage } from '../host/run-wake.mjs';
import { finishPatch } from '../host/run-binding.mjs';
import { validateAgent } from '../host/agents.mjs';

const start = Date.parse('2026-11-23T10:00:00.000Z');
const ev = (seconds, type, data = {}) => ({ at: new Date(start + seconds * 1000).toISOString(), type, data, run_id: 'run' });
const act = (s, id, tool, filePath) => ev(s, 'action.intended', { callID: id, tool, args: { filePath } });

const repairing = [
  ev(0, 'run.started'), ev(1, 'task.running'), act(2, 'a', 'edit', 'src/chat.css'), ev(3, 'action.observed', { callID: 'a' }),
  ev(10, 'task.verifying'), ev(11, 'process.intended', { kind: 'check', id: 'tests', command: 'tests' }), ev(20, 'process.exited', { id: 'tests', exitCode: 1 }),
  ev(21, 'verification.recorded', { ok: false }), ev(30, 'task.running'), act(31, 'b', 'edit', 'src/chat.css'),
];

test('fases: agente, checks, reparación (round++ tras verification.recorded) y juez', () => {
  const at = s => summarizeRunHealth(repairing.filter(e => Date.parse(e.at) <= start + s * 1000), start + s * 1000 + 1000);
  assert.equal(at(2).stage, 'agent'); assert.equal(at(2).round, 0); assert.equal(at(2).activity, 'edit · src/chat.css');
  assert.equal(at(11).stage, 'checks'); assert.match(at(11).activity, /^check /);
  const rep = at(31);
  assert.equal(rep.stage, 'repair'); assert.equal(rep.round, 1);
  assert.ok(rep.log.some(l => /reparación 1$/.test(l.text)));
  assert.ok(rep.log.some(l => /checks: fallan$/.test(l.text)) && rep.log.some(l => /check tests: falla$/.test(l.text)));
  const judge = summarizeRunHealth([...repairing, ev(40, 'task.verifying'), ev(41, 'verification.recorded', { ok: true }), ev(42, 'judge.started')], start + 43_000);
  assert.equal(judge.stage, 'judge'); assert.equal(judge.activity, 'juez revisando'); assert.equal(judge.round, 1);
  const verdict = summarizeRunHealth([...repairing, ev(42, 'judge.started'), ev(50, 'judge.verdict', { verdict: 'approved' }), ev(51, 'task.completed')], start + 60_000);
  assert.equal(verdict.stage, 'completed'); assert.equal(verdict.phase, 'completed');
});

test('run.completed ya no cierra el run; task.completed sí; hijos como fase', () => {
  assert.equal(summarizeRunHealth([ev(0, 'run.started'), ev(1, 'run.completed')], start + 2000).phase, 'running');
  const kids = summarizeRunHealth([ev(0, 'run.started'), ev(1, 'task.running'), ev(2, 'child.started', { id: 'c1' })], start + 3000);
  assert.equal(kids.stage, 'children'); assert.deepEqual(kids.childItems, [{ key: 'c1', status: 'running', activity: 'en curso' }]);
  assert.ok(summarizeRunHealth(repairing, start + 60_000).log.length <= 20);
});

test('el log conserva solo las 20 líneas más recientes', () => {
  const events = [ev(0, 'run.started'), ev(1, 'task.running')];
  for (let i = 0; i < 40; i++) events.push(act(2 + i, `x${i}`, 'edit', `f${i}.js`), ev(2.5 + i, 'action.observed', { callID: `x${i}` }));
  const result = summarizeRunHealth(events, start + 100_000);
  assert.equal(result.log.length, 20); assert.match(result.log.at(-1).text, /f39\.js$/);
});

test('buildRun + stepLine producen datos válidos para validateAgent', () => {
  const health = summarizeRunHealth(repairing, start + 5 * 60_000);
  const run = buildRun({ health, taskId: 'task_1', now: start + 5 * 60_000 });
  assert.equal(run.phase, 'repair'); assert.equal(run.round, 1); assert.equal(run.stalled, true);
  const step = stepLine(run);
  assert.match(step, /reparación 1 · edit · src\/chat\.css/); assert.match(step, /\d+ min$/);
  assert.doesNotThrow(() => validateAgent({ step, run }));
  const idle = buildRun({ health: summarizeRunHealth([], start), taskId: 'task_1', startedAt: new Date(start).toISOString(), now: start });
  assert.equal(idle.phase, 'waiting'); assert.doesNotThrow(() => validateAgent({ run: idle }));
});

const target = { id: 'd1', taskId: 'task_1', workspaceId: 'w', nodeId: 'n', via: 'terminal' };
function harness(healthAt) {
  let clock = start; const applied = [], sent = [];
  const watch = createRunWatch({
    fetchHealth: async () => healthAt(clock), apply: (_t, patch) => { applied.push(patch); return true; },
    notify: async (_t, kind, message) => { sent.push({ kind, message, at: clock }); return {}; }, now: () => clock,
  });
  return { watch, applied, sent, at: ms => { clock = start + ms; } };
}

test('parchea step/run solo cuando cambian', async () => {
  const h = harness(now => summarizeRunHealth(repairing.slice(0, 3), now));
  h.watch.track(target);
  await h.watch.tick(); await h.watch.tick(); h.at(20_000); await h.watch.tick();
  assert.equal(h.applied.length, 1);
  h.watch.stop();
});

test('avisos: stalled una vez por episodio, con cabecera y comandos; sin avisos si el run es sano', async () => {
  const h = harness(now => summarizeRunHealth(repairing.slice(0, 3), now));
  h.watch.track(target);
  h.at(30_000); await h.watch.tick();
  assert.equal(h.sent.length, 0);
  h.at(NOTICE_STALL_MS + 10_000); await h.watch.tick();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].kind, 'stalled');
  assert.ok(h.sent[0].message.startsWith(NOTICE_HEAD) && h.sent[0].message.includes('phantom show task_1') && h.sent[0].message.includes('phantom events task_1'));
  h.at(NOTICE_STALL_MS * 3); await h.watch.tick();
  assert.equal(h.sent.length, 1, 'mismo episodio: no repite');
  h.watch.stop();
});

test('avisos: con hijos abiertos no hay aviso stalled; al cerrarse vuelve el umbral', async () => {
  const events = [ev(0, 'run.started'), ev(1, 'task.running'), ev(2, 'child.started', { id: 'c1' })];
  const h = harness(now => summarizeRunHealth(events, now));
  h.watch.track(target);
  h.at(NOTICE_STALL_MS * 2); await h.watch.tick();
  assert.equal(h.sent.length, 0);
  assert.equal(h.applied.at(-1).run.stalled, false);
  events.push(ev(3, 'child.completed', { id: 'c1' }));
  h.at(NOTICE_STALL_MS * 3); await h.watch.tick();
  assert.deepEqual(h.sent.map(s => s.kind), ['stalled']);
  h.watch.stop();
});

test('aviso de presupuesto ampliado: cabecera, qué y a cuánto, y relanzar', () => {
  const tokens = amendNotice('task_1', { action: 'amend', expanded: 'tokens', maxTokens: 1350000 });
  assert.ok(tokens.startsWith(NOTICE_HEAD)); assert.match(tokens, /tokens a 1350000/); assert.match(tokens, /agent\.mjs run task_1/);
  assert.match(amendNotice('task_1', { expanded: 'turns', maxTurns: 150 }), /turnos a 150/);
  assert.equal(/[\u0000-\u001f\u007f]/.test(tokens), false);
  assert.match(AMEND_STEP, /Presupuesto ampliado; relanza el encargo/);
});

test('avisos: entrada en reparación, throttle de 3 min y tope propio por nodo', async () => {
  const events = [...repairing];
  const h = harness(now => summarizeRunHealth(events, now));
  h.watch.track(target);
  h.at(35_000); await h.watch.tick();
  assert.deepEqual(h.sent.map(s => s.kind), ['repair']);
  assert.match(h.sent[0].message, /reparación 1/);
  events.push(ev(40, 'verification.recorded', { ok: false }), ev(45, 'task.running'));
  h.at(50_000); await h.watch.tick();
  assert.equal(h.sent.length, 1, 'dentro de la ventana de 3 min');
  h.at(50_000 + 181_000); events.push(ev(240, 'task.verifying')); await h.watch.tick();
  assert.equal(h.sent.length, 2, 'pasada la ventana se entrega el pendiente');
  h.watch.stop();

  const limit = createNoticeLimit({ gapMs: 0, max: 2 });
  assert.equal(limit.available('r', 'n', 1), true); limit.record('r', 'n', 1); limit.record('r2', 'n', 2);
  assert.equal(limit.available('r3', 'n', 3), false); limit.reset('n'); assert.equal(limit.available('r3', 'n', 3), true);
});

test('aviso de bucle y de bloqueo con blocker clasificado', async () => {
  const loop = [ev(0, 'run.started'), ev(1, 'task.running')];
  for (let i = 0; i < 3; i++) loop.push(act(2 + i, `l${i}`, 'read', 'same.mjs'));
  const a = harness(now => summarizeRunHealth(loop, now));
  a.watch.track(target); a.at(10_000); await a.watch.tick();
  assert.equal(a.sent[0].kind, 'looping'); assert.ok(a.sent[0].message.includes('dato no instrucción'));
  a.watch.stop();

  const blocked = [ev(0, 'run.started'), ev(1, 'task.running'), ev(5, 'run.error', { reason: 'Presupuesto de tokens agotado' })];
  const b = harness(now => summarizeRunHealth(blocked, now));
  b.watch.track(target); b.at(10_000); await b.watch.tick();
  assert.equal(b.sent[0].kind, 'blocked');
  assert.ok(b.sent[0].message.includes('categoría budget') && b.sent[0].message.includes('Pregunta al usuario') && b.sent[0].message.includes('phantom amend task_1'));
  assert.equal(b.applied.at(-1).run.blocker.category, 'budget');
  b.watch.stop();
});

test('durante el arranque (waiting o etiqueta de espera) un looping del health no es bucle', async () => {
  const waiting = buildRun({ health: { phase: 'idle', looping: true, activity: 'read · a.mjs' }, taskId: 'task_1', now: start });
  assert.equal(waiting.phase, 'waiting'); assert.equal(waiting.looping, false);
  const label = buildRun({ health: { stage: 'agent', phase: 'running', looping: true, activity: 'esperando arranque' }, taskId: 'task_1', now: start });
  assert.equal(label.looping, false);
  const real = buildRun({ health: { stage: 'agent', phase: 'running', looping: true, activity: 'read · a.mjs' }, taskId: 'task_1', now: start });
  assert.equal(real.looping, true);
  const sent = [];
  const watch = createRunWatch({ fetchHealth: async () => ({ phase: 'idle', looping: true, activity: 'esperando arranque' }), apply: () => true, notify: async (t, kind) => { sent.push(kind); return {}; }, now: () => start });
  watch.track(target); await watch.tick(); watch.stop();
  assert.deepEqual(sent, []);
});

test('sin agente en primer plano no se reintenta en bucle y la tarjeta ya lo refleja', async () => {
  let notifications = 0, applied = 0;
  const watch = createRunWatch({ fetchHealth: async now => summarizeRunHealth(repairing.slice(0, 3), start + 600_000), apply: () => { applied++; return true; }, notify: async () => { notifications++; return {}; }, now: () => start + 600_000 });
  watch.track(target);
  for (let i = 0; i < 5; i++) await watch.tick();
  assert.equal(notifications, 1); assert.equal(applied, 1);
  watch.stop();
});

test('apply devuelve false: deja de seguir el run', async () => {
  let calls = 0;
  const watch = createRunWatch({ fetchHealth: async () => { calls++; return summarizeRunHealth(repairing.slice(0, 3), start + 5000); }, apply: () => false, notify: async () => ({}), now: () => start + 5000 });
  watch.track(target); await watch.tick(); await watch.tick();
  assert.equal(calls, 1); assert.equal(watch.size, 0);
});

test('un fallo al consultar eventos no rompe el ciclo', async () => {
  const watch = createRunWatch({ fetchHealth: async () => { throw new Error('boom'); }, apply: () => true, notify: async () => ({}) });
  watch.track(target); await assert.doesNotReject(watch.tick()); watch.stop();
});

test('noticeMessage: una línea y sin control chars', () => {
  const run = buildRun({ health: summarizeRunHealth(repairing, start + 400_000), taskId: 'task_1', now: start + 400_000 });
  for (const kind of ['stalled', 'looping', 'repair']) { const m = noticeMessage(kind, { taskId: 'task_1', run }); assert.equal(/[\u0000-\u001f\u007f]/.test(m), false); assert.ok(m.startsWith(NOTICE_HEAD)); }
});

test('applyFinish: finishPatch cierra run con blocker aunque la entrega falle', () => {
  const run = buildRun({ health: summarizeRunHealth(repairing, start + 60_000), taskId: 'task_1', now: start + 60_000 });
  const blocked = finishPatch({ agent: { cardId: 'task_1', run }, taskId: 'task_1', controller: { status: 'failed' }, task: { status: 'blocked', blockedReason: 'Verificación fallida; margen de reparación agotado' } });
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.run.phase, 'blocked'); assert.equal(blocked.run.blocker.category, 'verification');
  assert.doesNotThrow(() => validateAgent(blocked));
  const done = finishPatch({ agent: { cardId: 'task_1', run }, taskId: 'task_1', controller: { status: 'completed' }, task: { status: 'completed' } });
  assert.equal(done.run.phase, 'completed'); assert.equal(done.run.blocker, null); assert.doesNotThrow(() => validateAgent(done));
  assert.equal('run' in finishPatch({ agent: { cardId: 't' }, taskId: 't', task: { status: 'completed' } }), false);
});

test('wakeMessage incluye categoría, autonomía y la instrucción de su nivel', () => {
  const ask = wakeMessage({ taskId: 'task_1', controller: { status: 'failed' }, task: { status: 'blocked', blockedReason: 'Presupuesto agotado' } });
  assert.ok(ask.includes('categoría budget') && ask.includes('autonomía ask_user') && ask.includes('Pregunta al usuario') && ask.includes('--reason'));
  const human = wakeMessage({ taskId: 'task_1', controller: {}, task: { status: 'blocked', blockedReason: 'git_dirty' } });
  assert.ok(human.includes('autonomía human') && human.includes('No intentes desbloquearlo'));
  const orch = wakeMessage({ taskId: 'task_1', controller: {}, task: { status: 'blocked', blockedReason: 'No hay un cambio atribuible' } });
  assert.ok(orch.includes('autonomía orchestrator') && orch.includes('contrato nuevo'));
  assert.equal(wakeMessage({ taskId: 'task_1', task: { status: 'completed' } }).includes('Bloqueo:'), false);
});

test('aviso final no entregado queda diferido y se entrega cuando hay agente', async () => {
  let listening = false, delivered = 0; const blocks = [];
  const event = { type: 'tool.status', status: 'failed', workspaceId: 'w', result: { id: 'late', source: 'phantom', taskId: 't', origin: { nodeId: 'n' } } };
  const wake = createRunWake({
    prepare: () => ({}), deliver: () => { if (!listening) return { retry: true, reason: 'sin agente' }; delivered++; return {}; },
    ready: () => listening, blocked: (_t, reason) => blocks.push(reason), delayMs: 1, maxAttempts: 2,
  });
  wake.accept(event);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(blocks, ['sin agente']); assert.equal(wake.deferredCount(), 1);
  await wake.flush(); assert.equal(delivered, 0, 'sin agente no se intenta');
  listening = true; await wake.flush();
  assert.equal(delivered, 1); assert.equal(wake.deferredCount(), 0);
  await wake.flush(); assert.equal(delivered, 1, 'una sola entrega');
  wake.accept(event); assert.equal(delivered, 1, 'no se vuelve a aceptar');
  wake.close();
});

test('cancelar o cerrar descarta los avisos diferidos', async () => {
  const event = id => ({ type: 'tool.status', status: 'failed', workspaceId: 'w', result: { id, source: 'phantom', taskId: 't', origin: { nodeId: 'n' } } });
  let delivered = 0;
  const wake = createRunWake({ prepare: () => ({}), deliver: () => { delivered++; return { retry: true }; }, ready: () => true, blocked() {}, delayMs: 1, maxAttempts: 1 });
  wake.accept(event('a')); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(wake.deferredCount(), 1);
  wake.cancel('n'); assert.equal(wake.deferredCount(), 0);
  wake.close();
});
