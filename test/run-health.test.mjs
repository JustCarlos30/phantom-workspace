import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_THRESHOLD, STALL_THRESHOLD_MS, summarizeRunHealth } from '../integrations/run-health.mjs';

const start = Date.parse('2026-11-23T10:00:00.000Z');
const event = (seconds, type, data = {}, run_id = 'run') => ({ at: new Date(start + seconds * 1000).toISOString(), type, data, run_id });

test('summarizes a healthy assignment', () => {
  const result = summarizeRunHealth([event(0, 'run.started'), event(5, 'action.intended', { callID: 'a', tool: 'read', args: { filePath: 'a.mjs' } })], start + 10_000);
  assert.deepEqual(result.current, { tool: 'read', target: 'a.mjs', at: event(5, '').at });
  assert.equal(result.phase, 'running');
  assert.equal(result.elapsedMs, 10_000);
  assert.equal(result.idleMs, 5_000);
  assert.equal(result.stalled, false);
});

test('detects a stalled assignment', () => {
  const result = summarizeRunHealth([event(0, 'run.started')], start + STALL_THRESHOLD_MS);
  assert.equal(result.stalled, true);
  assert.match(result.reason, /stall threshold/);
});

test('detects a repeated action loop', () => {
  const events = [event(0, 'run.started')];
  for (let i = 0; i < LOOP_THRESHOLD; i++) events.push(event(i + 1, 'action.intended', { callID: `a${i}`, tool: 'read', args: { filePath: 'same.mjs' } }));
  const result = summarizeRunHealth(events, start + 10_000);
  assert.equal(result.looping, true);
  assert.match(result.reason, /loop/);
});

test('counts children once and records terminal children', () => {
  const result = summarizeRunHealth([event(0, 'run.started'), event(1, 'child.started', { id: 'one' }), event(2, 'child.completed', { id: 'one' }), event(3, 'child.started', { id: 'two' })], start + 4_000);
  assert.deepEqual(result.children, { done: 1, total: 2 });
});

test('counts settled and delivery-accepted children as done', () => {
  const result = summarizeRunHealth([event(0, 'run.started'), event(1, 'child.settled', { id: 'one' }), event(2, 'child.delivery_accepted', { id: 'two' })], start + 3_000);
  assert.deepEqual(result.children, { done: 2, total: 2 });
});

test('returns an idle summary without events', () => {
  assert.deepEqual(summarizeRunHealth([], start), { phase: 'idle', elapsedMs: 0, idleMs: 0, current: null, children: { done: 0, total: 0 }, stalled: false, looping: false, reason: null });
});

test('ignores unrelated event types', () => {
  const result = summarizeRunHealth([event(0, 'run.started'), event(200, 'model.requested', { model: 'x' })], start + 200_000);
  assert.equal(result.idleMs, 200_000);
  assert.equal(result.stalled, true);
});
