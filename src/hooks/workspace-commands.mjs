// scope: global funciona también al escribir; navigation exige modo navegación y
// un destino no editable; panel permite salir del contenido, incluido xterm.
export const COMMANDS = Object.freeze([
  { id: 'palette', title: 'Buscar comandos', group: 'Workspace', defaultBinding: 'Ctrl+K', scope: 'global' },
  { id: 'projects', title: 'Cambiar proyecto', group: 'Workspace', defaultBinding: 'Ctrl+Shift+P', scope: 'global' },
  { id: 'panels', title: 'Buscar paneles', group: 'Workspace', defaultBinding: 'Ctrl+Shift+F', scope: 'global' },
  { id: 'left', title: 'Panel a la izquierda', group: 'Navegación', defaultBinding: 'ArrowLeft', scope: 'navigation' },
  { id: 'right', title: 'Panel a la derecha', group: 'Navegación', defaultBinding: 'ArrowRight', scope: 'navigation' },
  { id: 'up', title: 'Panel de arriba', group: 'Navegación', defaultBinding: 'ArrowUp', scope: 'navigation' },
  { id: 'down', title: 'Panel de abajo', group: 'Navegación', defaultBinding: 'ArrowDown', scope: 'navigation' },
  { id: 'next-session', title: 'Siguiente sesión', group: 'Navegación', defaultBinding: 'Ctrl+PageDown', scope: 'global' },
  { id: 'previous-session', title: 'Sesión anterior', group: 'Navegación', defaultBinding: 'Ctrl+PageUp', scope: 'global' },
  { id: 'next-attention', title: 'Siguiente sesión que necesita atención', group: 'Navegación', defaultBinding: 'Ctrl+Shift+A', scope: 'global' },
  { id: 'enter-panel', title: 'Entrar al panel', group: 'Navegación', defaultBinding: 'Enter', scope: 'navigation' },
  { id: 'leave-panel', title: 'Salir al mapa', group: 'Navegación', defaultBinding: 'Ctrl+Shift+Escape', scope: 'panel' },
  { id: 'fit-all', title: 'Ver todos los paneles', group: 'Navegación', defaultBinding: '0', scope: 'navigation' },
  { id: 'return-focus', title: 'Volver al enfoque', group: 'Navegación', defaultBinding: 'Ctrl+Shift+Enter', scope: 'global' },
  { id: 'shortcuts', title: 'Configurar atajos', group: 'Workspace', defaultBinding: 'Ctrl+,', scope: 'global' },
  { id: 'create-terminal', title: 'Crear terminal', group: 'Crear panel', defaultBinding: 'Ctrl+Shift+T', scope: 'global' },
  { id: 'create-browser', title: 'Crear navegador', group: 'Crear panel', defaultBinding: 'Ctrl+Shift+B', scope: 'global' },
  { id: 'create-note', title: 'Crear nota', group: 'Crear panel', defaultBinding: 'Ctrl+Shift+N', scope: 'global' },
  { id: 'create-zone', title: 'Crear zona', group: 'Crear panel', defaultBinding: 'Ctrl+Shift+Z', scope: 'global' },
].map(Object.freeze));

const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const modifierNames = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta' };
const namedKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Space', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`)];
const keyNames = Object.fromEntries(namedKeys.map(key => [key.toLowerCase(), key]));
const defaults = () => Object.fromEntries(COMMANDS.map(command => [command.id, command.defaultBinding]));
const hasModifier = binding => /^(Ctrl|Alt|Meta)\+|\+(Alt|Meta)\+/.test(binding);
const isArrow = key => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key);

