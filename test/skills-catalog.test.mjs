import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skillsCatalog, skillsRead, parseFrontmatter } from '../integrations/skills.mjs';
import { buildCatalog, parseBlocks, phantomEntry } from '../src/hooks/skills-model.mjs';

function skill(dir, name, front = `name: ${name}\ndescription: Hace ${name}`) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${front}\n---\n# ${name}\n\nCuerpo de ${name}.\n`);
}

test('catalog discovers project, user, plugin, codex and opencode skills with origins', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-')), home = path.join(tmp, 'home'), project = path.join(tmp, 'project');
  skill(path.join(project, '.claude/skills/local'), 'local');
  skill(path.join(home, '.claude/skills/alpha'), 'alpha', 'name: alpha\ndescription: >\n  Línea uno\n  línea dos\nmetadata:\n  version: 2.1.0');
  skill(path.join(home, '.claude/skills/synced/abc/pdf'), 'pdf');
  const plugin = path.join(home, '.claude/plugins/cache/m/p/1.0.0');
  skill(path.join(plugin, 'skills/beta'), 'beta');
  fs.writeFileSync(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'p@m': [{ installPath: plugin, version: '1.0.0' }] } }));
  skill(path.join(home, '.codex/skills/.system/gamma'), 'gamma');
  skill(path.join(home, '.config/opencode/skills/alpha'), 'alpha');
  fs.mkdirSync(path.join(home, '.claude/skills/alpha/references'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/skills/alpha/references/x.md'), 'x');
  const context = { workspace: { path: project, canonicalPath: project }, home };
  const { items } = await skillsCatalog({}, context);
  const by = name => items.filter(item => item.name === name);
  assert.equal(by('local')[0].origin, 'project');
  assert.equal(by('alpha').length, 2);
  const alpha = by('alpha').find(item => item.agent === 'Claude Code');
  assert.equal(alpha.description, 'Línea uno línea dos');
  assert.equal(alpha.version, '2.1.0');
  assert.deepEqual(alpha.folders, ['references']);
  assert.equal(by('pdf')[0].group, 'Claude Code · sincronizadas');
  assert.equal(by('beta')[0].plugin, 'p');
  assert.equal(by('gamma')[0].agent, 'Codex');
  const detail = await skillsRead({ id: alpha.id }, context);
  assert.match(detail.body, /Cuerpo de alpha/);
  assert.equal(detail.files.length, 1);
  await assert.rejects(skillsRead({ id: path.join(tmp, 'SKILL.md') }, context), /not found/);
  await assert.rejects(skillsRead({ id: '../SKILL.md' }, context), /Invalid/);
});

test('frontmatter tolerates quotes and missing blocks', () => {
  assert.deepEqual(parseFrontmatter('---\nname: "x"\ndescription: \'y\'\n---\nbody').meta, { name: 'x', description: 'y' });
  assert.equal(parseFrontmatter('no front').body, 'no front');
});

test('buildCatalog filters, groups by origin and reports copies', () => {
  const entries = [
    { id: '1', name: 'pdf', description: 'PDF', origin: 'installed', agent: 'Claude Code', group: 'A', folders: [] },
    { id: '2', name: 'pdf', description: 'PDF', origin: 'installed', agent: 'Codex', group: 'B', folders: [] },
    { id: '3', name: 'local', description: 'Mine', origin: 'project', agent: 'Claude Code', group: '.claude/skills', folders: [] },
    phantomEntry({ id: 'proj/x', title: 'Hace x', ref: { id: 'proj/x', scope: 'workspace', version: '1.0.0', sha256: 'a' } }),
  ];
  const all = buildCatalog(entries);
  assert.deepEqual(all.groups.map(group => group.origin), ['project', 'phantom', 'installed', 'installed']);
  assert.deepEqual(all.counts, { project: 1, worktree: 0, phantom: 1, installed: 2 });
  assert.equal(all.copiesOf(entries[0])[0].id, '2');
  assert.equal(buildCatalog(entries, { agent: 'Codex' }).visible, 1);
  assert.equal(buildCatalog(entries, { query: 'mine' }).visible, 1);
  assert.equal(buildCatalog(entries, { origin: 'phantom' }).groups[0].items[0].description, 'Hace x');
});

test('markdown parser recognizes the common skill blocks', () => {
  const blocks = parseBlocks('# T\n\nText **b**\n\n- a\n- b\n\n```js\nx()\n```\n\n> q\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---');
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'list', 'code', 'quote', 'table', 'rule']);
  assert.equal(blocks[3].text, 'x()');
  assert.deepEqual(blocks[5].rows, [['1', '2']]);
});

test('Skills that only exist or differ in another worktree are listed once, with their branch', async t => {
  const { execFileSync } = await import('node:child_process'); const fsp = fs.promises;
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'phantom-skills-trees-'))), repo = path.join(root, 'repo'), tree = path.join(root, 'tree'), home = path.join(root, 'home');
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const write = async (dir, name, description) => { await fsp.mkdir(path.join(dir, '.claude/skills', name), { recursive: true }); await fsp.writeFile(path.join(dir, '.claude/skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`); };
  await fsp.mkdir(repo, { recursive: true }); await fsp.mkdir(home);
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });
  git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.name', 'Fixture'); git(repo, 'config', 'user.email', 'fixture@localhost');
  await write(repo, 'same', 'Same'); await write(repo, 'changed', 'Original'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Base');
  const branch = 'phantom/terminal-362f2765-6c0b-498c-81c8-aab82e02f145';
  git(repo, 'worktree', 'add', '-b', branch, tree, 'HEAD');
  await write(tree, 'changed', 'Edited in the branch'); await write(tree, 'fresh', 'Only here');
  const workspace = { path: repo, canonicalPath: repo, nodes: [{ id: 'n1', type: 'terminal', title: 'Sidebar', data: { worktree: { branch } } }] };
  const catalog = await skillsCatalog({}, { workspace, home });
  assert.deepEqual(catalog.items.filter(item => item.origin === 'project').map(item => item.name).sort(), ['changed', 'same']);
  const drifted = catalog.items.filter(item => item.origin === 'worktree');
  assert.deepEqual(drifted.map(item => [item.name, item.drift, item.branch, item.worktreeLabel, item.group]).sort(), [['changed', 'modified', branch, 'Sidebar', 'En rama · Sidebar'], ['fresh', 'new', branch, 'Sidebar', 'En rama · Sidebar']]);
  assert.deepEqual(catalog.worktrees.map(item => [item.label, item.new, item.modified]), [['Sidebar', 1, 1]]);
  // A worktree copy is readable through the same authorization as any discovered skill.
  const detail = await skillsRead({ id: drifted.find(item => item.name === 'fresh').id }, { workspace, home });
  assert.equal(detail.description, 'Only here');
});
