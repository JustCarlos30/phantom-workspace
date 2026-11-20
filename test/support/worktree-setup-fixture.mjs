import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SETUP_MARKER } from '../../host/worktree-setup.mjs';

export const execute = promisify(execFile);
export const write = (cwd, name, value) => fs.writeFileSync(path.join(cwd, name), typeof value === 'string' ? value : JSON.stringify(value));
export const readMarker = cwd => JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules', SETUP_MARKER), 'utf8'));
export const count = cwd => Number(fs.readFileSync(path.join(cwd, 'install-count'), 'utf8'));
export async function until(fn) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('Fixture did not reach expected state');
}
export async function fixture(t, { electron = false } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom npm worktree-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const env = { npm_config_offline: 'true', npm_config_registry: 'http://127.0.0.1:1', npm_config_ignore_scripts: 'false', npm_config_cache: path.join(cwd, 'cache') };
  fs.mkdirSync(path.join(cwd, 'local-tool'));
  write(cwd, 'local-tool/package.json', { name: 'local-tool', version: '1.0.0', bin: { 'fixture-tool': 'cli.cjs' } });
  write(cwd, 'local-tool/cli.cjs', '#!/usr/bin/env node\nconsole.log("LOCAL_OFFLINE_TOOL");\n');
  fs.chmodSync(path.join(cwd, 'local-tool/cli.cjs'), 0o755);
  const dependencies = { 'local-tool': 'file:./local-tool' };
  if (electron) {
    // Mirrors electron@45+: no postinstall, the binary is fetched by install.js.
    fs.mkdirSync(path.join(cwd, 'local-electron'));
    write(cwd, 'local-electron/package.json', { name: 'electron', version: '45.0.0', bin: { 'install-electron': 'install.js' } });
    write(cwd, 'local-electron/install.js', `const fs=require('node:fs'),path=require('node:path');
const count=path.join(__dirname,'..','electron-installs');
fs.writeFileSync(count,String(Number(fs.existsSync(count)?fs.readFileSync(count,'utf8'):0)+1));
fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'dist','electron'),'');
fs.writeFileSync(path.join(__dirname,'path.txt'),'electron');
`);
    dependencies.electron = 'file:./local-electron';
  }
  write(cwd, 'package.json', { name: 'offline-fixture', version: '1.0.0', private: true, dependencies, scripts: { install: 'node install.cjs' } });
  write(cwd, 'install.cjs', `const fs=require('node:fs');
fs.writeFileSync('install-count',String(Number(fs.existsSync('install-count')?fs.readFileSync('install-count','utf8'):0)+1));
if(fs.existsSync('loud')) console.error('x'.repeat(100000));
if(fs.existsSync('fail')) {console.error('FIXTURE_INSTALL_FAILED');process.exit(7);}
if(fs.existsSync('pause')) {
  fs.writeFileSync('install-waiting','yes');
  const timer=setInterval(()=>{if(fs.existsSync('release')) clearInterval(timer);},25);
}
if(fs.existsSync('slow')) {
  const {spawn}=require('node:child_process');
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
  fs.writeFileSync('descendant-pid',String(child.pid));
  setInterval(()=>{},1000);
}
`);
  // Only local file dependencies: offline mode and an unreachable registry prove
  // the real npm lock generation/ci path cannot rely on a network service.
  await execute('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd, env: { ...process.env, ...env }, timeout: 15000 });
  return { cwd, options: { env } };
}
