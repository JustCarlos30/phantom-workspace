import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Chats } from '../host/chats.mjs';
import { codexModels } from '../host/chat-models.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-models-'));
  const store = { dir: root, state: { settings: {} } };
  const chats = new Chats(store, () => {});
  t.after(async () => { await chats.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const fixture = (name, body) => {
    const bin = path.join(root, name);
    fs.writeFileSync(bin, `#!${process.execPath}\n${body}`, { mode: 0o755 });
    return bin;
  };
  const workspace = { canonicalPath: root }, node = provider => ({ data: { chat: { provider } } });
  return { root, store, chats, fixture, workspace, node };
}

const rpc = body => `
const readline=require('node:readline');
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
let initialized=false;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize') {
  if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['app-server','--listen','stdio://']) || m.id!==1 || m.params.clientInfo.name!=='phantom-workspace' || m.params.clientInfo.version!=='0.1.0') process.exit(9);
  send({id:1,result:{}});
 } else if(m.method==='initialized') initialized=true;
 else if(m.method==='model/list') {
  if(!initialized || m.params.limit!==100) process.exit(8);
  ${body}
 }
});`;

test('OpenCode respeta cwd, PWD, binario, ANSI y caché por contexto', async t => {
  const { root, store, chats, fixture, workspace, node } = setup(t);
  const dir = path.join(root, 'card'); fs.mkdirSync(dir);
  const log = path.join(root, 'calls');
  const make = label => `const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},${JSON.stringify(label)}+':'+process.cwd()+':'+process.env.PWD+'\\n');
    if(process.argv[2]!=='models')process.exit(2);
    process.stdout.write('\\x1b[32m${label}/one\\x1b[0m\\r\\n${label}/one\\r\\n${label}/two\\r\\nruido');`;
  store.state.settings.opencodePath = fixture('oc-a', make('a'));
  const card = node('opencode'); card.data.cwd = dir;
  // Claude-only: el catálogo OpenCode ya no se consulta ni se ejecuta el binario.
  await assert.rejects(chats.models(workspace, card), /Claude/);
  assert.equal(fs.existsSync(log), false);
});

test('OpenCode reintenta catálogos vacíos y errores', async t => {
  const { root, store, chats, fixture, workspace, node } = setup(t);
  const state = path.join(root, 'state');
  store.state.settings.opencodePath = fixture('oc', `const fs=require('fs'),p=${JSON.stringify(state)};const n=fs.existsSync(p)?Number(fs.readFileSync(p)):0;fs.writeFileSync(p,String(n+1));if(n===0)console.log('vacío');else if(n===1){console.error('falló');process.exit(3);}else console.log('ok/model');`);
  await assert.rejects(chats.models(workspace, node('opencode')), /Claude/);
  await assert.rejects(chats.models(workspace, node('opencode')), /Claude/);
  assert.equal(fs.existsSync(state), false);
});

test('Codex negocia protocolo, pagina, filtra y deduplica por model', async t => {
  const { root, store, chats, fixture, workspace, node } = setup(t);
  const dir = path.join(root, 'card'); fs.mkdirSync(dir);
  const log = path.join(root, 'calls');
  const bin = fixture('codex', `const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},process.cwd()+':'+process.env.PWD+'\\n');` + rpc(`
    if(!m.params.cursor) send({id:m.id,result:{data:[{id:'other',model:'test-one',hidden:false},{model:'secret',hidden:true},{model:'--invalid'},{model:'test-one'}],nextCursor:'page-2'}});
    else if(m.params.cursor==='page-2') send({id:m.id,result:{data:[{model:'test-one'},{model:'test-two'}],nextCursor:null}});
    else process.exit(7);`));
  store.state.settings.codexPath = bin;
  const card = node('codex'); card.data.cwd = dir;
  // Claude-only: chats.models rechaza Codex sin ejecutar su binario; el protocolo se prueba directo.
  await assert.rejects(chats.models(workspace, card), /Claude/);
  assert.equal(fs.existsSync(log), false);
  const expected = [{ id: 'test-one', group: 'Codex' }, { id: 'test-two', group: 'Codex' }];
  assert.deepEqual(await codexModels(bin, dir), expected);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [`${dir}:${dir}`]);
});

test('Codex informa binario ausente, error RPC y salida prematura', async t => {
  const { root, fixture } = setup(t);
  await assert.rejects(codexModels(path.join(root, 'missing'), root), /No se encontró/);
  await assert.rejects(codexModels(fixture('rpc-error', rpc(`send({id:m.id,error:{code:-1,message:'sin acceso'}});`)), root), /error RPC: sin acceso/);
  await assert.rejects(codexModels(fixture('exit', `console.error('fallo simulado');process.exit(4);`), root), /terminó antes.*fallo simulado/);
  await assert.rejects(codexModels(fixture('invalid', `console.log('no es JSON');setInterval(()=>{},1000);`), root), /protocolo JSON inválida/);
});

test('Codex no cachea vacío ni error y permite reintentar', async t => {
  const { root, store, chats, fixture, workspace, node } = setup(t);
  const state = path.join(root, 'count');
  store.state.settings.codexPath = fixture('codex-retry', `const fs=require('fs'),p=${JSON.stringify(state)};const n=fs.existsSync(p)?Number(fs.readFileSync(p)):0;fs.writeFileSync(p,String(n+1));` + rpc(`
    if(n===0) send({id:m.id,result:{data:[],nextCursor:null}});
    else if(n===1) send({id:m.id,error:{message:'temporal'}});
    else send({id:m.id,result:{data:[{model:'recovered'}],nextCursor:null}});`));
  await assert.rejects(codexModels(store.state.settings.codexPath, root), /vacío/);
  await assert.rejects(codexModels(store.state.settings.codexPath, root), /temporal/);
  assert.equal((await codexModels(store.state.settings.codexPath, root))[0].id, 'recovered');
  await assert.rejects(chats.models(workspace, node('codex')), /Claude/);
  assert.equal(fs.readFileSync(state, 'utf8'), '3');
});

test('Codex corta cursores repetidos y respeta el plazo global', async t => {
  const { root, fixture } = setup(t);
  const loop = fixture('loop', rpc(`send({id:m.id,result:{data:[{model:'one'}],nextCursor:'repeat'}});`));
  await assert.rejects(codexModels(loop, root), /paginación/);
  const hang = fixture('hang', `setInterval(()=>{},1000);`);
  await assert.rejects(codexModels(hang, root, { timeoutMs: 150 }), /tiempo de espera agotado/);
});

test('Codex termina el hijo incluso si ignora SIGTERM', async t => {
  const { root, fixture } = setup(t), pidfile = path.join(root, 'pid');
  const bin = fixture('stubborn', `require('fs').writeFileSync(${JSON.stringify(pidfile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
  await assert.rejects(codexModels(bin, root, { timeoutMs: 300 }), /tiempo de espera/);
  const pid = Number(fs.readFileSync(pidfile, 'utf8'));
  const end = Date.now() + 3000;
  let alive = true;
  while (alive && Date.now() < end) {
    await new Promise(resolve => setTimeout(resolve, 50));
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
  }
  assert.equal(alive, false, 'el hijo debe desaparecer tras SIGKILL');
});
