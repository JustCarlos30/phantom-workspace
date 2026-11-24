import test from 'node:test';
import assert from 'node:assert/strict';
import { probeDesktopTPM } from '../scripts/desktop-tpm-probe.mjs';

function fixture({ encrypt, decrypt } = {}) {
  const calls = [], buffers = [];
  let original;
  const runner = (file, args, options) => {
    calls.push({ file, args, options });
    if (calls.length === 1) original = Buffer.from(options.input);
    const result = calls.length === 1
      ? (encrypt?.(options.input) ?? { status: 0, stdout: Buffer.from('synthetic sealed fixture'), stderr: Buffer.alloc(0) })
      : (decrypt?.(original) ?? { status: 0, stdout: Buffer.from(original), stderr: Buffer.alloc(0) });
    for (const buffer of [options.input, result.stdout, result.stderr]) if (Buffer.isBuffer(buffer)) buffers.push(buffer);
    return result;
  };
  return { runner, calls, buffers, cleanup: () => original?.fill(0) };
}

test('TPM probe pins executable, TPM2/PCR7, private pipes and resource bounds; clears buffers', () => {
  const f = fixture();
  try {
    assert.deepEqual(probeDesktopTPM({ runner: f.runner }), {
      ok: true, stage: 'roundtrip', reason: 'systemd-tpm2-pcr7-roundtrip-only',
    });
    assert.equal(f.calls.length, 2);
    const common = ['--user', '--no-ask-password', '--name=phantom-capability-probe'];
    assert.deepEqual(f.calls[0].args, [...common, '--with-key=tpm2', '--tpm2-pcrs=7', 'encrypt', '-', '-']);
    assert.deepEqual(f.calls[1].args, [...common, '--refuse-null', 'decrypt', '-', '-']);
    assert.equal(f.calls[0].options.input.length, 32);
    assert.equal(f.calls[1].options.input, f.buffers[1]);
    for (const call of f.calls) {
      assert.equal(call.file, '/usr/bin/systemd-creds');
      assert.equal(call.options.shell, false);
      assert.equal(call.options.timeout, 20_000);
      assert.equal(call.options.maxBuffer, 1048576);
      assert.equal(call.options.killSignal, 'SIGKILL');
      assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']);
      assert.equal(call.options.encoding, 'buffer');
    }
    for (const buffer of f.buffers) assert.ok(buffer.every(byte => byte === 0));
  } finally { f.cleanup(); }
});

test('TPM probe stops on subprocess errors without fallback or exposing child diagnostics', () => {
  for (const [extra, reason] of [
    [{ status: 1 }, 'subprocess-failed'],
    [{ status: 1, stderr: Buffer.from('Permission denied: PRIVATE_MARKER') }, 'authorization-denied'],
    [{ error: { code: 'ETIMEDOUT', message: 'PRIVATE_MARKER' } }, 'timeout'],
    [{ error: { code: 'ENOBUFS' } }, 'output-limit'],
    [{ error: { code: 'ENOENT' } }, 'executable-unavailable'],
    [{ error: { code: 'EACCES' } }, 'execution-denied'],
    [{ error: { code: 'PRIVATE_MARKER' } }, 'subprocess-error'],
    [{ signal: 'SIGKILL', status: null }, 'subprocess-signal'],
    [{ stdout: null }, 'invalid-stdout'],
    [{ stdout: 'PRIVATE_MARKER' }, 'invalid-stdout'],
    [{ stdout: Buffer.alloc(0) }, 'invalid-stdout'],
    [{ stdout: Buffer.alloc(1048577) }, 'output-limit'],
    [{ stderr: Buffer.alloc(1048577) }, 'output-limit'],
  ]) {
    const f = fixture({ encrypt: () => ({ status: 0, stdout: Buffer.from('PRIVATE_MARKER'), stderr: Buffer.from('PRIVATE_MARKER'), ...extra }) });
    try {
      const result = probeDesktopTPM({ runner: f.runner });
      assert.deepEqual(result, { ok: false, stage: 'encrypt', reason });
      assert.equal(f.calls.length, 1, 'failed encryption must never retry with another key source');
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_MARKER/);
      for (const buffer of f.buffers) assert.ok(buffer.every(byte => byte === 0));
    } finally { f.cleanup(); }
  }
});

test('TPM probe compares plaintext bytes and length and fails on decrypt errors', () => {
  for (const [decrypt, reason] of [
    [() => ({ status: 1, stdout: Buffer.from('PRIVATE_MARKER'), stderr: Buffer.from('PRIVATE_MARKER') }), 'subprocess-failed'],
    [() => ({ status: 0, stdout: Buffer.alloc(31) }), 'roundtrip-mismatch'],
    [original => { const bytes = Buffer.from(original); bytes[0] ^= 1; return { status: 0, stdout: bytes }; }, 'roundtrip-mismatch'],
    [() => ({ status: 0, stdout: undefined }), 'invalid-stdout'],
    [() => ({ error: { code: 'ETIMEDOUT' }, stdout: Buffer.alloc(0) }), 'timeout'],
  ]) {
    const f = fixture({ decrypt });
    try {
      const result = probeDesktopTPM({ runner: f.runner });
      assert.deepEqual(result, { ok: false, stage: 'decrypt', reason });
      assert.equal(f.calls.length, 2);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_MARKER/);
      for (const buffer of f.buffers) assert.ok(buffer.every(byte => byte === 0));
    } finally { f.cleanup(); }
  }
});

test('TPM probe catches runner exceptions and clears already received buffers', () => {
  const f = fixture();
  try {
    const result = probeDesktopTPM({ runner: (...args) => {
      if (f.calls.length) throw new Error('PRIVATE_MARKER');
      return f.runner(...args);
    } });
    assert.deepEqual(result, { ok: false, stage: 'decrypt', reason: 'runner-error' });
    for (const buffer of f.buffers) assert.ok(buffer.every(byte => byte === 0));
  } finally { f.cleanup(); }
});
