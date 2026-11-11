# Final packaged verification — FR02 / FR03 reviewer fixes

## Verdict

**32 passed / 2 failed. FR02 passes. FR03 is incomplete: keyboard focus after Enter is unreliable.** All remaining core flows, including lifecycle checks, completed. Counts are from the latest fresh functional execution only; no historical failure aggregation.

- Executable: `/home/carlosj/Carlos_World/phantom-workspace/out/Phantom Workspace-linux-x64/phantom-workspace`.
- Current `BUILD.json`: **builtAt `2026-11-11T07:28:40.505Z`**, Electron 45.3.0, Phantom 0.5.0, bundled Node v26.11.1.
- Latest fresh functional fixture: `/tmp/opencode/phantom-packaged-e2e-0jeLaR`.
- Execution: **2026-11-11 07:41:03–07:41:26 UTC**.
- Latest ledger: **`desktop-checks.final.json`**.
- Previous 29/1 ledger/report/images preserved unchanged in **`before-FR02-FR03-1794382427477/`**. Subsequent harness/debug executions also have separate archives.
- No `--no-sandbox`, mock bridge, app-source changes or commits.

## FR02 — both real inspector regressions pass

Tested independently with **Tasks** and **Context** inspectors open:

1. Focused terminal T2, opened inspector, then **clicked its visible terminal surface**.
2. Typed actual `printf` using literal **Space key presses**, independently read the resulting labelled output through `terminal.attach`.
3. Started an actual owned `sleep 30` child, inspected the known shell's `/proc` children to confirm it existed, pressed **Ctrl+C**, and verified the child exited and shell accepted a subsequent labelled `printf`.
4. Inspector remained open throughout. Session ID matched T2; snapshots/sequences of the other two terminals stayed unchanged.
5. Clicked the actual inspector title/search input and typed text, Space, `0 wasd`, and Ctrl+C. Across a bounded negative observation, **all PTY output/sequence snapshots remained unchanged and camera stayed unchanged**.
6. Native browser view remained hidden under the inspector. Separate native-browser overlay tests also pass.

Persistent checks: `FR02 tasks inspector...` and `FR02 context inspector...` in `test/desktop-smoke.mjs`.

## FR03 — inline behavior passes; two focus failures remain

### What works

- Panel context menu **Renombrar** opens the input **inside the node header**.
- Project breadcrumb editing is inline as well.
- Neither path creates `.app-modal-backdrop`.
- Enter persists names, blur persists names, Escape cancels, and subsequent blur after Escape does not accidentally save.
- Project canonical path is unchanged by renaming.
- Escape restored keyboard focus in the completed run.

### Remaining issue 1 — panel header focus after Enter

**Reproduction:** Focus a note → Options → **Renombrar** → edit → Enter. Repeat with blur and another Enter rename. The saved title/button returns, but keyboard focus can land on **`BODY`**, not the title button.

Latest execution observations:

- First context-menu Enter: restored.
- Escape: restored.
- Repeated Enter restoring original title after a blur commit: **not restored, `activeTag: BODY`**.

The same focus loss occurred on the **first context-menu Enter** in the earlier current-build capture execution, confirming this is intermittent rather than limited to the cleanup rename. `document.hasFocus()` was true; no inline input remained. The title itself persisted.

### Remaining issue 2 — project breadcrumb focus after Enter

**Reproduction:** Click project breadcrumb name → type a new name → Enter. The new name persists and the breadcrumb button returns, but **`document.activeElement` is `BODY`**, not the breadcrumb name button. Escape restores focus; blur persistence and Escape cancellation still work.

Evidence is retained in **`fr03PanelFocus`**, **`fr03ProjectFocus`**, and failed-check `focus` fields in the final JSON.

Implementation pointer for coordinator: `src/hooks/useInlineName.js`, the `end(returnFocus)` callback's `requestAnimationFrame(() => origin()?.focus(...))`, plus Canvas title-button origin lookup / App project-button ref. **A scheduling/ref-readiness race is a plausible investigation target, not a proven root cause. No source patch was made.**

## Other current-build functional passes

