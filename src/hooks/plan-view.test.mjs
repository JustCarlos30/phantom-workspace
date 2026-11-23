import test from 'node:test';
import assert from 'node:assert/strict';
import { planSummary, phaseState } from './plan-view.mjs';

const plan = statuses => ({ title: 'P', phases: statuses.map((status, i) => ({ key: `k${i}`, title: `F${i + 1}`, status })) });

test('sin plan devuelve null', () => {
  assert.equal(planSummary(undefined), null);
  assert.equal(planSummary({ phases: [] }), null);
});

test('la fase en curso manda', () => {
  const s = planSummary(plan(['done', 'running', 'blocked', 'pending']));
  assert.equal(s.index, 2);
  assert.equal(s.done, 1);
  assert.equal(s.total, 4);
  assert.equal(s.label, 'Fase 2 de 4 · F2');
  assert.equal(s.tone, 'working');
});

test('sin fase en curso, la primera bloqueada', () => {
  const s = planSummary(plan(['done', 'pending', 'blocked']));
  assert.equal(s.index, 3);
  assert.equal(s.tone, 'blocked');
});

test('sin curso ni bloqueo, la primera pendiente', () => {
  const s = planSummary(plan(['done', 'pending', 'pending']));
  assert.equal(s.index, 2);
  assert.equal(s.tone, 'idle');
  assert.equal(s.current.key, 'k1');
});

test('plan completo', () => {
  const s = planSummary(plan(['done', 'done']));
  assert.equal(s.label, 'Plan completo · 2 fases');
  assert.equal(s.tone, 'done');
  assert.equal(s.current, null);
});

test('phaseState textos visibles', () => {
  assert.equal(phaseState({ status: 'running' }), 'En curso');
  assert.equal(phaseState({ status: 'done' }), 'Hecha');
  assert.equal(phaseState({ status: 'blocked' }), 'Bloqueada');
  assert.equal(phaseState({ status: 'pending', taskId: 't1' }), 'Lista');
  assert.equal(phaseState({ status: 'pending' }), 'Sin encargo todavía');
});
