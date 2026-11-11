import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AlertCircle, RotateCcw, Square } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { subscribe } from '../hooks/useWorkspace';
import { createTerminalStream } from '../hooks/terminalStream';
import { writeOwnedTerminalInput } from '../hooks/inputOwnership';

export default function TerminalPanel({ node, workspace, api, active, overview, onRelaunch, notify, connected = true, focusRequested = false }) {
  const host = useRef(null), terminal = useRef(null), streamRef = useRef(null);
  const activeRef = useRef(active); activeRef.current = active;
  const connectedRef = useRef(connected); connectedRef.current = connected;
  const [status, setStatus] = useState(node.data?.sessionId ? 'connecting' : 'lost');
  const [error, setError] = useState('');
  const sessionId = node.data?.sessionId;
  const cwd = node.data?.cwd || node.data?.worktree?.path || workspace.canonicalPath || workspace.path;
  const directoryLabel = node.data?.worktree ? `Worktree · ${node.data.worktree.branch || 'HEAD separado'}` : node.data?.worktreeReason ? `Sin worktree · ${node.data.worktreeReason}` : '';
  useEffect(() => {
    if (!host.current) return;
    let disposed = false, fitting, stream;
    const term = new Terminal({ fontFamily: '"DejaVu Sans Mono", "Liberation Mono", monospace', fontSize: 13, lineHeight: 1.24, cursorBlink: true, scrollback: 4000, allowProposedApi: false, theme: { background: '#151a23', foreground: '#e1e8f2', cursor: '#a7baff', selectionBackground: '#8b9dff55', black: '#292d35', red: '#f18d97', green: '#8bd3b3', yellow: '#e6c78b', blue: '#8faeff', magenta: '#c5a6ee', cyan: '#87cdd7', white: '#e1e8f2' } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current); terminal.current = term;
    const resize = () => {
      clearTimeout(fitting); fitting = setTimeout(() => {
        if (disposed || !host.current?.clientWidth || !host.current?.clientHeight) return;
        // Layout pixels exclude the canvas transform; padding belongs to xterm.
        try {
          fit.fit();
          if (stream?.canWrite()) {
            const version = stream.version();
            api('terminal.resize', { sessionId, cols: term.cols, rows: term.rows }).catch(e => { if (!disposed && stream.version() === version) setError(e.message); });
          }
        } catch (e) { if (!disposed) setError(`No se pudo ajustar la terminal: ${e.message}`); }
      }, 90);
    };
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
      const version = stream?.version();
      writeOwnedTerminalInput({ stream, active: activeRef.current, element: term.element, focusedElement: document.activeElement, sessionId, invoke: api, text })?.catch(e => { if (!disposed && stream.version() === version) stream.fail(e); });
    });
    return () => { disposed = true; stream?.dispose(); streamRef.current = null; observer.disconnect(); clearTimeout(fitting); data.dispose(); term.dispose(); terminal.current = null; };
  }, [sessionId, api]);
  useEffect(() => {
    if (!focusRequested || !activeRef.current || status !== 'running') return;
    const element = document.activeElement;
    if (element?.closest('.inspector-host,.project-name-editor,.title-button')) return;
    if (element?.closest('input,textarea,select,[contenteditable="true"]') && !element.closest('.xterm')) return;
    terminal.current?.focus();
    // Opening/closing a nonmodal surface must not take focus from its controls.
  }, [focusRequested, status]);
  return <div className={`terminal-panel ${overview ? 'is-overview' : ''}`}>
    <div className="terminal-location"><span className={`status-dot ${status}`} /><span title={`${cwd}${directoryLabel ? `\n${directoryLabel}` : ''}`}>{directoryLabel ? `${directoryLabel} · ` : ''}{cwd}</span><span>{status === 'running' ? 'En ejecución' : status === 'connecting' ? 'Conectando…' : status === 'disconnected' ? 'Sin conexión' : status === 'exited' ? 'Finalizada' : 'Sin sesión activa'}</span>{status === 'running' && <button className="terminal-stop" title="Terminar proceso" aria-label="Terminar proceso" onClick={() => api('terminal.stop', { sessionId }).catch(e => notify(e.message, 'error'))}><Square size={12} /></button>}</div>
    <div ref={host} className="terminal-host" />
    {overview && <div className="terminal-overview" aria-hidden="true"><span>Terminal</span><span>{status === 'running' ? 'Sesión en ejecución' : 'Historial de sesión'}</span></div>}
    {(error || status === 'lost' || status === 'exited') && <div className="terminal-message"><AlertCircle size={15} /><span>{error || (status === 'exited' ? 'La sesión ha finalizado. El historial se conserva.' : 'Esta vista no tiene una sesión activa.')}</span>{sessionId && <button disabled={status === 'connecting' || status === 'disconnected'} onClick={() => streamRef.current?.retry()}><RotateCcw size={13} /> Reconectar</button>}{status !== 'disconnected' && status !== 'connecting' && <button onClick={() => onRelaunch(node)}>Nueva sesión</button>}</div>}
  </div>;
}
