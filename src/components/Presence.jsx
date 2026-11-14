import React, { Children, useLayoutEffect, useRef, useState } from 'react';

// Keep the real surface mounted during its exit: no screenshots, duplicate PTYs,
// or delayed application actions. Exiting surfaces immediately lose input ownership.
export function Presence({ children, show = !!children, onExit }) {
  const root = useRef(null), retained = useRef(null), exitCallback = useRef(onExit);
  const [mounted, setMounted] = useState(show);
  exitCallback.current = onExit;
  useLayoutEffect(() => { if (show) retained.current = children; });
  useLayoutEffect(() => {
    if (show && !mounted) { setMounted(true); return; }
    if (!mounted) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animations = [...root.current.children].map(element => {
      const backdrop = element.matches('.popover-dismiss,.rail-scrim,.app-modal-backdrop,.tw-overlay,.main-workspace,.project-rail,.canvas-region,.toast-stack');
      const panel = element.matches('.canvas-node');
      // Ghost motion: surfaces condense out of a haze and disperse back into
      // it. Nothing slides; position is where the thing is, not how it got there.
      const still = reduced || backdrop;
      const rest = { opacity: 1, translate: '0 0', filter: 'blur(0px)', ...(!still && { scale: '1' }) };
      const edge = { opacity: 0, translate: '0 0', filter: still ? 'blur(0px)' : show ? 'blur(8px)' : 'blur(12px)', ...(!still && { scale: show ? '.96' : '1.02' }) };
      return element.animate(show ? [edge, rest] : [rest, edge], {
        duration: reduced ? 60 : show ? 200 : panel ? 160 : 120,
        easing: reduced ? 'linear' : show ? 'linear(0, .36 12%, .72 25%, .94 40%, 1.05 58%, 1.025 75%, 1)' : 'cubic-bezier(.4,0,1,1)',
        fill: 'both',
      });
    });
    let cancelled = false;
    Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (cancelled) return;
      // An exit keeps its final frame (fill: both) until React unmounts it;
      // cancelling first repaints the surface at full opacity for a frame.
      if (!show) { retained.current = null; setMounted(false); exitCallback.current?.(); return; }
      animations.forEach(animation => animation.cancel());
    }).catch(() => {});
    return () => { cancelled = true; animations.forEach(animation => animation.cancel()); };
  }, [show, mounted]);
  if (!show && !mounted) return null;
  return <div ref={root} className="motion-presence" inert={!show} aria-hidden={!show || undefined}>{show ? children : retained.current}</div>;
}

// Retain removed keyed items until their own exit completes. Existing panels
// retain React identity, terminal streams, and keyboard focus through updates.
export function PresenceGroup({ children }) {
  const [entries, setEntries] = useState(() => Children.toArray(children).map(element => ({ element, present: true })));
  useLayoutEffect(() => {
    const items = Children.toArray(children), keys = new Set(items.map(item => item.key));
    // Exiting items keep their DOM position: moving them to the end would lift a
    // closing panel above its overlapping neighbours mid-exit.
    setEntries(old => {
      const next = items.map(element => ({ element, present: true }));
      old.forEach((entry, i) => {
        if (keys.has(entry.element.key)) return;
        let at = 0;
        for (let j = i - 1; j >= 0; j--) {
          const index = next.findIndex(item => item.element.key === old[j].element.key);
          if (index >= 0) { at = index + 1; break; }
        }
        next.splice(at, 0, { ...entry, present: false });
      });
      return next;
    });
  }, [children]);
  return <>{entries.map(({ element, present }) => <Presence key={element.key} show={present} onExit={() => setEntries(old => old.filter(entry => entry.element.key !== element.key || entry.present))}>{element}</Presence>)}</>;
}
