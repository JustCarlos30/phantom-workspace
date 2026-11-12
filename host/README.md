# Persistent host

Run with **system Node**, not Electron:

```sh
/usr/bin/node host/server.mjs --data /absolute/private/state/directory
node --test test/host*.test.mjs
```

The coordinator must build/install `node-pty` against that same Node ABI. The host loads it lazily, so state and integration RPC remain usable when the native dependency is unavailable; terminal creation returns the actual dependency error.

## Public entry points

- `server.mjs`: `createHost({dataDir?, handleIntegration?, shutdownIntegrations?})`, alias `startHost`, returns a promise for `{invoke, close, store, terminals, server, socketPath, emit}`. `invoke(method, payload={})` is async. `close()` is idempotent and awaited. `probeSocket(socketPath)` returns `Promise<boolean>`.
- `../desktop/host-client.mjs`: `connectHost({dataDir?, nodePath?, hostPath?, onEvent?})` returns a promise for `{invoke(method,payload={}), close()}`. Also exports `requestTimeout(method)`: 360s for terminal creation (Git allocation plus dependency setup), 180s for voice transcription, 150s for Phantom/Docker/automation, 60s otherwise. Client close never shuts down the daemon. Transport failures reject outstanding requests as ambiguous; requests are never replayed. Fresh connections deliver `{type:'connection',status:'connected'}`; disconnect/retry failures also notify the callback.
- `store.mjs`: `Store`, `dataHome`, `canonicalFolder`, `validateState`, `validateHistory`, `atomicJSON`, validation helpers `assert`, `object`, `text`, and constants `NODE_TYPES`, `MAX_HISTORY`. Store methods: `persist()`, `getWorkspace(id)`, `open(path)`, `transaction(fn)`.
- `terminals.mjs`: `Terminals`, `dimensions(cols?,rows?)`. Terminal manager methods: `create(workspace,node,options)`, `descriptor(session)`, `get(id)`, `attach(id,fromSeq?)`, `write(id,data)`, `resize(id,cols,rows)`, `stop(id)`, `flush()`, `save()`, `close()`; `capture(session,entry)` is an internal snapshot helper.

Production integration dispatch dynamically imports `handleIntegration` from `../integrations/index.mjs`. Tests may inject it through `createHost`; absent production integrations produce an error, never fabricated success.

## Terminal worktree dependencies

Explicit `terminal.create` allocates or validates a dedicated Git worktree, persists its assignment in `node.data`, then prepares dependencies before spawning the PTY. A setup failure rejects through the existing RPC error flow; the node, branch, worktree and uncommitted changes remain available for retry using the same node ID. Non-Git folders (including unborn repositories) and non-Node projects keep their previous behavior without installation.

`worktree-setup.mjs` exports `prepareWorktree(cwd, {signal?, timeoutMs?, env?, onProgress?})`, `SETUP_TIMEOUT_MS` (240s, including queue wait) and `SETUP_MARKER`. Results have `status: 'installed' | 'reused' | 'skipped'` and `cwd`; skipped results include a reason. This API accepts only Node projects with `package.json` and `package-lock.json`. Shrinkwrap is outside this initial scope: presence of `npm-shrinkwrap.json` skips preparation with reason `unsupported-shrinkwrap`, even alongside package-lock, to avoid fingerprinting a different lock than npm actually installs. A non-npm `packageManager`, non-npm `devEngines.packageManager`, or pnpm/yarn/bun lock/workspace file skips setup even if an npm lock also exists. Lockless Node projects are skipped.

The shell opens before dependency setup. Background setup can take up to four minutes for `npm ci --include=dev --no-audit --no-fund --foreground-scripts`, including normal npm lifecycle/native builds and any required downloads. npm runs as argv with no shell, at the exact canonical worktree cwd. Each worktree owns its installation: no copying or linking source `node_modules`. Setup itself never edits the manifest or lock. npm must be installed and accessible to the system-Node host. Failures include a bounded output tail and recovery instructions.

Only metadata inside `node_modules` is written: `.phantom-worktree-setup.json` records ownership, incomplete/ready state, a package+selected-lock+platform+architecture+Node-ABI fingerprint and an installed-path inventory. Success is recorded atomically only after npm finishes and the inputs still match. A matching ready marker plus intact inventory skips npm; missing modules/files, changed inputs/ABI, or an incomplete managed marker trigger repair. A nonempty manual installation, unreadable marker, or symlinked `node_modules` is preserved and returns an explicit error: move/remove `node_modules` yourself before retrying to authorize a fresh independent installation. An absent or empty directory can be initialized automatically.

