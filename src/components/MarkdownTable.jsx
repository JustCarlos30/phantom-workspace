import React, { useEffect, useRef, useState } from 'react';
import { CopyButton } from './CopyButton';
import { columnKinds, toTSV } from '../hooks/markdownTable.mjs';
import '../markdown-table.css';

const PREVIEW_ROWS = 12;

// One table look for every Markdown reader: a quiet frame with a summary bar,
// horizontal scroll with edge shadows instead of squeezed columns, numeric
// columns right-aligned, and long tables collapsed behind an explicit control.
export default function MarkdownTable({ block, inline, id = 't' }) {
  const kinds = columnKinds(block), long = block.rows.length > PREVIEW_ROWS + 3;
  const [expanded, setExpanded] = useState(false), scroller = useRef(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const rows = long && !expanded ? block.rows.slice(0, PREVIEW_ROWS) : block.rows;
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const measure = () => setEdges(prev => { const next = { start: el.scrollLeft > 1, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 }; return prev.start === next.start && prev.end === next.end ? prev : next; });
    measure(); el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null; observer?.observe(el);
    return () => { el.removeEventListener('scroll', measure); observer?.disconnect(); };
  }, [block, expanded]);
  const cellProps = c => ({ 'data-align': block.align?.[c] || (kinds[c] === 'number' ? 'right' : undefined), 'data-kind': kinds[c] });
  const summary = block.pending ? 'Recibiendo tabla…' : `${block.rows.length} ${block.rows.length === 1 ? 'fila' : 'filas'} · ${block.head.length} ${block.head.length === 1 ? 'columna' : 'columnas'}`;
  return <figure className={`md-table ${block.pending ? 'is-pending' : ''}`} aria-busy={block.pending || undefined}>
    <figcaption><span>{summary}</span>{!block.pending && <CopyButton text={() => toTSV(block)} label="Copiar tabla (pega en hojas de cálculo)" />}</figcaption>
    <div className={`md-table-body ${edges.start ? 'has-start' : ''} ${edges.end ? 'has-end' : ''}`}><div ref={scroller} className="md-table-scroll" tabIndex={edges.start || edges.end ? 0 : undefined} role="region" aria-label={`Tabla: ${block.head.filter(Boolean).slice(0, 3).join(', ')}`}>
      <table>
        <thead><tr>{block.head.map((cell, c) => <th key={c} scope="col" {...cellProps(c)}>{inline(cell, `${id}-h${c}`)}</th>)}</tr></thead>
        <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} {...cellProps(c)}>{cell ? inline(cell, `${id}-${r}-${c}`) : <span className="md-table-empty" aria-label="vacío">—</span>}</td>)}</tr>)}</tbody>
      </table>
    </div></div>
    {long && <button type="button" className="md-table-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Mostrar menos' : `Mostrar ${block.rows.length - PREVIEW_ROWS} filas más`}</button>}
  </figure>;
}
