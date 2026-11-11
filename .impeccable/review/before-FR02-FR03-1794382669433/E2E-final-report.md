# Task E2E — packaged app, final verification

## Result

**Core functional flow passed. Raw final ledger: 29 passed / 1 failed.** The failure is a test locator in the optional tools screenshot, not a product failure. No remaining functional product defect was reproduced. Visual observation remains in the optional focused-terminal image (see below); this is not an unqualified all-green visual verdict.

Executable tested:

`/home/carlosj/Carlos_World/phantom-workspace/out/Phantom Workspace-linux-x64/phantom-workspace`

Fresh fixture: `/tmp/opencode/phantom-packaged-e2e-BkglHO`; final execution ran 06:57:36–06:57:58 UTC on 2026-11-11. No resume/history aggregation. Original `desktop-checks.json` remains unchanged and is also archived in `before-fix/`. Earlier packaged harness attempts are separate `packaged-attempt-*.json`, not mixed into final counts.

## Packaging verified independently

- `desktop.info.packaged === true`.
- All four launches/restarts succeeded **without `--no-sandbox`**; no sandbox fallback flag used. This verifies default launch behavior, not an audit of every Chromium sandbox mechanism.
- Renderer loaded `resources/app/dist/index.html`, with working directory in the temp fixture and no dev-server URL.
- `/proc/<hostPid>/exe` resolved to bundled **`resources/runtime/node`**.
- Host environment used default **`resources/app/vendor/phantom/bin/phantom.mjs`** and **`resources/browsers`**. Inherited CLI/Node/browser overrides were removed; `settings.phantomPath` remained empty. Only Phantom data was configured for its native integration, outside the workspace; shell separately selected as `/bin/sh` for portable fixture commands.
- Native decision, coordinated card and skill were created through actual forms using that bundled CLI. No model ran.
- Actual live Chromium child executable was under packaged `resources/browsers`; deterministic Node playground used packaged `resources/runtime/node`.

## Functional assertions claimed

1. Isolated empty desktop and real fixture workspace opening through real `workspace.open` (authorized folder-chooser bypass).
2. Three UI-created terminals; portable `printf` typed through real xterm; independent native output/session/PID readback, unique IDs/PIDs.
3. Shell `exit 7` and separate UI process stop, independently verified.
4. Note editing; `0 wasd` typing does not change camera. Real header drag, keyboard resize, zoom, keyboard palette lookup/focus/return.
5. Task form creation and `doing` status persisted. Typed voice text explicitly reviewed into a local task without microphone/cloud.
6. Real Markdown context scan/read/**pin** passes (optional-hash regression fixed).
7. Native Phantom decision/card/skill creation from bundled CLI; native validation error remains visible without false host disconnect.
8. Git panel/API returns actual fixture branch/list. Docker actual availability/owned list queried read-only; no container actions.
9. Services formats actual managed owner object without crash, pins local URL, opens the **scoped pinned row** in actual native browser.
10. Browser UI URL editing reaches the real local server; native DOM contains `REAL_NATIVE_BROWSER_SENTINEL`, ready state complete, no loading. Remote `window.phantom` and `require` are undefined. Inspector and keyboard palette hide and restore native view.
11. Deterministic Node playground returned `SYNTHETIC_NODE_RESULT 42`.
12. Playwright headed/live local run completed with browser kept open, then explicitly stopped through UI. Real nonempty `trace.zip`; **Ver trace grabado en canvas** opened actual native internal trace viewer and its settled DOM loaded. Viewer redirect handled by same-origin inspection, not exact initial-URL equality.
13. Auto-placed canvas nodes do not overlap in native geometry; screenshot physical rectangles also checked independently at both desktop sizes.
14. Immediately after note and geometry edits, actual `BrowserWindow.close()` handshake drained writes. Disk note and height match; daemon PTY remained alive.
15. Warm restart reattached **same session `9029d0fe-2097-4c90-b617-5fec95ad2312`, PID `3240257`**, same history and task continuity, with exactly three sessions/no new shell.
16. Explicit host shutdown/restart yielded **exited/null PID**, preserved history/layout, no auto-started shells. Earlier `lost` expectation for graceful shutdown was a harness bug and is corrected.
17. Separate explicit UI crash fixture created and its running history awaited on disk. Only known fixture daemon PID was SIGKILLed after identity/data-directory validation; reopen yielded **lost/null PID**, retained `CRASH_PERSISTED`, and no new PTY. No arbitrary process was killed.
18. Final renderer console/page-error arrays are empty; no tool recovery boundary crash.

## Final screenshot batch — captured once, each read once

| Image | Validity |
| --- | --- |
| `desktop.png` | Actual packaged app, **1520×980**, populated six-panel overview, nonblank, physically nonoverlapping, legible titles. |
| `narrow.png` | Actual packaged app, **1100×760**, nonblank/nonoverlapping. Terminal status overviews at 38% zoom are deliberate; titles legible. |
| `browser-native.png` | Direct native viewport, **770×375**, real synthetic local fixture heading/sentinel/input/button visible. DOM/URL/loading checked before capture. |
| `focused-terminal.png` | Actual running PTY, **1520×980**, `E2E_1_21` visible. **Visual observation:** large black lower rectangle approximately x257–1485/y508–888. Cause unverified; possible app surface or compositor/capture behavior, not asserted as a diagnosed source defect. |
| `tools.png` | Optional image **not produced**: test queried `Estado local` after two tasks existed, causing strict-locator ambiguity. Failure preserved in ledger. Test source now scopes the named task, syntax-checked only; no rerun/capture loop. |

Native browser capture is separate because renderer-only screenshots can exclude Electron native views. Overview uses the app's actual labeled browser previews. Synthetic fixture content is labeled in workspace name and body.

## Artifacts and cleanup

- Final ledger: **`.impeccable/review/desktop-checks.final.json`** — 29 passed, 1 failed, full errors/native state/runtime paths/session evidence; image-review assessment added without altering raw counts.
- Before-fix ledger: `.impeccable/review/desktop-checks.json` (unchanged).
- Test source: `test/desktop-smoke.mjs`, fresh profile by default, accepts `PHANTOM_TEST_EXECUTABLE`, 120-second execution bound.
- Only this test's apps, local servers, validated daemons and fixture shells were cleaned up. Fixture files retained for coordinator inspection.
- No app-source changes, commits, source renaming, browser-profile access, microphone/model/cloud calls or Docker mutations.

**End envelope task E2E.**
