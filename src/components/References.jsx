import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ExternalLink, Globe, ImageOff, Link2, MessageCircle, Trash2, X, Copy, RotateCcw, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { commentBrief, referenceURL, timecode } from '../hooks/references.mjs';
import { contentBox, contentPoint, frameAt, stepTime, validateReview } from '../../shared/video-review.mjs';

// A reference on the board: the picture, video or link itself, plus one line
// for why it is here. Agents read that line together with the file.
export default function ReferencePanel({ node, workspace, comments, onChange, onOpenPanel, onOpenComment, api, notify, onReviewDraft }) {
  const data = node.data || {}, src = data.file ? referenceURL(workspace.id, data.file) : null;
  const [missing, setMissing] = useState(false), [duration, setDuration] = useState(0);
  const video = useRef(null), surface = useRef(null), start = useRef(null);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [fps, setFps] = useState(''), [mode, setMode] = useState(''), [region, setRegion] = useState(null), [size, setSize] = useState(null), [error, setError] = useState(''), [working, setWorking] = useState(false), [compare, setCompare] = useState('');
  const drafting = useRef(false);
  const visual = ['image', 'video'].includes(data.kind), isVideo = data.kind === 'video';
  const versions = workspace.nodes.filter(n => n.type === 'reference' && n.id !== node.id && n.data.kind === data.kind && (n.id === data.previousVersion || n.data.previousVersion === node.id));
  const other = versions.find(n => n.id === compare);
  const box = () => {
    const el = surface.current?.querySelector('[data-review-media]');
    return el && contentBox(el.getBoundingClientRect(), el.videoWidth || el.naturalWidth, el.videoHeight || el.naturalHeight);
  };
  const makeDraft = async selected => {
    if (drafting.current) return;
    drafting.current = true;
    video.current?.pause(); setWorking(true); setError('');
    try {
      if (isVideo && !(Number(fps) > 0 && Number(fps) <= 240)) throw new Error('Indica los FPS del archivo antes de marcar.');
      const identity = await api('reference.identity', { workspaceId: workspace.id, id: node.id });
      video.current?.pause();
      const current = video.current?.currentTime || 0;
      if (isVideo && (video.current.seeking || video.current.readyState < 2)) throw new Error('Espera a que termine la búsqueda del frame y vuelve a marcar.');
      let capture, captureLimit;
      if (isVideo) {
        try {
          const el = video.current, canvas = document.createElement('canvas'), scale = Math.min(1, 960 / el.videoWidth);
          canvas.width = Math.round(el.videoWidth * scale); canvas.height = Math.round(el.videoHeight * scale);
          canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height);
           capture = canvas.toDataURL('image/png').split(',')[1];
           if (!capture) throw new Error('Frame no disponible');
          if (capture.length > 900000) { capture = undefined; captureLimit = 'Captura demasiado grande; se envía archivo y tiempo.'; }
        } catch { captureLimit = 'Chromium no permite capturar este frame; se envía archivo y tiempo.'; }
      }
      onReviewDraft({ nodeId: node.id, x: selected.x, y: selected.y, requestId: crypto.randomUUID(), review: { schema: 1, ...identity, region: selected, scope: isVideo ? 'instant' : 'all', ...(isVideo ? { fps: Number(fps), time: current, frame: frameAt(current, Number(fps)) } : {}), ...(captureLimit ? { captureLimit } : {}) }, ...(capture ? { capture } : {}) });
      setMode('');
      setRegion(null);
    } catch (e) { setError(e.message); } finally { setWorking(false); drafting.current = false; }
  };
  const step = delta => { try { video.current.pause(); video.current.currentTime = stepTime(video.current.currentTime, delta, Number(fps), duration); } catch (e) { setError(e.message); } };
  const importVersion = async () => {
    setError(''); setWorking(true);
    try {
      const path = await api('dialog.openFile'); if (!path) return;
      await api('reference.add', { workspaceId: workspace.id, path, previousVersion: node.id, x: node.x + node.width + 40, y: node.y, width: node.width, height: Math.max(node.height, 420), ...(data.spaceId ? { spaceId: data.spaceId } : {}) });
      notify('Nueva versión importada; selecciona Comparar para ver antes y después.');
    } catch (e) { setError(e.message); } finally { setWorking(false); }
  };
  useEffect(() => setMissing(false), [src]);
  const timed = data.kind === 'video' ? (comments || []).filter(c => c.time !== undefined && !c.resolved) : [];
  const origin = data.source || data.url;
  const openOrigin = () => onOpenPanel('browser', { url: origin });
  return <div className="reference" data-kind={data.kind} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { setMode(''); setRegion(null); } }}>
    {visual && <div className="review-tools" onPointerDown={e => e.stopPropagation()}>
      {isVideo && <><button aria-label={playing ? 'Pausar video' : 'Reproducir video'} disabled={missing} onClick={() => playing ? video.current.pause() : video.current.play().catch(e => setError(e.message))}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><button aria-label="Frame anterior" disabled={!fps || missing} onClick={() => step(-1)}><SkipBack size={14} /></button><button aria-label="Frame siguiente" disabled={!fps || missing} onClick={() => step(1)}><SkipForward size={14} /></button><label>FPS <input aria-label="FPS explícitos" type="number" min="0.001" max="240" step="any" placeholder="24" value={fps} onChange={e => setFps(e.target.value)} /></label><output>{time.toFixed(3)} s{Number(fps) > 0 ? ` · f ${frameAt(time, Number(fps))}` : ''}</output></>}
      <button aria-pressed={mode === 'point'} disabled={working || missing} onClick={() => { video.current?.pause(); setMode(mode === 'point' ? '' : 'point'); }}>Punto</button>
      <button aria-pressed={mode === 'rect'} disabled={working || missing} onClick={() => { video.current?.pause(); setMode(mode === 'rect' ? '' : 'rect'); }}>Rectángulo</button>
      <button disabled={working || missing || !size} onClick={() => makeDraft({ type: 'point', x: .5, y: .5 })}>Marcar centro</button>
      <button disabled={working} onClick={importVersion}>Importar versión</button>
      {versions.length > 0 && <label>Comparar <select aria-label="Comparar versión" value={compare} onChange={e => setCompare(e.target.value)}><option value="">Sin comparación</option>{versions.map(n => <option key={n.id} value={n.id}>{n.title} · {n.data.file.slice(0, 8)}</option>)}</select></label>}
    </div>}
    {error && <p className="review-error" role="alert">{error}</p>}
    <div ref={surface} className="reference-media" data-marking={mode || undefined} onPointerDown={e => {
      if (!mode || working) return; e.preventDefault(); e.stopPropagation(); video.current?.pause();
      const p = contentPoint(box(), e.clientX, e.clientY); if (!p) return;
      start.current = p; e.currentTarget.setPointerCapture(e.pointerId); setRegion({ type: 'point', ...p });
    }} onPointerMove={e => {
      if (!start.current || mode !== 'rect') return;
      const p = contentPoint(box(), e.clientX, e.clientY); if (!p) return;
      setRegion({ type: 'rect', x: Math.min(p.x, start.current.x), y: Math.min(p.y, start.current.y), width: Math.abs(p.x - start.current.x), height: Math.abs(p.y - start.current.y) });
    }} onPointerUp={e => {
      if (!start.current) return; e.stopPropagation();
      const p = contentPoint(box(), e.clientX, e.clientY), first = start.current; start.current = null;
      if (!p) { setRegion(null); return; }
      const selected = mode === 'rect' ? { type: 'rect', x: Math.min(p.x, first.x), y: Math.min(p.y, first.y), width: Math.abs(p.x - first.x), height: Math.abs(p.y - first.y) } : { type: 'point', ...first };
      if (selected.type === 'rect' && (!selected.width || !selected.height)) { setError('Arrastra para dibujar un rectángulo.'); return; }
      setRegion(selected); makeDraft(selected);
    }} onPointerCancel={() => { start.current = null; setRegion(null); }}>
      {missing || (!src && data.kind !== 'link') ? <div className="reference-missing"><ImageOff size={22} strokeWidth={1.5} /><span>{data.kind === 'empty' ? 'Pega una imagen o un enlace con Ctrl + V' : 'El archivo de esta referencia ya no está en este equipo'}</span></div>
        : data.kind === 'video' ? <video ref={video} data-reference-video data-review-media src={src} preload="auto" playsInline onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onSeeked={e => setTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onLoadedMetadata={e => { setDuration(e.currentTarget.duration || 0); setSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight }); }} onError={() => setMissing(true)} />
        : data.kind === 'link' ? <button className="reference-link" title={`Abrir ${data.url} en un navegador del canvas`} onClick={openOrigin}>
          {src ? <img src={src} alt="" draggable={false} onError={() => setMissing(true)} /> : <span className="reference-link-blank"><Globe size={26} strokeWidth={1.4} /></span>}
          <span className="reference-link-text"><strong>{node.title}</strong>{data.description && <em>{data.description}</em>}<small><Link2 size={11} />{data.site || data.url}</small></span>
        </button>
        : <img data-review-media src={src} alt={data.note || node.title} draggable={false} onLoad={e => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} onError={() => setMissing(true)} />}
      {visual && size && <ReviewMarks surface={surface} size={size} region={region} comments={comments} time={time} onOpenComment={onOpenComment} />}
    </div>
    {isVideo && duration > 0 && <input className="review-seek" aria-label="Tiempo del video" type="range" min="0" max={duration} step="any" value={time} onChange={e => { video.current.pause(); video.current.currentTime = Number(e.target.value); setTime(Number(e.target.value)); }} />}
    {other && <div className="review-compare"><span>Versión comparada · {other.title} · {other.data.file.slice(0, 8)}</span>{isVideo ? <video src={referenceURL(workspace.id, other.data.file)} controls preload="metadata" /> : <img alt={`Versión comparada: ${other.title}`} src={referenceURL(workspace.id, other.data.file)} />}</div>}
    {timed.length > 0 && duration > 0 && <div className="reference-timeline" aria-label="Comentarios en el video">{timed.map(c => <button key={c.id} style={{ left: `${Math.min(100, c.time / duration * 100)}%` }} title={`${timecode(c.time)} · ${c.messages[0].text}`} aria-label={`Ir al comentario del minuto ${timecode(c.time)}`} onClick={() => { if (video.current) video.current.currentTime = c.time; onOpenComment(c.id); }} />)}</div>}
    <footer className="reference-caption">
      <input aria-label="Por qué esta referencia" value={data.note || ''} placeholder="¿Qué te gusta de esta referencia?" maxLength={4000} onChange={e => onChange(node.id, { data: { ...data, note: e.target.value } })} onPointerDown={e => e.stopPropagation()} />
      {origin && data.kind !== 'link' && <button className="icon-button" title={`Fuente: ${origin}`} aria-label="Abrir la fuente en un navegador del canvas" onClick={openOrigin}><ExternalLink size={13} /></button>}
    </footer>
  </div>;
}

