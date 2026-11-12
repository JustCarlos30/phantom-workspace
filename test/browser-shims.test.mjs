import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { browserShims, provisionBrowserTerminal } from '../host/agent-browser.mjs';

// Fake system openers record their argv; a fake bridge CLI records what reached the panel.
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-shims-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sys = path.join(dir, 'sys'); await fs.mkdir(sys);
  const log = path.join(dir, 'log');
  for (const name of ['xdg-open', 'gio']) {
    await fs.writeFile(path.join(sys, name), `#!/bin/sh\necho "system:${name}:BROWSER=$BROWSER:$*" >> "${log}"\n`, { mode: 0o755 });
  }
  const cli = path.join(dir, 'cli.mjs');
  await fs.writeFile(cli, `import fs from 'node:fs';\nif (process.env.FAIL) process.exit(1);\nfs.appendFileSync(${JSON.stringify(log)}, 'panel:' + process.argv.slice(2).join(' ') + '\\n');\nconsole.log('{}');\n`);
  const capability = provisionBrowserTerminal(dir, { sessionId: randomUUID(), workspaceId: randomUUID(), nodeId: randomUUID() },
    { PATH: `${sys}:/usr/bin:/bin`, BROWSER: 'firedragon' });
  t.after(() => capability.revoke());
  const env = { ...capability.env, PHANTOM_BROWSER_CLI: cli, PHANTOM_AGENT_NODE: process.execPath };
  const run = (cmd, args, extra = {}) => spawnSync(cmd, args, { env: { ...env, ...extra }, encoding: 'utf8' });
  const read = async () => (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
  return { env, run, read, log };
}

test('terminal env puts the shims first and points $BROWSER at them, remembering the original', async t => {
  const { env } = await fixture(t);
  assert.equal(env.PATH.split(':')[0], browserShims);
  assert.equal(env.BROWSER, path.join(browserShims, 'xdg-open'));
  assert.equal(env.PHANTOM_BROWSER_ORIGINAL, 'firedragon');
  const nested = provisionBrowserTerminal(await fs.mkdtemp(path.join(os.tmpdir(), 'phantom-shims-n-')), { sessionId: randomUUID(), workspaceId: randomUUID(), nodeId: randomUUID() }, env);
  assert.equal(nested.env.PATH.split(':').filter(dir => dir === browserShims).length, 1);
  assert.equal(nested.env.PHANTOM_BROWSER_ORIGINAL, 'firedragon');
  nested.revoke();
});

test('http(s) opens land in the integrated panel through every shimmed opener', async t => {
  const { run, read, env } = await fixture(t);
  for (const name of ['xdg-open', 'sensible-browser', 'x-www-browser', 'kde-open5']) {
    assert.equal(run(path.join(browserShims, name), ['http://localhost:5173/']).status, 0);
  }
  assert.equal(run(env.BROWSER, ['https://example.test/a?b=1']).status, 0);
  assert.equal(run('xdg-open', ['http://localhost:8400/live']).status, 0); // resolved through PATH
  assert.equal(run(path.join(browserShims, 'gio'), ['open', 'http://localhost:3000/']).status, 0);
  assert.deepEqual(await read(), [
    ...Array(4).fill('panel:open http://localhost:5173/'),
    'panel:open https://example.test/a?b=1', 'panel:open http://localhost:8400/live', 'panel:open http://localhost:3000/']);
});

test('non-URL targets, opt-out and bridge failures never loop and never silently go external', async t => {
  const { run, read } = await fixture(t);
  assert.equal(run(path.join(browserShims, 'xdg-open'), ['/tmp/report.pdf']).status, 0);
  assert.equal(run(path.join(browserShims, 'gio'), ['info', '/tmp']).status, 0);
  assert.equal(run(path.join(browserShims, 'xdg-open'), ['http://localhost/'], { PHANTOM_BROWSER_EXTERNAL: '1' }).status, 0);
  assert.equal(run(path.join(browserShims, 'sensible-browser'), ['http://localhost/'], { PHANTOM_BROWSER_EXTERNAL: '1' }).status, 0);
  const failed = run(path.join(browserShims, 'xdg-open'), ['http://localhost/'], { FAIL: '1' });
  assert.equal(failed.status, 1); assert.match(failed.stderr, /navegador integrado/);
  assert.deepEqual(await read(), [
    'system:xdg-open:BROWSER=firedragon:/tmp/report.pdf', 'system:gio:BROWSER=firedragon:info /tmp',
    'system:xdg-open:BROWSER=firedragon:http://localhost/', 'system:xdg-open:BROWSER=firedragon:http://localhost/']);
});
