import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { phantomInstructions } from '../host/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const actions = ['branch.integrate', 'verify.prepublish', 'release.build', 'canvas.organize', 'research.collect', 'env.service'];

test('instructions name the published skill actions', () => {
  const text = phantomInstructions({ name: 'p', canonicalPath: '/p', nodes: [] });
  assert.match(text, /skills_resolve/);
  for (const action of actions) assert.ok(text.includes(action), `missing ${action}`);

  const skillFiles = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, 'skills', entry.name, 'skill.json'))
    .filter(file => fs.existsSync(file));
  const published = skillFiles.flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')).actions || []);
  for (const action of actions) assert.ok(published.includes(action), `no skill publishes ${action}`);
});
