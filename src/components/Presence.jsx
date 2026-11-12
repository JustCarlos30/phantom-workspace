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
      const side = element.matches('.inspector-host,.attention-tray');
      const panel = element.matches('.canvas-node');
      const shift = reduced || backdrop || panel ? '0 0' : side ? '14px 0' : '0 7px';
      const rest = { opacity: 1, translate: '0 0', ...(panel && { scale: '1' }) };
      const edge = { opacity: 0, translate: shift, ...(panel && { scale: reduced ? '1' : show ? '.98' : '.96' }) };
      return element.animate(show ? [edge, rest] : [rest, edge], {
        duration: reduced ? 60 : show ? 200 : panel ? 160 : 120,
        easing: show ? 'cubic-bezier(.16,1,.3,1)' : 'cubic-bezier(.4,0,1,1)',
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
