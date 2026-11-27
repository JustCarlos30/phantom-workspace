import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSleepInhibitor } from '../host/sleep-inhibit.mjs';

const T0 = Date.parse('2026-11-27T10:00:00Z');

function fakeSpawn() {
  const calls = [];
  const spawn = (cmd, args, options) => {
    const child = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      return true;
    };
    calls.push({ cmd, args, options, child });
    return child;
  };
  return { spawn, calls };
}

test('hold lanza systemd-inhibit con sleep:idle hasta el plazo', () => {
  const { spawn, calls } = fakeSpawn();
  const inh = createSleepInhibitor({ spawn, now: () => T0 });
  const s = inh.hold(T0 + 90_000, 'Cuota agotada');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'systemd-inhibit');
  assert.ok(calls[0].args.includes('--what=sleep:idle'));
  assert.ok(calls[0].args.includes('--why=Cuota agotada'));
  assert.deepEqual(calls[0].args.slice(-2), ['sleep', '90']);
  assert.deepEqual(s, { active: true, untilMs: T0 + 90_000, reason: 'Cuota agotada', available: true, error: null });
});

test('reutiliza el inhibidor: plazo anterior no lanza, posterior lo sustituye', () => {
  let t = T0;
  const { spawn, calls } = fakeSpawn();
  const inh = createSleepInhibitor({ spawn, now: () => t });
  inh.hold(T0 + 60_000, 'a');
  inh.hold(T0 + 30_000, 'b');
  assert.equal(calls.length, 1);
  inh.hold(T0 + 3_600_000, 'c');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].child.killed, true);
  assert.deepEqual(calls[1].args.slice(-2), ['sleep', '3600']);
  assert.equal(inh.status().untilMs, T0 + 3_600_000);
  assert.equal(inh.status().reason, 'c');
});

test('al terminar el proceso el estado queda inactivo', () => {
  const { spawn, calls } = fakeSpawn();
  const inh = createSleepInhibitor({ spawn, now: () => T0 });
  inh.hold(T0 + 1000, 'x');
  calls[0].child.emit('exit', 0, null);
  assert.deepEqual(inh.status(), { active: false, untilMs: null, reason: null, available: true, error: null });
});

test('salida de un proceso sustituido no borra el inhibidor vigente', () => {
  const { spawn, calls } = fakeSpawn();
  const inh = createSleepInhibitor({ spawn, now: () => T0 });
  inh.hold(T0 + 60_000, 'a');
  inh.hold(T0 + 120_000, 'b');
  calls[0].child.emit('exit', null, 'SIGTERM');
  assert.equal(inh.status().active, true);
  assert.equal(inh.status().untilMs, T0 + 120_000);
});

test('release termina el inhibidor y es idempotente', () => {
  const { spawn, calls } = fakeSpawn();
  const inh = createSleepInhibitor({ spawn, now: () => T0 });
  inh.hold(T0 + 1000, 'x');
  assert.equal(inh.release().active, false);
  assert.equal(calls[0].child.killed, true);
  assert.equal(inh.status().active, false);
  assert.doesNotThrow(() => inh.release());
});

test('sin systemd-inhibit degrada sin lanzar y lo informa', () => {
  const { spawn, calls } = fakeSpawn();
  const inh = createSleepInhibitor({ spawn, now: () => T0 });
  inh.hold(T0 + 1000, 'x');
  const err = Object.assign(new Error('spawn systemd-inhibit ENOENT'), { code: 'ENOENT' });
  calls[0].child.emit('error', err);
  assert.deepEqual(inh.status(), { active: false, untilMs: null, reason: null, available: false, error: 'spawn systemd-inhibit ENOENT' });
  inh.hold(T0 + 2000, 'y');
  assert.equal(calls.length, 1);
});

test('spawn que lanza síncronamente degrada sin propagar el error', () => {
  const inh = createSleepInhibitor({
    spawn: () => {
      throw Object.assign(new Error('spawn systemd-inhibit ENOENT'), { code: 'ENOENT' });
    },
    now: () => T0,
  });
  assert.doesNotThrow(() => inh.hold(T0 + 1000, 'x'));
  assert.equal(inh.status().available, false);
  assert.equal(inh.status().active, false);
});

test('un plazo ya vencido no lanza proceso', () => {
  const { spawn, calls } = fakeSpawn();
  const inh = createSleepInhibitor({ spawn, now: () => T0 });
  const s = inh.hold(T0, 'x');
  assert.equal(calls.length, 0);
  assert.equal(s.active, false);
});
