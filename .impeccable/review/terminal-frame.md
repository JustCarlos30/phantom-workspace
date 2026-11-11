# Integrated terminal frame

## Direction and implementation

Operate mode, preserving the shipping dark Phantom palette. Carlos confirmed an integrated frame, larger monospaced text and size controls. The terminal remains a real xterm/PTY surface.

- Opaque `--surface` frame with 12px horizontal inset, 48px path/size toolbar and 34px session footer.
- Output defaults to 16px and 1.4 line height; local JetBrains Mono/Cascadia Code preferred, existing Linux mono fonts retained as fallbacks.
- Size controls span 12–24px; clicking the numeric size resets to 16px. The existing workspace save queue persists `node.data.fontSize` per panel.
- Size changes refit the existing xterm and PTY without recreating the session or process.
- Recovery messages participate in layout rather than covering the session history.
- xterm padding stays inside the measured host; the xterm viewport and padding share the terminal background.

## Verification

Build passed. An isolated Electron run with a real shell verified preference save, PTY column changes, stable PID/session, keyboard input, reset, map/focus navigation, stop/recovery and no renderer errors. Desktop 1520×980 and narrow desktop 1100×760 captures were inspected. Evidence: `/tmp/opencode/phantom-terminal-frame-ifjPhw/` (development evidence, not shipping assets).

The mechanical detector reported advisory palette/type documentation drift against the older light design record, including the existing ANSI palette; no blocking findings. DESIGN.md was removed concurrently by another workspace change during this session and has not been recreated or overwritten here. This scoped record documents the terminal addition independently.

General suite: 86 passed, 3 skipped, 1 failed. The failure is `Phantom task catalog excludes unrelated projects but includes known worktree family` in `test/integrations.test.mjs:194`; it also fails in isolation and does not exercise the changed UI.

Verdict: terminal-frame scope verified; the general suite remains non-green because of the separately reproducible catalog integration failure. No whole-product approval is implied.
