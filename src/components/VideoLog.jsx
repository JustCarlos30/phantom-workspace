import React, { useRef } from 'react';
import { ArrowLeft, BookOpen, RefreshCw, Settings } from 'lucide-react';
import { Button, ErrorNotice, Field } from './PluginPrimitives';
import { inline } from './SkillsMarkdown';
import { parseBlocks } from '../hooks/skills-model.mjs';
import { useVideoLog } from '../hooks/useVideoLog';
import { videoLogMessage } from '../hooks/video-log.mjs';
import '../video-log.css';

// Local reader: all rows, no previews, HTML execution, image requests or linked-file reads.
function Block({ block }) {
  if (block.type === 'heading') { const Tag = `h${Math.min(6, block.level + 2)}`; return <Tag>{inline(block.text)}</Tag>; }
  if (block.type === 'code') return <pre><code>{block.text}</code></pre>;
  if (block.type === 'rule') return <hr />;
  if (block.type === 'quote') return <blockquote>{block.children.map((child, i) => <Block key={i} block={child} />)}</blockquote>;
  if (block.type === 'list') { const Tag = block.ordered ? 'ol' : 'ul'; return <Tag>{block.items.map((item, i) => <li key={i} style={{ marginInlineStart: item.depth * 12 }}>{inline(item.text)}</li>)}</Tag>; }
  if (block.type === 'table') return <div className="vl-table" tabIndex={0} role="region" aria-label="Tabla completa de la fuente"><table><thead><tr>{block.head.map((cell, i) => <th key={i} scope="col">{inline(cell)}</th>)}</tr></thead><tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, c) => <td key={c}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
  return <p>{inline(block.text)}</p>;
}
function FullMarkdown({ source }) {
  return <div className="vl-prose">{parseBlocks(source).map((block, i) => <Block key={i} block={block} />)}</div>;
}
const range = item => `Líneas ${item.startLine}–${item.endLine}`;

export function VideoLog({ workspace, api, plugin, onOpenPanel }) {
  const view = useVideoLog({ workspace, api, plugin });
  const { resource, document, items, query, video, selected, origin } = view;
  const detail = useRef(null), list = useRef(null);
  const configure = () => onOpenPanel?.('plugins');
  const choose = item => { view.setSelection(item.id); requestAnimationFrame(() => detail.current?.focus()); };
  const back = () => { view.setSelection(null); requestAnimationFrame(() => list.current?.focus()); };
  return <section className={`video-log tw-content ${selected ? 'vl-has-detail' : ''}`} aria-label="Bitácora de videos" aria-busy={resource.loading}>
    <header className="tw-heading vl-header"><div className="vl-title"><BookOpen size={20} aria-hidden="true" /><h2>Bitácora de videos</h2></div><div className="tw-row"><Button icon={RefreshCw} disabled={resource.loading} onClick={resource.reload}>{resource.loading ? 'Leyendo…' : 'Actualizar'}</Button><Button icon={Settings} onClick={configure}>Configurar fuente</Button></div></header>
    <p className="vl-freshness" role="status">{resource.loading ? (resource.data ? 'Releyendo disco; se muestra la lectura anterior.' : 'Cargando la fuente local…') : resource.data?.observedAt ? `Lectura: ${new Date(resource.data.observedAt).toLocaleString('es')}` : 'Sin lectura'}</p>
    <ErrorNotice error={resource.error} retry={resource.reload} />
    {resource.data?.available === false && <div className="vl-notice" role={resource.data.state === 'inaccessible' ? 'alert' : 'status'}><p>{resource.data.reason}</p><div className="tw-row"><Button onClick={configure}>Abrir configuración</Button><Button onClick={resource.reload} disabled={resource.loading}>Reintentar lectura</Button></div></div>}
    {resource.data?.available && <>
      <p className="vl-source">Fuente: {resource.data.sourcePath}</p>
      <div className="vl-filters"><Field label="Buscar aprendizajes" hint="Busca también en evidencia, límites y contexto."><input type="search" value={query} onChange={event => view.setQuery(event.target.value)} placeholder="Buscar en la bitácora…" /></Field><Field label="Filtrar por video"><select value={video} onChange={event => view.setVideo(event.target.value)}><option value="">Todos los orígenes</option>{view.videos.map(slug => <option key={slug} value={slug}>{slug}</option>)}<option value="__transversal__">Entradas transversales</option></select></Field></div>
      <p className="vl-count" role="status">{items.length} de {document.insights.length} aprendizajes{video ? ' · filtro de origen activo' : ''}</p>
      {!document.insights.length ? <p className="vl-notice" role="status">{videoLogMessage(resource.data.state)}</p> : !items.length ? <div className="vl-notice" role="status"><p>Sin coincidencias para esta búsqueda y filtro.</p><Button onClick={() => view.showVideo('')}>Limpiar búsqueda y filtro</Button></div> : <div className="vl-layout">
        <section className="vl-list" aria-label="Aprendizajes" ref={list} tabIndex={-1}>
          {items.map(item => { const source = document.origins.find(entry => entry.id === item.originId); return <button className="vl-insight" key={item.id} type="button" aria-pressed={selected?.id === item.id} onClick={() => choose(item)}><strong>{item.title}</strong><span>{item.summary}</span><small>{item.kind === 'transversal' ? 'Transversal · ' : ''}{source?.title} · {range(item)}</small></button>; })}
        </section>
        {selected && <article className="vl-detail" ref={detail} tabIndex={-1} aria-label="Detalle del aprendizaje">
          <Button icon={ArrowLeft} onClick={back}>Volver a aprendizajes</Button>
          <h3>{selected.title}</h3><p className="vl-origin">{selected.kind === 'transversal' ? 'Entrada transversal · no atribuida a un único video' : 'Ficha de video'}<br />{origin.title}<br />{range(selected)} · Encabezado en línea {selected.headingLine}</p>
          <FullMarkdown source={selected.markdown} />
          {selected.video && <Button onClick={() => view.showVideo(selected.video)}>Ver todos los aprendizajes de {selected.video}</Button>}
          <section className="vl-context" aria-label="Contexto completo del origen"><h4>{selected.kind === 'transversal' ? 'Contexto de la entrada transversal' : 'Contexto completo de la ficha'}</h4><p className="vl-origin">{range(origin)} · Comentarios, resultados, renders y subtítulos son contexto, no aprendizajes adicionales. Las hipótesis y preferencias conservan el carácter de la fuente.</p><FullMarkdown source={origin.markdown} /></section>
          <details className="vl-raw"><summary>Ver Markdown completo del origen</summary><pre>{origin.markdown}</pre></details>
        </article>}
      </div>}
    </>}
  </section>;
}
