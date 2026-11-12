import { useCallback, useEffect, useState } from 'react';
import { subscribe } from './useWorkspace';
import { mergeChat } from './chatState';

// The conversation of one chat card for its selected provider. The host owns
// the transcript; this hook loads it once and then follows its events.
export function useChat({ workspaceId, nodeId, provider, api, connected = true }) {
  const [chat, setChat] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setChat(null); setError('');
    if (!provider || !connected) return;
    let disposed = false, inflight = false, again = false;
    const load = async () => {
      if (inflight) { again = true; return; }
      inflight = true;
      try {
        const value = await api('chat.get', { workspaceId, nodeId });
        if (!disposed) { setChat(value); setError(''); }
      } catch (e) { if (!disposed) setError(e.message); }
      finally { inflight = false; if (again && !disposed) { again = false; load(); } }
    };
    const off = subscribe(event => {
      if (event.type !== 'chat.update' || event.nodeId !== nodeId) return;
      // Anything that arrives mid-load or resets the thread is re-read whole.
      if (event.reset || inflight) { load(); return; }
      setChat(current => current ? mergeChat(current, event) : current);
    });
    load();
    return () => { disposed = true; off(); };
  }, [workspaceId, nodeId, provider, api, connected]);
  const call = useCallback((method, payload = {}) => api(method, { workspaceId, nodeId, ...payload }).then(result => { setError(''); return result; }, e => { setError(e.message); throw e; }), [api, workspaceId, nodeId]);
  const send = useCallback(text => call('chat.send', { text }), [call]);
  const stop = useCallback(() => call('chat.stop'), [call]);
  const clear = useCallback(() => call('chat.clear'), [call]);
  const unqueue = useCallback(id => call('chat.queue.remove', { id }), [call]);
  const resume = useCallback(id => call('chat.queue.send', { id }), [call]);
  const answer = useCallback((requestId, decision) => call('chat.permission.answer', { requestId, decision }), [call]);
  const reply = useCallback((requestId, answers) => call('chat.question.answer', { requestId, answers }), [call]);
  return { chat, error, send, stop, clear, answer, reply, unqueue, resume };
}
