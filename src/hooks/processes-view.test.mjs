import test from 'node:test';
import assert from 'node:assert/strict';
import { processesView } from './processes-view.mjs';

test('selecciona procesos terminal, ordena recientes y cruza sesiones y puertos gestionados sin mutar', () => {
  const node = (id,date,sessionId) => ({ id, type:'terminal', data:{ sessionId, process:{ id:`p-${id}`, title:id, command:'npm run dev', cwd:'/tree', from:{nodeId:'sender'}, createdAt:date } } });
  const older=node('old','2026-11-14','s-old'),newer=node('new','2026-11-15','s-new'),missing=node('missing','2026-11-13');
  const nodes=[older,{id:'plain',type:'terminal',data:{}},newer,missing,{...newer,type:'note'}];
  const sessions=[{id:'s-old',nodeId:'old',status:'exited'},{id:'s-new',nodeId:'new',status:'running'}];
  const service={id:'port',source:'managed',url:'http://localhost:3000/',owner:{sessionId:'s-new'}};
  const services=[service,{...service,source:'pinned'},{...service,owner:{sessionId:'other'}},{source:'managed'}];
  const before=structuredClone({nodes,sessions,services});
  const rows=processesView(nodes,sessions,services);
  assert.deepEqual(rows.map(r=>[r.nodeId,r.status]),[['new','running'],['old','stopped'],['missing','stopped']]);
  assert.deepEqual(rows[0].services,[service]);assert.deepEqual(rows[1].services,[]);assert.deepEqual(rows[2].services,[]);
  assert.equal(rows[0].command,'npm run dev');assert.equal(rows[0].cwd,'/tree');assert.equal(rows[0].processId,'p-new');
  assert.deepEqual({nodes,sessions,services},before);
  assert.equal(processesView([newer],[{id:'s-new',nodeId:'other',status:'running'}])[0].status,'stopped');
  assert.deepEqual(processesView(),[]);
});
