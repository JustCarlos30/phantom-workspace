import React, { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Globe, ImageOff, Link2, MessageCircle, Trash2, X, Copy, RotateCcw } from 'lucide-react';
import { commentBrief, referenceURL, timecode } from '../hooks/references.mjs';

// A reference on the board: the picture, video or link itself, plus one line
// for why it is here. Agents read that line together with the file.
export default function ReferencePanel({ node, workspace, comments, onChange, onOpenPanel, onOpenComment }) {
  const data = node.data || {}, src = data.file ? referenceURL(workspace.id, data.file) : null;
  const [missing, setMissing] = useState(false), [duration, setDuration] = useState(0);
  const video = useRef(null);
  useEffect(() => setMissing(false), [src]);
  const timed = data.kind === 'video' ? (comments || []).filter(c => c.time !== undefined && !c.resolved) : [];
  const origin = data.source || data.url;
  const openOrigin = () => onOpenPanel('browser', { url: origin });
  return <div className="reference" data-kind={data.kind}>
    <div className="reference-media">
      {missing || (!src && data.kind !== 'link') ? <div className="reference-missing"><ImageOff size={22} strokeWidth={1.5} /><span>{data.kind === 'empty' ? 'Pega una imagen o un enlace con Ctrl + V' : 'El archivo de esta referencia ya no está en este equipo'}</span></div>
        : data.kind === 'video' ? <video ref={video} data-reference-video src={src} controls preload="metadata" playsInline onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)} onError={() => setMissing(true)} onPointerDown={e => e.stopPropagation()} />
        : data.kind === 'link' ? <button className="reference-link" title={`Abrir ${data.url} en un navegador del canvas`} onClick={openOrigin}>
          {src ? <img src={src} alt="" draggable={false} onError={() => setMissing(true)} /> : <span className="reference-link-blank"><Globe size={26} strokeWidth={1.4} /></span>}
          <span className="reference-link-text"><strong>{node.title}</strong>{data.description && <em>{data.description}</em>}<small><Link2 size={11} />{data.site || data.url}</small></span>
        </button>
        : <img src={src} alt={data.note || node.title} draggable={false} onError={() => setMissing(true)} />}
    </div>
    {timed.length > 0 && duration > 0 && <div className="reference-timeline" aria-label="Comentarios en el video">{timed.map(c => <button key={c.id} style={{ left: `${Math.min(100, c.time / duration * 100)}%` }} title={`${timecode(c.time)} · ${c.messages[0].text}`} aria-label={`Ir al comentario del minuto ${timecode(c.time)}`} onClick={() => { if (video.current) video.current.currentTime = c.time; onOpenComment(c.id); }} />)}</div>}
    <footer className="reference-caption">
      <input aria-label="Por qué esta referencia" value={data.note || ''} placeholder="¿Qué te gusta de esta referencia?" maxLength={4000} onChange={e => onChange(node.id, { data: { ...data, note: e.target.value } })} onPointerDown={e => e.stopPropagation()} />
      {origin && data.kind !== 'link' && <button className="icon-button" title={`Fuente: ${origin}`} aria-label="Abrir la fuente en un navegador del canvas" onClick={openOrigin}><ExternalLink size={13} /></button>}
    </footer>
  </div>;
}

function Composer({ placeholder, onSubmit, onCancel, autoFocus }) {
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false);
  const send = async () => { const text = value.trim(); if (!text || busy) return; setBusy(true); try { await onSubmit(text); setValue(''); } finally { setBusy(false); } };
  return <form className="comment-composer" onSubmit={e => { e.preventDefault(); send(); }}>
    <textarea autoFocus={autoFocus} rows={2} value={value} placeholder={placeholder} maxLength={4000} onChange={e => setValue(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }} />
    <button className="button primary" type="submit" disabled={!value.trim() || busy}>Enviar</button>
  </form>;
}

