import test from 'node:test';
import assert from 'node:assert/strict';
import { cardTitleOf } from '../host/agents.mjs';

test('discards the generic heading but preserves later headings', () => {
  assert.equal(cardTitleOf('## Título\nMapa de delegación\n\n## Propósito\nVer quién'), 'Mapa de delegación ## Propósito Ver quién');
});

test('recognizes generic labels regardless of case and optional colon', () => {
  for (const label of ['título', 'titulo', 'title', 'objetivo', 'goal', 'propósito', 'proposito', 'purpose']) {
    assert.equal(cardTitleOf(`\n\n##  ${label.toUpperCase()}:  \n\nHola   mundo`), 'Hola mundo');
  }
});

test('strips only the first remaining heading markers', () => {
  assert.equal(cardTitleOf('# Objetivo\n## Arreglar botón\nDetalle'), 'Arreglar botón Detalle');
  assert.equal(cardTitleOf('# Arreglar botón\nDetalle'), 'Arreglar botón Detalle');
  assert.equal(cardTitleOf('## Título del informe\nX'), 'Título del informe X');
  assert.equal(cardTitleOf('###### Arreglar\n## Detalle'), 'Arreglar ## Detalle');
  assert.equal(cardTitleOf('####### Arreglar'), '####### Arreglar');
});

test('preserves plain text and inline hashtags', () => {
  assert.equal(cardTitleOf('BUG visual: algo'), 'BUG visual: algo');
  assert.equal(cardTitleOf('Usa #hashtag y ## dobles'), 'Usa #hashtag y ## dobles');
});

test('handles absent goals and a generic heading alone', () => {
  for (const goal of [null, undefined, '', '\n \n', '## Título']) assert.equal(cardTitleOf(goal), '');
});

test('flattens control characters and spaces and limits to 512 characters', () => {
  assert.equal(cardTitleOf(' BUG\tvisual:\u0000 algo\n con   detalle '), 'BUG visual: algo con detalle');
  assert.equal(cardTitleOf('x'.repeat(600)), 'x'.repeat(512));
});
