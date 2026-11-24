import test from 'node:test';
import assert from 'node:assert/strict';
import { directionalNeighbor, cycleSession } from './panel-navigation.mjs';

const panel = (id, x, y, extra = {}) => ({ id, type: 'terminal', x, y, width: 100, height: 100, ...extra });
const origin = panel('origin', 0, 0);

test('encuentra vecinos en los cuatro ejes en coordenadas del canvas', () => {
  const nodes = [origin, panel('left', -150, 0), panel('right', 150, 0), panel('up', 0, -150), panel('down', 0, 150)];
  for (const direction of ['left', 'right', 'up', 'down']) {
    assert.equal(directionalNeighbor(nodes, 'origin', direction), direction);
  }
  assert.equal(directionalNeighbor(nodes, 'right', 'right'), null);
  assert.equal(directionalNeighbor(nodes, 'left', 'left'), null);
});

test('elige el panel alineado más cercano e incluye otros tipos de panel', () => {
  const nodes = [origin, panel('far', 500, 0), panel('near', 125, 0, { type: 'browser' }), panel('middle', 250, 0, { type: 'note' })];
  assert.equal(directionalNeighbor(nodes, 'origin', 'right'), 'near');
  assert.equal(directionalNeighbor(nodes, 'near', 'right'), 'middle');
});

test('prioriza la banda perpendicular frente a diagonales próximas', () => {
  const nodes = [origin, panel('diagonal', 110, 110), panel('aligned', 500, 25)];
  assert.equal(directionalNeighbor(nodes, 'origin', 'right'), 'aligned');
  assert.equal(directionalNeighbor([origin, nodes[1]], 'origin', 'right'), 'diagonal');
  assert.equal(directionalNeighbor([origin, panel('diagonal', 110, 110), panel('aligned', 25, 500)], 'origin', 'down'), 'aligned');
});

test('usa centros para el sentido y bordes para la distancia con tamaños distintos', () => {
  const nodes = [
    origin,
    panel('wide', -20, 0, { width: 400 }),
    panel('narrow', 120, 0, { width: 20 }),
    panel('same-center', -100, -100, { width: 300, height: 300 }),
  ];
  assert.equal(directionalNeighbor(nodes, 'origin', 'right'), 'wide');
  assert.equal(directionalNeighbor([origin, nodes[3]], 'origin', 'right'), null);
  assert.equal(directionalNeighbor([origin, nodes[3]], 'origin', 'left'), null);
});

test('si la distancia entre bordes empata usa la distancia de centros', () => {
  const nodes = [origin, panel('offset', 150, 50), panel('centered', 150, 0)];
  assert.equal(directionalNeighbor(nodes, 'origin', 'right'), 'centered');
  assert.equal(directionalNeighbor([...nodes].reverse(), 'origin', 'right'), 'centered');
});

test('empates geométricos exactos son estables por ID, sin depender del orden', () => {
  const nodes = [origin, panel('b', 150, 0), panel('a', 150, 0)];
  assert.equal(directionalNeighbor(nodes, 'origin', 'right'), 'a');
  assert.equal(directionalNeighbor([...nodes].reverse(), 'origin', 'right'), 'a');
  const diagonal = [origin, panel('b', 150, -150), panel('a', 150, 150)];
  assert.equal(directionalNeighbor(diagonal, 'origin', 'right'), 'a');
});

test('excluye zonas y ocultos tanto como destino como origen', () => {
  const nodes = [
    origin,
    panel('zone', 110, 0, { type: 'zone' }),
    panel('hidden-data', 120, 0, { data: { hidden: true } }),
    panel('hidden-node', 130, 0, { hidden: true }),
    panel('visible', 200, 0),
  ];
  assert.equal(directionalNeighbor(nodes, 'origin', 'right'), 'visible');
  for (const id of ['zone', 'hidden-data', 'hidden-node']) assert.equal(directionalNeighbor(nodes, id, 'right'), null);
  assert.equal(directionalNeighbor(nodes.slice(0, -1), 'origin', 'right'), null);
});

