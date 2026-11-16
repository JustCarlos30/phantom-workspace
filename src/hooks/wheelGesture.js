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
        else if (input.zooming) owner = 'canvas';
        else if (input.overMinimap) owner = 'element';
        // On the map a card's own content (a terminal's scrollback included)
        // only scrolls once that card is the active one (clicked). Passing over
        // any other card keeps moving the map, so the wheel never "sticks" on
        // whatever happens to be under it. An active scrollable body keeps the
        // gesture even at its scroll limits.
        else if (input.overTerminal && input.terminalActive) owner = 'element';
        else if (input.overBody && input.bodyActive && (input.bodyCanScroll || input.bodyScrollable)) owner = 'element';
        else owner = 'canvas';
      }
      lastTime = time;
      return owner;
    },
    reset,
  };
}

// One mouse-wheel notch (or a line/page-mode event) zooms by this fixed ratio.
export const ZOOM_STEP = 1.2;

// A touchpad scrolls in small pixel deltas; a mouse notch arrives as one big
// delta (≈53 on X11, 100 on Windows, 120 on Wayland) or in line/page mode.
export const isDiscreteWheel = ({ deltaMode = 0, deltaX = 0, deltaY = 0 }) =>
  deltaMode !== 0 || (!deltaX && Math.abs(deltaY) >= 50);

// Multiplier to apply to the zoom for one wheel event (dy in pixels).
// Chromium reports a touchpad pinch as ctrl+wheel with deltaY = -100·ln(scale),
// so exp(-dy / 100) follows the fingers exactly. A mouse notch steps a fixed
// ratio instead of jumping by whatever the platform's notch size happens to be.
export function wheelZoomFactor(dy, { discrete = false, pinch = false } = {}) {
  if (!dy) return 1;
  if (discrete) return ZOOM_STEP ** -Math.sign(dy);
  return Math.exp(-Math.max(-100, Math.min(100, dy)) * (pinch ? .01 : .004));
}

export function hasScrollable(element, dx, dy, boundary, styleOf = el => getComputedStyle(el)) {
  const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  for (let current = element; current; current = current.parentElement) {
    const style = styleOf(current);
    const overflow = axis === 'x' ? style.overflowX || style.overflow : style.overflowY || style.overflow;
    if (overflow === 'auto' || overflow === 'scroll') {
      const extent = axis === 'x' ? current.scrollWidth - current.clientWidth : current.scrollHeight - current.clientHeight;
      if (extent > 1) return true;
    }
    if (current === boundary) break;
  }
  return false;
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
