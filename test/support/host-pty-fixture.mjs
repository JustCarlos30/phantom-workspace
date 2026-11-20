import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export async function until(fn,ms=5000) {const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,30));}throw new Error('Timed out waiting for PTY output');}

export function setupRepository(root, mode) {
  const repository = path.join(root, 'repository');
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ name: 'host-setup-fixture', version: '1.0.0', scripts: { install: 'node install.cjs' } }));
  fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({ name: 'host-setup-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'host-setup-fixture', version: '1.0.0', hasInstallScript: true } } }));
  fs.writeFileSync(path.join(repository, '.npmrc'), 'offline=true\nregistry=http://127.0.0.1:1\nignore-scripts=false\n');
  fs.writeFileSync(path.join(repository, 'install.cjs'), `const fs=require('node:fs');
fs.writeFileSync('install-count',String(Number(fs.existsSync('install-count')?fs.readFileSync('install-count','utf8'):0)+1));
if(fs.existsSync('fail')) {console.error('HOST_SETUP_FIXTURE_FAILED');process.exit(7);}
if(fs.existsSync('slow')) {
  const child=require('node:child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
  fs.writeFileSync('descendant-pid',String(child.pid));
  setInterval(()=>{},1000);
}
`);
  fs.writeFileSync(path.join(repository, mode), 'yes');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Offline npm fixture');
  return { repository, git };
}
