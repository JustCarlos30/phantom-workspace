import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wrapper = fileURLToPath(new URL('../scripts/build-latest.mjs', import.meta.url));

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('dry-run selects the registered primary, even from an ahead linked worktree and unrelated cwd', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom latest '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const primary = path.join(root, 'primary with spaces');
  const linked = path.join(root, 'linked with spaces');
  const elsewhere = path.join(root, 'unrelated cwd');
  const bin = path.join(root, 'fake bin');
  await mkdir(path.join(primary, 'scripts'), { recursive: true });
  await mkdir(elsewhere);
  await mkdir(bin);
  await copyFile(wrapper, path.join(primary, 'scripts', 'build-latest.mjs'));
  git(primary, 'init', '-b', 'integrate/main');
  git(primary, 'config', 'user.name', 'Build test');
  git(primary, 'config', 'user.email', 'build@example.invalid');
  git(primary, 'config', 'commit.gpgsign', 'false');
  git(primary, 'add', '.');
  git(primary, 'commit', '-m', 'Primary source');
  const primarySha = git(primary, 'rev-parse', 'HEAD');
  git(primary, 'worktree', 'add', '-b', 'newer-linked', linked);
  await writeFile(path.join(linked, 'ahead.txt'), 'newer linked commit\n');
  git(linked, 'add', '.');
  git(linked, 'commit', '-m', 'Linked is ahead');
  const linkedSha = git(linked, 'rev-parse', 'HEAD');
  assert.notEqual(primarySha, linkedSha);
  await writeFile(path.join(primary, 'local change.txt'), 'include local state\n');
  const marker = path.join(root, 'npm-was-run');
  await writeFile(path.join(bin, 'npm'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected');\nprocess.exit(91);\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [path.join(linked, 'scripts', 'build-latest.mjs'), '--dry-run'], {
    cwd: elsewhere, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PLAYWRIGHT_BROWSERS_PATH: path.join(primary, 'out', 'browsers'), ELECTRON_RUN_AS_NODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Carpeta principal: ${primary}\n`));
  assert.ok(result.stdout.includes('Rama: integrate/main\n'));
  assert.ok(result.stdout.includes(`SHA: ${primarySha}\n`));
  assert.ok(!result.stdout.includes(linkedSha));
  assert.ok(result.stdout.includes('Cambios sin commit: sí'));
  assert.ok(result.stdout.includes(path.join(primary, 'out', 'Phantom Workspace-linux-x64', 'phantom-workspace')));
  const ci = result.stdout.indexOf('"ci" "--include=dev" "--no-audit" "--no-fund"');
  const browser = result.stdout.indexOf('"node_modules/playwright/cli.js" "install" "chromium"');
  const pack = result.stdout.indexOf('"run" "package"');
  assert.ok(ci >= 0 && browser > ci && pack > browser);
  assert.ok(!result.stdout.includes(`PLAYWRIGHT_BROWSERS_PATH=${path.join(primary, 'out', 'browsers')}`));
  assert.ok(result.stdout.includes('ELECTRON_RUN_AS_NODE: eliminado'));
  for (const absent of [marker, path.join(primary, 'node_modules'), path.join(linked, 'node_modules'), path.join(primary, 'out')]) {
    await assert.rejects(access(absent), { code: 'ENOENT' });
  }
  assert.equal(git(primary, 'status', '--porcelain'), '?? "local change.txt"');
});

test('help works outside Git and unknown arguments fail before resolving a repository', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'phantom latest help '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const standalone = path.join(root, 'build-latest.mjs');
  await copyFile(wrapper, standalone);
  const help = spawnSync(process.execPath, [standalone, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--dry-run/);
  assert.match(help.stdout, /LOCAL/);
  for (const args of [['--unknown'], ['--help', '--unknown']]) {
    const result = spawnSync(process.execPath, [standalone, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Argumento desconocido: --unknown/);
    assert.doesNotMatch(result.stdout, /Build completado/);
  }
});
