import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, ExternalLink, FileText, Folder, GitBranch, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { useResource } from './PluginPrimitives';
import { Markdown } from './SkillsMarkdown';
import { ORIGINS, ORDER, DRIFT, buildCatalog, phantomEntry, textOf, bytes } from '../hooks/skills-model.mjs';
import '../skills.css';

function Monogram({ entry, large }) {
  return <span className={`sk-mono sk-${entry.origin}${large ? ' is-large' : ''}`} aria-hidden="true">{(entry.name.replace(/^[^a-z0-9]+/i, '')[0] || '?').toUpperCase()}</span>;
}

function OriginPill({ origin }) {
  return <span className={`sk-pill sk-${origin}`}><i />{ORIGINS[origin].label}</span>;
}

function Row({ entry, active, copies, onSelect }) {
  return <button type="button" className={`sk-row${active ? ' is-active' : ''}`} aria-pressed={active} onClick={() => onSelect(entry.id)}>
    <Monogram entry={entry} />
    <span className="sk-row-main">
      <span className="sk-row-title"><strong>{entry.name}</strong>{entry.version && <span className="sk-tag">v{entry.version}</span>}</span>
      <span className="sk-row-desc">{entry.description || 'Sin descripción declarada.'}</span>
      {(entry.folders.length > 0 || copies.length > 0 || entry.drift) && <span className="sk-row-meta">
        {entry.drift && <span className="sk-chip is-drift"><GitBranch size={10} />{DRIFT[entry.drift]}</span>}
        {entry.folders.slice(0, 3).map(folder => <span key={folder} className="sk-chip"><Folder size={10} />{folder}</span>)}
        {copies.length > 0 && <span className="sk-chip is-copy" title={copies.map(copy => copy.group).join('\n')}>También en {copies.length === 1 ? copies[0].agent : `${copies.length} lugares`}</span>}
      </span>}
    </span>
  </button>;
}

function Fact({ label, children }) {
  return <div className="sk-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function FileDetail({ entry, api, notify, onOpenPanel }) {
  const detail = useResource(api, 'skills.read', { workspaceId: entry.workspaceId, id: entry.id });
  const [filesOpen, setFilesOpen] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(entry.path); notify?.('Ruta copiada'); }
    catch (error) { notify?.(`No se pudo copiar: ${error.message}`, 'error'); }
  };
  const data = detail.data;
  return <>
    <dl className="sk-facts">
      {entry.origin === 'worktree' && <Fact label="Rama"><span className="sk-path" title={entry.branch || entry.worktree}>{entry.worktreeLabel} · {DRIFT[entry.drift]?.toLowerCase()}</span>{onOpenPanel && <button type="button" className="sk-icon" aria-label="Ver esta rama en Ramas" title="Ver en Ramas" onClick={() => onOpenPanel('branches', entry.branch ? { branch: entry.branch } : {})}><GitBranch size={13} /></button>}</Fact>}
      <Fact label="Agente">{entry.agent}{entry.plugin ? ` · plugin ${entry.plugin}` : ''}</Fact>
      <Fact label="Archivos">{entry.fileCount ? `${entry.fileCount} de apoyo` : 'Solo SKILL.md'}{data?.size ? ` · ${bytes(data.size)}` : ''}</Fact>
      {entry.allowedTools && <Fact label="Herramientas">{entry.allowedTools}</Fact>}
      <Fact label="Ubicación"><span className="sk-path" title={entry.path}>{entry.path}</span><button type="button" className="sk-icon" aria-label="Copiar ruta" title="Copiar ruta" onClick={copy}><Copy size={13} /></button></Fact>
    </dl>
    {data?.files?.length > 0 && <section className="sk-files">
      <button type="button" className="sk-disclosure" aria-expanded={filesOpen} onClick={() => setFilesOpen(open => !open)}><FileText size={13} />Archivos de apoyo<span>{data.files.length}</span></button>
      {filesOpen && <ul>{data.files.map(file => <li key={file.path}><span>{file.path}</span><small>{bytes(file.size)}</small></li>)}</ul>}
    </section>}
    <section className="sk-instructions" aria-label="Instrucciones">
      <h4 className={`sk-section-title${/^\s*#/.test(data?.body || '') ? ' sk-hidden' : ''}`}>Instrucciones</h4>
      {detail.loading && !data && <div className="sk-skeleton" role="status" aria-label="Cargando instrucciones"><i /><i /><i /></div>}
      {detail.error && <p className="sk-notice is-error">No se pudo leer la Skill: {detail.error.message}<button type="button" onClick={detail.reload}>Reintentar</button></p>}
      {data && <Markdown source={data.body} />}
      {data?.truncated && <p className="sk-notice">Se muestran los primeros 512 KB de SKILL.md.</p>}
    </section>
  </>;
}

