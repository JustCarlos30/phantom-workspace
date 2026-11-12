import React, { useEffect, useRef, useState } from 'react';
import { Film } from 'lucide-react';
import EmptyState from './EmptyState.jsx';
import { clampFrame, clampRange, createReviewId, elementsForRange, frameToTime, normalizeRegion, timeToFrame, videoRect, validRegion } from '../hooks/video-review-model.mjs';
import '../video-review.css';

export default function VideoReview({ workspace, api }) {
  return <Review key={workspace.id} workspace={workspace} api={api} />;
}
function Review({ workspace, api }) {
  const [catalog, setCatalog] = useState(null), [slug, setSlug] = useState(''), [render, setRender] = useState('');
  const [pkg, setPkg] = useState(null), [comments, setComments] = useState([]), [error, setError] = useState(''), [listError, setListError] = useState('');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false), [mode, setMode] = useState('frame');
  const [start, setStart] = useState(0), [end, setEnd] = useState(0), [region, setRegion] = useState(null), [element, setElement] = useState(''), [text, setText] = useState('');
  const [selected, setSelected] = useState(null), [drawing, setDrawing] = useState(false), [rect, setRect] = useState(null), [notice, setNotice] = useState('');
  const video = useRef(null), stage = useRef(null), drag = useRef(null), generation = useRef(0), mutation = useRef(false);
  const request = async (method, extra = {}) => {
    const value = await api(method, { workspaceId: workspace.id, ...extra });
    if (method !== 'review.projects' && value?.available === false) throw new Error(value.reason);
    return value;
  };
  useEffect(() => {
    let live = true;
    setCatalog(null); setError('');
    request('review.projects').then(value => { if (live) { setCatalog(value); setSlug(current => value.items?.some(item => item.slug === current) ? current : value.items?.[0]?.slug || ''); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [workspace.id, api, reload]);
  useEffect(() => {
    const current = ++generation.current;
    setPkg(null); setComments([]); setRegion(null); setSelected(null); setFrame(0); setPlaying(false); setElement(''); setText(''); setNotice(''); setListError(''); setError('');
    if (!slug || !render) { setLoading(false); return; }
    setLoading(true);
    const exported = request('review.export', { slug, input: { render } }).then(value => {
      if (generation.current !== current) return;
      if (value.available === false) throw new Error(value.reason);
      if (value.origin?.kind !== 'render' || !value.mediaURL) throw new Error('Se necesita un render verificado. No hay preview del árbol actual.');
      setPkg(value);
    }).catch(e => { if (generation.current === current) setError(`${e.message} Si falta la asociación del render, hay que renderizar de nuevo.`); }).finally(() => { if (generation.current === current) setLoading(false); });
    exported.then(() => generation.current === current ? request('review.list', { slug }) : null).then(value => {
      if (generation.current !== current) return;
      if (!Array.isArray(value.comments)) throw new Error(value.reason || 'Listado de comentarios inválido.');
      setComments(value.comments);
    }).catch(e => { if (generation.current === current) setListError(e.message); });
    return () => { generation.current++; };
  }, [slug, render, api, workspace.id, reload]);
  useEffect(() => {
    if (!pkg || !stage.current) return;
    const measure = () => { const box = stage.current; if (box?.clientWidth && box.clientHeight) setRect(videoRect({ width: box.clientWidth, height: box.clientHeight }, pkg.video.width, pkg.video.height)); };
    const observer = new ResizeObserver(measure); observer.observe(stage.current); measure();
    return () => observer.disconnect();
  }, [pkg]);
  useEffect(() => {
    const media = video.current;
    if (!media || !pkg || !playing) return;
    let id, live = true;
    const tick = (_now, metadata) => {
      if (!live) return;
      setFrame(timeToFrame(metadata?.mediaTime ?? media.currentTime, pkg.video.fps, pkg.video.durationInFrames));
      id = media.requestVideoFrameCallback ? media.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    id = media.requestVideoFrameCallback ? media.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    return () => { live = false; if (media.cancelVideoFrameCallback) media.cancelVideoFrameCallback(id); else cancelAnimationFrame(id); };
  }, [pkg, playing]);
  const total = pkg?.video.durationInFrames || 1;
  const range = mode === 'range' ? clampRange(start, end, total) : { start: frame, end: frame };
  const elements = elementsForRange(pkg?.elements || [], range);
  const seek = value => {
    if (!video.current || !pkg) return;
    const target = clampFrame(value, total);
    video.current.pause(); video.current.currentTime = frameToTime(target, pkg.video.fps); setFrame(target); setSelected(null);
  };
  const jump = comment => { seek(comment.frame ?? comment.range.start); setRegion(comment.region || null); setSelected(comment); setDrawing(false); };
  const operate = async action => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(''); setNotice('');
    const current = generation.current;
    try {
      await action();
      if (current !== generation.current) return;
      setNotice('Cambio guardado en el taller.');
      try { const value = await request('review.list', { slug }); if (current === generation.current) { if (!Array.isArray(value.comments)) throw new Error(value.reason || 'Listado inválido.'); setComments(value.comments); setListError(''); } }
      catch (e) { if (current === generation.current) setListError(e.message); }
    } catch (e) { if (current === generation.current) setError(e.message); }
    finally { mutation.current = false; setBusy(false); }
  };
  const send = event => {
    event.preventDefault();
    if (!pkg || !text.trim()) return;
    const input = { id: createReviewId(), revision: pkg.revision, text: text.trim(), ...(mode === 'range' ? { range } : { frame }), ...(validRegion(region) ? { region } : {}), ...(elements.some(item => item.id === element) ? { elementId: element } : {}) };
    const current = generation.current;
    operate(async () => { await request('review.add', { slug, input }); if (current === generation.current) { setText(''); setRegion(null); setSelected(null); } });
  };
  const point = event => { const el = stage.current, box = el.getBoundingClientRect(); return { x: (event.clientX - box.left) * el.clientWidth / box.width, y: (event.clientY - box.top) * el.clientHeight / box.height }; };
  const overlay = validRegion(region) && rect ? { left: rect.left + region.x * rect.width, top: rect.top + region.y * rect.height, width: region.width * rect.width, height: region.height * rect.height } : null;
  const projects = catalog?.items || [], renders = projects.find(item => item.slug === slug)?.renders || [];
  return <div className="vr" onKeyDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
    <div className="vr-row"><strong><Film size={16} aria-hidden="true" /> Revisión de video</strong><button type="button" disabled={busy || loading} onClick={() => setReload(n => n + 1)}>Actualizar</button></div>
    {error && <p className="vr-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!catalog && !error && <p role="status">Buscando taller…</p>}
    {catalog?.available === false && <EmptyState icon={Film} title="No hay un taller de videos" description={catalog.reason} />}
    {catalog?.available && !projects.length && <EmptyState icon={Film} title="Sin proyectos" description="Este taller no tiene proyectos válidos bajo projects/." />}
    {!!projects.length && <div className="vr-row"><label>Proyecto<select value={slug} disabled={busy} onChange={e => { setRender(''); setSlug(e.target.value); }}>{projects.map(item => <option key={item.slug}>{item.slug}</option>)}</select></label><label>Render<select value={render} disabled={busy} onChange={e => setRender(e.target.value)}><option value="">Elegir render…</option>{renders.map(item => <option key={item.name} value={item.name}>{item.name}{item.reason ? ' · No disponible' : ''}</option>)}</select></label></div>}
    {!!projects.length && !renders.length && <EmptyState icon={Film} title="Se necesita un render" description="Renderiza de nuevo en el taller para crear un MP4 con su sidecar y snapshot de revisión. No hay preview del árbol actual." />}
    {renders.find(item => item.name === render)?.reason && <p className="vr-error">{renders.find(item => item.name === render).reason}</p>}
    {loading && <p role="status">Exportando revisión y verificando el MP4…</p>}
    {pkg && <>
      <div className="vr-stage" ref={stage} tabIndex={0} role="group" aria-label="Visor de video. Flechas izquierda y derecha: un frame." onKeyDown={e => { if (e.target === e.currentTarget && !e.altKey && !e.ctrlKey && !e.metaKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); seek(frame + (e.key === 'ArrowLeft' ? -1 : 1)); } }}
        onPointerDown={e => { e.currentTarget.focus(); if (!drawing || !rect || e.button !== 0) return; const p = point(e); if (p.x < rect.left || p.y < rect.top || p.x > rect.left + rect.width || p.y > rect.top + rect.height) return; video.current.pause(); setSelected(null); drag.current = p; e.currentTarget.setPointerCapture(e.pointerId); setRegion(null); }}
        onPointerMove={e => { if (drag.current) setRegion(normalizeRegion(drag.current, point(e), rect)); }}
        onPointerUp={e => { if (drag.current) { setRegion(normalizeRegion(drag.current, point(e), rect)); drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); } }} onPointerCancel={() => { drag.current = null; }}>
        <video key={pkg.mediaURL} ref={video} src={pkg.mediaURL} preload="metadata" playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onSeeked={e => setFrame(timeToFrame(e.currentTarget.currentTime, pkg.video.fps, total))} onError={() => setError('No se pudo reproducir el MP4 verificado. Actualiza la revisión; si cambió el archivo, renderiza de nuevo.')} />
        {overlay && <div className="vr-region" style={overlay} />}
      </div>
      <div className="vr-row"><button type="button" onClick={() => { if (playing) video.current.pause(); else video.current.play().catch(e => setError(e.message)); }}>{playing ? 'Pausar' : 'Reproducir'}</button><button type="button" onClick={() => seek(frame - 1)}>−1 frame</button><button type="button" onClick={() => seek(frame + 1)}>+1 frame</button><output>Frame {frame} / {total - 1} · {total} cuadros · {pkg.video.fps} fps</output><label>Ir a frame<input type="number" min="0" max={total - 1} value={frame} onChange={e => { if (e.target.value !== '') seek(Number(e.target.value)); }} /></label></div>
      <input aria-label="Línea de tiempo por frames" type="range" min="0" max={total - 1} value={frame} onChange={e => seek(Number(e.target.value))} />
      <div className="vr-markers" aria-label="Marcadores de comentarios">{comments.filter(c => c.revision === pkg.revision).map(c => <button key={c.id} type="button" style={{ left: `${(c.frame ?? c.range.start) / Math.max(1, total - 1) * 100}%` }} title={c.text} aria-label={`Comentario en frame ${c.frame ?? c.range.start}: ${c.text}`} onClick={() => jump(c)} />)}</div>
      <p className="vr-muted">Frames base cero · extremos inclusivos · revisión <code title={pkg.revision}>{pkg.revision.slice(0, 12)}</code>. Arrastra con «Marcar zona» para localizar un detalle.</p>
      {selected && <p role="status">Comentario {selected.id}{selected.revision !== pkg.revision ? ' · Pertenece a otra revisión; su región se muestra solo como referencia.' : ''}</p>}
      <form onSubmit={send}>
        <div className="vr-row"><label>Ubicación<select value={mode} onChange={e => { setMode(e.target.value); setStart(frame); setEnd(frame); }}><option value="frame">Frame actual</option><option value="range">Rango inclusivo</option></select></label>{mode === 'range' && <><label>Entrada<input type="number" min="0" max={total - 1} value={start} onChange={e => setStart(clampFrame(e.target.value, total))} /></label><button type="button" onClick={() => setStart(frame)}>Entrada aquí</button><label>Salida<input type="number" min="0" max={total - 1} value={end} onChange={e => setEnd(clampFrame(e.target.value, total))} /></label><button type="button" onClick={() => setEnd(frame)}>Salida aquí</button><span>{range.start}–{range.end}</span></>}</div>
        <div className="vr-row"><button type="button" aria-pressed={drawing} onClick={() => setDrawing(value => !value)}>Marcar zona</button><button type="button" disabled={!region} onClick={() => { setRegion(null); setSelected(null); }}>Quitar zona</button><label>Elemento (opcional)<select value={elements.some(item => item.id === element) ? element : ''} onChange={e => setElement(e.target.value)}><option value="">Sin elemento</option>{elements.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label></div>
        <label>Comentario<textarea value={text} required onChange={e => setText(e.target.value)} placeholder="¿Qué hay que cambiar en este frame o zona?" /></label>
        <button type="submit" className="vr-primary" disabled={busy || !text.trim()}>Guardar comentario</button>
      </form>
    </>}
    {!!render && <section aria-label="Comentarios del taller"><h3>Comentarios</h3>{listError && <p className="vr-error" role="alert">No se pudo leer la lista: {listError}</p>}{!listError && !comments.length && <p className="vr-muted">Sin comentarios en la última lectura.</p>}{comments.map(c => <article className="vr-comment" key={c.id}><div className="vr-row"><button type="button" disabled={!pkg} onClick={() => jump(c)}>Frame {c.frame ?? `${c.range.start}–${c.range.end}`}</button>{c.stale && <span className="vr-badge">Obsoleto</span>}{c.resolved && <span className="vr-badge">Resuelto</span>}{c.elementId && <span className="vr-badge">{c.elementId}</span>}</div><p>{c.text}</p><small>{c.id} · {c.revision.slice(0, 12)}</small>{!c.resolved && <button type="button" disabled={busy} onClick={() => operate(() => request('review.resolve', { slug, input: { id: c.id, revision: c.revision } }))}>Resolver</button>}</article>)}</section>}
  </div>;
}
