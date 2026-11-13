import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Globe, Maximize2, MessageCircle, RotateCw, AlertCircle } from 'lucide-react';
import { subscribe } from '../hooks/useWorkspace';
import { createBrowserIntent, isSiteURL } from '../hooks/browserIntent';
import ResearchReader from './ResearchReader';

// Transient previews survive view/boundary remounts, never enter workspace JSON.
const previews = new Map();
function contentBounds(element) {
  if (!element) return null;
  const r = element.getBoundingClientRect(), x = Math.max(0, Math.ceil(r.x)), y = Math.max(0, Math.ceil(r.y));
  return { x, y, width: Math.max(1, Math.floor(Math.min(r.right, window.innerWidth) - x)), height: Math.max(1, Math.floor(Math.min(r.bottom, window.innerHeight) - y)) };
}
export default function BrowserPanel({ node, workspace, api, active, obscured: covered, commenting = false, commentCount = 0, onComment, onFocus, onChange }) {
  // While commenting, the native page (drawn above all DOM) steps aside for its
  // last capture so pins, the composer and the click itself stay reachable.
  const obscured = covered || (active && commenting);
  const content = useRef(null), intent = useRef(null), captureTimer = useRef(null);
  const latest = useRef({ node, onChange }); latest.current = { node, onChange };
  const [url, setUrl] = useState(isSiteURL(node.data?.url) ? node.data.url : '');
  const [info, setInfo] = useState({});
  const [error, setError] = useState('');
  const [capture, setCapture] = useState(previews.get(node.id) || null);
  const capturePage = useCallback(async () => {
    const controller = intent.current, ticket = controller?.captureTicket();
    if (!ticket) return;
    try {
      const result = await api('browser.capture', { id: node.id });
      if (intent.current !== controller || !controller.captureCurrent(ticket) || !/^data:image\//.test(result?.dataUrl || '')) return;
      const next = { dataUrl: result.dataUrl, url: ticket.url, title: ticket.title };
      previews.delete(node.id); previews.set(node.id, next);
      while (previews.size > 12) previews.delete(previews.keys().next().value);
      setCapture(next);
    } catch { /* Keep the last valid, settled-page capture on transient failure. */ }
  }, [api, node.id]);
  useEffect(() => {
    const controller = createBrowserIntent({ id: node.id, workspaceId: workspace.id, url: latest.current.node.data?.url,
      invoke: api, onState: setInfo, onAddress: setUrl, onError: setError,
      onCommit: address => {
        const { node: current, onChange: update } = latest.current;
        if (current.data?.url !== address) update(current.id, { data: { ...current.data, url: address } });
      },
    });
    intent.current = controller;
    const off = subscribe(event => {
      if (event.type !== 'browser.state' || event.id !== node.id) return;
      controller.state(event);
      clearTimeout(captureTimer.current);
      if (controller.captureTicket()) captureTimer.current = setTimeout(capturePage, 220);
    });
    return () => {
      off(); clearTimeout(captureTimer.current); controller.dispose();
      if (intent.current === controller) intent.current = null;
      api('browser.detach', { id: node.id }).catch(() => {});
    };
  }, [node.id, workspace.id, api, capturePage]);
  useEffect(() => {
    let disposed = false, observer, frame;
    const controller = intent.current;
    if (!controller) return;
    const bounds = () => contentBounds(content.current);
    const update = () => { if (!disposed && bounds()) controller.bounds(bounds()); };
    if (active && !obscured) {
      frame = requestAnimationFrame(() => {
        if (disposed || !bounds()) return;
        controller.show(bounds()).then(shown => {
          if (disposed || !shown) return;
          observer = new ResizeObserver(update); if (content.current) observer.observe(content.current);
          window.addEventListener('resize', update);
        }).catch(() => {});
      });
    } else {
      capturePage(); controller.hide();
    }
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', update);
      // Capture only a settled HTTP(S) page. Hiding never waits for Chromium.
      capturePage(); controller.hide();
    };
  }, [active, obscured, node.id, workspace.id, api, capturePage]);
  const navigate = event => {
    event?.preventDefault();
    let destination = url.trim(); if (!/^https?:\/\//i.test(destination)) destination = `https://${destination}`;
    try { const parsed = new URL(destination); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); destination = parsed.href; }
    catch { setError('Escribe una dirección HTTP o HTTPS válida.'); return; }
    intent.current?.navigate(destination).catch(() => {});
    if (active && error && contentBounds(content.current)) intent.current?.show(contentBounds(content.current)).catch(() => {});
    if (!active) onFocus(node.id);
  };
  const toggleReader = () => {
    onChange(node.id, { data: { ...node.data, reader: !node.data?.reader } });
    requestAnimationFrame(() => {
      if (active && !obscured) intent.current?.bounds(contentBounds(content.current));
    });
  };
  return <div className="browser-panel" data-browser-id={node.id} data-agent-key={node.data?.agentKey}>
    <form className="browser-toolbar" onSubmit={navigate}>
      <button type="button" title="Atrás" aria-label="Atrás" disabled={!active || !info.canGoBack || info.loading} onClick={() => intent.current?.action('browser.back')}><ArrowLeft size={15} /></button>
      <button type="button" title="Adelante" aria-label="Adelante" disabled={!active || !info.canGoForward || info.loading} onClick={() => intent.current?.action('browser.forward')}><ArrowRight size={15} /></button>
      <button type="button" title="Recargar" aria-label="Recargar" disabled={!active || info.loading} onClick={() => intent.current?.action('browser.reload')}><RotateCw size={14} className={info.loading ? 'spinning' : ''} /></button>
      <input aria-label="Dirección web" placeholder="https://…" value={url} onChange={e => { intent.current?.edit(); setUrl(e.target.value); }} spellCheck={false} />
      <button type="button" title="Abrir en navegador externo" aria-label="Abrir en navegador externo" disabled={!isSiteURL(url)} onClick={() => api('desktop.openExternal', { url }).catch(e => setError(e.message))}><ExternalLink size={14} /></button>
      {node.data?.reader
        ? <button type="button" title="Cerrar lector de research" aria-label="Cerrar lector de research" aria-pressed onClick={toggleReader}><BookOpen size={14} /></button>
        : <button type="button" title="Abrir lector de research" aria-label="Abrir lector de research" aria-pressed={false} onClick={toggleReader}><BookOpen size={14} /></button>}
      {onComment && active && <button type="button" className={`browser-comment ${commenting ? 'is-on' : ''}`} title={commenting ? 'Volver a la página en vivo · Esc' : 'Comentar sobre esta página'} aria-label={commenting ? 'Salir del modo comentario' : 'Comentar sobre esta página'} aria-pressed={commenting} onClick={onComment}><MessageCircle size={14} />{commentCount > 0 && <b className="comment-count">{commentCount}</b>}</button>}
    </form>
    {error && <div className="inline-error"><AlertCircle size={14} /><span>{error}</span><button onClick={navigate}>Reintentar</button></div>}
    <div className="browser-body">
      <div ref={content} className="browser-content">
        {active && commenting && !covered && !error && <div className="browser-freeze">{capture ? <img data-browser-page={capture.url} data-browser-title={capture.title || ''} src={capture.dataUrl} alt={`Página congelada para comentar: ${capture.url}`} draggable={false} /> : <div className="browser-preview-label"><Globe size={25} /><strong>Congelando la página…</strong><span>Comenta cuando aparezca la captura</span></div>}</div>}
        {(!active || covered || error) && <div className="browser-preview">{capture && <img src={capture.dataUrl} alt={`Última captura de ${capture.url}`} />}<div className="browser-preview-label"><Globe size={25} /><strong>{capture?.title || (isSiteURL(info.url) ? info.title || info.url : '') || url || 'Navegador del proyecto'}</strong><span>{capture ? `Última captura: ${capture.url}` : 'Sin captura de una página cargada'}</span><span>Enfocar para navegar</span><button className="button" onClick={() => onFocus(node.id)}><Maximize2 size={14} /> Enfocar navegador</button></div></div>}
      </div>
      {node.data?.reader && <ResearchReader node={node} nodes={workspace.nodes || []} spaceId={node.data?.spaceId ?? null} workspaceId={workspace.id} api={api} onChange={onChange} browserUrl={info.url || url} browserTitle={info.title} onNavigate={destination => { setUrl(destination); intent.current?.navigate(destination).catch(() => {}); if (!active) onFocus(node.id); }} />}
    </div>
  </div>;
}
