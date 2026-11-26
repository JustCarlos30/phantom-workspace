import React, { useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import Canvas from '../../src/components/Canvas.jsx';
import { ChangesCanvasContext } from '../../src/components/ChangesCanvasContext.jsx';
import '../../src/styles.css';
import '../../src/studio.css';
import '../../src/canvas-ui.css';
import '../../src/terminal.css';
import '../../src/plugins.css';
import '../../src/chat.css';
import '../../src/shell.css';
import '../../src/phantom-chat.css';
import '../../src/panels.css';
import '../../src/menus.css';

// Only the review consumer is substituted in probe builds; Canvas and ChatCard stay real.
export function ChangesProbe({ node, onComment }) {
  const context = useContext(ChangesCanvasContext), scroll = useRef(null), scrollTop = useRef(0);
  const [selection, setSelection] = useState('src/example.jsx');
  const active = context?.activeId === node.id, expanded = context?.expandedId === node.id;
  const host = expanded ? context?.expandedHost : context?.host;
  useLayoutEffect(() => {
    window.fixture.contexts.set(node.id, context);
    if (scroll.current) scroll.current.scrollTop = scrollTop.current;
  });
  useLayoutEffect(() => () => window.fixture.contexts.delete(node.id), [node.id]);
  return <span>
    <button type="button" aria-label={`Revisar ${node.id}`} onClick={() => context.open(node.id)}>Revisar cambios</button>
    {active && host && createPortal(<section role="dialog" aria-label={`Revisión ${node.id}`} tabIndex={-1} data-probe={node.id} style={expanded ? { position: 'absolute', inset: 0 } : { position: 'absolute', ...context.placement }} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); context.close(node.id); } }}>
      <button type="button" aria-label="Ampliar revisión" onClick={() => context.expand(node.id)}>Ampliar</button>
      <button type="button" aria-label="Restaurar revisión" onClick={() => context.restore(node.id)}>Restaurar</button>
      <button type="button" aria-label="Cerrar revisión" onClick={() => context.close(node.id)}>Cerrar</button>
      <input aria-label="Selección de prueba" value={selection} onChange={e => setSelection(e.target.value)} />
      <div ref={scroll} data-probe-scroll style={{ height: 240, overflow: 'auto' }} onScroll={e => { scrollTop.current = e.currentTarget.scrollTop; }}><pre>{Array.from({ length: 100 }, (_, i) => `Línea ${i + 1}`).join('\n')}</pre></div>
      {onComment && <button type="button" aria-label="Comentar selección de prueba" onClick={() => onComment({ path: selection, startLine: 4, endLine: 7, text: 'Revisar estas líneas\nSin enviar' })}>Comentar</button>}
    </section>, host)}
  </span>;
}

const listeners = new Set();
window.phantom = { onEvent: callback => { listeners.add(callback); return () => listeners.delete(callback); } };
const noop = () => {}, done = async () => {};
const chat = { provider: 'claude', running: false, messages: [{ id: 'message-a', role: 'user', parts: [{ type: 'text', text: 'Datos sintéticos para el fixture de revisión.' }] }], queue: [], meta: { model: 'claude-synthetic' } };
const makeNode = (id, index, terminal) => ({ id, title: `Sesión ${id}`, type: 'terminal', x: 40 + index * 800, y: 120, width: 640, height: 560, data: { ...(terminal ? {} : { chat: { provider: 'claude' } }), worktree: { path: `/synthetic/worktree-${id}`, branch: `review/${id}` } } });
let root;
window.mountChangesCanvas = ({ terminal = false } = {}) => {
  root?.unmount();
  try { localStorage.setItem('phantom.minimap', 'off'); } catch { /* Opaque offline origin. */ }
  window.fixture = { calls: [], contexts: new Map(), cameras: [], unknown: [], failDiff: false };
  const api = async (method, payload) => {
    window.fixture.calls.push({ method, payload });
    if (method === 'desktop.info') return { dataDir: '/synthetic/data' };
    if (method === 'chat.get') return chat;
    if (method === 'chat.models') return { items: [{ id: 'claude-synthetic' }] };
    if (method === 'state.get') return { settings: {} };
    if (method === 'phantom.controllers') return { items: [] };
    if (method === 'voice.stream.warm') return {};
    if (method === 'repo.changes') return { files: [{ path: 'src/example.jsx', name: 'example.jsx', status: 'M', added: 2, removed: 1, uncommitted: true }], base: 'main', truncated: false };
    if (method === 'repo.diff') {
      if (window.fixture.failDiff) throw new Error('Fallo sintético de diff');
      return { text: 'diff --git a/src/example.jsx b/src/example.jsx\n--- a/src/example.jsx\n+++ b/src/example.jsx\n@@ -1,2 +1,3 @@\n conservar\n-anterior\n+nuevo\n+revisable', truncated: false };
    }
    window.fixture.unknown.push(method);
    throw new Error(`Método sin fixture: ${method}`);
  };
  function Fixture() {
    const [workspace, setWorkspace] = useState({ id: 'workspace-a', path: '/synthetic/project-a', camera: { x: 80, y: 100, zoom: 1 }, nodes: [makeNode('a', 0, terminal), makeNode('b', 1, terminal)] });
    const [focused, setFocused] = useState(null), [selected, setSelected] = useState(['a']), [spaceId, setSpaceId] = useState(null);
    const onCamera = useCallback((camera, workspaceId, cameraSpaceId) => {
      window.fixture.cameras.push({ camera, workspaceId, spaceId: cameraSpaceId });
      setWorkspace(value => value.id === workspaceId ? { ...value, camera } : value);
    }, []);
    window.fixture.update = updater => setWorkspace(updater);
    window.fixture.focus = setFocused;
    window.fixture.space = setSpaceId;
    window.fixture.workspace = workspace;
    window.fixture.focused = focused;
    window.fixture.selected = selected;
    return <Canvas key={`${workspace.id}:${spaceId || 'main'}`} workspace={workspace} spaceId={spaceId} api={api} selected={selected} onSelect={setSelected} focused={focused} onFocus={setFocused} keyboardMode="interaction" onCamera={onCamera} onChange={(id, patch) => setWorkspace(value => ({ ...value, nodes: value.nodes.map(node => node.id === id ? { ...node, ...patch } : node) }))} onOpenPanel={noop} notify={noop} refresh={done} flush={done} registerBeforeFlush={() => noop} onMenu={noop} onCloseTerminal={noop} />;
  }
  root = createRoot(document.getElementById('fixture'));
  root.render(<Fixture />);
};
window.disposeChangesCanvas = () => { root?.unmount(); root = null; };
