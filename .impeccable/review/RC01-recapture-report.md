# RC-01 targeted evidence recovery

## Disposition

**Evidence recovered: 6 targeted checks passed / 0 failed.** Required `focused-terminal.png` replaced once after diagnostics. Ready for reviewer re-review using all four required images. No core-suite rerun, application-source change or aesthetic iteration.

Separate ledger: **`recapture-checks.json`**. The original **`desktop-checks.final.json` remains unchanged at 29 passed / 1 optional diagnostics failure**. That prior failure was an ambiguous tools screenshot locator, not a core task failure; the scoped recovery check now passes and `tools.png` exists.

## Same build, isolated surface

- Executable: `out/Phantom Workspace-linux-x64/phantom-workspace`.
- `BUILD.json`: built **2026-11-11T06:49:14.687Z**, Electron 45.3.0, Phantom 0.5.0, bundled Node v26.11.1.
- Successful recovery fixture: `/tmp/opencode/phantom-rc01-C6wPWM`; separate Electron/host/Phantom data; no sandbox flag.
- Fixed actual renderer size: **1520×980**. Native window frame 1520×1007.
- An earlier setup request timed out, and an earlier diagnostic surface was subsequently constrained to 1000×673 by the desktop environment. Those attempts were rejected, separately archived as `recapture-setup-attempt-*.json`, and did not replace the required image. Native min/max constraints were applied to the fresh successful window to hold the requested dimensions. This is test-window configuration, not an application patch.

## Measured terminal geometry

After overview → focused terminal, waited **at least 500 ms**, then required stable native session dimensions and screen bounds for another **300 ms**. Repeated after the output stimulus and one unfocus/refocus cycle with one actual keyboard panel-width resize. No extra window-resize cycle was used as a cosmetic repair.

| Measurement | Initial settled focus | Final settled focus |
| --- | --- | --- |
| Actual window content | 1520×980 | 1520×980 |
| Native PTY | **155 columns × 37 rows** | **155 columns × 37 rows** |
| `.terminal-host` | 1250×695 | 1250×695 |
| `.xterm` | 1250×695 | 1250×695 |
| `.xterm-viewport` | 1250×695 | 1250×695 |
| `.xterm-screen` | 1213×666 | 1213×666 |
| DOM cell rows | 37 × 18px | 37 × 18px |

The viewport fills the host height. The screen's 29px difference accounts for 8px top padding and remaining bottom padding/partial-cell space; it is not an old, overview-sized screen occupying only the upper half.

Computed backgrounds are captured in JSON: host/root/screen transparent, viewport `rgb(0,0,0)`, painted active cell background `#131d2c`. Thin black padding strips outside the cell area are visible; they are distinguished from the original large lower block.

## Lower-region exercise and verification

Typed a harmless POSIX shell loop through actual xterm to print **50 individually labelled lines**. Independently verified all `RC01_LINE_01__LOWER_REGION_OK` through `RC01_LINE_50__LOWER_REGION_OK` in native `terminal.attach` history. Then unfocused/refocused once, resized the panel width once (+24 canvas units), and typed a final cursor marker.

The replacement visibly shows lines 18–50 plus END/FINAL markers and the final prompt/cursor. In particular, **lines 36–50 render below the previous y≈508 boundary**, down toward the terminal bottom. Native dimensions remain 155×37 throughout focused observations.

Final lower active-cell pixel region **x277–1449 / y535–857**:

- 378,879 pixels sampled.
- **0% black pixels**.
- **96.1003%** expected `#131d2c` background.
- **10,858 bright glyph/cursor pixels**.
- Every sampled scanline has at least **87.9795%** expected background.

## Diagnosis and confidence

The large rectangle **did not reproduce once full-height fit/paint readiness was measured**, including after the focus/resize exercise. The settled initial diagnostic already had correct full-height rendering, before the 50-line stimulus.

This supports **a pre-fit/paint capture artifact** as the explanation for the historical image. It does **not** prove the original timing cause: historical geometry was not recorded. No application fix was made, and no claim is made that an arbitrary wait resolves a persistent source issue. The recovered evidence directly demonstrates correct lower-region output and continuous active-cell background on the same packaged build.

## Images reviewed directly

- **`focused-terminal.png`** — one final replacement, 1520×980; output/cursor below old boundary, no large lower black rectangle, no toast. **Read and validated.**
- **`tools.png`** — 1520×980; actual local task and uniquely scoped `Estado local` control; lower terminal output also visible. **Read and validated.**
- `recapture-initial.png` — settled initial diagnostic, full-height active cells; preferences toast present only in this diagnostic. **Read and validated as diagnostic, not required deliverable.**
- `focused-terminal.before-RC01.png` — preserved previous required image.

Required four-image set for the reviewer: **`desktop.png`, `narrow.png`, `browser-native.png`, `focused-terminal.png`**. The first three retain their previously validated same-build images unchanged.

## Cleanup

Stopped only the recovery app and its validated isolated daemon. Profile directory checked afterward: no `host.lock` or `host.sock`. Fixtures remain for inspection. No microphone, model/cloud calls, user browser/profile access, Docker actions, commits or application-source modifications.

**End envelope task E2E — RC-01 recovery.**
