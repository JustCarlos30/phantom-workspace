import test from 'node:test';
import assert from 'node:assert/strict';
import { canScroll, createWheelGesture } from './wheelGesture.js';

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

test('una rueda con muescas espaciadas recalcula con la seleccion actual', () => {
  const { route } = clocked();
  assert.equal(route(0, { overBody: true, bodyCanScroll: true }), 'canvas');
  assert.equal(route(400, { overBody: true, bodyActive: true, bodyCanScroll: true }), 'element');
});

test('tras silencio mayor al idle se recalcula el dueno', () => {
  const { route } = clocked();
  assert.equal(route(0), 'canvas');
  assert.equal(route(151, { overTerminal: true }), 'element');
});

test('zoom sobre body o terminal pertenece al canvas', () => {
  const body = clocked();
  const terminal = clocked();
  assert.equal(body.route(0, { zooming: true, overBody: true, bodyActive: true, bodyCanScroll: true }), 'canvas');
  assert.equal(terminal.route(0, { zooming: true, overTerminal: true }), 'canvas');
});

test('cambiar entre zoom y paneo inicia una rafaga nueva', () => {
  const { route } = clocked();
  assert.equal(route(0, { overTerminal: true }), 'element');
  assert.equal(route(10, { zooming: true, overTerminal: true }), 'canvas');
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
