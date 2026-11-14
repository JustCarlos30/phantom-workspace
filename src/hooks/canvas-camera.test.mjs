import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./useCanvasCamera.js', import.meta.url), 'utf8')
  .replace(/^import .* from 'react';\n/, '').replaceAll('export ', '');
const origin = { x: 0, y: 0, zoom: 1 };
const target = { x: 231.125, y: -47.875, zoom: .6 };
const plain = value => JSON.parse(JSON.stringify(value));

// Run the real hook with a controlled hook lifecycle and independent timer/RAF
// queues. In particular, a settle timer may fire before the next display frame.
function fixture({ reducedMotion = false } = {}) {
  let now = 0, id = 0, cursor = 0, effects = [], result;
  const slots = [], rafs = new Map(), timers = new Map(), listeners = new Map();
  const commits = [], paints = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hook = vm.runInNewContext(`${source}\nuseCanvasCamera;`, {
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useState(value) {
      const i = cursor++; slots[i] ||= { value };
      return [slots[i].value, next => { slots[i].value = next; }];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
      });
    },
    performance: { now: () => now },
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame: fn => { rafs.set(++id, fn); return id; },
    cancelAnimationFrame: id => rafs.delete(id),
    setTimeout: (fn, delay) => { timers.set(++id, { at: now + delay, fn }); return id; },
    clearTimeout: id => timers.delete(id),
    window: {
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name),
    },
  });
  const commit = value => commits.push(plain(value)), paint = value => paints.push(plain(value));
  const render = (value = origin) => {
    cursor = 0; effects = []; result = hook(value, commit, paint);
    effects.forEach(fn => fn()); return result;
  };
  const advance = time => {
    assert.ok(time >= now);
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > time) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
    }
    now = time;
  };
  render();
  return {
    get camera() { return result; }, commits, paints, rafs, timers, render, advance,
    frame(time) {
      advance(time);
      for (const [id, fn] of [...rafs]) if (rafs.delete(id)) fn(time);
    },
    blur() { listeners.get('blur')?.(); },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('navigation clears the old t=180 settle before its first frame', () => {
  const f = fixture();
  f.camera.updateCamera({ x: 40, y: 20, zoom: 1 });
  f.frame(16); f.advance(170); f.camera.navigate(target);
  f.advance(180);
  assert.equal(f.commits.length, 0);
  f.frame(186);
  assert.ok(f.camera.cameraRef.current.zoom < 1);
  f.frame(350); f.advance(1000);
  assert.deepEqual(plain(f.camera.cameraRef.current), target);
  assert.deepEqual(f.commits, [target]);
  assert.deepEqual(f.paints.at(-1), target);
  assert.equal(f.rafs.size + f.timers.size, 0);
});

test('a replacement navigation owns its destination and ignores delayed external acknowledgement', () => {
  const f = fixture();
  f.camera.navigate(target); f.frame(60);
  const replacement = { x: -100, y: 80, zoom: 1.5 };
  f.camera.navigate(replacement);
  f.render({ x: 40, y: 20, zoom: 1 });
  f.frame(240);
  assert.deepEqual(f.commits, [replacement]);
  assert.deepEqual(f.paints.at(-1), replacement);
});

for (const beforeFirstFrame of [true, false]) {
  test(`blur/flush finishes navigation exactly ${beforeFirstFrame ? 'before' : 'after'} its first frame`, () => {
    const f = fixture();
    f.camera.navigate(target);
    if (!beforeFirstFrame) f.frame(70);
    f.blur(); f.camera.flushCamera(); f.advance(500);
    assert.deepEqual(f.commits, [target]);
    assert.deepEqual(f.paints.at(-1), target);
    assert.equal(f.rafs.size + f.timers.size, 0);
    const input = { x: 10, y: 30, zoom: .9 };
    f.camera.updateCamera(input); f.frame(516); f.advance(680);
    assert.deepEqual(f.commits.at(-1), input);
    assert.deepEqual(f.paints.at(-1), input);
  });
}

test('deliberate input interrupts navigation without snapping back to its destination', () => {
  const f = fixture();
  f.camera.navigate(target); f.frame(60);
  const input = { x: 10, y: 30, zoom: .9 };
  f.camera.updateCamera(input); f.frame(76); f.advance(500);
  assert.deepEqual(f.commits, [input]);
  assert.deepEqual(f.paints.at(-1), input);
  assert.equal(f.rafs.size + f.timers.size, 0);
});

test('flush cancels and releases a pending paint RAF so input can paint again', () => {
  const f = fixture();
  f.camera.updateCamera(target); f.camera.flushCamera();
  assert.equal(f.rafs.size, 0);
  assert.deepEqual(f.paints.at(-1), target);
  f.camera.updateCamera(origin); f.frame(16);
  assert.deepEqual(f.paints.at(-1), origin, 'New input must paint before its settle timer');
  f.advance(180);
  assert.deepEqual(f.commits, [target, origin]);
});

test('cleanup persists the exact destination, releases RAF refs and leaves no timer', () => {
  const f = fixture();
  f.camera.navigate(target); f.frame(30); f.cleanup();
  assert.deepEqual(f.commits, [target]);
  assert.equal(f.rafs.size + f.timers.size, 0);
  f.camera.updateCamera(origin); f.frame(46); f.camera.flushCamera();
  assert.deepEqual(f.paints.at(-1), origin);
});

test('reduced motion settles and persists the exact requested camera', () => {
  const f = fixture({ reducedMotion: true });
  f.camera.navigate(target); f.frame(16); f.advance(180);
  assert.deepEqual(f.commits, [target]);
  assert.deepEqual(f.paints.at(-1), target);
});
