import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExportPath, checkExportSize, classifyExportResult } from '../desktop/security.mjs';

test('normaliza la ruta a .json sin duplicar la extensión', () => {
  assert.equal(normalizeExportPath('/tmp/a'), '/tmp/a.json');
  assert.equal(normalizeExportPath('/tmp/a.json'), '/tmp/a.json');
  assert.equal(normalizeExportPath('/tmp/A.JSON'), '/tmp/A.JSON');
  assert.equal(normalizeExportPath(''), null);
});

test('clasifica cancelación, destino pendiente y guardado', () => {
  assert.deepEqual(classifyExportResult({ canceled: true }, false), { status: 'cancelled' });
  assert.deepEqual(classifyExportResult({ canceled: false, filePath: '' }, false), { status: 'cancelled' });
  assert.deepEqual(classifyExportResult(undefined, false), { status: 'cancelled' });
  assert.deepEqual(classifyExportResult({ canceled: false, filePath: '/tmp/x' }, true), { status: 'saved', path: '/tmp/x.json' });
});

test('valida el tamaño y sugiere exportar sin historial', () => {
  assert.equal(checkExportSize({ a: 1 }), '{"a":1}');
  assert.throws(() => checkExportSize({ big: 'x'.repeat(100) }, 50), /sin historial|Incluir historial/);
  assert.throws(() => checkExportSize(undefined), /JSON válido/);
});