function ReviewMarks({ surface, size, region, comments, time, onOpenComment }) {
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const el = surface.current; if (!el) return;
    const measure = () => setBox(contentBox({ x: 0, y: 0, width: el.clientWidth, height: el.clientHeight }, size.width, size.height));
    measure(); const observer = new ResizeObserver(measure); observer.observe(el); return () => observer.disconnect();
  }, [size, surface]);
  if (!box) return null;
  const marks = (comments || []).filter(c => c.review && !c.resolved && (c.review.kind !== 'video' || c.review.scope === 'all' || Math.abs(c.review.time - time) <= 1 / c.review.fps || (c.review.scope === 'range' && time >= c.review.time && time <= c.review.end))).map(c => ({ ...c.review.region, id: c.id }));
  if (region) marks.push(region);
  return <svg className="review-marks" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">{marks.map((r, i) => r.type === 'rect' ? <rect key={r.id || i} x={r.x} y={r.y} width={r.width} height={r.height} vectorEffect="non-scaling-stroke" /> : <ellipse key={r.id || i} cx={r.x} cy={r.y} rx={5 / box.width} ry={5 / box.height} vectorEffect="non-scaling-stroke" />)}</svg>;
}

function Composer({ placeholder, onSubmit, onCancel, autoFocus }) {
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const field = useRef(null);
  // Starts at one line and grows with the text up to five, then scrolls (max-height in CSS).
  useLayoutEffect(() => { const el = field.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }, [value]);
  const sending = useRef(false), request = useRef(crypto.randomUUID());
  const send = async () => { const text = value.trim(); if (!text || sending.current) return; sending.current = true; setBusy(true); setError(''); try { await onSubmit(text, request.current); request.current = crypto.randomUUID(); setValue(''); } catch (e) { setError(e.message || 'No se pudo guardar. Reintenta: el texto se conserva.'); } finally { sending.current = false; setBusy(false); } };
  return <form className="comment-composer" onSubmit={e => { e.preventDefault(); send(); }}>
    <div className="comment-field" onPointerDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); field.current?.focus(); } }}>
      <textarea ref={field} aria-label="Texto del comentario" autoFocus={autoFocus} readOnly={busy} rows={1} value={value} placeholder={placeholder} maxLength={4000} onChange={e => setValue(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape' && !busy) { e.preventDefault(); onCancel(); } }} />
      <button className="comment-send" type="submit" aria-label="Enviar" title="Enviar (Enter)" disabled={!value.trim() || busy}><ArrowUp size={14} strokeWidth={2.25} /></button>
    </div>
    <p className="comment-composer-hint" aria-hidden="true">Enter envía · Shift+Enter salto de línea</p>
    {error && <p className="review-error" role="alert">{error} · Reintenta enviar; el borrador se conserva.</p>}
  </form>;
}

// Pins live in world space and keep their screen size at any zoom. One thread
// is open at a time; a draft is a pin that has not been written yet.
export function CommentLayer({ comments, draft, open, active, geometryOf, nodeOf, api, workspaceId, pathOf, notify, onOpen, onDraft, seek }) {
  const layer = useRef(null);
  useLayoutEffect(() => {
    for (const thread of layer.current?.querySelectorAll('.comment-thread') || []) {
      thread.style.marginLeft = '0px'; thread.style.marginTop = '0px';
      const b = thread.getBoundingClientRect();
      thread.style.marginLeft = `${Math.min(0, window.innerWidth - 16 - b.right) + Math.max(0, 16 - b.left)}px`;
      thread.style.marginTop = `${Math.min(0, window.innerHeight - 16 - b.bottom) + Math.max(0, 80 - b.top)}px`;
    }
  });
  const call = (method, payload) => api(method, { workspaceId, ...payload }).then(result => {
    if (result?.mention === 'sent') notify('Enviado a Phantom: responderá en este hilo.');
    if (result?.mention === 'queued') notify('Phantom está ocupado: tu comentario quedó en su cola y responderá en este hilo.');
    if (result?.mention === 'failed') notify(`El comentario se guardó, pero no llegó a Phantom: ${result.mentionError}`, 'error');
    return result;
  }, error => notify(`No se pudo guardar el comentario: ${error.message}`, 'error'));
  const point = c => {
    if (!c.nodeId) return { left: c.x, top: c.y };
    const g = geometryOf(c.nodeId); if (!g) return null;
    if (c.review) {
      const panel = document.querySelector(`[data-node-id="${c.nodeId}"]`), el = panel?.querySelector('[data-review-media]');
      if (el) {
        const p = panel.getBoundingClientRect(), b = contentBox(el.getBoundingClientRect(), el.videoWidth || el.naturalWidth, el.videoHeight || el.naturalHeight);
        if (b && p.width && p.height) return { left: g.x + (b.x - p.x + c.review.region.x * b.width) / p.width * g.width, top: g.y + (b.y - p.y + c.review.region.y * b.height) / p.height * g.height };
      }
    }
    return { left: g.x + c.x * g.width, top: g.y + c.y * g.height };
  };
  const draftAt = draft && point(draft);
  return <div ref={layer} className="comment-layer">
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
          {c.review && <ReviewSummary review={c.review} />}
          {c.handoff && <div className="review-handoff" role="status"><span>{({ sending: 'Enviando a Phantom…', sent: 'Entregado a Phantom', queued: 'En la cola de Phantom', failed: 'No entregado a Phantom', uncertain: 'Acuse incierto: revisa el chat de Phantom' })[c.handoff.status]}</span>{c.handoff.error && <p>{c.handoff.error}</p>}{c.handoff.status === 'failed' && <button onClick={() => call('comment.retry', { id: c.id })}>Reintentar envío</button>}</div>}
          <Composer placeholder="Responder… (@phantom se lo pide al agente)" onSubmit={async (text, requestId) => { if (!await call('comment.reply', { id: c.id, text, requestId })) throw new Error('Respuesta sin guardar'); }} onCancel={() => onOpen(null)} />
        </section>}
      </div>;
    })}
    {draftAt && <div className="comment-anchor open" style={draftAt}>
      <span className="comment-pin draft"><MessageCircle size={12} /></span>
      <section className="comment-thread" role="dialog" aria-label="Nuevo comentario" onKeyDown={e => e.stopPropagation()}>
        <header><strong>{draft.review ? 'Revisar región' : 'Nuevo comentario'}</strong><button className="icon-button" aria-label="Cancelar comentario" onClick={() => onDraft(null)}><X size={14} /></button></header>
        {draft.review && <><ReviewSummary review={draft.review} /><ReviewFields draft={draft} onDraft={onDraft} /></>}
        {draft.time !== undefined && <header><strong>En el video</strong><span className="comment-time">{timecode(draft.time)}</span></header>}
        <Composer key={draft.requestId || 'canvas-draft'} autoFocus placeholder="Comenta… @phantom se lo pide al agente" onCancel={() => onDraft(null)} onSubmit={async text => {
          const { nodeId, x, y, time, spaceId, review, capture, requestId } = draft;
          if (review) validateReview(review);
          const made = await call('comment.add', { nodeId, x, y, text, ...(requestId ? { requestId } : {}), ...(review ? { review, ...(capture ? { capture } : {}) } : {}), ...(time !== undefined ? { time } : {}), ...(spaceId ? { spaceId } : {}) });
          if (!made) throw new Error('Comentario sin guardar');
          onDraft(null); onOpen(made.id);
        }} />
      </section>
    </div>}
  </div>;
}

