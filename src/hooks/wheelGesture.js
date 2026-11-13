export function createWheelGesture({ idle = 150, now = () => performance.now() } = {}) {
  let owner = null;
  let lastTime = null;
  let zooming = null;

  const reset = () => {
    owner = null;
    lastTime = null;
    zooming = null;
  };

  return {
    route(input) {
      const time = input.time ?? now();
      if (owner === null || time - lastTime > idle || input.zooming !== zooming) {
        zooming = input.zooming;
        if (input.overCanvasChrome) owner = 'ignore';
        else if (!input.zooming && (input.overTerminal || input.overMinimap)) owner = 'element';
        else if (input.zooming) owner = 'canvas';
        else if (input.overBody && input.bodyCanScroll) owner = 'element';
        else owner = 'canvas';
      }
      lastTime = time;
      return owner;
    },
    reset,
  };
}

export function canScroll(element, dx, dy, boundary, styleOf = el => getComputedStyle(el)) {
  const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  const delta = axis === 'x' ? dx : dy;
  if (!delta) return false;

  for (let current = element; current; current = current.parentElement) {
    const style = styleOf(current);
    const overflow = axis === 'x' ? style.overflowX || style.overflow : style.overflowY || style.overflow;
    if ((overflow === 'auto' || overflow === 'scroll')) {
      const position = axis === 'x' ? current.scrollLeft : current.scrollTop;
      const extent = axis === 'x' ? current.scrollWidth - current.clientWidth : current.scrollHeight - current.clientHeight;
      if (delta < 0 ? position > 1 : position < extent - 1) return true;
    }
    if (current === boundary) break;
  }
  return false;
}
