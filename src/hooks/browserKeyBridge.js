import { keyboardInitFromBrowserEvent } from './browserKeyBridge.mjs';

export function installBrowserKeyBridge(win = window) {
  if (typeof win.phantom?.onEvent !== 'function') return () => {};
  return win.phantom.onEvent(event => {
    const init = keyboardInitFromBrowserEvent(event);
    if (!init) return;
    const panel = typeof event.id === 'string' && event.id.length > 0 && event.id.length <= 128
      ? win.document.querySelector(`[data-node-id="${win.CSS.escape(event.id)}"]`) : null;
    const target = panel || win.document.body;
    target?.dispatchEvent(new win.KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
  });
}
