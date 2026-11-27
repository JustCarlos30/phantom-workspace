import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, resolveBindings, validateBindings, matchCommand, formatBinding } from './workspace-commands.mjs';
import { panelShortcut } from './panel-shortcuts.mjs';
import { readFileSync } from 'node:fs';
import { nativeMenuShortcuts, nativeBindingReservation } from '../../shared/keyboard-reservations.mjs';

const bindings = resolveBindings();
const navigation = { navigationMode: true };
const eventFor = (key, modifiers = {}) => ({ key, ...modifiers });
const ctrl = key => eventFor(key, { ctrlKey: true });
const ctrlShift = key => eventFor(key, { ctrlKey: true, shiftKey: true });

test('el catálogo publica los IDs pactados, defaults únicos y metadatos de UI', () => {
  assert.deepEqual(COMMANDS.map(command => command.id), [
    'palette', 'projects', 'panels', 'left', 'right', 'up', 'down', 'next-session', 'previous-session', 'next-attention',
    'enter-panel', 'leave-panel', 'fit-all', 'return-focus', 'shortcuts',
    'close-panel', 'create-terminal', 'create-browser', 'create-note', 'create-zone',
  ]);
  for (const command of COMMANDS) {
    assert.ok(command.title && command.group);
    assert.ok(['global', 'navigation', 'panel'].includes(command.scope));
    assert.equal(bindings[command.id], command.defaultBinding);
    assert.ok(!command.defaultBinding.includes('Meta'));
  }
  assert.equal(new Set(Object.values(bindings)).size, COMMANDS.length);
  assert.deepEqual(validateBindings().conflicts, []);
});

test('next-attention existe, tiene binding único y no genera conflictos', () => {
  const command = COMMANDS.find(item => item.id === 'next-attention');
  assert.ok(command);
  assert.equal(command.title, 'Siguiente sesión que necesita atención');
  assert.equal(command.group, 'Navegación');
  assert.equal(command.scope, 'global');
  assert.equal(command.defaultBinding, 'Ctrl+Shift+A');
  assert.equal(Object.values(bindings).filter(binding => binding === command.defaultBinding).length, 1);
  assert.deepEqual(validateBindings({ 'next-attention': 'Ctrl+Shift+A' }).conflicts, []);
  assert.equal(matchCommand(ctrlShift('A'), bindings), 'next-attention');
  assert.equal(matchCommand(ctrlShift('a'), bindings, { editable: true }), 'next-attention');
});

test('los modificadores son exactos; Ctrl no implica Meta ni ignora Alt/Shift', () => {
  assert.equal(matchCommand(ctrl('k'), bindings), 'palette');
  assert.equal(matchCommand(ctrl('K'), bindings), 'palette');
  for (const event of [
    eventFor('k'), eventFor('k', { metaKey: true }), ctrlShift('k'),
    eventFor('k', { ctrlKey: true, altKey: true }), eventFor('k', { ctrlKey: true, metaKey: true }),
  ]) assert.equal(matchCommand(event, bindings), null);
  assert.equal(matchCommand(ctrlShift('p'), bindings), 'projects');
  assert.equal(matchCommand(ctrlShift('f'), bindings), 'panels');
  assert.equal(matchCommand(ctrlShift('Enter'), bindings), 'return-focus');
  assert.equal(matchCommand(ctrl('PageDown'), bindings), 'next-session');
  assert.equal(matchCommand(ctrl('PageUp'), bindings), 'previous-session');
  assert.equal(matchCommand(ctrl(','), bindings), 'shortcuts');
});

test('resuelve y ejecuta rebinding canónico con Ctrl/Alt/Shift/Meta explícitos', () => {
  const overrides = Object.freeze({ palette: ' shift + alt + Control + k ', projects: 'cmd+P', panels: 'Alt+F2' });
  const rebound = resolveBindings(overrides);
  assert.equal(rebound.palette, 'Ctrl+Alt+Shift+K');
  assert.equal(rebound.projects, 'Meta+P');
  assert.equal(rebound.panels, 'Alt+F2');
  assert.equal(matchCommand(ctrl('k'), rebound), null);
  assert.equal(matchCommand(eventFor('k', { ctrlKey: true, altKey: true, shiftKey: true }), rebound), 'palette');
  assert.equal(matchCommand(eventFor('p', { metaKey: true }), rebound), 'projects');
  assert.equal(matchCommand(eventFor('p', { metaKey: true, ctrlKey: true }), rebound), null);
  assert.equal(matchCommand(eventFor('F2', { altKey: true }), rebound), 'panels');
});