// Pins live in world space and keep their screen size at any zoom. One thread
// is open at a time; a draft is a pin that has not been written yet.
export function CommentLayer({ comments, draft, open, active, geometryOf, nodeOf, api, workspaceId, pathOf, notify, onOpen, onDraft, seek }) {
  const call = (method, payload) => api(method, { workspaceId, ...payload }).catch(error => notify(`No se pudo guardar el comentario: ${error.message}`, 'error'));
  const point = c => { if (!c.nodeId) return { left: c.x, top: c.y }; const g = geometryOf(c.nodeId); return g && { left: g.x + c.x * g.width, top: g.y + c.y * g.height }; };
  const draftAt = draft && point(draft);
  return <div className="comment-layer">
    {comments.map(c => {
      const at = point(c); if (!at || (c.resolved && !active && open !== c.id)) return null;
      const node = c.nodeId ? nodeOf(c.nodeId) : null, isOpen = open === c.id;
      return <div key={c.id} className={`comment-anchor ${isOpen ? 'open' : ''}`} style={at}>
        <button className={`comment-pin ${c.resolved ? 'resolved' : ''}`} aria-label={`Comentario ${c.number}: ${c.messages[0].text}`} aria-expanded={isOpen} title={c.messages[0].text} onClick={() => { onOpen(isOpen ? null : c.id); if (!isOpen && c.time !== undefined) seek(c.nodeId, c.time); }}>{c.resolved ? <Check size={12} /> : c.number}</button>
        {isOpen && <section className="comment-thread" role="dialog" aria-label={`Hilo del comentario ${c.number}`} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onOpen(null); } }}>
          <header><strong>{node ? node.title : 'Canvas'}</strong>{c.time !== undefined && <button className="comment-time" title="Ir a este momento del video" onClick={() => seek(c.nodeId, c.time)}>{timecode(c.time)}</button>}
            <button className="icon-button" title="Copiar para un agente" aria-label="Copiar el hilo para un agente" onClick={() => navigator.clipboard.writeText(commentBrief(c, node, node ? pathOf(node) : null)).then(() => notify('Hilo copiado: pégalo en una terminal o en el chat de Phantom.'), () => notify('No se pudo copiar el hilo', 'error'))}><Copy size={13} /></button>
            <button className="icon-button" title={c.resolved ? 'Reabrir' : 'Resolver'} aria-label={c.resolved ? 'Reabrir comentario' : 'Resolver comentario'} onClick={() => { call('comment.update', { id: c.id, patch: { resolved: !c.resolved } }); if (!c.resolved) onOpen(null); }}>{c.resolved ? <RotateCcw size={13} /> : <Check size={14} />}</button>
            <button className="icon-button" title="Eliminar hilo" aria-label="Eliminar comentario" onClick={() => { call('comment.remove', { id: c.id }); onOpen(null); }}><Trash2 size={13} /></button>
            <button className="icon-button" title="Cerrar" aria-label="Cerrar hilo" onClick={() => onOpen(null)}><X size={14} /></button></header>
          <ol>{c.messages.map(m => <li key={m.id}><b>{m.author}</b><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><p>{m.text}</p></li>)}</ol>
          <Composer placeholder="Responder…" onSubmit={text => call('comment.reply', { id: c.id, text })} onCancel={() => onOpen(null)} />
        </section>}
      </div>;
    })}
    {draftAt && <div className="comment-anchor open" style={draftAt}>
      <span className="comment-pin draft"><MessageCircle size={12} /></span>
      <section className="comment-thread" role="dialog" aria-label="Nuevo comentario">
        {draft.time !== undefined && <header><strong>En el video</strong><span className="comment-time">{timecode(draft.time)}</span></header>}
        <Composer autoFocus placeholder="Escribe un comentario…" onCancel={() => onDraft(null)} onSubmit={async text => { const { nodeId, x, y, time, spaceId } = draft; const made = await call('comment.add', { nodeId, x, y, text, ...(time !== undefined ? { time } : {}), ...(spaceId ? { spaceId } : {}) }); if (made) onDraft(null); }} />
      </section>
    </div>}
  </div>;
}