function ReviewSummary({ review: r }) {
  return <div className="review-summary"><span>Versión SHA-256 <code title={r.hash}>{r.hash.slice(0, 12)}</code></span><span>{r.region.type === 'rect' ? 'Rectángulo' : 'Punto'} · contenido normalizado {Math.round(r.region.x * 100)}%, {Math.round(r.region.y * 100)}%{r.region.type === 'rect' ? ` · ${Math.round(r.region.width * 100)}% × ${Math.round(r.region.height * 100)}%` : ''}</span>{r.kind === 'video' && <span>{r.time.toFixed(3)} s · frame {r.frame} (base 0) · {r.fps} FPS declarados</span>}<span>Alcance: {r.scope === 'range' ? `tramo hasta ${r.end.toFixed(3)} s` : r.scope === 'instant' ? 'este instante' : 'todas las apariciones (intención)'}</span>{r.element && <span>Elemento: {r.element}</span>}{r.editableSource && <span>Fuente editable: {r.editableSource}</span>}{r.capture && <span>Captura PNG adjunta</span>}{r.captureLimit && <span>{r.captureLimit}</span>}</div>;
}

function ReviewFields({ draft, onDraft }) {
  const r = draft.review, update = patch => {
    const review = { ...r, ...patch };
    if (review.scope !== 'range') delete review.end;
    onDraft({ ...draft, review });
  };
  return <div className="review-fields">
    <details className="review-region-fields"><summary>Ajustar región con teclado</summary>
      <label>Tipo de marca<select aria-label="Tipo de marca" value={r.region.type} onChange={e => update({ region: e.target.value === 'rect' ? { ...r.region, type: 'rect', width: Math.min(.1, 1 - r.region.x), height: Math.min(.1, 1 - r.region.y) } : { type: 'point', x: r.region.x, y: r.region.y } })}><option value="point">Punto</option><option value="rect">Rectángulo</option></select></label>
      <div className="review-region-grid">{['x', 'y', ...(r.region.type === 'rect' ? ['width', 'height'] : [])].map(key => <label key={key}>{({ x: 'X', y: 'Y', width: 'Ancho', height: 'Alto' })[key]} (0–1)<input aria-label={`Región ${key}`} type="number" min="0" max="1" step="0.01" value={r.region[key]} onChange={e => update({ region: { ...r.region, [key]: Number(e.target.value) } })} /></label>)}</div>
    </details>
    {r.kind === 'video' && <><label>Alcance<select aria-label="Alcance de revisión" value={r.scope} onChange={e => update({ scope: e.target.value, ...(e.target.value === 'range' ? { end: r.end || r.time + 1 / r.fps } : {}) })}><option value="instant">Este instante</option><option value="range">Tramo desde este instante</option><option value="all">Todas las apariciones (intención)</option></select></label>{r.scope === 'range' && <label>Fin del tramo (segundos)<input aria-label="Fin del tramo" type="number" min={r.time} step="any" value={r.end ?? ''} onChange={e => update({ end: Number(e.target.value) })} /></label>}</>}
    <label>Elemento (opcional)<input aria-label="Elemento señalado" placeholder="Ej. ala izquierda del pixel art" maxLength={4096} value={r.element || ''} onChange={e => update({ element: e.target.value })} /></label>
    <label>Fuente editable (opcional)<input aria-label="Fuente editable" placeholder="Ruta o referencia al proyecto fuente" maxLength={4096} value={r.editableSource || ''} onChange={e => update({ editableSource: e.target.value })} /></label>
    <p>La región indica dónde mirar. Las apariciones y el elemento los describes tú. Escribe @phantom para enviarlo al agente.</p>
  </div>;
}
