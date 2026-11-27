import { spawn as nodeSpawn } from 'node:child_process';

export function createSleepInhibitor({ spawn = nodeSpawn, now = () => Date.now() } = {}) {
  let child = null;
  let untilMs = null;
  let reason = null;
  let available = true;
  let error = null;

  function clear() {
    child = null;
    untilMs = null;
    reason = null;
  }

  function stop() {
    const current = child;
    clear();
    current?.kill?.();
  }

  function start(deadline, why) {
    const seconds = Math.ceil((deadline - now()) / 1000);
    const args = ['--what=sleep:idle', '--who=Phantom Workspace', `--why=${why}`, '--mode=block', 'sleep', String(seconds)];
    let next;
    try {
      next = spawn('systemd-inhibit', args, { stdio: 'ignore' });
    } catch (err) {
      markUnavailable(err);
      return;
    }
    next.on?.('error', (err) => {
      if (child !== next) return;
      clear();
      if (err.code === 'ENOENT') available = false;
      error = err.message;
    });
    next.on?.('exit', () => {
      if (child === next) clear();
    });
    next.unref?.();
    child = next;
    untilMs = deadline;
    reason = why;
    error = null;
  }

  function markUnavailable(err) {
    clear();
    if (err.code === 'ENOENT') available = false;
    error = err.message;
  }

  function status() {
    return { active: child !== null, untilMs, reason, available, error };
  }

  function hold(deadline, why = 'Phantom: espera de cuota') {
    if (!available || !(deadline > now())) return status();
    if (child && deadline <= untilMs) return status();
    stop();
    start(deadline, why);
    return status();
  }

  function release() {
    stop();
    return status();
  }

  return { hold, release, status };
}
