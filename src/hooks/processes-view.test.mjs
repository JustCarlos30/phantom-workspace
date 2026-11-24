import test from 'node:test';
import assert from 'node:assert/strict';
import { processesView, healthView, setupView, checksView, envLead, scriptRunning, operatorProcess } from './processes-view.mjs';

test('selecciona procesos terminal, ordena recientes y cruza sesiones y puertos gestionados sin mutar', () => {
  const node = (id,date,sessionId) => ({ id, type:'terminal', data:{ sessionId, process:{ id:`p-${id}`, title:id, command:'npm run dev', cwd:'/tree', from:{nodeId:'sender'}, createdAt:date } } });
  const older=node('old','2026-11-14','s-old'),newer=node('new','2026-11-15','s-new'),missing=node('missing','2026-11-13');
  const nodes=[older,{id:'plain',type:'terminal',data:{}},newer,missing,{...newer,type:'note'}];
  const sessions=[{id:'s-old',nodeId:'old',status:'exited',exitCode:2},{id:'s-new',nodeId:'new',status:'running'}];
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
  assert.deepEqual(rows.map(r=>r.exitCode),[null,2,null]);
});

test('healthView describe la salud real en palabras simples', () => {
  assert.deepEqual(healthView({ health: 'healthy', httpStatus: 200 }), { tone: 'ok', text: 'Responde (HTTP 200)' });
  assert.deepEqual(healthView({ health: 'unhealthy', httpStatus: 503 }), { tone: 'warn', text: 'Responde con error (HTTP 503)' });
  assert.equal(healthView({ health: 'unreachable' }).text, 'No responde');
  assert.equal(healthView({ health: 'unknown' }).text, 'Sin comprobar');
  assert.equal(healthView().tone, 'none');
});

test('setupView solo lista copias con preparación y permite reintentar lo fallido de una sesión viva', () => {
  const rows = setupView([
    { id: 'a', nodeId: 'na', worktree: {}, status: 'running', cwd: '/w/a', setup: { status: 'failed', error: 'npm ci falló' } },
    { id: 'b', nodeId: 'nb', worktree: {}, status: 'exited', setup: { status: 'cancelled' } },
    { id: 'c', nodeId: 'nc', worktree: {}, status: 'running', setup: { status: 'installing', output: 'x' } },
    { id: 'd', nodeId: 'nd', worktree: {}, status: 'running', setup: { status: 'skipped', reason: 'Sin package.json' } },
    { id: 'e', nodeId: 'ne', status: 'running', setup: { status: 'failed' } },
  ]);
  assert.deepEqual(rows.map(r => [r.sessionId, r.label, r.canRetry, r.problem]), [['a', 'Falló', true, true], ['b', 'Cancelada', false, true], ['c', 'Instalando dependencias', false, false], ['d', 'No hacía falta', false, false]]);
  assert.equal(rows[0].why, 'npm ci falló'); assert.equal(rows[3].why, 'Sin package.json');
  assert.deepEqual(setupView(), []);
});

test('checksView explica de dónde viene el comando', () => {
  assert.equal(checksView(null), null);
  assert.match(checksView({ command: 'npm test', configured: true }).source, /Definido/);
  assert.match(checksView({ command: 'npm test', configured: false }).source, /Detectado/);
  assert.equal(checksView({ command: '', configured: false }).empty, true);
  assert.match(checksView({ command: '', configured: true }).source, /no ejecutar/);
});

test('envLead prioriza lo que necesita al operador', () => {
  const script = { id: 's1', name: 'dev', origin: 'project' };
  assert.equal(envLead({ setup: [{ problem: true, canRetry: true, sessionId: 'a', why: 'x' }], rows: [{ status: 'stopped', exitCode: 1, title: 't', processId: 'p' }] }).action.kind, 'retry');
  const failed = envLead({ rows: [{ status: 'stopped', exitCode: 1, title: 'api', processId: 'p' }] });
  assert.deepEqual([failed.action.kind, failed.action.id], ['restart', 'p']); assert.match(failed.why, /código 1/);
  assert.equal(envLead({ ports: [{ health: 'unreachable', source: 'managed', port: 3000 }] }).action, null);
  assert.equal(envLead({ rows: [{ status: 'running' }, { status: 'running' }] }).tone, 'ok');
  assert.deepEqual(envLead({ scripts: [{ id: 's0', name: 'build', origin: 'project' }, script] }).action, { kind: 'run', id: 's1', label: 'Ejecutar dev' });
  assert.equal(envLead().action, null);
});

test('scriptRunning y operatorProcess', () => {
  const script = { name: 'dev', command: 'npm run dev', cwd: '/w', origin: 'session' };
  assert.equal(scriptRunning(script, [{ status: 'running', command: 'npm run dev', cwd: '/w' }]), true);
  assert.equal(scriptRunning(script, [{ status: 'stopped', command: 'npm run dev', cwd: '/w' }]), false);
  assert.equal(scriptRunning(script), false);
  const process = operatorProcess(script, 'id1', '2026-11-20T00:00:00.000Z');
  assert.deepEqual([process.title, process.cwd, process.from.nodeId], ['dev (copia de la sesión)', '/w', 'operator']);
});
