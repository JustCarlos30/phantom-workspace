import React, { useEffect, useRef, useState } from 'react';
import '../activity-trace.css';

// Only mounted for a real pulse state. No frame loop or geometry measurements:
// CSS sizes the path and IntersectionObserver follows camera transforms/clipping.
export default function ActivityTrace({ state }) {
  const svg = useRef(null);
  const [settled, setSettled] = useState(false);
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
  const attention = state === 'pulse-attention' || state === 'pulse-turn';
  return <svg ref={svg} className="activity-trace" data-state={state} data-settled={settled} data-visible="false" aria-hidden="true" focusable="false">
    <rect className="activity-trace__contour" pathLength="200" />
    <rect className="activity-trace__head" pathLength="200" onAnimationEnd={() => { if (attention || state === 'pulse-success') setSettled(true); }} />
    {state === 'pulse-working' && <rect className="activity-trace__tail" pathLength="200" />}
  </svg>;
}