- Actual packaged desktop/isolated empty state; renderer loads bundled dist without dev server.
- Host `/proc/<pid>/exe` is bundled `resources/runtime/node`; default `PHANTOM_CLI` points to bundled vendor CLI, browser path to `resources/browsers`.
- Three actual terminals created by UI; xterm `printf` independently verified with unique IDs/PIDs. Separate `exit 7` and explicit stop.
- Note/canvas drag, resize, zoom, camera isolation, palette lookup/focus/return.
- Local task creation and doing-status persistence; typed voice → reviewed local task without mic/cloud.
- Real Markdown scan/read/pin; native Phantom decision/card/skill creation using bundled CLI and isolated Phantom data, without models.
- Native validation error stays visible without false host disconnect; Git fixture branch/list; actual read-only Docker listing.
- Services owner formatting, scoped pin/open; actual native URL/content loading, no remote Phantom/Node bridge, native view hidden under overlays.
- Bundled Node deterministic playground; actual bundled Chromium Playwright live run, stop, nonempty trace and internal native trace viewer.
- Native/physical node nonoverlap.
- Immediate close handshake saves note/geometry; warm reopen reattaches **same session/PID** with no new shell.
- Explicit shutdown restores **exited/null PID** and history/layout with no auto shell.
- SIGKILL of **only known fixture daemon**, after history persistence, restores **lost/null PID** with no new PTY.
- No uncaught renderer/recovery crashes.

## One current-build image batch — all five directly read

The batch was captured in fresh fixture **`/tmp/opencode/phantom-packaged-e2e-f0oDNt`** on the **same 07:28:40 build**. After harness query scoping was corrected, the final fresh functional completion used `--functional-only` to reuse this already-captured batch instead of creating a second visual round. The final ledger records **`imageProvenance`**, its source ledger/archive, fixture, and exact build metadata. The capture-run failures are not mixed into final counts.

| Image | Direct review |
| --- | --- |
| **`desktop.png`** | **1520×980**, valid/nonblank, six physically nonoverlapping panels and legible titles. Real PTYs, note, local browser and trace previews. Note title `E2E Note FR03` reflects that capture fixture. |
| **`narrow.png`** | **1100×760**, valid/nonblank/nonoverlapping; intentional terminal overview status placeholders at 38% zoom. |
| **`browser-native.png`** | **1250×680**, actual settled native page with synthetic fixture heading, sentinel, input and button; not renderer placeholder. |
| **`focused-terminal.png`** | **1520×980**, valid lower-region output: `BUILD_LINE_16`–`BUILD_LINE_50`, final marker and prompt/cursor. Large black lower rectangle absent. |
| **`tools.png`** | **1520×980**, actual two-task inspector with uniquely scoped status control, persisted doing status and lower terminal output; no toast. |

Before terminal capture, the test awaited **at least 500 ms**, then stable actual PTY dimensions/output sequence and DOM screen bounds for **300 ms**. It typed and independently verified **50 labelled shell output lines**. Native focused dimensions were **155×37**, active screen **1213×666**, viewport/host **1250×695**. Labelled DOM rows and cursor extend below y508 through y850.

Sampled lower active-cell region: **378,879 pixels; 0% black; 95.805% expected `#131d2c` background; 11,457 bright glyph/cursor pixels**. Thin default viewport padding strips are distinguished from the former large rectangle. Screenshot and pixel evidence remain linked to their actual capture fixture.

## Harness and cleanup

Persistent `test/desktop-smoke.mjs` now includes the requested FR02 and FR03 regressions, scopes palette options to the palette dialog (rather than counting options in an open inspector), waits for inline-edit removal/paint before subsequent interactions, preserves focus failures, and isolates failed overlays so independent checks continue.

Commands used for the current build included the standard full suite/capture run and a **fresh full functional completion with `node test/desktop-smoke.mjs --functional-only`**. That latter run produced the final **32/2** result, verified same-build image provenance and performed no additional capture.

Only test/evidence files changed. Only owned apps, fixture servers, validated daemon PIDs and owned fixture shells were stopped. Latest profile directory checked after cleanup: **no host.lock or host.sock**. No user profiles, cloud/model/microphone calls, Docker mutations or real repository commits.

**End envelope task E2E — FR02 / FR03 final verification.**
