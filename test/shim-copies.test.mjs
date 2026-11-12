import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

// Phantom snapshots reject symlinks, so every shim alias is a real copy that
// dispatches on $0. The copies must stay byte-identical to their source.
const families = {
  'scripts/agent-shims/claude': ['codex'],
  'scripts/browser-shims/xdg-open': ['gio', 'kde-open', 'kde-open5', 'sensible-browser', 'www-browser', 'x-www-browser'],
};

test('shim aliases are executable copies identical to their source', () => {
  for (const [source, aliases] of Object.entries(families)) {
    const original = fs.readFileSync(path.join(root, source));
    for (const alias of aliases) {
      const file = path.join(path.dirname(path.join(root, source)), alias), stat = fs.lstatSync(file);
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${alias} debe ser un archivo normal`);
      assert.ok(stat.mode & 0o111, `${alias} debe ser ejecutable`);
      assert.deepEqual(fs.readFileSync(file), original, `${alias} debe ser idéntico a ${path.basename(source)}`);
    }
  }
});

test('the repository tracks no symlinks or submodules', () => {
  const special = execFileSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(line => /^(120000|160000) /.test(line));
  assert.deepEqual(special, []);
});
