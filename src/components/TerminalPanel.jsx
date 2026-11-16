import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { AlertCircle, ArrowDown, Folder, GitBranch, Mic, Minus, Plus, RotateCcw, Square } from 'lucide-react';
import { useVoiceWorkspace } from './VoiceProvider';
import '@xterm/xterm/css/xterm.css';
import { subscribe } from '../hooks/useWorkspace';
import { createTerminalStream } from '../hooks/terminalStream';
import { writeOwnedTerminalInput } from '../hooks/inputOwnership';
import AgentIdentity from './AgentIdentity';
import { AgentState, ProviderBadge, effectiveStatus, locationOf, providerOf, sessionLabel } from './TerminalCard';
import { useTerminalTail } from '../hooks/useTerminalTail';
import { formatSince, useNow } from '../hooks/terminalPulse.mjs';
import { ModeSwitch } from './ChatCard';

// Phantom engine theme: the well matches the card plane and the caret and
// selection follow the project accent, so the terminal reads as one surface.
function phantomTheme() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const accent = token('--accent', '#a78bda');
  const background = token('--terminal-bg', '#0e0b13');
  // ANSI 16 follow the desktop terminal palette so a shell reads the same here as in kitty.
  return { background, foreground: token('--terminal-ink', '#ddd5e9'), cursor: accent, cursorAccent: background, selectionBackground: `${accent}4d`,
    black: '#232040', red: '#ff86b7', green: '#7aeec4', yellow: '#f5cf8a', blue: '#7da8ff', magenta: '#c39bff', cyan: '#6fe3f2', white: '#a9a6cf',
    brightBlack: '#5d5888', brightRed: '#ffa3c8', brightGreen: '#9df4d4', brightYellow: '#f8dca8', brightBlue: '#a0c0ff', brightMagenta: '#d6b8ff', brightCyan: '#98ecf6', brightWhite: '#e4e2f7' };
}

// The DOM renderer re-lays out thousands of spans per write and re-rasters them
// under the canvas scale. WebGL is far cheaper, but browsers cap live contexts
// (~16 per page), so only readable terminals hold one, up to a budget.
const WEBGL_BUDGET = 8;
let webglContexts = 0;
const webglSupported = typeof WebGL2RenderingContext !== 'undefined';
// DOM stays the default: it is crisp at any zoom and its rows are what the
// desktop suites assert on. Opt in with localStorage 'phantom.terminalRenderer' = 'webgl'.
const webglPreferred = () => { try { return localStorage.getItem('phantom.terminalRenderer') === 'webgl'; } catch { return false; } };

