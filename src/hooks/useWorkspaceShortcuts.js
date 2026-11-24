import { useCallback, useEffect, useRef, useState } from 'react';
import { COMMANDS, resolveBindings, validateBindings } from './workspace-commands.mjs';

// Preferencia local global, compartida por proyectos y por instancias del hook.
export const WORKSPACE_SHORTCUTS_KEY = 'phantom:workspace:shortcuts';
const changedEvent = 'phantom:workspace-shortcuts-changed';
const storageConflict = message => [{ ids: [], binding: null, reason: 'storage', message }];

function loadBindings() {
  try {
    const saved = localStorage.getItem(WORKSPACE_SHORTCUTS_KEY);
    return validateBindings(saved === null ? {} : JSON.parse(saved));
  } catch {
    return { bindings: resolveBindings(), conflicts: storageConflict('No se pudieron leer los atajos locales. Puedes restablecerlos para recuperarlos.') };
  }
}

/**
 * {bindings, setBinding(id, string|null), resetBindings(), conflicts}.
 * Las mutaciones devuelven boolean: false conserva los atajos previos y expone
 * conflictos {ids,binding,reason,message}; true guarda y limpia los conflictos.
 * No instala listeners de teclado. null desactiva salvo las vías de recuperación
 * leave-panel/shortcuts. Fallar al persistir no aplica una configuración temporal.
 */
export function useWorkspaceShortcuts() {
  const [state, setState] = useState(loadBindings);
  const current = useRef(state);
  const publish = useCallback(next => { current.current = next; setState(next); }, []);
  useEffect(() => {
    const reload = event => {
      if (event.type === 'storage' && (event.storageArea !== localStorage || (event.key !== null && event.key !== WORKSPACE_SHORTCUTS_KEY))) return;
      publish(loadBindings());
    };
    window.addEventListener('storage', reload);
    window.addEventListener(changedEvent, reload);
    publish(loadBindings());
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener(changedEvent, reload);
    };
  }, [publish]);

  const save = useCallback(bindings => {
    try { localStorage.setItem(WORKSPACE_SHORTCUTS_KEY, JSON.stringify(bindings)); }
    catch {
      publish({ ...current.current, conflicts: storageConflict('No se pudieron guardar los atajos locales. Libera espacio y vuelve a intentarlo.') });
      return false;
    }
    publish({ bindings, conflicts: [] });
    window.dispatchEvent(new Event(changedEvent));
    return true;
  }, [publish]);

  const setBinding = useCallback((id, binding) => {
    if (!COMMANDS.some(command => command.id === id)) {
      publish({ ...current.current, conflicts: [{ ids: [id], binding, reason: 'unknown-command', message: 'El comando no existe.' }] });
      return false;
    }
    const result = validateBindings({ ...current.current.bindings, [id]: binding });
    if (result.conflicts.length) {
      publish({ ...current.current, conflicts: result.conflicts });
      return false;
    }
    return save(result.bindings);
  }, [publish, save]);
  const resetBindings = useCallback(() => save(resolveBindings()), [save]);
  return { bindings: state.bindings, setBinding, resetBindings, conflicts: state.conflicts };
}
