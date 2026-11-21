import React, { useEffect, useRef } from 'react';
import '../activity-trace.css';

// Only mounted for a real pulse state. No frame loop or geometry measurements:
// CSS sizes the path and IntersectionObserver follows camera transforms/clipping.
export default function ActivityTrace({ state }) {
  const svg = useRef(null);
  useEffect(() => {
    const element = svg.current, panel = element.parentElement;
    const visible = new IntersectionObserver(([entry]) => {
      element.dataset.visible = String(entry.isIntersecting && entry.intersectionRatio > 0);
    });
    visible.observe(panel);
    const visibility = () => { element.dataset.hidden = String(document.hidden); };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => { visible.disconnect(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return <svg ref={svg} className="activity-trace" data-state={state} data-visible="false" aria-hidden="true" focusable="false">
    {[['26px', .06], ['18px', .14], ['11px', .28], ['6px', .55], ['2.5px', 1]].map(([length, opacity], index) =>
      <rect key={length} className={index === 4 ? 'activity-trace__head' : 'activity-trace__tail'} pathLength="100" style={{ '--L': length, opacity }} />)}
  </svg>;
}