test('sin vecino, selección o geometría válida devuelve null', () => {
  assert.equal(directionalNeighbor([], 'origin', 'right'), null);
  assert.equal(directionalNeighbor([origin], 'missing', 'right'), null);
  assert.equal(directionalNeighbor([origin], 'origin', 'right'), null);
  assert.equal(directionalNeighbor([origin], 'origin', 'diagonal'), null);
  assert.equal(directionalNeighbor(null, 'origin', 'right'), null);
  const invalid = [null, {}, panel('no-size', 100, 0, { width: 0 }), panel('negative', 100, 0, { height: -10 }), panel('infinite', Infinity, 0), panel('nan', 100, NaN), panel('text', '100', 0)];
  assert.equal(directionalNeighbor([origin, ...invalid], 'origin', 'right'), null);
  assert.equal(directionalNeighbor([panel('invalid-origin', 0, 0, { width: undefined }), panel('valid', 100, 0)], 'invalid-origin', 'right'), null);
});

test('negativos y traslación del canvas no cambian el vecino', () => {
  const nodes = [origin, panel('near', 200, -20), panel('far', 400, 0)];
  const shifted = nodes.map(node => ({ ...node, x: node.x - 10000, y: node.y - 20000 }));
  assert.equal(directionalNeighbor(nodes, 'origin', 'right'), 'near');
  assert.equal(directionalNeighbor(shifted, 'origin', 'right'), 'near');
});

test('cicla solo sesiones visibles, incluyendo chats y terminales sin PTY', () => {
  const nodes = [
    { id: 'a', type: 'terminal', data: { sessionId: 'pty-a' } },
    { id: 'browser', type: 'browser' },
    { id: 'hidden', type: 'terminal', data: { hidden: true } },
    { id: 'chat', type: 'terminal', data: { chat: { provider: 'claude' } } },
    { id: 'zone', type: 'zone' },
    { id: 'note', type: 'note' },
    { id: 'ended', type: 'terminal' },
    { id: 'hidden-node', type: 'terminal', hidden: true },
  ];
  assert.equal(cycleSession(nodes, 'a', 1), 'chat');
  assert.equal(cycleSession(nodes, 'chat', 1), 'ended');
  assert.equal(cycleSession(nodes, 'ended', 1), 'a');
  assert.equal(cycleSession(nodes, 'a', -1), 'ended');
  assert.equal(cycleSession(nodes, 'ended', -1), 'chat');
  assert.equal(cycleSession(nodes, 'a', 5), 'ended');
  assert.equal(cycleSession(nodes, 'a', -5), 'chat');
});

test('sin sesión seleccionada comienza por el extremo según el sentido', () => {
  const nodes = [{ id: 'a', type: 'terminal' }, { id: 'b', type: 'terminal' }];
  for (const currentId of [null, undefined, 'missing']) {
    assert.equal(cycleSession(nodes, currentId, 1), 'a');
    assert.equal(cycleSession(nodes, currentId, -1), 'b');
  }
  assert.equal(cycleSession([{ id: 'only', type: 'terminal' }], 'only', 1), 'only');
  assert.equal(cycleSession([{ id: 'only', type: 'terminal' }], 'only', -1), 'only');
});

test('ciclo vacío o delta inválido no selecciona otro panel', () => {
  const nodes = [{ id: 'a', type: 'terminal' }];
  for (const delta of [0, 1.5, NaN, Infinity, '1', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(cycleSession(nodes, 'a', delta), null);
  }
  assert.equal(cycleSession([], 'a', 1), null);
  assert.equal(cycleSession(null, 'a', 1), null);
  assert.equal(cycleSession([null, {}, { id: 'zone', type: 'zone' }, { id: 'hidden', type: 'terminal', data: { hidden: true } }], 'a', 1), null);
});

test('la navegación no muta los nodos ni su orden', () => {
  const nodes = Object.freeze([Object.freeze(origin), Object.freeze(panel('right', 150, 0))]);
  assert.equal(directionalNeighbor(nodes, 'origin', 'right'), 'right');
  assert.equal(cycleSession(nodes, 'origin', 1), 'right');
  assert.deepEqual(nodes.map(node => node.id), ['origin', 'right']);
});