export default function TerminalPanel({ node, workspace, api, active, overview = false, magnified = false, inputBlocked = false, onRelaunch, onChange, notify, refresh, flush, onOpenPanel, onEnlarge, connected = true, focusRequested = false }) {
  const host = useRef(null), terminal = useRef(null), streamRef = useRef(null);
  const resizeRef = useRef(null);
  const cancelAnchorRef = useRef(null);
  const activeRef = useRef(active); activeRef.current = active;
  const wheelBlockedRef = useRef(false); wheelBlockedRef.current = inputBlocked || overview;
  const connectedRef = useRef(connected); connectedRef.current = connected;
  const [status, setStatus] = useState(node.data?.sessionId ? 'connecting' : 'lost');
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(null);
  const [readingHistory, setReadingHistory] = useState(false);
  const sessionId = node.data?.sessionId;
  const { openDictation, registerTerminal } = useVoiceWorkspace();
  const destination = useRef(null);
  useEffect(() => {
    const element = host.current;
    let mounted = true;
    const valid = () => mounted && element?.isConnected && !element.closest('[inert]') && connectedRef.current && !!streamRef.current?.canWrite();
    const target = { kind: 'terminal', label: `${node.title || 'Terminal'} · ${sessionId || 'Sin sesión'}`, sessionId,
      valid, insert: async text => {
        if (!valid()) throw new Error('La sesión de destino no admite escritura. Reconecta esa terminal y vuelve a dictar.');
        await api('terminal.write', { sessionId, data: text });
      } };
    destination.current = target;
    const unregister = registerTerminal(element, target);
    return () => { mounted = false; unregister(); destination.current = null; };
  }, [sessionId, workspace.id, node.title, api, registerTerminal]);
  const fontSize = Number.isFinite(node.data?.fontSize) ? Math.min(24, Math.max(12, node.data.fontSize)) : 16;
  const cwd = node.data?.cwd || node.data?.worktree?.path || workspace.canonicalPath || workspace.path;
  const directoryLabel = node.data?.worktree ? `Copia propia de esta sesión · ${node.data.worktree.branch || 'sin rama'}` : node.data?.worktreeReason ? `Trabaja en la carpeta del proyecto · ${node.data.worktreeReason}` : '';
  useEffect(() => {
    if (!host.current) return;
    let disposed = false, fitting, stream, wheelEvent = null, anchor = null, anchorFrame;
    setSetup(null);
    const acceptSetup = incoming => { if (incoming && !disposed) setSetup(previous => !previous || incoming.updatedAt >= previous.updatedAt ? incoming : previous); };
    const offSetup = subscribe(event => { if (event.type === 'terminal.setup' && event.sessionId === sessionId) acceptSetup(event.setup); });
    const cancelAnchor = () => { cancelAnimationFrame(anchorFrame); anchor?.dispose(); anchor = null; };
    cancelAnchorRef.current = cancelAnchor;
    setReadingHistory(false); setError(''); setStatus(sessionId ? 'connecting' : 'lost');
    // Buffer inspection and reading anchors use xterm's public proposed APIs.
    const term = new Terminal({ fontFamily: '"Monaspace Neon", "GeistMono Nerd Font", "JetBrains Mono", "Cascadia Code", "DejaVu Sans Mono", "Liberation Mono", monospace', fontSize, lineHeight: 1.4, cursorBlink: true, scrollback: 4000, allowProposedApi: true, theme: phantomTheme() });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current); terminal.current = term;
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
      const reportsWheel = ['vt200', 'drag', 'any'].includes(term.modes.mouseTrackingMode);
      if (term.buffer.active.type === 'alternate' && !reportsWheel) return false;
      wheelEvent = reportsWheel ? event : null;
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
          if (current()) acceptSetup(session?.setup);
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
    return () => { disposed = true; offSetup(); cancelAnchor(); cancelAnchorRef.current = null; stream?.dispose(); streamRef.current = null; resizeRef.current = null; observer.disconnect(); clearTimeout(fitting); data.dispose(); historySubscriptions.forEach(subscription => subscription.dispose()); term.dispose(); terminal.current = null; };
  }, [sessionId, api]);
  // Hidden overview terminals don't need a context; above 100% zoom the scaled
  // WebGL bitmap would blur, so the crisp DOM renderer takes over there.
  const gpu = webglSupported && !overview && !magnified && webglPreferred();
  useEffect(() => {
    const term = terminal.current;
    if (!gpu || !term || webglContexts >= WEBGL_BUDGET) return;
    let addon;
    try { addon = new WebglAddon(); term.loadAddon(addon); }
    catch { try { addon?.dispose(); } catch {} return; }
    webglContexts++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true; webglContexts--;
      try { addon.dispose(); } catch {}
    };
    // A lost GPU context falls back to the DOM renderer for this terminal.
    const lost = addon.onContextLoss(release);
    return () => { lost.dispose(); release(); };
  }, [gpu, sessionId, api]);
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
  const preparing = !sessionId && node.data?.launchState === 'creating';
  const setupActive = setup && ['queued', 'checking', 'installing'].includes(setup.status);
  const setupFailed = setup && ['failed', 'cancelled'].includes(setup.status);
  const statusLabel = sessionLabel(status, preparing);
  const changeFontSize = value => onChange(node.id, { data: { ...node.data, fontSize: value } });
  const agent = node.data?.agent || {};
  const updatedAt = agent.updatedAt != null && agent.updatedAt !== '' ? new Date(agent.updatedAt) : null;
  const hasTime = !!updatedAt && Number.isFinite(updatedAt.getTime());
  const now = useNow(!overview && !!agent.step && hasTime);
  const { tail } = useTerminalTail({ sessionId, api, lines: 1, enabled: status === 'running', connected });
  const provider = providerOf(node, tail?.foreground);
  const { branch, where } = locationOf(node, workspace);
  return <div className="terminal-panel pt-focus" data-agent={agent.status || 'idle'}>
    <div className="pt-bar">
      <div className="pt-bar-identity">
        <ModeSwitch node={node} workspace={workspace} api={api} notify={notify} />
        {provider.kind !== 'shell' && <ProviderBadge provider={provider} />}
        {effectiveStatus(agent, tail?.screenState) && <AgentState agent={agent} status={effectiveStatus(agent, tail?.screenState)} />}
        {agent.step && <span className="pt-bar-step" title={agent.step}>{agent.step}</span>}
        {!overview && agent.step && hasTime && <time className="pt-bar-since" dateTime={updatedAt.toISOString()} title={`${updatedAt.toLocaleString()} · ${agent.source === 'agent' ? 'Reportado por agente' : 'Declarado manualmente'}`}>{formatSince(now - updatedAt.getTime())}</time>}
      </div>
      <div className="pt-bar-tools">
        <button type="button" title="Dictar en esta terminal · Ctrl/Cmd + Shift + M" aria-label="Dictar en esta terminal" disabled={!connected || status !== 'running'} onClick={() => openDictation(destination.current)}><Mic size={15} strokeWidth={1.75} /></button>
        <div className="pt-type" role="group" aria-label="Tamaño del texto de la terminal">
          <button type="button" aria-label="Reducir texto de la terminal" title="Reducir texto" disabled={fontSize <= 12} onClick={() => changeFontSize(fontSize - 1)}><Minus size={13} strokeWidth={1.75} /></button>
          <button type="button" className="pt-type-reset" aria-label={`Tamaño del texto: ${fontSize} píxeles. Restablecer a 16`} title="Restablecer a 16 px" onClick={() => changeFontSize(16)}>{fontSize}</button>
          <button type="button" aria-label="Ampliar texto de la terminal" title="Ampliar texto" disabled={fontSize >= 24} onClick={() => changeFontSize(fontSize + 1)}><Plus size={13} strokeWidth={1.75} /></button>
        </div>
        {status === 'running' && <button type="button" className="pt-stop" title="Terminar proceso" aria-label="Terminar proceso" onClick={() => api('terminal.stop', { sessionId }).catch(e => notify(e.message, 'error'))}><Square size={11} strokeWidth={1.75} /></button>}
      </div>
    </div>
    <div className="pt-context" aria-label="Contexto de la terminal">
      <span className="pt-chip" title={directoryLabel ? `${directoryLabel}\n${cwd}` : cwd}>{branch ? <GitBranch size={13} strokeWidth={1.75} aria-hidden="true" /> : <Folder size={13} strokeWidth={1.75} aria-hidden="true" />}<span>{where}</span></span>
      <span className="pt-session" role="status"><i className={`status-dot ${status}`} aria-hidden="true" />{statusLabel}</span>
    </div>
    <AgentIdentity node={node} workspace={workspace} api={api} refresh={refresh} flush={flush} onOpenPanel={onOpenPanel} />
    {(setupActive || setupFailed) && <section className={`terminal-setup ${setupFailed ? 'has-error' : ''}`} aria-label="Preparación de dependencias">
      <div className="terminal-setup-heading"><span role="status">{setupActive ? (setup.status === 'installing' ? 'Instalando dependencias…' : 'Preparando dependencias…') : setup.status === 'cancelled' ? 'Preparación cancelada' : 'No se pudieron instalar las dependencias'}</span>{setupActive && <progress aria-label="Instalación en curso" />}{setupFailed && status === 'running' && <button onClick={() => api('terminal.setup.retry', { sessionId }).then(session => setSetup(session.setup)).catch(e => notify(e.message, 'error'))}>Reintentar instalación</button>}</div>
      <small>La terminal y el agente ya están disponibles. Los comandos del proyecto pueden requerir que termine la instalación.</small>
      {(setup.output || setup.error) && <details><summary>Ver {setupFailed ? 'error y salida' : 'avance'}</summary><pre>{setup.error || setup.output}</pre></details>}
    </section>}
    <div ref={host} className="terminal-host" />
    {readingHistory && <button type="button" className="terminal-history-end" onClick={() => { cancelAnchorRef.current?.(); if (terminal.current?.buffer.active.type === 'normal') terminal.current.scrollToBottom(); }}><ArrowDown size={14} strokeWidth={1.75} aria-hidden="true" />Ir al final</button>}
    {(error || !preparing && (status === 'lost' || status === 'exited')) && <div className="terminal-message"><AlertCircle size={15} strokeWidth={1.75} /><span>{error || (status === 'exited' ? 'La sesión ha finalizado. El historial se conserva.' : node.data?.launchError || 'Esta vista no tiene una sesión activa.')}</span>{sessionId && <button disabled={status === 'connecting' || status === 'disconnected'} onClick={() => streamRef.current?.retry()}><RotateCcw size={13} strokeWidth={1.75} /> Reconectar</button>}{status !== 'disconnected' && status !== 'connecting' && <button onClick={() => onRelaunch(node)}>Nueva sesión</button>}</div>}
  </div>;
}
