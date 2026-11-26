import test from 'node:test';
import assert from 'node:assert/strict';
import { alertFacts, trackAlerts, planNotifications, pendingCount } from './desktop-alerts.mjs';

const ws = (over = {}) => ({ id: 'w1', name: 'Apolo', nodes: [], attention: [], ...over });
const merge = (failure, over = {}) => ({ id: `a-${failure}`, source: 'incorporaciones', ref: 'req1', nodeId: 'n1', failure, branch: 'feat/x', eventKey: `merge:req1:${failure}:abc`, ...over });
const one = (workspace, alerts) => alertFacts([workspace], alerts);

test('merge-conflict incluye rama y primeros archivos, y el proyecto en el título', () => {
  const [f] = one(ws({ attention: [merge('conflict', { conflicts: ['a.js', 'b.js', 'c.js'] })] }));
  assert.equal(f.kind, 'merge-conflict');
  assert.equal(f.target, 'branches');
  assert.equal(f.nodeId, 'n1');
  assert.ok(f.title.startsWith('Apolo · '));
  assert.ok(f.body.includes('feat/x') && f.body.includes('a.js') && f.body.includes('c.js'));
});

test('merge-checks, merge-stale y merge-error', () => {
  const facts = one(ws({ attention: [merge('checks'), merge('stale'), merge('error')] }));
  assert.deepEqual(facts.map(f => f.kind), ['merge-checks', 'merge-stale', 'merge-error']);
  assert.ok(facts.every(f => f.target === 'branches' && f.title.startsWith('Apolo · ')));
  assert.equal(new Set(facts.map(f => f.key)).size, 3);
});

test('session-failed resuelve el nodo por sessionId', () => {
  const w = ws({
    nodes: [{ id: 'n7', data: { sessionId: 's9' } }],
    attention: [{ id: 'f1', source: 'terminal', status: 'failed', sessionId: 's9', title: 'npm test' }]
  });
  const [f] = one(w);
  assert.equal(f.kind, 'session-failed');
  assert.equal(f.target, 'session');
  assert.equal(f.nodeId, 'n7');
  const [g] = one(ws({ attention: [{ id: 'f2', source: 'tool', exitCode: 2 }] }));
  assert.equal(g.kind, 'session-failed');
  assert.deepEqual(one(ws({ attention: [{ id: 'f3', source: 'terminal', status: 'running', exitCode: 0 }] })), []);
});

test('session-blocked y su clave incluye updatedAt; un merge del mismo nodo lo supera', () => {
  const node = u => ({ id: 'n1', data: { agent: { status: 'blocked', updatedAt: u } } });
  const [a] = one(ws({ nodes: [node(1)] }));
  const [b] = one(ws({ nodes: [node(2)] }));
  assert.equal(a.kind, 'session-blocked');
  assert.notEqual(a.key, b.key);
  const facts = one(ws({ nodes: [node(1)], attention: [merge('conflict')] }));
  assert.deepEqual(facts.map(f => f.kind), ['merge-conflict']);
});

test('permission para los estados que esperan al usuario', () => {
  for (const status of ['needs_approval', 'awaiting_approval', 'awaiting_input', 'waiting_for_input', 'needs_input']) {
    const [f] = one(ws({ nodes: [{ id: 'n2', data: { agent: { status } } }] }));
    assert.equal(f.kind, 'permission');
    assert.equal(f.nodeId, 'n2');
  }
  assert.deepEqual(one(ws({ nodes: [{ id: 'n2', data: { agent: { status: 'running' } } }] })), []);
});

test('stalled y unattended vienen del supervisor', () => {
  const facts = alertFacts([ws()], [
    { workspaceId: 'w1', kind: 'stalled', entityId: 'e1', title: 'Sin avance', at: 1 },
    { workspaceId: 'w1', kind: 'unattended', entityId: 'e2', title: 'Sin atender', at: 2 }
  ]);
  assert.deepEqual(facts.map(f => f.kind), ['stalled', 'unattended']);
  assert.ok(facts[0].title.startsWith('Apolo · '));
});

test('la atención reconocida se ignora', () => {
  for (const flag of ['acknowledgedAt', 'acknowledged', 'acked']) {
    assert.deepEqual(one(ws({ attention: [merge('conflict', { [flag]: flag === 'acknowledgedAt' ? 'now' : true })] })), []);
  }
});

test('título y cuerpo se recortan', () => {
  const [f] = one(ws({ name: 'P'.repeat(200), attention: [merge('conflict', { branch: 'b'.repeat(500) })] }));
  assert.ok(f.title.length <= 120);
  assert.ok(f.body.length <= 300);
});

test('la primera observación siembra sin avisar y luego no hay duplicados', () => {
  const f1 = one(ws({ attention: [merge('conflict')] }));
  const first = trackAlerts(null, f1);
  assert.deepEqual(first.fresh, []);
  const same = trackAlerts(first.seen, f1);
  assert.deepEqual(same.fresh, []);
  const f2 = [...f1, ...one(ws({ attention: [merge('checks')] }))];
  const next = trackAlerts(same.seen, f2);
  assert.equal(next.fresh.length, 1);
  assert.equal(next.fresh[0].kind, 'merge-checks');
  assert.deepEqual(trackAlerts(next.seen, f2).fresh, []);
});

test('seen solo conserva claves vigentes', () => {
  const f1 = one(ws({ attention: [merge('conflict'), merge('checks')] }));
  const { seen } = trackAlerts(null, f1);
  const after = trackAlerts(seen, f1.slice(0, 1));
  assert.equal(after.seen.size, 1);
});

const mk = (n, workspaceId = 'w1') => Array.from({ length: n }, (_, i) => ({
  key: `k${i}`, workspaceId, workspaceName: 'Apolo', kind: 'permission', title: `Apolo · t${i}`, body: 'b', target: 'session', nodeId: `n${i}`
}));

test('con foco solo toasts; sin foco, nativas con destino', () => {
  const fresh = mk(2);
  const focused = planNotifications(fresh, { focused: true });
  assert.equal(focused.toasts.length, 2);
  assert.deepEqual(focused.native, []);
  const away = planNotifications(fresh, { focused: false });
  assert.deepEqual(away.toasts, []);
  assert.deepEqual(away.native[0], { title: 'Apolo · t0', body: 'b', target: 'session', workspaceId: 'w1', nodeId: 'n0' });
});

test('más de 3 avisos se agrupan en uno con el destino del primero', () => {
  const fresh = [...mk(3), ...mk(2, 'w2')];
  const away = planNotifications(fresh, { focused: false });
  assert.equal(away.native.length, 1);
  assert.equal(away.native[0].title, '5 avisos en 2 proyectos');
  assert.equal(away.native[0].workspaceId, 'w1');
  assert.equal(away.native[0].nodeId, 'n0');
  assert.equal(planNotifications(fresh, { focused: true }).toasts.length, 1);
  assert.equal(planNotifications(mk(3), { focused: false }).native.length, 3);
  assert.deepEqual(planNotifications([], { focused: false }), { toasts: [], native: [] });
});

test('pendingCount cuenta los hechos vigentes', () => {
  assert.equal(pendingCount([]), 0);
  assert.equal(pendingCount(mk(4)), 4);
});
