import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const skillsDir = path.join(root, 'skills');
const allowed = new Set(['id', 'version', 'description', 'actions', 'bodyFile']);
const idPattern = /^[a-z0-9]+(?:[./-][a-z0-9]+)*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const actionPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

function help(script) {
  return execFileSync(process.execPath, [path.join(root, 'scripts', script), 'help'], { encoding: 'utf8' });
}

test('los paquetes de skills tienen esquema y ejemplos de CLI válidos', () => {
  const helps = { 'canvas.mjs': help('canvas.mjs'), 'branches.mjs': help('branches.mjs') };
  const folders = readdirSync(skillsDir).filter(name => statSync(path.join(skillsDir, name)).isDirectory());
  assert.ok(folders.length, 'debe existir al menos un paquete de skill');

  for (const folder of folders) {
    const directory = path.join(skillsDir, folder);
    const manifest = JSON.parse(readFileSync(path.join(directory, 'skill.json'), 'utf8'));
    assert.deepEqual(new Set(Object.keys(manifest)), allowed, `${folder}: campos no permitidos o faltantes`);
    assert.equal(manifest.id, folder);
    assert.match(manifest.id, idPattern);
    assert.match(manifest.version, versionPattern);
    assert.equal(typeof manifest.description, 'string');
    assert.ok(manifest.description.length > 0 && manifest.description.length <= 512);
    assert.ok(Array.isArray(manifest.actions) && manifest.actions.length >= 1 && manifest.actions.length <= 16);
    for (const action of manifest.actions) assert.match(action, actionPattern);
    assert.equal(manifest.bodyFile, 'SKILL.md');

    const body = readFileSync(path.join(directory, manifest.bodyFile));
    assert.ok(body.length > 0 && body.length <= 16384, `${folder}: SKILL.md fuera de límite`);
    assert.doesNotMatch(body.toString('utf8'), /\/home(?:\/|$)/, `${folder}: contiene una ruta absoluta de /home`);

    for (const block of body.toString('utf8').matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
      for (const match of block[1].matchAll(/^\s*(?:node\s+scripts\/(canvas|branches)\.mjs|\$(CANVAS|RAMAS))\s+([a-z-]+)/gm)) {
        const [, directCli, alias, command] = match;
        const cli = directCli || (alias === 'CANVAS' ? 'canvas' : 'branches');
        const script = `${cli}.mjs`;
        assert.match(helps[script], new RegExp(`(?:^|[^a-z-])${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z-])`, 'm'), `${folder}: ${command} no aparece en la ayuda de ${script}`);
      }
    }
  }
});
