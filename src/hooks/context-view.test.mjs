import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedRef, readerKind, emptyMessage, compactionBlocked } from './context-view.mjs';

test('Compactación solo se ofrece en sesiones soportadas, conectadas y sin cola ni operación', () => {
  const chat = { provider: 'opencode', sessionId: 'native-session', running: false, queue: [] };
  assert.equal(compactionBlocked(chat), '');
  assert.equal(compactionBlocked({ ...chat, provider: 'codex' }), '');
  assert.match(compactionBlocked(chat, false), /Conecta/);
  assert.match(compactionBlocked(null), /Conecta/);
  for (const provider of [null, 'claude', 'unknown']) assert.match(compactionBlocked({ ...chat, provider }), /no integrada/);
  assert.match(compactionBlocked({ ...chat, running: true }), /operación/);
  assert.match(compactionBlocked({ ...chat, queue: [{ id: 'q' }] }), /cola/);
  assert.match(compactionBlocked({ ...chat, sessionId: null }), /inicia/);
});

test('pinnedRef encuentra rutas directas y anidadas y conserva el ref', () => {
  const direct = { id: 'a', path: 'README.md' }, nested = { id: 'b', ref: { path: 'docs/guide.md' } };
  const refs = [null, {}, { ref: null }, direct, nested];
  assert.equal(pinnedRef(refs, direct.path), direct);
  assert.equal(pinnedRef(refs, nested.ref.path), nested);
  assert.equal(pinnedRef(refs, 'missing.md'), null);
  for (const path of [null, undefined, '', 1]) assert.equal(pinnedRef(refs, path), null);
  for (const refs of [null, undefined, {}, []]) assert.equal(pinnedRef(refs, 'README.md'), null);
});

test('readerKind distingue extensiones completas sin distinguir mayúsculas', () => {
  for (const path of ['README.md', 'docs/Guide.MARKDOWN', 'A.Md']) assert.equal(readerKind(path), 'markdown');
  for (const path of ['data.json', 'a.md.json', 'md', '', null, undefined, 1]) assert.equal(readerKind(path), 'code');
});

test('emptyMessage ofrece vacíos según pestaña y búsqueda', () => {
  for (const query of ['', '   ', null, undefined]) assert.equal(emptyMessage('docs', query), 'Este proyecto no tiene documentos Markdown.');
  assert.equal(emptyMessage('docs', ' guía '), 'Sin resultados para “guía”.');
  for (const query of ['', '   ', null, undefined]) assert.equal(emptyMessage('decisions', query), 'Aún no hay decisiones. Declara la primera para que los agentes la recuerden.');
  for (const query of ['guía', ' guía ']) assert.equal(emptyMessage('decisions', query), 'Sin resultados para “guía”.');
});
