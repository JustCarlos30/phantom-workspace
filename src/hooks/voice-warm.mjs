export function createWarmThrottle(minIntervalMs, now = Date.now) {
  let last = null;
  return {
    shouldWarm() {
      const t = now();
      if (last !== null && t - last < minIntervalMs) return false;
      last = t;
      return true;
    },
  };
}
