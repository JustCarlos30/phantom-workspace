import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, subscribe } from './useWorkspace';
import { buildActivity, pendingChat, pendingParts } from './activityModel.mjs';

import { createCoalescer } from './poll-schedule.mjs';

// These events do not change the task catalogue; phantom.list is re-read only if it is stale.
const lightEvents = new Set(['terminal.exit', 'tool.status']);
const empty =() => ({ sessions: {}, tasks: {}, git: {}, limits: {}, merges: {} });
const relevant = new Set(['state.changed', 'attention.new', 'terminal.exit', 'tool.status', 'task.changed', 'git.changed', 'session.changed']);
async function readSource(name, method, payload) {
  let timeout;
  try {
    const data = await Promise.race([api(method, payload), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('La lectura tardó demasiado.')), 15000); })]);
    if (name === 'sessions' && !Array.isArray(data)) throw new Error('El host devolvió un catálogo de sesiones inválido.');
    if (name === 'tasks' && data?.available !== false && !Array.isArray(data?.items)) throw new Error('Phantom devolvió un catálogo de tareas inválido.');
    if (name === 'git' && (typeof data?.available !== 'boolean' || !Array.isArray(data?.branches))) throw new Error('Git devolvió un radar inválido.');
    if (name === 'limits' && !Array.isArray(data?.providers)) throw new Error('El host devolvió límites inválidos.');
    if (name === 'merges' && data?.available !== false && (!Array.isArray(data?.queue) || !Array.isArray(data?.active))) throw new Error('El host devolvió una cola inválida.');
    return data;
  } finally { clearTimeout(timeout); }
}
// What every chat card, and the project's Phantom conversation, is waiting on.
// Read once per chat with chat.get and then kept current from the host's
// chat.update events, the same two sources ChatCard uses.
function useChatPending(workspace, connected) {
  const [chats, setChats] = useState([]);
  const workspaceId = workspace?.id || '';
  const chatKey = (workspace?.nodes || []).filter(node => node.type === 'terminal' && node.data?.chat?.provider).map(node => `${node.id}=${node.data.chat.provider}`).join('|');
  useEffect(() => {
    if (!workspaceId || !connected) { setChats([]); return undefined; }
    const ids = [`phantom:${workspaceId}`, ...chatKey.split('|').filter(Boolean).map(entry => entry.slice(0, entry.lastIndexOf('=')))];
    const state = new Map(), loading = new Set(), again = new Set();
    let disposed = false, signature = '';
    const publish = () => {
      const next = [...state].map(([nodeId, entry]) => ({ nodeId, running: entry.running, pending: [...entry.byMessage.values()].flat() })).filter(entry => entry.running);
      const sign = JSON.stringify(next.map(entry => [entry.nodeId, entry.pending.map(part => part.id)]));
      if (!disposed && sign !== signature) { signature = sign; setChats(next); }
    };
    const fold = (entry, messages) => { for (const message of messages || []) { const parts = pendingParts(message); if (parts.length) entry.byMessage.set(message.id, parts); else entry.byMessage.delete(message.id); } };
    const load = async nodeId => {
      if (loading.has(nodeId)) { again.add(nodeId); return; }
      loading.add(nodeId);
      try {
        const chat = await api('chat.get', { workspaceId, nodeId });
        const entry = { running: !!chat?.running, byMessage: new Map() };
        if (pendingChat(chat).length) fold(entry, chat.messages);
        state.set(nodeId, entry);
      } catch { state.delete(nodeId); }
      loading.delete(nodeId);
      if (disposed) return;
      if (again.delete(nodeId)) load(nodeId); else publish();
    };
    ids.forEach(load);
    const off = subscribe(event => {
      if (event.type !== 'chat.update' || event.workspaceId !== workspaceId || !ids.includes(event.nodeId)) return;
      // Anything that arrives mid-load or resets the thread is re-read whole.
      if (event.reset || loading.has(event.nodeId)) { load(event.nodeId); return; }
      const entry = state.get(event.nodeId) || { running: false, byMessage: new Map() };
      entry.running = !!event.running;
      if (entry.running) fold(entry, event.messages); else entry.byMessage.clear();
      state.set(event.nodeId, entry); publish();
    });
    return () => { disposed = true; off(); };
  }, [workspaceId, chatKey, connected]);
  return chats;
}
export function useActivity(workspace, connection, workspaceReadAt) {
  const [base, setBase] = useState('');
  const [snapshot, setSnapshot] = useState({ key: '', sources: empty() });
  const [, setTick] = useState(0);
  const runner = useRef(() => {});
  const identity = `${workspace?.id || ''}:${connection.status}:${base}`;
  const current = useRef(identity); current.current = identity;
  useEffect(() => {
    let disposed = false, needTasks = false, inFlight = false, again = false, revision = 0, online = connection.status === 'connected';
    const sources = empty();
    const valid = () => !disposed && current.current === identity;
    const publish = () => { if (valid()) setSnapshot({ key: identity, sources: { ...sources } }); };
    async function load(light = false) {
      if (!valid() || !workspace?.id || !online) return;
      if (inFlight) { again = true; needTasks = needTasks || !light; return; }
      inFlight = true;
      const request = ++revision;
      const queries = { sessions: ['terminal.list', {}], tasks: ['phantom.list', { topic: 'tasks' }], git: ['git.inspect', base ? { base } : {}], limits: ['limits.read', {}], merges: ['merge.status', {}] };
      if (light && sources.tasks.at && Date.now() - sources.tasks.at < 5000) delete queries.tasks;
      for (const name of Object.keys(queries)) sources[name] = { ...sources[name], loading: true };
      publish();
      await Promise.all(Object.entries(queries).map(async ([name, [method, payload]]) => {
        try {
          const data = await readSource(name, method, { workspaceId: workspace.id, ...payload });
          if (!valid() || request !== revision) return;
          sources[name] = { data, loading: false, at: Date.now(), error: data?.available === false ? data.reason || 'Sin datos' : '' };
        } catch (error) {
          if (!valid() || request !== revision) return;
          sources[name] = { ...sources[name], loading: false, error: error.message || String(error) };
        }
        publish();
      }));
      inFlight = false;
      if (again && valid()) { again = false; coalescer.trigger(); }
    }
    const coalescer = createCoalescer({ delay: 400, minGap: 2000, run: () => { const light = !needTasks; needTasks = false; load(light); } });
    runner.current = () => load();
    load();
    const interval = setInterval(() => { setTick(t => t + 1); load(); }, 20000);
    const off = subscribe(event => {
      if (event.type === 'connection') {
        online = event.status === 'connected';
        if (!online) ++revision;
        else { needTasks = true; coalescer.trigger(); }
        return;
      }
      if (relevant.has(event.type) && (!event.workspaceId || event.workspaceId === workspace?.id)) {
        if (!lightEvents.has(event.type)) needTasks = true;
        coalescer.trigger();
      }
    });
    return () => { disposed = true; ++revision; coalescer.dispose(); clearInterval(interval); off(); };
  }, [identity, workspace?.id, connection.status, base]);
  const sources = snapshot.key === identity ? snapshot.sources : empty();
  const chats = useChatPending(workspace, connection.status === 'connected');
  const activity = useMemo(() => {
    const result = buildActivity({ workspace, sessions: sources.sessions.data, tasks: sources.tasks.data, git: sources.git.data, merges: sources.merges.data, chats, connected: connection.status === 'connected' });
    // A failed reading keeps the last label but stops vouching for it.
    if (sources.sessions.error || sources.tasks.error) result.sessions = result.sessions.map(s => s.chatRunning ? s : { ...s, tone: 'unknown' });
    return result;
  }, [workspace, sources.sessions.data, sources.tasks.data, sources.git.data, sources.merges.data, sources.sessions.error, sources.tasks.error, chats, connection.status]);
  const retry = useCallback(() => runner.current(), []);
  return { ...activity, sources, base, setBase, retry, connected: connection.status === 'connected', workspaceReadAt, now: Date.now() };
}
