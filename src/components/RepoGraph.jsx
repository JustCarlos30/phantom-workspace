import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FolderOpen, GitBranch, GitMerge, SquareTerminal, Tag } from 'lucide-react';
import { filesText, shortBranch } from '../hooks/branches-model.mjs';
import { layoutGraph, parseRefs, relativeTime } from '../hooks/repo-graph.mjs';
import '../repository.css';

const ROW = 28, LANE = 18;
const COLORS = ['var(--c-lilac)', 'var(--c-sky)', 'var(--c-mint)', 'var(--c-sand)', 'var(--c-rose)', 'var(--c-iris)', 'var(--c-slate)'];
export function branchColor(name = '') {
  let hash = 2166136261;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return COLORS[(hash >>> 0) % COLORS.length];
}
const fullDate = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }); };

// A ref owns its first-parent path. Unnamed tips use their OID, never a column.
function graphPaths(commits, layout, base) {
  const byOid = new Map(commits.map(commit => [commit.oid, commit])), keys = new Map();
  const seeds = commits.flatMap(commit => parseRefs(commit.refs).filter(ref => ['head', 'branch', 'remote'].includes(ref.kind)).map(ref => ({ ...ref, oid: commit.oid })));
  seeds.sort((a, b) => Number(b.name === base) - Number(a.name === base) || Number(a.kind === 'remote') - Number(b.kind === 'remote') || a.name.localeCompare(b.name));
  const follow = (oid, key) => { while (oid && !keys.has(oid)) { keys.set(oid, key); oid = byOid.get(oid)?.parents[0]; } };
  seeds.forEach(seed => follow(seed.oid, seed.name));
  commits.forEach(commit => follow(commit.oid, commit.oid));
  let lanes = [];
  return layout.map((row, index) => {
    const key = keys.get(row.oid), previous = lanes.slice(), next = [];
    const top = row.top.map(seg => ({ seg, key: previous[seg[0]]?.key || key }));
    let parentIndex = 0;
    const bottom = row.bottom.map(seg => {
      const own = seg[0] === row.col, parent = own ? parentIndex++ : -1;
      const oid = own ? commits[index].parents[parent] : previous[seg[0]]?.oid;
      const colorKey = own ? (parent > 0 ? keys.get(oid) || key : key) : previous[seg[0]]?.key || key;
      // When two edges join, the surviving lane keeps the parent's owner.
      next[seg[1]] = { oid, key: next[seg[1]] ? keys.get(oid) || colorKey : colorKey };
      return { seg, key: colorKey };
    });
    lanes = next;
    return { ...row, key, top, bottom };
  });
}

export function GraphCell({ row, width, author, hovered, onPath }) {
  const x = index => index * LANE + LANE / 2 + 3, mid = ROW / 2;
  const path = ([from, to], y0, y1) => from === to ? `M${x(from)} ${y0}V${y1}` : `M${x(from)} ${y0}C${x(from)} ${(y0 + y1) / 2} ${x(to)} ${(y0 + y1) / 2} ${x(to)} ${y1}`;
  return <svg className="rp-graph-cell" width={width * LANE + 6} height={ROW} viewBox={`0 0 ${width * LANE + 6} ${ROW}`} preserveAspectRatio="none" aria-hidden="true">
    {row.top.map(({ seg, key }, i) => <path key={`t${i}`} d={path(seg, 0, mid)} stroke={branchColor(key)} opacity={hovered && hovered !== key && !(onPath && seg[1] === row.col) ? .2 : 1} />)}
    {row.bottom.map(({ seg, key }, i) => <path key={`b${i}`} d={path(seg, mid, ROW)} stroke={branchColor(key)} opacity={hovered && hovered !== key && !(onPath && i === 0 && seg[0] === row.col) ? .2 : 1} />)}
    <g opacity={hovered && hovered !== row.key && !onPath ? .2 : 1}>
      <circle cx={x(row.col)} cy={mid} r={7} fill={branchColor(row.key)} stroke={row.merge ? 'var(--ink)' : 'var(--surface)'} strokeWidth={row.merge ? 2 : 1} />
      <text x={x(row.col)} y={mid} className="rp-node-initial" textAnchor="middle" dominantBaseline="central">{(author?.trim()[0] || '?').toLocaleUpperCase()}</text>
    </g>
  </svg>;
}

export function RefBadges({ refs = [], trees = [], base, onHover }) {
  const items = parseRefs(refs).filter(ref => ref.kind !== 'detached' || !refs.some(r => r.startsWith('HEAD -> ')));
  const owned = new Map(trees.map(tree => [tree.name, tree]));
  return <span className="rp-refs">
    {items.slice(0, 3).map(ref => {
      const tree = owned.get(ref.name), label = tree?.terminal?.title || (ref.kind === 'tag' ? ref.name : shortBranch(ref.name));
      return <span key={`${ref.kind}:${ref.name}`} style={{ '--ref-color': branchColor(ref.name) }} onMouseEnter={() => onHover?.(ref.name)} onMouseLeave={() => onHover?.(null)} className={`rp-ref is-${ref.kind}${ref.name === base ? ' is-base' : ''}${tree?.changeCount ? ' is-dirty' : ''}`} title={`${ref.kind === 'tag' ? 'Tag' : ref.kind === 'remote' ? 'Rama remota' : 'Rama'} ${label}`}>
        {ref.kind === 'tag' ? <Tag size={10} aria-hidden="true" /> : tree?.terminal ? <SquareTerminal size={10} aria-hidden="true" /> : ref.kind === 'head' ? <Check size={10} aria-hidden="true" /> : <GitBranch size={10} aria-hidden="true" />}<span className="rp-ref-label">{label}</span>
      </span>;
    })}
    {items.length > 3 && <span className="rp-ref is-more" title={items.slice(3).map(ref => ref.name).join('\n')}>+{items.length - 3}</span>}
  </span>;
}