function PhantomDetail({ entry, api, onOpenPanel }) {
  const detail = useResource(api, 'phantom.detail', { workspaceId: entry.workspaceId, pluginId: 'phantom', topic: 'skills', id: entry.phantomId, ...(entry.ref?.sha256 ? { ref: entry.ref } : {}) });
  const manifest = detail.data?.manifest;
  return <>
    <dl className="sk-facts">
      <Fact label="Alcance">{entry.scope === 'global' ? 'Global · solo lectura' : entry.scope === 'workspace' || entry.scope ? 'Proyecto' : 'No informado'}</Fact>
      {manifest?.requiresTools?.length > 0 && <Fact label="Herramientas">{manifest.requiresTools.join(', ')}</Fact>}
      {manifest?.resources?.length > 0 && <Fact label="Recursos">{manifest.resources.map(resource => resource.name).join(', ')}</Fact>}
      {entry.ref?.sha256 && <Fact label="Huella"><span className="sk-path" title={entry.ref.sha256}>{entry.ref.sha256.slice(0, 16)}…</span></Fact>}
    </dl>
    {manifest?.actions?.length > 0 && <section><h4 className="sk-section-title">Acciones</h4><div className="sk-actions">{manifest.actions.map(action => <span key={action} className="sk-chip">{action}</span>)}</div></section>}
    <section className="sk-instructions" aria-label="Instrucciones">
      <h4 className={`sk-section-title${/^\s*#/.test(manifest?.body || '') ? ' sk-hidden' : ''}`}>Instrucciones</h4>
      {detail.loading && !detail.data && <div className="sk-skeleton" role="status" aria-label="Cargando instrucciones"><i /><i /><i /></div>}
      {detail.error && <p className="sk-notice is-error">Phantom no devolvió el detalle: {detail.error.message}<button type="button" onClick={detail.reload}>Reintentar</button></p>}
      {manifest && <Markdown source={manifest.body} />}
    </section>
    {onOpenPanel && <button type="button" className="sk-link-button" onClick={() => onOpenPanel('phantom-skills', { skillId: entry.phantomId, ...(entry.ref?.sha256 ? { ref: entry.ref } : {}) }, entry.name)}><ExternalLink size={13} />Abrir en Biblioteca Phantom para versionar o copiar</button>}
  </>;
}

function Detail({ entry, copies, api, notify, onOpenPanel, onClose, onSelect }) {
  return <article className="sk-detail" aria-label={`Skill ${entry.name}`}>
    <header className="sk-detail-head">
      <button type="button" className="sk-icon sk-back" aria-label="Volver a la lista" onClick={onClose}><ArrowLeft size={15} /></button>
      <Monogram entry={entry} large />
      <div className="sk-detail-title">
        <h3>{entry.name}</h3>
        <div className="sk-detail-tags"><OriginPill origin={entry.origin} /><span className="sk-tag">{entry.group}</span>{entry.version && <span className="sk-tag">v{entry.version}</span>}</div>
      </div>
      <button type="button" className="sk-icon sk-close" aria-label="Cerrar detalle" onClick={onClose}><X size={15} /></button>
    </header>
    {entry.description && <p className="sk-lede">{entry.description}</p>}
    {copies.length > 0 && <div className="sk-copies"><span>También disponible en</span>{copies.map(copy => <button type="button" key={copy.id} className="sk-chip is-button" onClick={() => onSelect(copy.id)}>{copy.group}</button>)}</div>}
    {entry.origin === 'phantom' ? <PhantomDetail entry={entry} api={api} onOpenPanel={onOpenPanel} /> : <>{entry.origin === 'worktree' && <p className="sk-notice">{entry.drift === 'new' ? 'Esta Skill solo existe en el worktree de esta rama.' : 'Esta copia difiere de la que hay en la carpeta del proyecto.'} Llegará al proyecto cuando la rama se integre.</p>}<FileDetail entry={entry} api={api} notify={notify} onOpenPanel={onOpenPanel} /></>}
  </article>;
}

