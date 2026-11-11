import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AlertCircle, ArrowDown, Folder, Maximize2, Minus, Plus, RotateCcw, Square } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { subscribe } from '../hooks/useWorkspace';
import { createTerminalStream } from '../hooks/terminalStream';
import { writeOwnedTerminalInput } from '../hooks/inputOwnership';
import AgentIdentity, { AGENT_LABELS } from './AgentIdentity';

export default function TerminalPanel({ node, workspace, api, active, overview, overviewZoom = 1, inputBlocked = false, onRelaunch, onChange, notify, refresh, flush, onOpenPanel, onEnlarge, connected = true, focusRequested = false }) {
  const host = useRef(null), terminal = useRef(null), streamRef = useRef(null);
  const resizeRef = useRef(null);
  const cancelAnchorRef = useRef(null);
  const activeRef = useRef(active); activeRef.current = active;
  const wheelBlockedRef = useRef(false); wheelBlockedRef.current = inputBlocked || overview;
  const connectedRef = useRef(connected); connectedRef.current = connected;
  const [status, setStatus] = useState(node.data?.sessionId ? 'connecting' : 'lost');
  const [error, setError] = useState('');
  const [rows, setRows] = useState(24);
  const [readingHistory, setReadingHistory] = useState(false);
  const sessionId = node.data?.sessionId;
  const fontSize = Number.isFinite(node.data?.fontSize) ? Math.min(24, Math.max(12, node.data.fontSize)) : 16;
  const cwd = node.data?.cwd || node.data?.worktree?.path || workspace.canonicalPath || workspace.path;
  const directoryLabel = node.data?.worktree ? `Worktree · ${node.data.worktree.branch || 'HEAD separado'}` : node.data?.worktreeReason ? `Sin worktree · ${node.data.worktreeReason}` : '';
  useEffect(() => {
    if (!host.current) return;
    let disposed = false, fitting, stream, wheelEvent = null, anchor = null, anchorFrame;
    const cancelAnchor = () => { cancelAnimationFrame(anchorFrame); anchor?.dispose(); anchor = null; };
    cancelAnchorRef.current = cancelAnchor;
    setReadingHistory(false); setError(''); setStatus(sessionId ? 'connecting' : 'lost'); setRows(24);
    // Buffer inspection and reading anchors use xterm's public proposed APIs.
    const term = new Terminal({ fontFamily: '"JetBrains Mono", "Cascadia Code", "DejaVu Sans Mono", "Liberation Mono", monospace', fontSize, lineHeight: 1.4, cursorBlink: true, scrollback: 4000, allowProposedApi: true, theme: { background: '#151a23', foreground: '#e1e8f2', cursor: '#a7baff', selectionBackground: '#8b9dff55', black: '#292d35', red: '#f18d97', green: '#8bd3b3', yellow: '#e6c78b', blue: '#8faeff', magenta: '#c5a6ee', cyan: '#87cdd7', white: '#e1e8f2' } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current); terminal.current = term;
    const sizeChanged = term.onResize(({ rows }) => setRows(rows));
    const syncHistory = () => {
      if (!disposed) {
        const buffer = term.buffer.active;
        setReadingHistory(buffer.type === 'normal' && buffer.viewportY < buffer.baseY);
      }
    };
    const historySubscriptions = [term.onScroll(syncHistory), term.buffer.onBufferChange(() => { cancelAnchor(); syncHistory(); }), term.onWriteParsed(syncHistory)];
    term.attachCustomWheelEventHandler(event => {
      if (wheelBlockedRef.current) return false;
      cancelAnchor();
      // xterm emits application mouse reports (or alternate-buffer arrows)
      // synchronously during this event. Route only those to the hovered PTY;
      // keyboard input still requires selection and focus. Don't steal focus.
      wheelEvent = event;
      queueMicrotask(() => { if (wheelEvent === event) wheelEvent = null; });
      return true;
    });
    const resize = () => {
      clearTimeout(fitting); fitting = setTimeout(() => {
        if (disposed || !host.current?.clientWidth || !host.current?.clientHeight) return;
        // Layout pixels exclude the canvas transform; padding belongs to xterm.
        const buffer = term.buffer.active;
        const reading = buffer.type === 'normal' && buffer.viewportY < buffer.baseY;
        cancelAnchor();
        anchor = reading ? term.registerMarker(buffer.viewportY - buffer.baseY - buffer.cursorY) : null;
        try {
          fit.fit();
          // xterm synchronizes its pixel viewport on the next render frame.
          // Scrolling before that uses stale dimensions/scrollTop after a fit.
          if (anchor) anchorFrame = requestAnimationFrame(() => {
            anchorFrame = requestAnimationFrame(() => {
              if (!disposed && term.buffer.active.type === 'normal' && anchor && !anchor.isDisposed) {
                const line = Math.min(anchor.line, term.buffer.active.baseY);
                term.scrollToLine(line);
                // xterm 6 scrollToLine applies a delta to its pixel viewport.
                // Reconcile once if font/row changes left that cache out of step
                // with the buffer; both calls run before the next paint.
                if (term.buffer.active.viewportY !== line) term.scrollToLine(line);
              }
              cancelAnchor(); syncHistory();
            });
          });
          syncHistory();
          if (stream?.canWrite()) {
            const version = stream.version();
            api('terminal.resize', { sessionId, cols: term.cols, rows: term.rows }).catch(e => { if (!disposed && stream.version() === version) setError(e.message); });
          }
        } catch (e) { cancelAnchor(); if (!disposed) setError(`No se pudo ajustar la terminal: ${e.message}`); }
      }, 90);
    };
    resizeRef.current = resize;
    if (sessionId) {
      stream = createTerminalStream({ sessionId, invoke: api, subscribe, connected: connectedRef.current,
        snapshot: (text, current, session) => new Promise(resolve => {
          // Fence old queued xterm writes before reset. Invalidate stale attach
          // callbacks before they can replace the display after reconnection.
          term.write('', () => {
            if (disposed || !current()) { resolve(); return; }
            if (Number.isInteger(session?.cols) && Number.isInteger(session?.rows)) term.resize(session.cols, session.rows);
            term.reset(); term.write(text, resolve);
          });
        }),
        output: text => new Promise(resolve => term.write(text, resolve)),
        onStatus: value => { if (!disposed) setStatus(value); },
        onError: message => { if (!disposed) setError(message); }, onReady: resize,
      });
      streamRef.current = stream; stream.start();
    } else { setStatus('lost'); setError(''); resize(); }
    const observer = new ResizeObserver(resize); observer.observe(host.current);
    const data = term.onData(text => {
      cancelAnchor();
      const version = stream?.version();
      writeOwnedTerminalInput({ stream, active: activeRef.current, element: term.element, focusedElement: document.activeElement, sessionId, invoke: api, text, wheelOwned: !!wheelEvent, blocked: wheelBlockedRef.current })?.catch(e => { if (!disposed && stream.version() === version) stream.fail(e); });
    });
    return () => { disposed = true; cancelAnchor(); cancelAnchorRef.current = null; stream?.dispose(); streamRef.current = null; resizeRef.current = null; observer.disconnect(); clearTimeout(fitting); data.dispose(); sizeChanged.dispose(); historySubscriptions.forEach(subscription => subscription.dispose()); term.dispose(); terminal.current = null; };
  }, [sessionId, api]);
  useEffect(() => {
    if (!terminal.current) return;
    terminal.current.options.fontSize = fontSize;
    resizeRef.current?.();
  }, [fontSize]);
  useEffect(() => {
    if (overview || (!focusRequested && !active) || !activeRef.current || status !== 'running') return;
    const element = document.activeElement;
    if (element?.closest('.inspector-host,.project-name-editor,.title-button')) return;
    if (element?.closest('input,textarea,select,[contenteditable="true"]') && !element.closest('.xterm')) return;
    terminal.current?.focus();
    // Opening/closing a nonmodal surface must not take focus from its controls.
  }, [focusRequested, active, status, overview]);
  const statusLabel = status === 'running' ? 'En ejecución' : status === 'connecting' ? 'Conectando…' : status === 'disconnected' ? 'Sin conexión' : status === 'exited' ? 'Finalizada' : 'Sin sesión activa';
  const changeFontSize = value => onChange(node.id, { data: { ...node.data, fontSize: value } });
  const agent = node.data?.agent || {};
  const mission = workspace.missions?.find(item => item.id === node.groupId);
  const compactOverview = overviewZoom < .25;
  const declaredState = AGENT_LABELS[agent.status] || 'Sin estado declarado';
  const missionLabel = mission?.title || (node.groupId ? 'Misión no disponible' : 'Sin misión vinculada');
  const stepLabel = agent.step || 'Sin paso declarado';
  const summaryDescription = [
    `Misión: ${missionLabel}${node.groupId ? ` · ${node.groupId}` : ''}`,
    `Paso: ${stepLabel}`,
    `Card: ${agent.cardTitle || (agent.cardId ? 'Título no disponible' : 'Sin card vinculada')}${agent.cardId ? ` · ${agent.cardId}` : ''}`,
    agent.source === 'agent' ? 'Reportado por agente' : agent.source === 'manual' ? 'Declarado manualmente' : 'Sin origen declarado',
    `PTY: ${statusLabel} · ${sessionId || 'Sin sesión'}`,
    `OpenCode: ${agent.providerSessionId ? `Vínculo declarado · ${agent.providerSessionId}` : 'Sin sesión vinculada'}`,
    error,
  ].filter(Boolean).join('. ');
  return <div className={`terminal-panel ${overview ? 'is-overview' : ''}`} style={{ '--overview-scale': 1 / overviewZoom }}>
    <div className="terminal-toolbar" inert={overview ? true : undefined} aria-hidden={overview || undefined}>
      <div className="terminal-directory"><Folder size={16} aria-hidden="true" /><span title={cwd}>{cwd}</span></div>
      <div className="terminal-type-controls" role="group" aria-label="Tamaño del texto de la terminal">
        <button aria-label="Reducir texto de la terminal" title="Reducir texto" disabled={fontSize <= 12} onClick={() => changeFontSize(fontSize - 1)}><Minus size={14} /></button>
        <button className="terminal-type-reset" aria-label={`Tamaño del texto: ${fontSize} píxeles. Restablecer a 16`} title="Restablecer a 16 px" onClick={() => changeFontSize(16)}>{fontSize}<span> px</span></button>
        <button aria-label="Ampliar texto de la terminal" title="Ampliar texto" disabled={fontSize >= 24} onClick={() => changeFontSize(fontSize + 1)}><Plus size={14} /></button>
      </div>
    </div>
    <AgentIdentity node={node} workspace={workspace} api={api} refresh={refresh} flush={flush} onOpenPanel={onOpenPanel} overview={overview} />
    <div ref={host} className="terminal-host" inert={overview ? true : undefined} aria-hidden={overview || undefined} />
    {!overview && readingHistory && <button type="button" className="terminal-history-end" onClick={() => { cancelAnchorRef.current?.(); if (terminal.current?.buffer.active.type === 'normal') terminal.current.scrollToBottom(); }}><ArrowDown size={14} aria-hidden="true" />Ir al final</button>}
    <div className="terminal-session-bar" inert={overview ? true : undefined} aria-hidden={overview || undefined}><span className="terminal-session-status" role="status"><span className={`status-dot ${status}`} />{statusLabel}</span>{rows < 16 && !focusRequested && onEnlarge ? <button className="terminal-enlarge" title="Más espacio para ver el área de escritura de OpenCode" onClick={onEnlarge}><Maximize2 size={13} />Enfocar para escribir</button> : <span className="terminal-session-context" title={directoryLabel || 'Terminal local'}>{directoryLabel || 'Terminal local'}</span>}{status === 'running' && <button className="terminal-stop" title="Terminar proceso" aria-label="Terminar proceso" onClick={() => api('terminal.stop', { sessionId }).catch(e => notify(e.message, 'error'))}><Square size={12} /></button>}</div>
    {overview && <section className="terminal-overview" data-tier={compactOverview ? 'compact' : 'summary'} aria-label={`Resumen de ${node.title}`} aria-description={summaryDescription}>
      <strong title={node.title}>{node.title}</strong>
      <span className="terminal-overview-state" title={declaredState}>{declaredState}</span><dl>
      {!compactOverview && <><div className="terminal-overview-mission" title={missionLabel}><dt>Misión</dt><dd>{missionLabel}</dd></div>
      <div className="terminal-overview-step" title={stepLabel}><dt>Paso</dt><dd>{stepLabel}</dd></div></>}
      <div className="terminal-overview-pty" title={statusLabel}><dt>PTY</dt><dd>{statusLabel}</dd></div>
    </dl></section>}
    {!overview && (error || status === 'lost' || status === 'exited') && <div className="terminal-message"><AlertCircle size={15} /><span>{error || (status === 'exited' ? 'La sesión ha finalizado. El historial se conserva.' : 'Esta vista no tiene una sesión activa.')}</span>{sessionId && <button disabled={status === 'connecting' || status === 'disconnected'} onClick={() => streamRef.current?.retry()}><RotateCcw size={13} /> Reconectar</button>}{status !== 'disconnected' && status !== 'connecting' && <button onClick={() => onRelaunch(node)}>Nueva sesión</button>}</div>}
  </div>;
}