export default function RepoGraph({ graph, trees = [], base, query = '', selected, onSelectCommit, onSelectTree, onMore, compact = false }) {
  const commits = graph?.commits || [];
  const layout = useMemo(() => graphPaths(commits, layoutGraph(commits), base), [commits, base]);
  const width = Math.max(compact ? 1 : 4, layout.reduce((max, row) => Math.max(max, row.width), 1));
  const [hovered, setHovered] = useState(null);
  const text = query.trim().toLowerCase(), list = useRef(null);
  const hoverPath = useMemo(() => {
    if (!hovered) return null;
    const byOid = new Map(commits.map(commit => [commit.oid, commit])), path = new Set();
    let oid = commits.find(commit => parseRefs(commit.refs).some(ref => ref.name === hovered) || commit.oid === hovered)?.oid;
    while (oid && !path.has(oid)) { path.add(oid); oid = byOid.get(oid)?.parents[0]; }
    return path;
  }, [hovered, commits]);
  useEffect(() => { if (selected?.kind === 'commit') list.current?.querySelector(`[data-oid="${selected.oid}"]`)?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  if (!graph) return <p className="rp-quiet rp-pad" role="status">Leyendo historial…</p>;
  if (!graph.available) return <p className="rp-warning rp-pad">{graph.reason || 'Sin historial disponible.'}</p>;
  return <div className={`rp-graph${compact ? ' is-compact' : ''}`} style={{ '--graph-width': `${width * LANE + 6}px` }} role="grid" aria-label="Historial de commits" ref={list} onMouseLeave={() => setHovered(null)}>
    <div className="rp-graph-head" role="row"><span role="columnheader">Grafo</span><span role="columnheader">Ramas</span><span role="columnheader">Mensaje</span>{!compact && <span role="columnheader">Autor</span>}<span role="columnheader">Fecha</span>{!compact && <span role="columnheader">SHA</span>}</div>
    {trees.filter(tree => tree.changeCount > 0 && tree.exists).map(tree => <button type="button" role="row" key={`wip:${tree.id}`} className={`rp-graph-row is-wip${selected?.kind === 'tree' && selected.id === tree.id ? ' is-selected' : ''}`} onClick={() => onSelectTree?.(tree.id)}>
      <span className="rp-graph-lanes"><svg width={LANE + 6} height={ROW} aria-hidden="true"><circle cx={LANE / 2 + 3} cy={ROW / 2} r={5} fill="none" stroke="var(--warning)" strokeWidth={2} strokeDasharray="2 2" /></svg></span>
      <span className="rp-refs"><span className="rp-ref is-wip" title={tree.title}>{tree.terminal ? <SquareTerminal size={10} /> : <FolderOpen size={10} />}<span className="rp-ref-label">{tree.title}</span></span></span><span className="rp-msg"><b>Sin guardar</b> · {filesText(tree.changeCount)}</span>{!compact && <span className="rp-author">{tree.running ? 'Sesión activa' : ''}</span>}<span className="rp-date" />{!compact && <span className="rp-sha" />}
    </button>)}
    {commits.map((commit, index) => {
      const row = layout[index], match = !text || `${commit.subject}\n${commit.author}\n${commit.oid}\n${commit.refs.join('\n')}`.toLowerCase().includes(text);
      const active = !hovered || row.key === hovered || hoverPath?.has(commit.oid);
      return <button type="button" role="row" key={commit.oid} data-oid={commit.oid} className={`rp-graph-row${selected?.kind === 'commit' && selected.oid === commit.oid ? ' is-selected' : ''}${match && active ? '' : ' is-dim'}`} onMouseEnter={() => setHovered(row.key)} onFocus={() => setHovered(row.key)} onBlur={() => setHovered(null)} onClick={() => onSelectCommit?.(commit.oid)} title={commit.subject}>
        <span className="rp-graph-lanes"><GraphCell row={row} width={width} author={commit.author} hovered={hovered} onPath={hoverPath?.has(commit.oid)} /></span>
        <RefBadges refs={commit.refs} trees={trees} base={base} onHover={key => setHovered(key || row.key)} />
        <span className="rp-msg">{commit.parents.length > 1 && <GitMerge size={11} aria-hidden="true" className="rp-merge-icon" />}{commit.subject}</span>
        {!compact && <span className="rp-author" title={commit.email}>{commit.author}</span>}<span className="rp-date" title={fullDate(commit.at)}>{relativeTime(commit.at)}</span>{!compact && <code className="rp-sha">{commit.oid.slice(0, 7)}</code>}
      </button>;
    })}
    {!commits.length && <p className="rp-quiet rp-pad">Sin commits en esta lectura.</p>}
    {graph.more && onMore && <div className="rp-graph-more"><button type="button" className="rp-button" onClick={onMore}>Cargar más</button></div>}
  </div>;
}
