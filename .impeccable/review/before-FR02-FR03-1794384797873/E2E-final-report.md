# Final packaged verification — current FR02 / FR03 result

## Verdict and provenance

**34 passed / 0 failed. All four FR02/FR03 checks pass.** This report replaces the stale 32/2 prose. Older failures remain historical evidence in the archives, not current open defects.

- Authoritative ledger: [desktop-checks.final.json](desktop-checks.final.json).
- Executable: `/home/carlosj/Carlos_World/phantom-workspace/out/Phantom Workspace-linux-x64/phantom-workspace`.
- [BUILD.json](../../out/Phantom%20Workspace-linux-x64/BUILD.json): version **0.1.0**, built **2026-11-11T07:46:06.456Z**, Electron **45.3.0**, bundled host Node **v26.11.1**, Phantom **0.5.0**, Linux x64.
- Fresh full execution started **2026-11-11T07:46:06.840Z**; fixture `/tmp/opencode/phantom-packaged-e2e-69LkwH`, isolated profile and synthetic repository. Previous ledger archived under `before-FR02-FR03-1794383166822/`.
- Normal packaged app launch, no added `--no-sandbox` app flag; own Node/Phantom/Chromium paths observed. Playwright manages its own Chromium launch flags; the app-launch result is not a universal sandbox audit.

## FR02 — real input ownership, both inspectors

Tasks and Context were checked independently with the inspector open. Clicking the visible T2 terminal then typing literal Space/`printf` and Ctrl+C reached the correct session. An actual owned `sleep 30` child was interrupted and the shell accepted subsequent labelled output. The other sessions stayed unchanged; the inspector stayed open.

Typing into inspector fields, including Space, `0 wasd` and Ctrl+C, produced **zero PTY traffic** and no camera movement over the bounded observation. The native browser remained hidden. Both regression checks pass.

## FR03 — inline rename and focus restored

Panel context-menu rename and project breadcrumb rename both pass:

- Inline input, no modal backdrop.
- Enter and blur persist; Escape cancels, including Escape followed by blur.
- Enter/Escape restore focus to the returning header/breadcrumb button. The repeated panel Enter that restores the original title also passes.
- Project canonical path stays unchanged.

The coordinator replaced rAF focus scheduling with post-commit `useLayoutEffect` in `useInlineName.js`, rebuilt the package, and ran this full E2E. The prior BODY-focus failures are not reproduced in the latest checks. The earlier **86/0/0** backend/native/ASR/renderer suite preceded that isolated focus change; it is not claimed as rerun afterward.

## Other observed passing checks

- Packaged renderer/host startup from isolated empty state; actual bundled CLI/browser/runtime paths.
- Three native PTYs with distinct IDs/PIDs and independently observed xterm output; shell exit 7 versus explicit stop.
- Note editing without camera movement; arrange/resize/zoom and keyboard palette lookup/focus/return; nonoverlapping auto-placement.
- Local task and doing-status persistence; real Markdown scan/read/pin.
- Native Phantom decision/card/skill creation with bundled CLI and isolated data; native validation error remains visible without disconnecting host. No model run.
- Real Git fixture inspection; Docker availability and read-only owned-container list (empty); no container mutations.
- Pinned URL and managed PTY service ownership; native local browser URL/content; remote `require` and Phantom bridge undefined; browser hides below overlays.
- Deterministic bundled Node playground result; real visible bundled Chromium Playwright browser, stop, recorded trace and internal native trace viewer.
- Typed voice transcript → reviewed explicit local task. No microphone or cloud in this E2E.
- Immediate native close handshake flushes note/geometry; warm restart reattaches **same PID/session**, no new shell.
- Explicit host shutdown restores **exited/null PID**, retained layout/history and no automatic shells.
- Unexpected crash of **only the known fixture daemon** restores **lost/null PID**, retained history and no automatic shell. This is not a reboot of the user's PC.
- No uncaught renderer errors/tool error-boundary crashes in the ledger.

## Current five-image batch

These images were captured in this new full execution, not reused from the stale 07:28 build. The coordinator reports direct validation of all five.

| Image | Recorded surface |
|---|---|
| [desktop.png](desktop.png) | 1520×980 renderer overview, synthetic PTYs/note/browser/trace panels. |
| [narrow.png](narrow.png) | 1100×760 renderer overview with intentional low-zoom summaries. |
| [browser-native.png](browser-native.png) | Settled real native local fixture page; direct native-layer capture. |
| [focused-terminal.png](focused-terminal.png) | 1520×980; 50 labelled lines, lower-region output and prompt/cursor after stable fit/paint. |
| [tools.png](tools.png) | Real persisted task inspector. |

Focused terminal evidence records **155×37** PTY, **1250×695** host/viewport, **1213×666** active screen and cursor at y850–868. RC01 was resolved with valid recaptures; historical recapture details remain in [RC01 report](RC01-recapture-report.md), whose old build/count references are historical. Reviewer SHIP covers **FR01/02/03 score only**, not broad UI acceptance. The [direction provenance mismatch](direction-provenance.md) concerns guide/CLI metadata, not application behavior.

## Reproduce and interpretation

From the app root, with display and dependencies available:

```sh
PHANTOM_TEST_EXECUTABLE="$PWD/out/Phantom Workspace-linux-x64/phantom-workspace" npm run test:desktop
```

Version 0.1 is usable and packaged. This synthetic automated run does not establish Carlos-observed usability, five-day dogfood, Spanish microphone quality, the proposed 10-minute/12-PTY/100-node budget, Tauri comparative benchmarks, model execution or Docker container lifecycle. See [VERIFICATION.md](../../VERIFICATION.md) for full suite chronology, local ASR proof and remaining acceptance boundaries.
