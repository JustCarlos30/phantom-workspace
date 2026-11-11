import test from 'node:test';
import assert from 'node:assert/strict';
import { findPanelPlacement, rectanglesOverlap } from './panelPlacement.js';
import { createBrowserIntent } from './browserIntent.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const rect = { x: 12, y: 90, width: 760, height: 450 };
function browserFixture({ attach, url = '' } = {}) {
  const calls = [], addresses = [], commits = [], states = [], errors = [];
  const controller = createBrowserIntent({ id: 'browser', workspaceId: 'workspace', url,
    invoke: async (method, payload) => { calls.push([method, payload]); if (method === 'browser.attach') return attach ? attach() : { attached: true }; return { ok: true }; },
    onState: state => states.push(state), onAddress: address => addresses.push(address), onCommit: address => commits.push(address), onError: error => errors.push(error),
  });
  return { controller, calls, addresses, commits, states, errors };
}
const state = (url, loading = false, extra = {}) => ({ url, loading, title: url, ...extra });

test('mixed new panel sizes find separate slots at desktop and narrow canvas widths without rearranging existing panels', () => {
  for (const viewport of [{ width: 1300, height: 800 }, { width: 1078, height: 725 }, { width: 750, height: 650 }]) {
    const nodes = [], sizes = [[640, 400], [640, 400], [640, 400], [420, 340], [800, 520]];
    for (const [width, height] of sizes) {
      const before = structuredClone(nodes);
      const position = findPanelPlacement({ nodes, width, height, viewport });
      assert.deepEqual(nodes, before, 'must not modify the user arrangement');
      const next = { ...position, width, height };
      assert.ok(nodes.every(node => !rectanglesOverlap(node, next)), 'headers and bodies must have the full spacing gap');
      nodes.push(next);
    }
    const width = Math.max(...nodes.map(n => n.x + n.width)) - Math.min(...nodes.map(n => n.x));
    const height = Math.max(...nodes.map(n => n.y + n.height)) - Math.min(...nodes.map(n => n.y));
    assert.ok(width < 3000 && height < 2000, 'packing remains bounded for Fit-all');
  }
});

test('hidden panels consume no placement slot and panning to free space creates near the camera', () => {
  const args = { width: 640, height: 400, viewport: { width: 1000, height: 700 }, camera: { x: -18000, y: 8000, zoom: .7 } };
  const anchor = findPanelPlacement(args);
  const hidden = { ...anchor, width: 640, height: 400, data: { hidden: true } };
  assert.deepEqual(findPanelPlacement({ ...args, nodes: [hidden, { x: 0, y: 0, width: 800, height: 500 }] }), anchor);
});

test('in-flight node reservations use the same packing as persisted panels', () => {
  const first = { ...findPanelPlacement({ width: 640, height: 400 }), width: 640, height: 400 };
  const second = { ...findPanelPlacement({ nodes: [first], width: 800, height: 520 }), width: 800, height: 520 };
  assert.equal(rectanglesOverlap(first, second), false);
  assert.deepEqual(findPanelPlacement({ nodes: [first], width: 800, height: 520 }), { x: second.x, y: second.y });
});

test('first navigation typed during about:blank attach survives old state and runs exactly once after attach', async () => {
  const attachment = deferred(); const f = browserFixture({ attach: () => attachment.promise });
  const show = f.controller.show(rect); await turn();
  f.controller.edit(); f.controller.state(state('about:blank'));
  assert.deepEqual(f.addresses, []); assert.equal(f.controller.captureTicket(), null);
  const navigate = f.controller.navigate('https://example.test/');
  f.controller.state(state('about:blank', true)); f.controller.state(state('about:blank'));
  assert.deepEqual(f.addresses, ['https://example.test/']); assert.deepEqual(f.commits, []);
  attachment.resolve({ attached: true }); await Promise.all([show, navigate]);
  assert.deepEqual(f.calls.filter(([method]) => method === 'browser.navigate').map(([, p]) => p.url), ['https://example.test/']);
  assert.deepEqual(f.commits, [], 'a requested address is not yet a committed address');
  f.controller.state(state('https://example.test/', true)); f.controller.state(state('https://example.test/'));
  assert.deepEqual(f.commits, ['https://example.test/']); assert.equal(f.controller.captureTicket().url, 'https://example.test/');
  f.controller.dispose();
});

test('latest submitted destination supersedes earlier queued requests before native attach resolves', async () => {
  const attachment = deferred(); const f = browserFixture({ attach: () => attachment.promise });
  const show = f.controller.show(rect); await turn();
  const a = f.controller.navigate('https://first.test/'), b = f.controller.navigate('https://latest.test/');
  f.controller.state(state('https://first.test/')); f.controller.state(state('about:blank'));
  attachment.resolve({ attached: true }); await Promise.all([show, a, b]);
  assert.deepEqual(f.calls.filter(([method]) => method === 'browser.navigate').map(([, p]) => p.url), ['https://latest.test/']);
  assert.deepEqual(f.commits, []); f.controller.state(state('https://latest.test/'));
  assert.deepEqual(f.commits, ['https://latest.test/']); f.controller.dispose();
});

test('dirty address draft is not overwritten by committed native state', async () => {
  const f = browserFixture({ url: 'https://old.test/' }); await f.controller.show(rect);
  f.controller.state(state('https://old.test/')); const count = f.addresses.length;
  f.controller.edit(); f.controller.state(state('https://old.test/', false, { title: 'Late title' })); f.controller.state(state('about:blank'));
  assert.equal(f.addresses.length, count); f.controller.dispose();
});

test('old navigation events cannot commit over a pending destination; redirect settles after its load', async () => {
  const f = browserFixture({ url: 'https://old.test/' }); await f.controller.show(rect); f.controller.state(state('https://old.test/'));
  await f.controller.navigate('https://target.test/');
  f.controller.state(state('https://old.test/', true)); f.controller.state(state('https://old.test/'));
  assert.deepEqual(f.commits, []); assert.equal(f.controller.captureTicket(), null);
  f.controller.state(state('https://target.test/', true));
  f.controller.state(state('https://redirect.test/', true)); f.controller.state(state('https://redirect.test/'));
  assert.deepEqual(f.commits, ['https://redirect.test/']); f.controller.dispose();
});

test('capture tickets reject blank, loading and obsolete pages and reattach uses the committed destination', async () => {
  const f = browserFixture(); await f.controller.show(rect); f.controller.state(state('about:blank'));
  assert.equal(f.controller.captureTicket(), null);
  await f.controller.navigate('https://one.test/'); f.controller.state(state('https://one.test/', true));
  assert.equal(f.controller.captureTicket(), null); f.controller.state(state('https://one.test/'));
  const old = f.controller.captureTicket(); assert.equal(f.controller.captureCurrent(old), true);
  await f.controller.navigate('https://two.test/'); assert.equal(f.controller.captureCurrent(old), false);
  f.controller.state(state('https://two.test/')); const current = f.controller.captureTicket();
  await f.controller.hide(); assert.equal(f.controller.captureCurrent(current), true, 'settled hidden pages can be captured best-effort');
  await f.controller.show(rect);
  assert.equal(f.calls.filter(([m]) => m === 'browser.attach').at(-1)[1].url, 'https://two.test/');
  f.controller.dispose(); assert.equal(f.controller.captureCurrent(current), false);
});
