import React from 'react';
import { PhantomFace } from './Glyphs.jsx';

/** Decorative identity for the two canvas entry points; actions stay in EmptyState. */
export default function GengarMascot() {
  return <span className="gengar-mascot" aria-hidden="true">
    <svg width="104" height="88" viewBox="0 0 104 88" fill="none" focusable="false">
      <ellipse cx="52" cy="81" rx="32" ry="3" fill="currentColor" opacity=".12" />
      <path className="gengar-mascot-body" d="m28 42-10 7-6 8 8-1-2 7 12-4-1 12-6 7 17 1 5-6h14l5 6 17-1-6-7-1-12 12 4-2-7 8 1-6-8-10-7Z" strokeLinejoin="miter" />
      <path d="m31 72 6 1m30 0 6-1" stroke="currentColor" strokeWidth="1.2" />
      <path d="m20 54 5-3m-4 9 5-3m52-3-5-3m4 9-5-3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="miter" />
      <PhantomFace size={68} x="18" y="2" />
    </svg>
  </span>;
}