test('null desactiva comandos opcionales sin alterar el resto', () => {
  const rebound = resolveBindings({ palette: null, left: null, 'create-terminal': null });
  assert.equal(rebound.palette, null);
  assert.equal(rebound.left, null);
  assert.equal(matchCommand(ctrl('k'), rebound), null);
  assert.equal(matchCommand(eventFor('ArrowLeft'), rebound, navigation), null);
  assert.equal(matchCommand(ctrlShift('t'), rebound), null);
  assert.equal(matchCommand(ctrlShift('b'), rebound), 'create-browser');
  assert.equal(bindings.palette, 'Ctrl+K');
});

test('tolera overrides persistidos corruptos sin perder defaults válidos', () => {
  for (const corrupt of [null, false, 42, 'Ctrl+K', [], ['palette']]) {
    assert.deepEqual(resolveBindings(corrupt), bindings);
    assert.ok(validateBindings(corrupt).conflicts.length);
  }
  for (const corrupt of ['', 'Ctrl+', 'Ctrl+Ctrl+K', 'Unknown+K', 'Ctrl+K+P', 0, true, {}, [], 'constructor', '__proto__']) {
    const result = validateBindings({ palette: corrupt, 'create-note': 'Alt+N' });
    assert.equal(result.bindings.palette, bindings.palette);
    assert.equal(result.bindings['create-note'], 'Alt+N');
    assert.ok(result.conflicts.some(conflict => conflict.reason === 'invalid-binding'));
  }
  assert.equal(resolveBindings({ left: 'constructor+ArrowRight' }).left, bindings.left);
  assert.equal(resolveBindings({ left: 'constructor' }).left, bindings.left);
  const saved = Object.create({ palette: 'Alt+K' });
  saved.panels = 'Alt+P';
  assert.equal(resolveBindings(saved).palette, bindings.palette);
  assert.equal(resolveBindings(saved).panels, 'Alt+P');
  const unknown = validateBindings(JSON.parse('{"__proto__":"Ctrl+X","unknown":"Alt+Q"}'));
  assert.deepEqual(unknown.bindings, bindings);
  assert.ok(unknown.conflicts.every(conflict => conflict.reason === 'unknown-command'));
  assert.equal(Object.getPrototypeOf(unknown.bindings), Object.prototype);
});

test('detecta duplicados aunque cambien el orden y las mayúsculas', () => {
  const saved = Object.freeze({ palette: 'alt+shift+q', projects: 'SHIFT+ALT+Q' });
  const result = validateBindings(saved);
  assert.deepEqual(result.bindings, bindings);
  assert.deepEqual(result.conflicts[0].ids, ['palette', 'projects']);
  assert.equal(result.conflicts[0].binding, 'Alt+Shift+Q');
  assert.equal(result.conflicts[0].reason, 'duplicate');
  assert.deepEqual(resolveBindings({ projects: saved.projects, palette: saved.palette }), result.bindings);
});

test('restaurar defaults tras un conflicto no genera colisiones secundarias', () => {
  const result = validateBindings({ palette: 'Ctrl+Shift+P', projects: 'Ctrl+Shift+F' });
  assert.deepEqual(result.bindings, bindings);
  assert.equal(new Set(Object.values(result.bindings)).size, COMMANDS.length);
  assert.ok(result.conflicts.length >= 2);
  const moved = validateBindings({ palette: 'Ctrl+Shift+P', projects: 'Ctrl+K' });
  assert.deepEqual(moved.conflicts, []);
  assert.equal(matchCommand(ctrl('k'), moved.bindings), 'projects');
  assert.equal(matchCommand(ctrlShift('p'), moved.bindings), 'palette');
});

test('reasignar no permite desactivar salida/ajustes ni convertirlos en teclas de escritura', () => {
  for (const id of ['leave-panel', 'shortcuts']) {
    for (const invalid of [null, 'Escape', 'Shift+Escape', 'a', 'F1']) {
      const result = validateBindings({ [id]: invalid });
      assert.equal(result.bindings[id], bindings[id]);
      assert.equal(result.conflicts[0].reason, 'invalid-binding');
    }
    const result = validateBindings({ [id]: 'Alt+Escape' });
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.bindings[id], 'Alt+Escape');
  }
  assert.ok(validateBindings({ 'leave-panel': bindings.shortcuts }).conflicts.some(conflict => conflict.reason === 'duplicate'));
});

test('los globales no se convierten en escritura ni en flechas; las teclas de función son válidas', () => {
  for (const binding of ['a', 'Enter', 'Shift+A', 'ArrowLeft', 'Ctrl+ArrowLeft']) {
    assert.equal(resolveBindings({ palette: binding }).palette, bindings.palette);
  }
  assert.equal(matchCommand(eventFor('F8'), resolveBindings({ palette: 'F8' })), 'palette');
  assert.equal(matchCommand(eventFor('k'), { palette: 'K' }), null);
  assert.equal(matchCommand(ctrl('ArrowLeft'), { palette: 'Ctrl+ArrowLeft' }, navigation), null);
});

