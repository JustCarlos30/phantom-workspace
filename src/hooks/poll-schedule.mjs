// Pure polling schedule helpers (no React).

// Delay until the next poll; a hidden window returns hiddenDelay (null = do not poll).
export function livePollDelay({ hidden, base = 5000, hiddenDelay = null } = {}) {
  return hidden ? hiddenDelay : base;
}

// Groups triggers into one run: the first schedules `run` after `delay`, later ones
// keep the earliest slot, and `run` never fires sooner than `minGap` after the last run.
export function createCoalescer({ minGap = 2000, delay = 400, now = Date.now, schedule = setTimeout, cancel = clearTimeout, run }) {
  let handle = null, lastRun = -Infinity, disposed = false;
  const fire = () => {
    handle = null;
    if (disposed) return;
    lastRun = now();
    run();
  };
  return {
    trigger() {
      if (disposed || handle !== null) return;
      const wait = Math.max(delay, lastRun + minGap - now());
      handle = schedule(fire, wait);
    },
    flush() {
      if (disposed || handle === null) return;
      cancel(handle);
      fire();
    },
    dispose() {
      disposed = true;
      if (handle !== null) cancel(handle);
      handle = null;
    },
  };
}
