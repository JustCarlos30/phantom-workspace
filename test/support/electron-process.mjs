// Playwright spawns Electron with `detached: true`, so the main process leads its
// own process group and every Chromium child (gpu, renderer, utility) inherits it.
// Killing only the main pid orphans those children; signalling the group does not,
// and still reaches them after the main process has already exited.
export function killElectronGroup(child, signal = 'SIGKILL') {
  const pid = child?.pid;
  if (!pid) return;
  if (process.platform !== 'win32') {
    try { process.kill(-pid, signal); return; } catch (error) { if (error.code === 'ESRCH') return; }
  }
  try { child.kill(signal); } catch {}
}
