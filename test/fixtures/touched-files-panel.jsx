import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TouchedFiles from '../../src/components/TouchedFiles.jsx';
import { ChangesCanvasContext } from '../../src/components/ChangesCanvasContext.jsx';
import '../../src/styles.css';
import '../../src/studio.css';
import '../../src/menus.css';

const files = [
  { path: 'README.md', status: 'M', added: 2, removed: 1, uncommitted: true },
  { path: 'src/app.js', status: 'M', added: 3, removed: 1, uncommitted: false },
  { path: 'src/util/math.js', status: 'A', added: 4, removed: 0, uncommitted: true },
];
const diffFor = path => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,5 +1,6 @@\n context line\n second context\n third context\n-old line of ${path}\n+new line of ${path}\n+extra line\n trailing context\n@@ -80,1 +81,1 @@\n-old ending\n+new ending\n`;
const calls = [];
const api = async (method, args) => {
  calls.push({ method, ...args });
  const fixture = window.fixture;
  if (fixture.failures[method]) throw new Error(fixture.failures[method]);
  if (fixture.defer[method]) return new Promise(resolve => fixture.pending.push({ method, args, resolve }));
  if (method === 'repo.changes') return { files: fixture.files, base: 'main', truncated: !!fixture.truncated };
  if (method === 'repo.diff') return { text: fixture.diffs[args.path] ?? diffFor(args.path), truncated: !!fixture.diffTruncated };
  if (method === 'repo.file.read') return fixture.readResult || { content: '# Documento sintético\n\n**Texto seguro**\n\n<img src=x onerror="window.injected=true">\n\n[No ejecutar](javascript:alert(1))\n' };
  throw new Error(`unexpected ${method}`);
};
window.fixture = { calls, files, failures: {}, defer: {}, pending: [], diffs: {}, events: [], references: [], sent: [], draft: 'Borrador existente', label: 'Datos sintéticos; no es evidencia de un repositorio real.' };

function PanelFixture({ options }) {
  const [host, setHost] = useState(null), [expandedHost, setExpandedHost] = useState(null);
  const [activeId, setActiveId] = useState(null), [expandedId, setExpandedId] = useState(null);
  const [placement, setPlacement] = useState({ left: 460, top: 40, width: 760, height: 600, ...options.placement });
  const [camera, setCamera] = useState({ x: 120, y: 80, zoom: .75 });
  const [enabled, setEnabled] = useState(true), [identity, setIdentity] = useState({ workspaceId: 'w1', tree: '/tmp/tree' });
  const [draft, setDraft] = useState(window.fixture.draft);
  const prior = useRef(null), expandedPrior = useRef(null);
  const open = useCallback(id => {
    window.fixture.events.push(['open', id]);
    if (!activeId) prior.current = camera;
    setActiveId(id); setExpandedId(null); setCamera({ x: 80, y: 50, zoom: .75 });
  }, [activeId, camera]);
  const close = useCallback(id => {
    window.fixture.events.push(['close', id]);
    if (id !== activeId) return;
    setActiveId(null); setExpandedId(null); if (prior.current) setCamera(prior.current);
  }, [activeId]);
  const expand = useCallback(id => {
    window.fixture.events.push(['expand', id]);
    if (id !== activeId || expandedId) return;
    expandedPrior.current = { camera, placement };
    setExpandedId(id); setCamera({ x: 0, y: 0, zoom: 1 });
  }, [activeId, expandedId, camera, placement]);
  const restore = useCallback(id => {
    window.fixture.events.push(['restore', id]);
    if (id !== expandedId) return;
    setExpandedId(null); setCamera(expandedPrior.current.camera); setPlacement(expandedPrior.current.placement);
  }, [expandedId]);
  const onComment = useCallback(reference => {
    if (window.fixture.commentError) throw new Error(window.fixture.commentError);
    window.fixture.references.push(reference);
    setDraft(old => {
      const next = `${old}\n\n${reference.path}:${reference.startLine}-${reference.endLine}\n${reference.text}`;
      window.fixture.draft = next;
      return next;
    });
  }, []);
  window.fixture.setPlacement = value => setPlacement(old => ({ ...old, ...value }));
  window.fixture.setCamera = setCamera;
  window.fixture.setEnabled = setEnabled;
  window.fixture.setIdentity = setIdentity;
  window.fixture.camera = camera;
  window.fixture.activeId = activeId;
  window.fixture.expandedId = expandedId;
  const card = (id, top = 40) => <div className="pt-card" data-session={id} style={{ position: 'absolute', left: 40, top, width: 400, height: options.two ? 180 : 600, padding: 12, pointerEvents: 'auto' }}>
    <TouchedFiles node={{ id, title: id === 'n1' ? 'Revisión sintética' : 'Otra sesión', x: 40, y: top, data: { worktree: { path: identity.tree, branch: 'feature/review' } } }} workspace={{ id: identity.workspaceId }} api={api} enabled={enabled} onComment={options.comment ? onComment : undefined} />
  </div>;
  const cards = <>{card('n1')}{options.two && card('n2', 240)}</>;
  return <>
    <style>{`body { margin: 0; background: var(--bg); } .fixture-label { position: absolute; bottom: 4px; left: 12px; color: var(--muted); font: var(--t-support); pointer-events: none; } .fixture-stage { position: absolute; inset: 0; overflow: hidden; } .fixture-world { position: absolute; width: 2400px; height: 1600px; transform-origin: 0 0; } .fixture-host, .fixture-expanded-host { position: absolute; inset: 0; pointer-events: none; } .fixture-draft { position: absolute; left: 16px; bottom: 32px; width: 360px; height: 48px; color: var(--ink); background: var(--surface); border: 0; }`}</style>
    {options.canvas ? <ChangesCanvasContext.Provider value={{ host, expandedHost, activeId, expandedId, placement, open, close, expand, restore }}>
      <div className="fixture-stage canvas-stage"><div className="fixture-world canvas-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>{cards}<div ref={setHost} className="fixture-host" /></div><div ref={setExpandedHost} className="fixture-expanded-host" /></div>
    </ChangesCanvasContext.Provider> : cards}
    {options.comment && <textarea className="fixture-draft" aria-label="Borrador de la sesión" value={draft} readOnly />}
    <span className="fixture-label">{window.fixture.label}</span>
  </>;
}

let root;
window.mountPanel = (options = {}) => {
  if (options.many) window.fixture.files = [...files.slice(0, 2), ...Array.from({ length: 30 }, (_, i) => ({ path: `src/item-${String(i).padStart(2, '0')}.js`, status: 'M', added: 1, removed: 1, uncommitted: true })), files[2]];
  if (options.longDiff) window.fixture.diffs['src/app.js'] = `@@ -1,120 +1,120 @@\n${Array.from({ length: 120 }, (_, i) => `-${i} old\n+${i} new`).join('\n')}\n`;
  root = createRoot(document.getElementById('fixture'));
  root.render(<PanelFixture options={options} />);
};
window.disposePanel = () => root?.unmount();
