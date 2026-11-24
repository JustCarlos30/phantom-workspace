import { spawnSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const binary = '/usr/bin/systemd-creds';
const common = ['--user', '--no-ask-password', '--name=phantom-capability-probe'];
const limit = 1024 * 1024;

// Only fixed classifications leave this boundary; child diagnostics may contain data.
function failure(result) {
  if (result?.error?.code === 'ETIMEDOUT') return 'timeout';
  if (result?.error?.code === 'ENOBUFS') return 'output-limit';
  if (result?.error?.code === 'ENOENT') return 'executable-unavailable';
  if (result?.error?.code === 'EACCES') return 'execution-denied';
  if (result?.error) return 'subprocess-error';
  if (result?.signal) return 'subprocess-signal';
  if (result?.status !== 0) {
    // Inspect locally, never relay stderr (or arbitrary error messages) to callers.
    if (Buffer.isBuffer(result?.stderr) && result.stderr.length <= limit &&
        /(?:access denied|permission denied|not authorized|not authorised|interactive authentication required|authentication is required)/i.test(result.stderr.toString('utf8'))) {
      return 'authorization-denied';
    }
    return 'subprocess-failed';
  }
  if (!Buffer.isBuffer(result.stdout) || result.stdout.length === 0) return 'invalid-stdout';
  if (result.stdout.length > limit || (Buffer.isBuffer(result.stderr) && result.stderr.length > limit)) return 'output-limit';
  return null;
}

/** Synthetic systemd sealing roundtrip only. Runner owns no retained copies of inputs.
 * The injected runner follows spawnSync's binary-output contract, for unit tests.
 */
export function probeDesktopTPM({ runner = spawnSync } = {}) {
  const plaintext = randomBytes(32);
  const buffers = new Set([plaintext]);
  let stage = 'encrypt';
  const run = (args, input) => {
    const result = runner(binary, args, {
      input, timeout: 20_000, maxBuffer: limit, shell: false,
      stdio: ['pipe', 'pipe', 'pipe'], encoding: 'buffer', killSignal: 'SIGKILL',
    });
    for (const value of [result?.stdout, result?.stderr]) {
      if (Buffer.isBuffer(value)) buffers.add(value);
    }
    return result;
  };
  try {
    const encrypted = run([...common, '--with-key=host+tpm2', '--tpm2-pcrs=7', 'encrypt', '-', '-'], plaintext);
    const encryptFailure = failure(encrypted);
    if (encryptFailure) return { ok: false, stage, reason: encryptFailure };
    stage = 'decrypt';
    const decrypted = run([...common, '--refuse-null', 'decrypt', '-', '-'], encrypted.stdout);
    const decryptFailure = failure(decrypted);
    if (decryptFailure) return { ok: false, stage, reason: decryptFailure };
    if (decrypted.stdout.length !== plaintext.length || !timingSafeEqual(plaintext, decrypted.stdout)) {
      return { ok: false, stage, reason: 'roundtrip-mismatch' };
    }
    return { ok: true, stage: 'roundtrip', reason: 'systemd-host-tpm2-pcr7-roundtrip-only' };
  } catch {
    return { ok: false, stage, reason: 'runner-error' };
  } finally {
    for (const buffer of buffers) buffer.fill(0);
  }
}

// Importing this module does not execute a probe or emit output.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.log(JSON.stringify({ ok: false, stage: 'cli', reason: 'unexpected-arguments' }));
    process.exitCode = 1;
  } else {
    const result = probeDesktopTPM();
    console.log(JSON.stringify(result));
    process.exitCode = result.ok ? 0 : 1;
  }
}
