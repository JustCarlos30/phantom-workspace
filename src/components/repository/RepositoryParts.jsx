import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, GitBranch, GitMerge, Pencil, Search, SquareTerminal } from 'lucide-react';
import { changeCode, changeLabel, changeMix, groupByDir } from '../../hooks/branches-model.mjs';

const STATUS = { M: 'Modificado', A: 'Añadido', D: 'Borrado', R: 'Renombrado', C: 'Copiado', T: 'Tipo cambiado', U: 'En conflicto' };
const statusTone = code => code === 'D' ? 'removed' : code === 'A' ? 'added' : code === 'U' ? 'conflict' : 'modified';
export const statusLetter = status => { const code = changeCode(status); return code === '?' ? 'N' : code; };
export const fileName = file => file.split('/').pop();
export const fileDir = file => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';

// ---------------------------------------------------------------- Detail pane

export function FileRow({ status, path, extra, onOpen, onEdit, title, hideDir = false }) {
  const letter = statusLetter(status);
  const label = letter === 'N' ? 'Nuevo' : STATUS[letter] || changeLabel(status);
  return <li className="rp-filerow">
    <button type="button" className="rp-filerow-main" onClick={onOpen} title={`${label} · ${title || path}`}>
      <span className={`rp-status is-${letter === 'N' ? 'added' : statusTone(letter)}`} aria-label={label}>{letter}</span>
      <span className="rp-filename">{fileName(path)}</span><span className="rp-status-label">{label}</span>{!hideDir && <span className="rp-filedir">{fileDir(path)}</span>}
      {hideDir && <span className="rp-spacer" />}
      {extra}
    </button>
    {onEdit && <button type="button" className="rp-icon is-small" title="Abrir en el editor" aria-label={`Editar ${path}`} onClick={onEdit}><Pencil size={12} /></button>}
  </li>;
}

// Stacked bar + legend: what kind of work a set of changes is, at a glance.
export function MixBar({ changes, total, summary }) {
  const mix = changeMix(changes, summary);
  if (!mix.length) return null;
  const shown = mix.reduce((sum, kind) => sum + kind.count, 0);
  return <div className="rp-mix">
    <div className="rp-mix-bar" role="img" aria-label={mix.map(kind => `${kind.count} ${kind.label.toLowerCase()}`).join(', ')}>
      {mix.map(kind => <span key={kind.id} className={`rp-mix-seg is-${kind.id}`} style={{ flexGrow: kind.count }} title={`${kind.count} ${kind.label.toLowerCase()}`} />)}
    </div>
    <div className="rp-mix-legend">
      {mix.map(kind => <span key={kind.id} className={`rp-mix-key is-${kind.id}`}><i aria-hidden="true" /><b>{kind.count}</b>{kind.label.toLowerCase()}</span>)}
      {total > shown && <span className="rp-quiet">· {total - shown} más sin listar</span>}
    </div>
  </div>;
}

// Files under folder headers, so a change set reads as "which parts of the repo".
export function GroupedFiles({ items, pathOf = item => item.path, render }) {
  const groups = groupByDir(items, pathOf);
  return <div className="rp-dirgroups">{groups.map(group => <section key={group.dir} className="rp-dirgroup">
    <h5 className="rp-dirhead" title={group.dir || 'Raíz del repositorio'}><Folder size={11} aria-hidden="true" /><span>{group.dir || 'raíz'}</span><span className="rp-count">{group.items.length}</span></h5>
    <ul className="rp-filelist">{group.items.map(item => render(item, true))}</ul>
  </section>)}</div>;
}

// ---------------------------------------------------------------- Sidebar

export function SideSection({ title, count, open, onToggle, children }) {
  return <section className="rp-side-section">
    <div className="rp-side-head"><button type="button" className="rp-disclosure" aria-expanded={open} onClick={onToggle}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span>{title}</span>{count !== undefined && <span className="rp-count">{count}</span>}</button></div>
    {open && children}
  </section>;
}

export function Sidebar({ model, selected, onSelectTree, onSelectCommit, filter, setFilter }) {
  const [open, setOpen] = useState({ trees: true, branches: true });
  const toggle = key => setOpen(old => ({ ...old, [key]: !old[key] }));
  const all = [model.baseRow, ...model.rows].filter(Boolean);
  const text = filter.trim().toLowerCase();
  const visible = all.filter(row => !text || `${row.title}\n${row.name || ''}\n${row.stateLabel}`.toLowerCase().includes(text));
  const trees = visible.filter(row => row.worktree), branches = visible.filter(row => !row.worktree);
  const item = (row, jump) => <li key={row.id}>
    <button type="button" className={`rp-side-item${selected?.kind === 'tree' && selected.id === row.id ? ' is-selected' : ''}`} onClick={() => { onSelectTree(row.id); if (jump && row.oid) onSelectCommit(row.oid, true); }} title={`${row.title} · ${row.detail}`}>
      {row.isBase ? <GitMerge size={13} aria-hidden="true" /> : row.terminal ? <SquareTerminal size={13} aria-hidden="true" className={row.running ? 'rp-live' : ''} /> : <GitBranch size={13} aria-hidden="true" />}
      <span className="rp-side-name">{row.title}</span>
      {!(row.isBase && row.state === 'merged') && <span className={`rp-pill${row.changeCount > 0 ? ' is-dirty' : ''}`} data-tone={row.tone}>{row.stateLabel}</span>}
    </button>
  </li>;
  return <aside className="rp-side" aria-label="Sesiones y ramas">
    <label className="rp-search rp-side-search"><Search size={12} aria-hidden="true" /><input type="search" placeholder="Filtrar" aria-label="Filtrar sesiones y ramas" value={filter} onChange={event => setFilter(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setFilter(''); }} /></label>
    <div className="rp-side-scroll">
      <SideSection title="Sesiones" count={trees.length} open={open.trees} onToggle={() => toggle('trees')}>
        <ul className="rp-side-list">{trees.map(row => item(row, false))}</ul>
      </SideSection>
      {branches.length > 0 && <SideSection title="Otras ramas" count={branches.length} open={open.branches} onToggle={() => toggle('branches')}>
        <ul className="rp-side-list">{branches.map(row => item(row, true))}</ul>
      </SideSection>}
    </div>
  </aside>;
}
