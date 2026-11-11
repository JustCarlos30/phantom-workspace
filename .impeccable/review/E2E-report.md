# Task E2E — real integrated desktop verification

## Verdict

**Failed overall.** Real Electron production-dist app tested on `DISPLAY=:1`, with isolated Electron/host/Phantom data and a synthetic Git/local HTTP fixture. No bridge replacement, source changes, user profiles, real model/cloud calls, microphone recording, Docker mutations, or repository commits.

Raw execution ledger: `desktop-checks.json` contains **24 passed and 11 failed assertions**, including preserved early harness failures and their focused continuation results. These counts are assertion history, not 35 independent product verdicts. Original blocker: `first-run-blocker.json`.

## Confirmed product issues for coordinator

1. **Services blanks the entire renderer.** Create real terminal sessions; open Services inspector and pin a localhost URL. `services.list` includes `owner: {pid, sessionId}` on managed services. `Services` in `src/components/ToolPanels.jsx` interpolates `service.owner` directly into JSX. Production renderer throws **React error #31: object with keys {pid, sessionId}**. Stack starts `lo (dist/assets/index-BTr5fg4y.js:8:39497)`, `Q (:8:41341)`, `ue (:8:42750)`, `Ae (:8:44922)`; full stack in JSON. Reproduced with fish and with `/bin/sh`. Pinned record reaches disk; opening it through Services UI is blocked by the crash. Test reloads after the recorded failure to continue independent checks.

2. **Context document pin fails validation.** Open Context, read real `E2E.md`, click **Fijar referencia**. UI displays `Error invoking remote method 'phantom:invoke': Error: Payload debe ser JSON serializable`; native `contextRefs` stays empty. `Context` creates `ref: {path, hash: item.hash || item.sha256}`; when scan returns no hash this includes `undefined`, which strict desktop validation rejects. Scan and read work. Native decision creation afterward and host inspection remain available; this is not transport loss.

3. **Requested cold-reopen status differs.** Explicit `desktop.quit({stopHost:true})`, reopen same profile. Layout equality and no running/new PTYs passed before the status assertion. Historical session is **`exited`**, expected **`lost`** under the requested E2E acceptance. Disk independently confirms all four descriptors have `pid:null` and preserved terminal snapshots, including `E2E_1_21`. Graceful shutdown records exit before cold load; coordinator should resolve whether acceptance or implementation should change. Do not claim a lost-state pass.

## Verified passes

- Empty state, real workspace opening via the authorized chooser bypass, isolated `desktop.info.dataDir`.
- Three terminals created by actual dock UI, portable shell `printf` typed through xterm; output read independently through `terminal.attach`, with distinct session IDs/PIDs and running status. Shell `exit 7` independently reports exited/7; explicit stop uses the UI separately.
- Note editing, text `0 wasd` leaves camera unchanged; real header drag, keyboard resize, zoom, palette panel lookup/focus, return to map.
- Local task form creation and `doing` status persisted; typed voice transcript explicitly converted to a second local task.
- Real context Markdown scan/read. Native Phantom decision, coordinated card and skill created by actual JSON forms against sibling `harness_engineer/bin/phantom.mjs`, with isolated `settings.phantomData`. No model run.
- Git panel/API sees committed fixture branch `fixture-main`. Docker list interrogates actual environment read-only; response preserved in JSON.
- Deterministic Node playground via UI returned `SYNTHETIC_NODE_RESULT 42`.
- Native browser URL navigation after initial attach settles: native remote webcontents URL matches local server; body contains `REAL_NATIVE_BROWSER_SENTINEL`; `typeof window.phantom` and `typeof require` are both `undefined`. Inspector/palette hide the native view and closing overlays restores visibility.
- Playwright started live via UI against local fixture, explicitly stopped via UI, then `automation.trace` returned a real nonempty `trace.zip`. Asking for trace before live run stops was a harness sequencing error, retained in the ledger and corrected in continuation.
- Immediate close after note plus geometry edit: actual `BrowserWindow.close()` triggered renderer close handshake; saved note was on disk and PTY PID **3188234** remained alive. Same profile restart reattached **same session `627e3236-1b05-4bcf-ac26-590b31c53e05` and PID 3188234**, with history and no additional shell. Playwright inspector can hold a windowless debug Electron process open; continuation waits for real renderer closure, then terminates only its own windowless debug process before relaunch. Earlier application-process `close` timeout was a harness lifecycle assertion, not evidence of failed persistence.

## Visual evidence — one capture pass only, inspected

- `desktop.png`: actual app renderer, **1520×980**, nonblank. Synthetic workspace and five panels exist, but overlapping panels obscure terminal/note content. This is insufficient as a clean populated overview.
- `narrow.png`: actual app renderer, **1100×760**, nonblank, same overlap limitation.
- `browser-native.png`: direct native `browser.capture`, **blank white** because the first capture preceded corrected settled navigation. **Not a validated browser viewport image.** Later native DOM/URL/sandbox checks pass, but no second visual capture was taken per one-pass constraint.

No visual success is claimed from capture operations alone. Visual inspection failure is appended explicitly in JSON. No redesign or aesthetic iteration performed.

## Artifacts and cleanup

Test source: `test/desktop-smoke.mjs`; optional packaged executable: `PHANTOM_TEST_EXECUTABLE`. Per execution deadline: 120 seconds. Focused continuation can use `PHANTOM_TEST_FIXTURE` with its own prior synthetic fixture; raw prior failures remain.

Primary fixture retained for evidence: `/tmp/opencode/phantom-e2e-LJ0z2B`. First fixture: `/tmp/opencode/phantom-e2e-tdbRLS`. Only this test's Electron processes, HTTP servers and owned host daemons were stopped. Primary fixture's host lock is absent after cleanup; native terminal disk descriptors have null PIDs.

**End envelope task E2E.**
