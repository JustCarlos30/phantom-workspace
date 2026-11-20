import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, validateState } from '../host/store.mjs';

function fixture(t) {const root=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-store-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('canonical workspace identity, same basenames, empty folder, missing paths',t=>{
  const root=fixture(t),store=new Store(path.join(root,'state'));
  const a=path.join(root,'a','project'),b=path.join(root,'b','project');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b,{recursive:true});fs.symlinkSync(a,path.join(root,'alias'));
  const first=store.transaction(()=>store.open(a));const alias=store.transaction(()=>store.open(path.join(root,'alias')));const second=store.transaction(()=>store.open(b));
  assert.equal(first.id,alias.id);assert.notEqual(first.id,second.id);assert.equal(first.name,second.name);
  assert.throws(()=>store.open(''));assert.throws(()=>store.open(path.join(root,'missing')));assert.throws(()=>store.open('relative'));
  fs.rmdirSync(a);store.flush();const restored=new Store(store.dir);assert.equal(restored.state.workspaces.length,2);assert.equal(restored.state.workspaces[0].id,first.id);
  assert.equal(fs.statSync(store.dir).mode&0o777,0o700);assert.equal(fs.statSync(store.filename).mode&0o777,0o600);
});
test('invalid transactions/imports preserve durable state; corrupt state fails visibly',t=>{
  const root=fixture(t),store=new Store(path.join(root,'state'));store.transaction(()=>store.open(root));store.flush();const before=fs.readFileSync(store.filename,'utf8');
  assert.throws(()=>store.transaction(()=>{store.state.workspaces[0].camera.zoom=-1;}));assert.equal(fs.readFileSync(store.filename,'utf8'),before);
  const duplicate=structuredClone(store.state);duplicate.workspaces.push({...duplicate.workspaces[0]});assert.throws(()=>validateState(duplicate));
  fs.writeFileSync(store.filename,'{broken');assert.throws(()=>new Store(store.dir));assert.equal(fs.readFileSync(store.filename,'utf8'),'{broken');
});