Calls for the same canonical cwd serialize within the host; cancellation of a queued caller does not cancel another caller's install. Closing the terminal or host aborts active setup, terminates npm's Linux process group and escalates to SIGKILL for lifecycle descendants before settling. Reconnecting/attaching to a live session and cold host startup never run setup. A new session must be requested explicitly after restart, and reuses a valid installation. Graceful cancellation restores an incomplete marker for retry. An uncatchable crash/power loss during npm's own deletion of `node_modules` can lose that marker: any remaining unmarked nonempty installation is conservatively treated as manual, requiring the explicit move/removal above.

`node scripts/setup-worktree.mjs` calls the same API on this checkout's root, is idempotent, handles SIGINT/SIGTERM and exits unsuccessfully on failure. Importing the script does not install anything. It creates no setup metadata outside `node_modules`.

Integration context includes the resolved `dataDir` alongside workspace/state/persistence/events/live-session descriptors. Close allows a 500ms initial request drain, invokes `shutdownIntegrations()` with a 5s deadline, stops owned PTYs, and allows a 500ms final integration drain. Production cleanup is loaded only when production dispatch has been used; injected fixtures can supply their own cleanup hook without importing production adapters. Cleanup errors reject `close()` after socket/lock cleanup.

## Persistence and limits

- `state.json`: validated schema v1, atomic rename, file and directory fsync. Corrupt files fail visibly without replacement. Imports validate before changing state. Imported histories are journaled in this file until their transfer to `terminals.json` completes, so a crash during import can finish on restart.
- `terminals.json`: session metadata and ANSI snapshots; 100 sessions, 256 Ki characters per snapshot, global 8 MiB UTF-8 history budget, recent sessions preferred. Running sessions become `lost` with no PID on cold startup; nothing is relaunched.
- xterm headless retains a 1,000-line scrollback plus normal/alternate screen state. Snapshots are lazy on attach/export/resize/exit and at most once per second for periodic persistence. Snapshot and sequence are captured together after terminal parsing. Attach always returns a full ANSI snapshot, not a delta; `truncated` indicates an outdated `fromSeq` or exhausted screen/history budgets (`session.historyTruncated`). Clients replace their local terminal before applying it.
- Terminal dimensions: 2–500 columns, 1–300 rows. Keyboard messages: 64 Ki characters. PTY reads pause at a 256 KiB parser backlog and resume below 64 KiB; one OS read may overshoot the high-water mark. Tiny reads coalesce into byte-bounded batches with a 4ms scheduling window. Noisy output never causes automatic process termination. Slow RPC consumers are disconnected rather than buffering unlimited output. Request lines and pending request bytes are capped at 32 MiB; 256 pending requests and 32 connected clients maximum. Each socket reserves eight concurrent control slots separately from eight normal/integration slots, keeping terminal write/stop/resize and state reads responsive during slow integrations.
- Linux abstract socket arbitration prevents simultaneous daemon startups, including after a crash. `host.sock` is mode 0600 inside a 0700 state directory. `host.lock` is diagnostic metadata, not a stale-PID ownership authority.
- `host.log` rotates at the next launch above 1 MiB, retaining one previous log. The daemon logs readiness/startup errors, not terminal input/output. State-home precedence is explicit `--data` / client `dataDir`, `PHANTOM_WORKSPACE_HOME`, then `${XDG_STATE_HOME || ~/.local/state}/phantom-workspace`.
- Stop/shutdown enumerate the owned Linux process session/descendants and validate process start-times before signaling. They do not signal PIDs restored from disk. Client disconnect does not stop processes.
- Removing a live terminal node rejects with an instruction to hide (`data.hidden`) or explicitly stop it first. Stopped-node removal preserves session history. Actual terminal exits and tool `failed`/`completed` events produce durable attention with session/run identity and timestamps, deduplicated per factual event. A completed Phantom process does not imply task acceptance. No idle/blocked status is inferred.
- `terminal.close({workspaceId,nodeId})` explicitly terminates the terminal's process tree, awaits exit and descendant cleanup, and removes the node and its session histories. Creation on the same node rejects while closing. Hiding and stopping remain separate operations.
- Workflow versions accept integers from 1 through 1,000,000; edits may persist version 2 and beyond.

Portable exports omit terminal snapshots by default and whitelist presentation settings; host credential settings are not returned to the renderer. `includeHistory:true` is explicit. Imports never run shells, workflows, or tools. Import requires active host terminals to be stopped.

Dependency progress is reported as `terminal.setup` events and included in session descriptors/attach snapshots (`setup.status`, bounded `output`, errors, timestamps). A failed install leaves the shell and agent running; `terminal.setup.retry` retries for a live session in the same worktree. Stopping/exiting/closing the session or host aborts and reaps setup. Cold host restart marks interrupted preparation cancelled, never silently reruns npm.

Under socket pressure, live terminal chunks are replaced with a coalesced `terminal.resync` event per affected session once the socket drains. The renderer refreshes that screen without transport reconnection or a connecting-status flash. `terminal.attach` uses the control queue so slow integrations cannot starve recovery.
