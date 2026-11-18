import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInventory, analyzeSource, inspectRepository, productionStyles } from '../scripts/storybook-inventory.mjs';
import { createHost } from '../src/stories/host-mock.js';

test('el inventario detecta fuentes sin registrar y enlaces inexistentes', () => {
  const errors = validateInventory(
    ['src/components/A.jsx', 'src/components/B.jsx'],
    [{ source: 'src/components/A.jsx', story: 'familia--ausente' }],
    ['familia--presente'],
  );
  assert.ok(errors.some((error) => error.includes('B.jsx')));
  assert.ok(errors.some((error) => error.includes('familia--ausente')));
});

test('detecta duplicados y cobertura declarada sin escenario', () => {
  const errors = validateInventory(['A.jsx'], [{ source: 'A.jsx', status: 'renderizado' }, { source: 'A.jsx', story: 'a--real' }], ['a--real']);
  assert.ok(errors.some(e => e.includes('duplicada')));
  assert.ok(errors.some(e => e.includes('sin escenario')));
});

test('AST distingue componentes privados, exports y registros sin confundir comentarios', () => {
  const result = analyzeSource('// function Fake() {}\nexport function Visible() { return <Privado />; }\nfunction Privado() { return <span />; }\nexport const REGISTRY = {};', 'sample.jsx');
  assert.deepEqual(result.symbols.map(s => [s.name, s.exported]), [['Visible', true], ['Privado', false], ['REGISTRY', true]]);
  assert.match(result.symbols[2].kind, /registro/);
});

test('catálogo actual cubre todas las fuentes JSX y sus enlaces CSF', async () => {
  const report = await inspectRepository();
  assert.deepEqual(report.errors, []);
  assert.ok(report.entries.filter(e => e.status === 'renderizado').length >= 61);
  assert.equal(new Set(report.entries.filter(e => e.status === 'renderizado').map(e => e.family)).size, 12);
  const changed = validateInventory([...report.entries.map(e => e.source), 'src/components/Nuevo.jsx'], report.entries, report.stories.map(s => s.id));
  assert.ok(changed.some(e => e.includes('Nuevo.jsx')));
});

test('host rechaza métodos desconocidos, clona lecturas y elimina suscripciones al cerrar', async () => {
  const host = createHost();
  await assert.rejects(host.invoke('git.exec', { command: 'never' }), /desconocido/);
  const first = await host.invoke('state.get');
  first.workspaces[0].name = 'Mutado';
  assert.notEqual((await host.invoke('state.get')).workspaces[0].name, 'Mutado');
  let count = 0;
  const off = host.onEvent(() => count++);
  host.emit({ type: 'example' }); off(); host.emit({ type: 'example' });
  assert.equal(count, 1);
  host.onEvent(() => count++);
  host.dispose(); host.emit({ type: 'example' });
  assert.equal(host.subscriptions, 0);
  assert.equal(count, 1);
  await assert.rejects(host.invoke('state.get'), /cerrada/);
  const fresh = createHost();
  assert.deepEqual(fresh.calls, []);
  fresh.dispose();
});

test('estilos derivan del grafo real de App sin importarlo como aplicación', async () => {
  const styles = await productionStyles();
  assert.deepEqual(styles.slice(0, 3), ['src/styles.css', 'src/tools.css', 'src/empty-state.css']);
  for (const name of ['styles', 'studio', 'activity', 'canvas-ui', 'terminal', 'chat', 'sidebar', 'shell', 'phantom-chat', 'panels', 'menus', 'plugins', 'skills']) assert.ok(styles.includes(`src/${name}.css`), name);
  assert.ok(styles.indexOf('src/menus.css') > styles.indexOf('src/panels.css'));
  assert.equal(new Set(styles).size, styles.length);
  assert.ok(styles.every(file => file.endsWith('.css')));
});
