import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { connectHost } from '../desktop/host-client.mjs';

async function fixture(t) {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-reconnect-'));
  const sockets=new Set(),requests=[];
  let client,connections=0;
  const server=net.createServer(socket=>{
    connections++;sockets.add(socket);
    socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    socket.setEncoding('utf8');let buffer='';
    socket.on('data',chunk=>{
      buffer+=chunk;let i;
      while((i=buffer.indexOf('\n'))>=0){
        const request=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);
        requests.push(request);
        if(request.method==='hold')server.emit('held',socket);
        else socket.write(JSON.stringify({id:request.id,result:'OK'})+'\n');
      }
    });
  });
  t.after(async()=>{
    client?.close();for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  });
  server.listen(path.join(dataDir,'host.sock'));await once(server,'listening');
  client=await connectHost({dataDir});
  async function hold() {
    const held=once(server,'held');
    const outcome=client.invoke('hold').then(()=>assert.fail('Expected disconnect'),error=>error);
    const [socket]=await held;
    return {socket,outcome};
  }
  return {client,server,hold,requests,get connections(){return connections;}};
}

test('stale transport failures preserve the reconnected socket', {timeout:10000}, async t=>{
  const f=await fixture(t);
  const first=await f.hold(),second=await f.hold();
  const reopened=once(f.server,'connection');
  first.socket.destroy();
  const errors=await Promise.all([first.outcome,second.outcome]);
  for(const error of errors){
    assert.equal(error.message,'Host disconnected; request outcome unknown');
    assert.ok(error.transport);
  }
  assert.equal(errors[0].transport,errors[1].transport);
  await reopened;
  assert.equal(await f.client.invoke('ping'),'OK');
  for(const error of errors)f.client.reconnect(error.transport);
  f.client.reconnect(null);
  assert.equal(await f.client.invoke('ping'),'OK');
  await delay(1000);
  assert.equal(await f.client.invoke('ping'),'OK');
  assert.equal(f.connections,2);
  assert.equal(f.requests.filter(request=>request.method==='hold').length,2);
});

test('reconnect with the current transport destroys it and reconnects', {timeout:10000}, async t=>{
  const f=await fixture(t);
  let transport;
  const write=net.Socket.prototype.write;
  const mocked=t.mock.method(net.Socket.prototype,'write',function(chunk,...args){
    if(typeof chunk==='string'&&chunk.includes('"method":"hold"'))transport=this;
    return write.call(this,chunk,...args);
  });
  const current=await f.hold();
  mocked.mock.restore();
  assert.ok(transport);
  assert.equal(transport.destroyed,false);
  const reopened=once(f.server,'connection');
  f.client.reconnect(transport);
  assert.ok(transport.destroyed);
  const currentError=await current.outcome;
  assert.equal(currentError.message,'Host disconnected; request outcome unknown');
  assert.equal(currentError.transport,transport);
  await reopened;
  assert.equal(await f.client.invoke('ping'),'OK');
  await delay(1000);
  assert.equal(f.connections,2);
});

test('reconnect without a transport replaces the live socket', {timeout:10000}, async t=>{
  const f=await fixture(t);
  for(const args of [[],[undefined]]){
    const current=await f.hold();
    const reopened=once(f.server,'connection');
    f.client.reconnect(...args);
    const error=await current.outcome;
    assert.equal(error.message,'Host disconnected; request outcome unknown');
    await reopened;
    assert.equal(await f.client.invoke('ping'),'OK');
  }
  assert.equal(f.connections,3);
  assert.equal(f.requests.filter(request=>request.method==='hold').length,2);
});