function normalizeKey(key) {
  if (key === ' ') return 'Space';
  if (typeof key !== 'string') return null;
  return Object.hasOwn(keyNames, key.toLowerCase()) ? keyNames[key.toLowerCase()] :
    (/^[a-z0-9/.,;:'"\[\]\\`=?!@#$%^&*()_<>|{}~-]$/i.test(key) ? key.toUpperCase() : null);
}

// Un solo acorde, sin secuencias: modificadores separados por + y una tecla
// KeyboardEvent.key. Se normalizan mayúsculas y orden, sin usar KeyboardEvent.code.
function normalizeBinding(binding) {
  if (typeof binding !== 'string') return null;
  const parts = binding.trim().split('+').map(part => part.trim());
  const key = normalizeKey(parts.pop());
  if (!key) return null;
  const found = new Set();
  for (const part of parts) {
    const modifier = Object.hasOwn(modifierNames, part.toLowerCase()) ? modifierNames[part.toLowerCase()] : null;
    if (!modifier || found.has(modifier)) return null;
    found.add(modifier);
  }
  return [...modifiers.filter(modifier => found.has(modifier)), key].join('+');
}

/**
 * Valida overrides parciales y devuelve {bindings, conflicts}. Cada conflicto es
 * {ids, binding, reason, message}; no modifica la entrada. Desconocidos, valores
 * inválidos y duplicados vuelven a sus defaults. null desactiva un comando, salvo
 * leave-panel y shortcuts: ambos conservan un acorde con Ctrl, Alt o Meta para
 * poder salir de un editor y recuperar la configuración. Los globales también
 * exigen ese modificador, salvo F1–F24; las flechas solo admiten scope navigation.
 */
export function validateBindings(overrides = {}) {
  const bindings = defaults();
  const conflicts = [];
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return { bindings, conflicts: [{ ids: [], binding: null, reason: 'invalid-overrides', message: 'La configuración de atajos no es válida.' }] };
  }
  for (const [id, value] of Object.entries(overrides)) {
    const command = COMMANDS.find(item => item.id === id);
    if (!command) {
      conflicts.push({ ids: [id], binding: value, reason: 'unknown-command', message: 'El comando no existe.' });
      continue;
    }
    const binding = value === null ? null : normalizeBinding(value);
    const required = id === 'leave-panel' || id === 'shortcuts';
    const key = binding?.split('+').at(-1);
    if ((value !== null && !binding) || (required && (!binding || !hasModifier(binding))) ||
        (binding && command.scope === 'global' && !hasModifier(binding) && !/^F\d+$/.test(key)) ||
        (binding && isArrow(key) && command.scope !== 'navigation')) {
      conflicts.push({ ids: [id], binding: value, reason: 'invalid-binding', message: required ? 'Conserva un atajo con Ctrl, Alt o Meta para salir y configurar los atajos.' : 'El atajo no es válido para este comando.' });
      continue;
    }
    bindings[id] = binding;
  }
  // Al restaurar un default puede aparecer otro choque: se repite hasta que
  // todos los implicados recuperen sus defaults únicos, sin depender del orden.
  let duplicates;
  do {
    const groups = new Map();
    for (const [id, binding] of Object.entries(bindings)) {
      if (binding === null) continue;
      if (!groups.has(binding)) groups.set(binding, []);
      groups.get(binding).push(id);
    }
    duplicates = [...groups].filter(([, ids]) => ids.length > 1);
    for (const [binding, ids] of duplicates) {
      conflicts.push({ ids, binding, reason: 'duplicate', message: 'Este atajo ya está asignado a otro comando.' });
      for (const id of ids) bindings[id] = COMMANDS.find(command => command.id === id).defaultBinding;
    }
  } while (duplicates.length);
  return { bindings, conflicts };
}

// Mapa completo ID → acorde canónico o null. Tolera datos persistidos corruptos.
export function resolveBindings(overrides) {
  return validateBindings(overrides).bindings;
}

/**
 * Devuelve el ID coincidente o null, sin consumir el evento. context acepta
 * {navigationMode, inPanel, editable, blocked}, todos false por defecto. La UI
 * comunica overlays mediante blocked y el modo mediante navigationMode/inPanel.
 * Detecta edición DOM y xterm incluso sin editable; los globales modificados y
 * leave-panel siguen disponibles al escribir. Invocar en captura antes de xterm
 * y consumir solo coincidencias. IME/AltGraph nunca se interceptan.
 */
export function matchCommand(event, bindings = resolveBindings(), context = {}) {
  if (!event || event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.which === 229 ||
      event.getModifierState?.('AltGraph') || context.blocked) return null;
  const key = normalizeKey(event.key);
  if (!key || event.key === 'Dead' || event.key === 'Process') return null;
  const target = event.target;
  const editable = context.editable || target?.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '') ||
    !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.xterm');
  const inPanel = context.inPanel || !!target?.closest?.('.xterm');
  const binding = [...modifiers.filter(modifier => event[`${modifier === 'Ctrl' ? 'ctrl' : modifier.toLowerCase()}Key`]), key].join('+');
  for (const command of COMMANDS) {
    if (command.scope === 'navigation' && (!context.navigationMode || editable || inPanel)) continue;
    if (command.scope === 'panel' && !inPanel) continue;
    if (isArrow(key) && command.scope !== 'navigation') continue;
    const candidate = normalizeBinding(bindings?.[command.id]);
    if (candidate !== binding) continue;
    if ((command.scope === 'global' || command.scope === 'panel') && !hasModifier(candidate) &&
        (command.scope === 'panel' || !/^F\d+$/.test(key))) continue;
    return command.id;
  }
  return null;
}

// Etiqueta legible y estable en Linux/Wayland; null o un acorde inválido → «Sin atajo».
export function formatBinding(binding) {
  const normalized = normalizeBinding(binding);
  if (!normalized) return 'Sin atajo';
  const labels = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Espacio', Escape: 'Esc' };
  return normalized.split('+').map(part => labels[part] || part).join('+');
}
