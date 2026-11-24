import { useCallback } from 'react';

export function useFitDensity(levels) {
  return useCallback(node => {
    if (!node) return;
    let frame = null;
    let disposed = false;
    const fit = () => {
      for (const level of levels) {
        node.dataset.fit = level;
        if (node.scrollWidth <= node.clientWidth + 1) break;
      }
    };
    const schedule = () => {
      if (disposed || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        fit();
      });
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(node);
    if (node.parentElement) resize.observe(node.parentElement);
    const content = new MutationObserver(schedule);
    content.observe(node, { childList: true, subtree: true, characterData: true });
    const shell = new MutationObserver(schedule);
    const appShell = node.closest('.app-shell');
    if (appShell) shell.observe(appShell, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule);
    fit();
    return () => {
      disposed = true;
      resize.disconnect();
      content.disconnect();
      shell.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [levels]);
}