test('flechas, entrada y encuadre solo actúan en modo navegación', () => {
  for (const [key, id] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up'], ['ArrowDown', 'down'], ['Enter', 'enter-panel'], ['0', 'fit-all']]) {
    assert.equal(matchCommand(eventFor(key), bindings), null);
    assert.equal(matchCommand(eventFor(key), bindings, navigation), id);
    assert.equal(matchCommand(eventFor(key), bindings, { ...navigation, editable: true }), null);
    assert.equal(matchCommand(eventFor(key), bindings, { ...navigation, inPanel: true }), null);
    assert.equal(matchCommand(eventFor(key, { shiftKey: true }), bindings, navigation), null);
  }
  const rebound = resolveBindings({ left: 'Alt+ArrowLeft' });
  assert.equal(matchCommand(eventFor('ArrowLeft', { altKey: true }), rebound), null);
  assert.equal(matchCommand(eventFor('ArrowLeft', { altKey: true }), rebound, navigation), 'left');
});

test('detecta inputs, contenteditable, roles de edición y xterm sin depender de contexto', () => {
  const targets = [
    { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { isContentEditable: true },
    { closest: selector => selector.includes('[role="textbox"]') ? {} : null },
    { closest: selector => selector.includes('.xterm') ? {} : null },
  ];
  for (const target of targets) {
    assert.equal(matchCommand({ key: 'ArrowLeft', target }, bindings, navigation), null);
    assert.equal(matchCommand({ key: 'Enter', target }, bindings, navigation), null);
    assert.equal(matchCommand({ ...ctrl('k'), target }, bindings, navigation), 'palette');
  }
});

test('salida explícita funciona desde xterm y paneles editables, no con Escape desnudo', () => {
  const target = { closest: selector => selector.includes('.xterm') ? {} : null };
  assert.equal(matchCommand({ ...ctrlShift('Escape'), target }, bindings), 'leave-panel');
  assert.equal(matchCommand(ctrlShift('Escape'), bindings, { inPanel: true, editable: true }), 'leave-panel');
  assert.equal(matchCommand(ctrlShift('Escape'), bindings), null);
  assert.equal(matchCommand({ key: 'Escape', target }, bindings), null);
  assert.equal(matchCommand({ ...ctrl('Escape'), target }, bindings), null);
  const rebound = resolveBindings({ 'leave-panel': 'Alt+Escape' });
  assert.equal(matchCommand({ key: 'Escape', altKey: true, target }, rebound), 'leave-panel');
  assert.equal(matchCommand({ ...ctrlShift('Escape'), target }, rebound), null);
});

test('no intercepta composición IME, teclas muertas ni AltGraph', () => {
  for (const extra of [
    { isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { which: 229 },
    { key: 'Dead' }, { key: 'Process' }, { getModifierState: name => name === 'AltGraph' },
  ]) {
    assert.equal(matchCommand({ ...ctrl('k'), ...extra }, bindings), null);
    assert.equal(matchCommand({ ...ctrlShift('Escape'), ...extra }, bindings, { inPanel: true }), null);
    assert.equal(matchCommand({ key: 'ArrowLeft', ...extra }, bindings, navigation), null);
  }
  const rebound = resolveBindings({ palette: 'Ctrl+Alt+Q' });
  assert.equal(matchCommand({ key: 'q', ctrlKey: true, altKey: true, getModifierState: () => true }, rebound), null);
  assert.equal(matchCommand({ key: 'q', ctrlKey: true, altKey: true, getModifierState: () => false }, rebound), 'palette');
});

test('respeta overlays y eventos consumidos sin efectos laterales', () => {
  const event = Object.freeze(ctrl('k'));
  assert.equal(matchCommand(event, bindings, { blocked: true }), null);
  assert.equal(matchCommand({ ...event, defaultPrevented: true }, bindings), null);
  assert.equal(matchCommand(ctrlShift('Escape'), bindings, { inPanel: true, blocked: true }), null);
  assert.equal(matchCommand(event, bindings), 'palette');
  for (const invalid of [null, undefined, {}, { code: 'KeyK', ctrlKey: true }]) assert.equal(matchCommand(invalid, bindings), null);
});

test('formatea acordes legibles sin símbolos Meta por plataforma', () => {
  assert.equal(formatBinding('shift+control+t'), 'Ctrl+Shift+T');
  assert.equal(formatBinding('Alt+ArrowLeft'), 'Alt+←');
  assert.equal(formatBinding('ArrowRight'), '→');
  assert.equal(formatBinding('ArrowUp'), '↑');
  assert.equal(formatBinding('ArrowDown'), '↓');
  assert.equal(formatBinding('Ctrl+Space'), 'Ctrl+Espacio');
  assert.equal(formatBinding('meta+Escape'), 'Meta+Esc');
  for (const invalid of [null, undefined, '', 'Ctrl+', {}]) assert.equal(formatBinding(invalid), 'Sin atajo');
});

test('mantiene los atajos de creación Ctrl y la compatibilidad Cmd de panelShortcut', () => {
  for (const [key, type] of Object.entries({ t: 'terminal', b: 'browser', n: 'note', z: 'zone' })) {
    assert.equal(matchCommand(ctrlShift(key), bindings), `create-${type}`);
    assert.equal(panelShortcut(ctrlShift(key)), type);
    assert.equal(panelShortcut(eventFor(key.toUpperCase(), { metaKey: true, shiftKey: true })), type);
  }
});

test('rechaza reservas nativas canónicas y conserva salida y configuración recuperables', () => {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Ctrl';
  for (const key of ['W', 'Q', 'Z', 'X', 'C', 'V', 'A', 'R']) {
    const result = validateBindings({ palette: `${modifier}+${key}` });
    assert.equal(result.bindings.palette, bindings.palette);
    assert.equal(result.conflicts[0].reason, 'native-reservation');
  }
  for (const binding of process.platform === 'darwin' ? ['Meta+Shift+Z', 'Meta+Alt+I', 'Meta+Ctrl+F'] : ['Ctrl+Y', 'F11', 'Shift+Ctrl+I']) {
    const result = validateBindings({ palette: binding });
    assert.equal(result.bindings.palette, bindings.palette);
    assert.equal(result.conflicts[0].reason, 'native-reservation');
  }
  for (const { accelerator, title } of Object.values(nativeMenuShortcuts())) {
    for (const id of ['palette', 'leave-panel', 'shortcuts', 'left']) {
      const result = validateBindings({ [id]: accelerator.toLowerCase() });
      assert.equal(result.bindings[id], bindings[id]);
      const requiredFunctionKey = accelerator === 'F11' && ['leave-panel', 'shortcuts'].includes(id);
      assert.equal(result.conflicts[0].reason, requiredFunctionKey ? 'invalid-binding' : 'native-reservation');
      if (!requiredFunctionKey) assert.ok(result.conflicts[0].message.includes(title));
      assert.equal(matchCommand(ctrl('k'), result.bindings), 'palette');
      assert.equal(matchCommand(ctrlShift('Escape'), result.bindings, { inPanel: true }), 'leave-panel');
    }
  }
  for (const binding of ['Ctrl+Alt+R', 'Ctrl+Alt+W', 'F8']) {
    const result = validateBindings({ palette: binding });
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.bindings.palette, binding);
  }
});

test('reservas compartidas distinguen plataforma y no chocan con los defaults', () => {
  for (const platform of ['linux', 'win32', 'darwin']) {
    const menu = nativeMenuShortcuts(platform);
    for (const command of COMMANDS) assert.equal(nativeBindingReservation(command.defaultBinding, platform), null, command.id);
    assert.equal(nativeBindingReservation('Meta+Shift+N', platform), null);
    assert.equal(menu.close.accelerator, platform === 'darwin' ? 'Meta+W' : 'Ctrl+W');
    assert.equal(menu.redo.accelerator, platform === 'darwin' ? 'Shift+Meta+Z' : 'Ctrl+Y');
    assert.equal(menu.togglefullscreen.accelerator, platform === 'darwin' ? 'Ctrl+Meta+F' : 'F11');
    for (const item of Object.values(menu)) {
      assert.equal(formatBinding(item.accelerator), item.accelerator);
      assert.equal(nativeBindingReservation(item.accelerator, platform)?.title, item.title);
    }
  }
  assert.equal(nativeBindingReservation('Meta+W', 'linux'), null);
  assert.equal(nativeBindingReservation('Ctrl+W', 'darwin'), null);
  assert.equal(matchCommand(ctrlShift('n'), validateBindings({ 'create-note': 'Ctrl+Shift+N' }).bindings), 'create-note');
});

test('el menú nativo toma sus aceleradores de las reservas y deja libres Ctrl+Shift+N/Z', () => {
  const source = readFileSync(new URL('../../desktop/main.mjs', import.meta.url), 'utf8');
  const menu = source.slice(source.indexOf('Menu.setApplicationMenu'), source.indexOf(']));', source.indexOf('Menu.setApplicationMenu')));
  assert.match(source, /nativeMenuShortcuts\(process\.platform\)/);
  assert.doesNotMatch(menu, /accelerator:\s*'/);
  assert.doesNotMatch(menu, /\{ role: '/);
  assert.match(menu, /\{ label: 'Abrir ventana', click:/);
});
