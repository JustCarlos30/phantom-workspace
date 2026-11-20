import { useEffect, useRef, useState } from 'react';
import * as workspace from './useWorkspace';
import { structuralShare } from './structuralShare.js';
import { createTailPoller } from './tailPoller.js';

export function shareTerminalTail(previous, next) {
  return structuralShare(previous, next);
}

export function shouldResetTerminalTail(previousSessionId, sessionId) {
  return previousSessionId !== sessionId;
}

// Phantom's map card never mounts xterm. It reads a plain-text tail parsed by
// the host's headless terminal. Views of the same session and line count share
// one poller (output-driven reads plus a slow heartbeat).
const pollers = new Map();
const pollerFor = (sessionId, lines, api) => {
  const key = `${sessionId}:${lines}`;
  let entry = pollers.get(key);
  if (!entry || entry.api !== api) {
    entry = { api, poller: createTailPoller({ sessionId, lines, invoke: api, subscribeSession: workspace.subscribeSession }) };
    pollers.set(key, entry);
  }
  return entry.poller;
};

export function useTerminalTail({ sessionId, api, lines = 12, enabled = true, connected = true }) {
  const [tail, setTail] = useState(null);
  const [error, setError] = useState('');
  const previousSessionId = useRef(sessionId);
  useEffect(() => {
    if (shouldResetTerminalTail(previousSessionId.current, sessionId)) {
      setTail(null); setError('');
    }
    previousSessionId.current = sessionId;
    if (!sessionId || !enabled || !connected) return;
    return pollerFor(sessionId, lines, api).subscribe(value => {
      if (value.error !== undefined) setError(value.error);
      else { setTail(previous => shareTerminalTail(previous, value)); setError(''); }
    });
  }, [sessionId, api, lines, enabled, connected]);
  return { tail, error };
}