export default function SkillsCatalog({ workspace, api, notify, onOpenPanel }) {
  const enabled = Boolean(workspace?.id);
  const files = useResource(api, 'skills.catalog', { workspaceId: workspace?.id }, { enabled });
  const phantom = useResource(api, 'phantom.list', { workspaceId: workspace?.id, pluginId: 'phantom', topic: 'skills' }, { enabled });
  const [origin, setOrigin] = useState('all'), [agent, setAgent] = useState('all'), [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState(null);
  const search = useRef(null), root = useRef(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 720));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);

  const entries = useMemo(() => [
    ...(Array.isArray(files.data?.items) ? files.data.items : []).map(item => ({ ...item, workspaceId: workspace?.id })),
    ...(phantom.data?.available !== false && Array.isArray(phantom.data?.items) ? phantom.data.items : []).map(item => ({ ...phantomEntry(item), workspaceId: workspace?.id })),
  ], [files.data, phantom.data, workspace?.id]);
  const catalog = useMemo(() => buildCatalog(entries, { origin, agent, query }), [entries, origin, agent, query]);
  const selected = entries.find(entry => entry.id === selectedId) || null;
  const loading = files.loading || phantom.loading;
  const reload = () => { files.reload(); phantom.reload(); };

  if (!enabled) return <EmptyState className="tw-empty" description="Abre una carpeta para ver sus Skills." />;
  const showList = wide || !selected;
  return <div ref={root} className={`sk-root${wide ? ' is-wide' : ''}${selected ? ' has-detail' : ''}`}>
    <header className="sk-head">
      <div className="sk-title"><Sparkles size={16} /><div><h2>Skills</h2><p>{loading && !catalog.total ? 'Buscando en carpeta, Phantom e instalaciones…' : `${catalog.total} disponibles en ${workspace.name || 'este proyecto'}`}</p></div></div>
      <button type="button" className="sk-icon" aria-label="Actualizar catálogo" title="Actualizar catálogo" disabled={loading} onClick={reload}><RefreshCw size={14} className={loading ? 'spinning' : ''} /></button>
    </header>
    <div className="sk-toolbar">
      <div className="sk-segments" role="tablist" aria-label="Origen">
        {[['all', 'Todas', catalog.total], ...ORDER.filter(key => key !== 'worktree' || catalog.counts.worktree).map(key => [key, ORIGINS[key].label, catalog.counts[key]])].map(([key, label, count]) => <button key={key} type="button" role="tab" aria-selected={origin === key} title={ORIGINS[key]?.hint} className={`sk-segment${key !== 'all' ? ` sk-${key}` : ''}`} onClick={() => setOrigin(key)}>{key !== 'all' && <i />}{label}<span>{count}</span></button>)}
      </div>
      <label className="sk-search"><Search size={13} /><input ref={search} type="search" placeholder="Buscar por nombre, descripción o grupo" aria-label="Buscar Skills" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} /></label>
      {catalog.agents.length > 1 && <div className="sk-agents" aria-label="Agente">
        {['all', ...catalog.agents].map(key => <button key={key} type="button" aria-pressed={agent === key} className="sk-agent" onClick={() => setAgent(key)}>{key === 'all' ? 'Todos los agentes' : key}</button>)}
      </div>}
    </div>
    <div className="sk-body">
      {showList && <nav className="sk-list" aria-label="Skills disponibles">
        {phantom.data?.available === false && (origin === 'all' || origin === 'phantom') && <p className="sk-notice">Phantom no respondió, así que sus Skills no aparecen. {textOf(phantom.data.reason).replace(/^Phantom unavailable:\s*/, '')}</p>}
        {files.error && <p className="sk-notice is-error">No se pudieron leer las Skills locales: {files.error.message}<button type="button" onClick={files.reload}>Reintentar</button></p>}
        {phantom.error && <p className="sk-notice is-error">Phantom no respondió: {phantom.error.message}<button type="button" onClick={phantom.reload}>Reintentar</button></p>}
        {loading && !catalog.total && <div className="sk-skeleton is-list" role="status" aria-label="Cargando Skills"><i /><i /><i /><i /></div>}
        {!loading && !files.error && !phantom.error && files.data && phantom.data?.available !== false && !catalog.total && <EmptyState className="sk-empty" icon={Sparkles} title="Aún no hay Skills" description={<>Crea una carpeta con un SKILL.md en <code>.claude/skills/</code> de este proyecto o instala un plugin.</>} />}
        {catalog.total > 0 && !catalog.visible && <EmptyState className="sk-empty" icon={Search} title="Sin coincidencias" description="Prueba otro término o vuelve a «Todas»." actions={<button type="button" className="sk-link-button" onClick={() => { setQuery(''); setOrigin('all'); setAgent('all'); }}>Limpiar filtros</button>} />}
        {catalog.groups.map(group => <section key={`${group.origin}:${group.title}`} className="sk-group" aria-label={group.title}>
          <h3 className="sk-group-title"><i className={`sk-dot sk-${group.origin}`} />{group.title}<span>{group.items.length}</span></h3>
          {group.items.map(entry => <Row key={entry.id} entry={entry} active={entry.id === selectedId} copies={catalog.copiesOf(entry)} onSelect={setSelectedId} />)}
        </section>)}
      </nav>}
      {selected ? <Detail key={selected.id} entry={selected} copies={catalog.copiesOf(selected)} api={api} notify={notify} onOpenPanel={onOpenPanel} onClose={() => setSelectedId(null)} onSelect={setSelectedId} />
        : wide && catalog.total > 0 && <EmptyState className="sk-placeholder" icon={Sparkles} description="Elige una Skill para leer qué hace, dónde vive y sus instrucciones." />}
    </div>
  </div>;
}
import EmptyState from './EmptyState.jsx';
