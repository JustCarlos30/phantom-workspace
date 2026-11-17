import { useEffect, useState } from 'react';
import { subscribe } from './useWorkspace';
import { chatSubagents } from './delegation-model.mjs';

const EMPTY = {};

export function useChatSubagents(workspace, api, connected) {
  const workspaceId = workspace?.id || '';
  const chatKey = JSON.stringify((workspace?.nodes || []).filter(node => node.type === 'terminal' && node.data?.chat?.provider).map(node => [node.id, node.data.chat.provider]));
  const [snapshot, setSnapshot] = useState({ workspaceId: '', chatKey: '', data: EMPTY });
  useEffect(() => {
    if (!workspaceId || !connected) { setSnapshot({ workspaceId, chatKey, data: EMPTY }); return undefined; }
    const ids = JSON.parse(chatKey).map(([id]) => id);
    const state = new Map(), loading = new Set(), again = new Set();
    let disposed = false;
    const publish = () => {
      if (disposed) return;
      const data = Object.fromEntries(ids.map(id => [id, [...(state.get(id)?.values() || [])].flat()]).filter(([, parts]) => parts.length));
      setSnapshot(previous => previous.workspaceId === workspaceId && previous.chatKey === chatKey && JSON.stringify(previous.data) === JSON.stringify(data) ? previous : { workspaceId, chatKey, data });
    };
    const fold = (entry, messages) => {
      for (const message of Array.isArray(messages) ? messages : []) {
        if (!message) continue;
        const parts = chatSubagents([message]);
        if (parts.length) entry.set(message.id, parts); else entry.delete(message.id);
      }
    };
    const load = async nodeId => {
      if (disposed) return;
      if (loading.has(nodeId)) { again.add(nodeId); return; }
      loading.add(nodeId);
      try {
        const chat = await api('chat.get', { workspaceId, nodeId });
        if (disposed) return;
        const entry = new Map();
        if (chat?.running) fold(entry, chat.messages);
        state.set(nodeId, entry);
      } catch { state.delete(nodeId); }
      loading.delete(nodeId);
      if (disposed) return;
      if (again.delete(nodeId)) load(nodeId); else publish();
    };
    const off = subscribe(event => {
      if (event.type !== 'chat.update' || event.workspaceId !== workspaceId || !ids.includes(event.nodeId)) return;
      if (event.reset || loading.has(event.nodeId)) { load(event.nodeId); return; }
      const entry = state.get(event.nodeId) || new Map();
      if (event.running === false) entry.clear(); else fold(entry, event.messages);
      state.set(event.nodeId, entry);
      publish();
    });
    publish();
    ids.forEach(load);
    return () => { disposed = true; off(); };
  }, [workspaceId, chatKey, api, connected]);
  return workspaceId && connected && snapshot.workspaceId === workspaceId && snapshot.chatKey === chatKey ? snapshot.data : EMPTY;
}
