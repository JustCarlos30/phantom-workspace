import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { prepareWorktree, SETUP_TIMEOUT_MS } from '../host/worktree-setup.mjs';
import { requestTimeout } from '../desktop/host-client.mjs';
import { write, readMarker, until, fixture } from './support/worktree-setup-fixture.mjs';

test('cancel/timeout kills npm lifecycle descendants, preserves retry, and queued cancellation is independent', async t => {
  const { cwd, options } = await fixture(t);
  write(cwd, 'slow', 'yes');
  const controller = new AbortController();
  const running = prepareWorktree(cwd, { ...options, signal: controller.signal });
  const rejection = assert.rejects(running, /fixture cancellation/);
  await until(() => fs.existsSync(path.join(cwd, 'descendant-pid')));
  const pid = Number(fs.readFileSync(path.join(cwd, 'descendant-pid'), 'utf8'));
  await assert.rejects(prepareWorktree(cwd, { ...options, timeoutMs: 30 }), /excedió/);
  controller.abort(new Error('fixture cancellation'));
  await rejection;
  await until(() => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z'); } catch { return true; } });
  assert.equal(readMarker(cwd).state, 'incomplete');
  fs.unlinkSync(path.join(cwd, 'slow'));
  assert.equal((await prepareWorktree(cwd, options)).status, 'installed');
  fs.writeFileSync(path.join(cwd, 'slow'), 'yes');
  fs.appendFileSync(path.join(cwd, 'package-lock.json'), '\n');
  await assert.rejects(prepareWorktree(cwd, { ...options, timeoutMs: 1500 }), /excedió/);
  assert.equal(readMarker(cwd).state, 'incomplete');
  assert.ok(requestTimeout('terminal.create') > SETUP_TIMEOUT_MS + 60000);
});

for (const termination of ['SIGTERM', 'exit']) {
  test(`isolated setup parent ${termination} reaps a live npm lifecycle group and preserves termination`, async t => {
    const { cwd, options } = await fixture(t);
    write(cwd, 'install.cjs', `const fs=require('node:fs'),{spawn}=require('node:child_process');
const stat=fs.readFileSync('/proc/self/stat','utf8').split(') ')[1].split(' ');
fs.writeFileSync('lifecycle-group',stat[2]);
const child=spawn(process.execPath,['-e',"const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync('descendant-pid',String(process.pid));setInterval(()=>{},1000)"],{stdio:'ignore'});
setInterval(()=>{},1000);
`);
    const moduleURL = new URL('../host/worktree-setup.mjs', import.meta.url).href;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', `
import { prepareWorktree } from ${JSON.stringify(moduleURL)};
process.on('message', () => process.exit(23));
prepareWorktree(${JSON.stringify(cwd)}, ${JSON.stringify(options)}).catch(() => process.exit(91));
`], { cwd, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = new Promise(resolve => {
      parent.once('exit', (code, signal) => resolve({ code, signal }));
      parent.once('error', error => resolve({ error }));
    });
    const stopped = pid => {
      try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z'); }
      catch (error) { if (error.code === 'ENOENT') return true; throw error; }
    };
    try {
      await until(() => fs.existsSync(path.join(cwd, 'descendant-pid')));
      const descendant = Number(fs.readFileSync(path.join(cwd, 'descendant-pid'), 'utf8'));
      const group = Number(fs.readFileSync(path.join(cwd, 'lifecycle-group'), 'utf8'));
      assert.ok(group > 1);
      assert.equal(stopped(group), false, 'npm group leader is alive before parent termination');
      assert.equal(stopped(descendant), false, 'lifecycle descendant is alive before parent termination');
      if (termination === 'exit') parent.send('exit');
      else parent.kill(termination);
      await until(() => parent.exitCode !== null || parent.signalCode !== null);
      assert.deepEqual(await exited, termination === 'exit' ? { code: 23, signal: null } : { code: null, signal: 'SIGTERM' });
      await until(() => stopped(group) && stopped(descendant));
    } finally {
      if (parent.exitCode === null && parent.signalCode === null && parent.pid) {
        let children = '';
        try { children = fs.readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`, 'utf8').trim(); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        for (const pid of children.split(/\s+/).map(Number).filter(pid => pid > 1)) {
          try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
      }
      if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
      await exited;
      const groupFile = path.join(cwd, 'lifecycle-group');
      if (fs.existsSync(groupFile)) {
        const group = Number(fs.readFileSync(groupFile, 'utf8'));
        if (group > 1) try { process.kill(-group, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
  });
}

test('setup CLI module is inert when imported', async () => {
  const module = await import('../scripts/setup-worktree.mjs');
  assert.equal(typeof module.setupCurrentWorktree, 'function');
});
