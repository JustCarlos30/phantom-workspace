import test from 'node:test';
import assert from 'node:assert/strict';
import { canScroll, hasScrollable, createWheelGesture, isDiscreteWheel, wheelZoomFactor, ZOOM_STEP } from './wheelGesture.js';

const input = extra => ({ zooming: false, overCanvasChrome: false, overTerminal: false, overMinimap: false, overBody: false, bodyCanScroll: false, ...extra });
const clocked = () => {
  let time = 0;
  const gesture = createWheelGesture({ now: () => time });
  return { route: (next, extra) => { time = next; return gesture.route(input(extra)); }, gesture };
};

test('una rafaga del fondo conserva el canvas sobre body, terminal y minimapa', () => {
  const { route } = clocked();
  assert.equal(route(0), 'canvas');
  assert.equal(route(10, { overBody: true, bodyActive: true, bodyCanScroll: true }), 'canvas');
  assert.equal(route(20, { overTerminal: true }), 'canvas');
  assert.equal(route(30, { overMinimap: true }), 'canvas');
});

test('una rafaga en body activo desplazable conserva el elemento al salir', () => {
  const { route } = clocked();
  assert.equal(route(0, { overBody: true, bodyActive: true, bodyCanScroll: true }), 'element');
  assert.equal(route(10), 'element');
});

test('un body desplazable de una card no seleccionada mueve el canvas', () => {
  const { route } = clocked();
  assert.equal(route(0, { overBody: true, bodyCanScroll: true }), 'canvas');
  assert.equal(route(10, { overBody: true, bodyActive: true, bodyCanScroll: true }), 'canvas');
});

test('un body activo sin desplazamiento pertenece al canvas', () => {
  const { route } = clocked();
  assert.equal(route(0, { overBody: true, bodyActive: true }), 'canvas');
});

test('un body activo desplazable conserva el elemento en su limite', () => {
  const { route } = clocked();
  assert.equal(route(0, { overBody: true, bodyActive: true, bodyCanScroll: false, bodyScrollable: true }), 'element');
});

test('un body desplazable no seleccionado en su limite mueve el canvas', () => {
  const { route } = clocked();
  assert.equal(route(0, { overBody: true, bodyActive: false, bodyCanScroll: false, bodyScrollable: true }), 'canvas');
});

test('una rueda con muescas espaciadas recalcula con la seleccion actual', () => {
  const { route } = clocked();
  assert.equal(route(0, { overBody: true, bodyCanScroll: true }), 'canvas');
  assert.equal(route(400, { overBody: true, bodyActive: true, bodyCanScroll: true }), 'element');
});

test('tras silencio mayor al idle se recalcula el dueno', () => {
  const { route } = clocked();
  assert.equal(route(0), 'canvas');
  assert.equal(route(151, { overTerminal: true, terminalActive: true }), 'element');
});

test('zoom sobre body o terminal pertenece al canvas', () => {
  const body = clocked();
  const terminal = clocked();
  assert.equal(body.route(0, { zooming: true, overBody: true, bodyActive: true, bodyCanScroll: true }), 'canvas');
  assert.equal(terminal.route(0, { zooming: true, overTerminal: true }), 'canvas');
});

test('cambiar entre zoom y paneo inicia una rafaga nueva', () => {
  const { route } = clocked();
  assert.equal(route(0, { overTerminal: true, terminalActive: true }), 'element');
  assert.equal(route(10, { zooming: true, overTerminal: true, terminalActive: true }), 'canvas');
});

test('los controles flotantes se ignoran', () => {
  const { route } = clocked();
  assert.equal(route(0, { overCanvasChrome: true }), 'ignore');
});

test('reset fuerza el recalculo del dueno', () => {
  const { route, gesture } = clocked();
  assert.equal(route(0), 'canvas');
  gesture.reset();
  assert.equal(route(1, { overMinimap: true }), 'element');
});

test('canScroll respeta los limites superior e inferior', () => {
  const boundary = { scrollTop: 0, scrollHeight: 300, clientHeight: 100, parentElement: null };
  const styleOf = () => ({ overflowY: 'auto' });
  assert.equal(canScroll(boundary, 0, -1, boundary, styleOf), false);
  assert.equal(canScroll(boundary, 0, 1, boundary, styleOf), true);
  boundary.scrollTop = 200;
  assert.equal(canScroll(boundary, 0, 1, boundary, styleOf), false);
  assert.equal(canScroll(boundary, 0, -1, boundary, styleOf), true);
});

test('hasScrollable detecta overflow en el limite inferior', () => {
  const boundary = { scrollTop: 200, scrollHeight: 300, clientHeight: 100, parentElement: null };
  const child = { parentElement: boundary };
  const styleOf = el => ({ overflowY: el === boundary ? 'auto' : 'visible' });
  assert.equal(hasScrollable(child, 0, 1, boundary, styleOf), true);
  boundary.scrollHeight = 100;
  assert.equal(hasScrollable(child, 0, 1, boundary, styleOf), false);
  boundary.scrollHeight = 101;
  assert.equal(hasScrollable(child, 0, 1, boundary, styleOf), false);
  boundary.scrollHeight = 300;
  assert.equal(hasScrollable(child, 0, 1, boundary, () => ({ overflowY: 'hidden' })), false);
});

test('el pinch del touchpad sigue a los dedos (deltaY = -100·ln(escala))', () => {
  for (const scale of [1.03, .97, 1.2]) {
    const factor = wheelZoomFactor(-100 * Math.log(scale), { pinch: true });
    assert.ok(Math.abs(factor - scale) < 1e-9);
  }
});

test('una muesca de rueda da un paso fijo sin importar la plataforma', () => {
  for (const deltaY of [53.33, 100, 120]) {
    assert.equal(isDiscreteWheel({ deltaY }), true);
    assert.equal(wheelZoomFactor(deltaY, { discrete: true, pinch: true }), 1 / ZOOM_STEP);
    assert.equal(wheelZoomFactor(-deltaY, { discrete: true }), ZOOM_STEP);
  }
  assert.equal(isDiscreteWheel({ deltaMode: 1, deltaY: 3 }), true);
});

test('el desplazamiento fino del touchpad no cuenta como muesca', () => {
  assert.equal(isDiscreteWheel({ deltaY: 4.5 }), false);
  assert.equal(isDiscreteWheel({ deltaX: 60, deltaY: 60 }), false);
  assert.equal(wheelZoomFactor(0), 1);
});

test('una terminal no seleccionada deja pasar el scroll al mapa', () => {
  const { route } = clocked();
  assert.equal(route(0, { overTerminal: true }), 'canvas');
  assert.equal(route(10, { overTerminal: true, terminalActive: true }), 'canvas');
});

test('la terminal seleccionada recibe su propio scroll', () => {
  const { route } = clocked();
  assert.equal(route(0, { overTerminal: true, terminalActive: true }), 'element');
  assert.equal(route(10), 'element');
});

test('el minimapa conserva su scroll sin seleccion', () => {
  const { route } = clocked();
  assert.equal(route(0, { overMinimap: true }), 'element');
});
