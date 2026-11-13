import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Search, Trash2 } from 'lucide-react';
import { RESEARCH_LABELS, withStatus } from '../../shared/research.mjs';
import { fitCapture } from '../hooks/pageCapture.js';
import { currentIndex, groupByStatus, moreLikeThisText, next, prev, sourcesFor } from '../hooks/researchReader.js';
import '../research-reader.css';

export default function ResearchReader({ node, nodes, spaceId, workspaceId, api, onChange, onNavigate, browserUrl, browserTitle }) {
  const sources = sourcesFor(nodes, spaceId ?? undefined), index = currentIndex(sources, browserUrl, node.data?.readerRef);
  const current = sources[index], groups = groupByStatus(sources);
  const [composer, setComposer] = useState(''), [kind, setKind] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const select = source => { onChange(node.id, { data: { ...node.data, readerRef: { id: source.id } } }); onNavigate(source.data.url); };
  const move = direction => { const target = direction === 'next' ? next(sources, index) : prev(sources, index); if (target >= 0) select(sources[target]); };
  const status = target => { if (!current) return; const targetIndex = next(sources, index); const updated = { ...current.data, tags: withStatus(current.data.tags || [], target) }; onChange(current.id, { data: updated }); if (targetIndex >= 0) select(sources[targetIndex]); };
  const submit = async event => {
    event.preventDefault(); const text = composer.trim(); if (!text || !current || busy) return;
    setBusy(true); setMessage('');
    let page = { url: browserUrl || current.data.url, title: browserTitle || current.title }, captureTooLarge = false;
    try { const captured = await api('browser.capture', { id: node.id }); const capture = await fitCapture(captured?.dataUrl); if (capture) page = { ...page, capture }; else captureTooLarge = true; }
    catch { setMessage('No se pudo capturar la página; el comentario se enviará sin captura.'); }
    try { await api('comment.add', { workspaceId: workspaceId, nodeId: current.id, x: .5, y: .5, text: kind === 'more' ? moreLikeThisText(text) : text, page }); setComposer(''); setKind(''); if (captureTooLarge) setMessage('La captura era demasiado grande; el comentario se guardó sin ella.'); }
    catch (error) { setMessage(error.message || 'No se pudo guardar el comentario. El texto se conserva.'); }
    finally { setBusy(false); }
  };
  const fieldFocused = target => target instanceof Element && !!target.closest('input,textarea,select');
  return <aside className="research-reader" tabIndex={0} aria-label="Lector de research" onKeyDown={event => {
    if (fieldFocused(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase(); const action = event.key === 'ArrowDown' || key === 'j' ? () => move('next') : event.key === 'ArrowUp' || key === 'k' ? () => move('prev') : key === 'l' ? () => status('liked') : key === 'd' ? () => status('discarded') : key === 'm' ? () => { setMessage(''); setKind('more'); } : key === 'c' ? () => { setMessage(''); setKind('comment'); } : null;
    if (action) { event.preventDefault(); action(); }
  }}>
    <header className="research-reader-head"><strong>{current ? `${index + 1} / ${sources.length}` : `0 / ${sources.length}`}</strong><span>Lector</span></header>
    <div className="research-reader-actions"><button aria-label="Fuente anterior" title="Anterior (K o Flecha arriba)" disabled={prev(sources, index) < 0} onClick={() => move('prev')}><ChevronLeft size={14} /> Anterior</button><button aria-label="Fuente siguiente" title="Siguiente (J o Flecha abajo)" disabled={next(sources, index) < 0} onClick={() => move('next')}>Siguiente <ChevronRight size={14} /></button>{current && <><button className="reader-like" aria-label="Me gusta" title="Me gusta (L)" onClick={() => status('liked')}><Heart size={13} /> Me gusta</button><button className="reader-discard" aria-label="Descartar" title="Descartar (D)" onClick={() => status('discarded')}><Trash2 size={13} /> Descartar</button><button aria-label="Buscar más fuentes similares" title="Más así (M)" onClick={() => { setMessage(''); setKind('more'); }}><Search size={13} /> Más así</button><button aria-label="Comentar fuente" title="Comentar (C)" onClick={() => { setMessage(''); setKind('comment'); }}><MessageCircle size={13} /> Comentar</button></>}</div>
    {kind && <form className="research-reader-compose" onSubmit={submit}><label>{kind === 'more' ? '¿Qué te gusta de esta?' : 'Comentar esta fuente'}</label><textarea autoFocus value={composer} onChange={e => setComposer(e.target.value)} placeholder={kind === 'more' ? 'Describe qué quieres conservar…' : 'Escribe tu comentario…'} /><footer><button type="button" aria-label="Cancelar comentario" title="Cancelar" onClick={() => setKind('')}>Cancelar</button><button type="submit" aria-label="Enviar comentario" title="Enviar comentario" disabled={!composer.trim() || busy}>{busy ? 'Enviando…' : 'Enviar'}</button></footer></form>}
    {message && <p className={`research-reader-status${message.startsWith('No se pudo guardar') ? ' error' : ''}`} role="status">{message}</p>}
    {!sources.length ? <p className="research-reader-empty">No hay fuentes de research en este espacio.</p> : <div className="research-reader-list">{['inbox', 'liked', 'discarded'].map(status => <details className="research-reader-group" key={status} open={status !== 'discarded'}><summary>{RESEARCH_LABELS[status]} ({groups[status].length})</summary>{groups[status].map(source => <button key={source.id} className={`research-reader-source${source.id === current?.id ? ' current' : ''}`} aria-label={`Abrir ${source.title}`} title={source.data.url} onClick={() => select(source)}><strong>{source.title || source.data.url}</strong><small>{source.data.site || (() => { try { return new URL(source.data.url).hostname; } catch { return source.data.url; } })()}</small>{source.data.note && <em>{source.data.note}</em>}</button>)}</details>)}</div>}
    <footer className="research-reader-help">J/K navegar, L me gusta, D descartar, M más así, C comentar</footer>
  </aside>;
}
