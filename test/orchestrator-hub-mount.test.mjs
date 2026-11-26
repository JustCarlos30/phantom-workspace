import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNavigation } from '../src/hooks/useDesktopAlerts.js';

const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const app = source('src/App.jsx');
const chat = source('src/components/PhantomChat.jsx');

test('el hub vive en App, fuera de PhantomChat y sin key por workspace', () => {
  const tags = [...app.matchAll(/<OrchestratorHub\b[^>]*>/g)];
  assert.equal(tags.length, 1);
  assert.doesNotMatch(tags[0][0], /\bkey=/);
  const chatTag = app.match(/<PhantomChat key=\{`phantom-chat:\$\{workspace\.id\}`\}[^\n]*?\/>/)?.[0];
  assert.ok(chatTag, 'PhantomChat sigue con su key por workspace');
  assert.ok(!chatTag.includes('OrchestratorHub'), 'el hub no cuelga del chat');
  const surface = app.match(/<div className="oh-surface"[^>]*>/)?.[0];
  assert.ok(surface);
  assert.doesNotMatch(surface, /key=|workspace\.id/);
  assert.doesNotMatch(chat, /import[^\n]*OrchestratorHub/);
  assert.match(app, /const \[hubOpen, setHubOpen\] = useState\(false\)/);
});

test('Ctrl ⇧ Espacio y la acción openOrchestrator abren/cierran la sección global', () => {
  assert.match(app, /e\.code === 'Space'\) \{[^}]*openPhantomChat\(false\); else toggleHub\(\)/);
  assert.match(app, /key === 'openOrchestrator'\) \{ toggleHub\(\); return; \}/);
  assert.match(app, /const toggleHub = useCallback\(\(value\) => setHubOpen\(open => typeof value === 'boolean' \? value : !open\), \[\]\)/);
});

test('cabecera, riel y pestaña «Agentes» enlazan con la sección', () => {
  assert.match(app, /<OrchestratorHubButton pending=\{hubPending\} broken=\{hubBroken\}/);
  assert.match(app, /<OrchestratorRailEntry pending=\{hubPending\} broken=\{hubBroken\}/);
  assert.ok(app.indexOf('<OrchestratorRailEntry') < app.indexOf('<SidebarPanels'), 'el riel va encima de la lista');
  assert.match(app, /onOpenOrchestrator=\{\(\) => toggleHub\(true\)\}/);
  assert.match(chat, /<span className="pd-tab-label">Agentes<\/span>/);
  assert.doesNotMatch(chat, /<span className="pd-tab-label">Orquestador<\/span>/);
  assert.match(chat, /onClick=\{onOpenOrchestrator\}>Abrir orquestador</);
});

test('Te necesitan conserva rail-attention y needs-you como clases separadas', () => {
  const button = app.match(/<button className=\{`rail-attention[^`]*`\}/)?.[0];
  assert.ok(button, 'botón «Te necesitan» del riel');
  assert.match(button, /rail-attention \$\{activity\.needs\.length \? 'needs-you' : ''\}/);
  assert.doesNotMatch(app, /rail-attention\$\{/);
  // Evaluada la plantilla real con y sin pendientes, las clases quedan separadas.
  const className = needs => `rail-attention ${needs ? 'needs-you' : ''}`.trim().split(/\s+/);
  assert.deepEqual(className(1), ['rail-attention', 'needs-you']);
  assert.deepEqual(className(0), ['rail-attention']);
});

test('los avisos de escritorio usan la navegación entre proyectos, sin esperas fijas', () => {
  assert.match(app, /event\.type === 'desktop\.notification'/);
  assert.match(app, /navigation\.go\(\{ workspaceId: event\.workspaceId, panel: \['branches'\] \}\)/);
  assert.match(app, /navigation\.go\(\{ workspaceId: event\.workspaceId, nodeId: event\.nodeId \}\)/);
  assert.match(app, /useDesktopAlerts\(subscribe, state, notify\)/);
  assert.match(app, /useReadyBranches\(api, workspace, connection, notify\)/);
  assert.doesNotMatch(app, /setTimeout\(resolve, 50\)/);
  assert.match(app, /navigation\.settle\(workspace\?\.id\)/);
});

function harness(initial) {
  const log = [];
  let active = initial;
  let resolveSelect;
  const nav = createNavigation({
    getActiveId: () => active,
    select: id => { log.push(['select', id]); return new Promise(resolve => { resolveSelect = resolve; }); },
    run: target => log.push(['run', active, target])
  });
  return { nav, log, setActive: id => { active = id; }, finishSelect: value => resolveSelect(value) };
}

test('navegación: mismo proyecto ejecuta al instante sin cambiar de proyecto', async () => {
  const h = harness('a');
  await h.nav.go({ workspaceId: 'a', nodeId: 'n1' });
  await h.nav.go({ panel: ['branches'] });
  assert.deepEqual(h.log, [['run', 'a', { workspaceId: 'a', nodeId: 'n1' }], ['run', 'a', { panel: ['branches'] }]]);
});

test('navegación: otro proyecto cambia primero y ejecuta solo cuando ese proyecto es el activo', async () => {
  const h = harness('a');
  const pending = h.nav.go({ workspaceId: 'b', nodeId: 'n9' });
  assert.deepEqual(h.log, [['select', 'b']]);
  h.nav.settle('a');
  assert.equal(h.log.length, 1, 'no ejecuta mientras el activo sigue siendo a');
  h.setActive('b'); h.finishSelect(undefined); await pending;
  h.nav.settle('b');
  assert.deepEqual(h.log.at(-1), ['run', 'b', { workspaceId: 'b', nodeId: 'n9' }]);
  h.nav.settle('b');
  assert.equal(h.log.length, 2, 'el destino se ejecuta una sola vez');
});

test('navegación: fila de otro proyecto (cambio y luego panel) hace un solo cambio y abre el panel allí', async () => {
  const h = harness('a');
  const first = h.nav.go({ workspaceId: 'b' });
  await h.nav.go({ workspaceId: 'b', panel: ['incorporaciones', { requestId: 'r1' }, 'Incorporaciones'] });
  assert.deepEqual(h.log.filter(([kind]) => kind === 'select'), [['select', 'b']]);
  h.setActive('b'); h.finishSelect(undefined); await first;
  h.nav.settle('b');
  assert.deepEqual(h.log.filter(([kind]) => kind === 'run'), [['run', 'b', { workspaceId: 'b', panel: ['incorporaciones', { requestId: 'r1' }, 'Incorporaciones'] }]]);
});

test('navegación: si el cambio falla (null) el destino se descarta y no salta después', async () => {
  const h = harness('a');
  const pending = h.nav.go({ workspaceId: 'b', nodeId: 'n9' });
  h.finishSelect(null); await pending;
  assert.equal(h.nav.pending, null);
  h.setActive('b'); h.nav.settle('b');
  assert.equal(h.log.some(([kind]) => kind === 'run'), false);
});

test('navegación: un destino posterior a otro proyecto sustituye al pendiente', async () => {
  const h = harness('a');
  h.nav.go({ workspaceId: 'b', nodeId: 'x' });
  h.nav.go({ workspaceId: 'c', nodeId: 'y' });
  h.setActive('b'); h.nav.settle('b');
  assert.equal(h.log.some(([kind]) => kind === 'run'), false, 'b ya no es el destino');
  h.setActive('c'); h.nav.settle('c');
  assert.deepEqual(h.log.at(-1), ['run', 'c', { workspaceId: 'c', nodeId: 'y' }]);
});
