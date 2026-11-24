export function keyboardPlatform() {
  if (typeof process !== 'undefined' && process.platform) return process.platform;
  const platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '';
  return /mac/i.test(platform) ? 'darwin' : /win/i.test(platform) ? 'win32' : 'linux';
}

export function nativeMenuShortcuts(platform = keyboardPlatform()) {
  const modifier = platform === 'darwin' ? 'Meta' : 'Ctrl';
  return {
    close: { accelerator: `${modifier}+W`, title: 'Cerrar ventana' },
    quit: { accelerator: `${modifier}+Q`, title: 'Salir' },
    undo: { accelerator: `${modifier}+Z`, title: 'Deshacer' },
    redo: { accelerator: platform === 'darwin' ? 'Shift+Meta+Z' : 'Ctrl+Y', title: 'Rehacer' },
    cut: { accelerator: `${modifier}+X`, title: 'Cortar' },
    copy: { accelerator: `${modifier}+C`, title: 'Copiar' },
    paste: { accelerator: `${modifier}+V`, title: 'Pegar' },
    selectAll: { accelerator: `${modifier}+A`, title: 'Seleccionar todo' },
    reload: { accelerator: `${modifier}+R`, title: 'Recargar' },
    togglefullscreen: { accelerator: platform === 'darwin' ? 'Ctrl+Meta+F' : 'F11', title: 'Pantalla completa' },
    toggleDevTools: { accelerator: platform === 'darwin' ? 'Alt+Meta+I' : 'Ctrl+Shift+I', title: 'Herramientas de desarrollo' },
  };
}

export function nativeBindingReservation(binding, platform = keyboardPlatform()) {
  return Object.values(nativeMenuShortcuts(platform)).find(item => item.accelerator === binding) || null;
}
