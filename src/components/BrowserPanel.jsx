import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Maximize2, RotateCw, AlertCircle } from 'lucide-react';
import { subscribe } from '../hooks/useWorkspace';
import { createBrowserIntent, isSiteURL } from '../hooks/browserIntent';

// Transient previews survive view/boundary remounts, never enter workspace JSON.
const previews = new Map();
function contentBounds(element) {
  if (!element) return null;
  const r = element.getBoundingClientRect(), x = Math.max(0, Math.ceil(r.x)), y = Math.max(0, Math.ceil(r.y));
  return { x, y, width: Math.max(1, Math.floor(Math.min(r.right, window.innerWidth) - x)), height: Math.max(1, Math.floor(Math.min(r.bottom, window.innerHeight) - y)) };
}
export default function BrowserPanel({ node, workspace, api, active, obscured, onFocus, onChange }) {
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
  return <div className="browser-panel" data-browser-id={node.id} data-agent-preview={node.data?.agentBrowser ? 'true' : undefined}>
    <form className="browser-toolbar" onSubmit={navigate}>
      <button type="button" title="Atrás" aria-label="Atrás" disabled={!active || !info.canGoBack || info.loading} onClick={() => intent.current?.action('browser.back')}><ArrowLeft size={15} /></button>
      <button type="button" title="Adelante" aria-label="Adelante" disabled={!active || !info.canGoForward || info.loading} onClick={() => intent.current?.action('browser.forward')}><ArrowRight size={15} /></button>
      <button type="button" title="Recargar" aria-label="Recargar" disabled={!active || info.loading} onClick={() => intent.current?.action('browser.reload')}><RotateCw size={14} className={info.loading ? 'spinning' : ''} /></button>
      <input aria-label="Dirección web" placeholder="https://…" value={url} onChange={e => { intent.current?.edit(); setUrl(e.target.value); }} spellCheck={false} />
      <button type="button" title="Abrir en navegador externo" aria-label="Abrir en navegador externo" disabled={!isSiteURL(url)} onClick={() => api('desktop.openExternal', { url }).catch(e => setError(e.message))}><ExternalLink size={14} /></button>
    </form>
    {error && <div className="inline-error"><AlertCircle size={14} /><span>{error}</span><button onClick={navigate}>Reintentar</button></div>}
    <div ref={content} className="browser-content">
      {(!active || obscured || error) && <div className="browser-preview">{capture && <img src={capture.dataUrl} alt={`Última captura de ${capture.url}`} />}<div className="browser-preview-label"><Globe size={25} /><strong>{capture?.title || (isSiteURL(info.url) ? info.title || info.url : '') || url || 'Navegador del proyecto'}</strong><span>{capture ? `Última captura: ${capture.url}` : 'Sin captura de una página cargada'}</span><span>Enfocar para navegar</span><button className="button" onClick={() => onFocus(node.id)}><Maximize2 size={14} /> Enfocar navegador</button></div></div>}
    </div>
  </div>;
}
