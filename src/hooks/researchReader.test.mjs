import assert from 'node:assert/strict';
import test from 'node:test';
import { currentIndex, groupByStatus, moreLikeThisText, next, prev, sourcesFor } from './researchReader.js';

const source = (id, status, x, y, url = `https://example.com/${id}/`) => ({ id, type: 'reference', x, y, data: { kind: 'link', url, spaceId: 'space', tags: [`research:${status}`] } });
const sources = [source('b', 'liked', 5, 20), source('a', 'inbox', 30, 10), source('c', 'discarded', 1, 30)];

test('sourcesFor filtra por espacio', () => {
  assert.deepEqual(sourcesFor([...sources, { ...source('other', 'inbox', 0, 0), data: { ...source('other', 'inbox', 0, 0).data, spaceId: 'other' } }], 'space').map(node => node.id), ['a', 'b', 'c']);
});

test('sourcesFor filtra enlaces y fuentes con estado', () => {
  const nonLink = { ...source('non-link', 'inbox', 0, 0), data: { ...source('non-link', 'inbox', 0, 0).data, kind: 'note' } };
  const noStatus = { ...source('no-status', 'inbox', 0, 0), data: { ...source('no-status', 'inbox', 0, 0).data, tags: [] } };
  assert.deepEqual(sourcesFor([...sources, nonLink, noStatus], 'space').map(node => node.id), ['a', 'b', 'c']);
});

test('sourcesFor ordena por y y luego por x', () => {
  assert.deepEqual(sourcesFor([source('b', 'inbox', 30, 10), source('a', 'inbox', 10, 10), source('c', 'inbox', 0, 20)], 'space').map(node => node.id), ['a', 'b', 'c']);
});

test('groupByStatus agrupa las fuentes por estado', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(groupByStatus(sources)).map(([key, value]) => [key, value.length])), { inbox: 1, liked: 1, discarded: 1 });
});

test('currentIndex prioriza el id guardado', () => {
  assert.equal(currentIndex(sources, 'https://example.com/a/', { id: 'b' }), 0);
});

test('currentIndex compara URL sin hash ni barra final', () => {
  assert.equal(currentIndex(sources, 'https://example.com/a#heading', null), 1);
});

test('currentIndex devuelve menos uno sin coincidencia', () => {
  assert.equal(currentIndex(sources, 'https://example.com/missing', null), -1);
});

test('next salta descartadas y no da la vuelta', () => {
  assert.equal(next(sources, 0), 1);
  assert.equal(next(sources, 1), -1);
});

test('prev salta descartadas', () => {
  assert.equal(prev([source('a', 'discarded', 0, 0), source('b', 'inbox', 0, 0), source('c', 'discarded', 0, 0)], 2), 1);
});

test('moreLikeThisText crea la solicitud de fuentes similares', () => {
  assert.equal(moreLikeThisText('la tipografía'), '@phantom trae 5–10 fuentes como esta. Lo que me gusta: la tipografía');
});
