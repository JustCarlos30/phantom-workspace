import React from 'react';
import { createRoot } from 'react-dom/client';
import ChatCard from '../../src/components/ChatCard.jsx';
import PhantomChat from '../../src/components/PhantomChat.jsx';
import { AgentOpenContext, useAgentOpener } from '../../src/hooks/useAgentTraces.js';
import { workspace as exampleWorkspace, chatNode } from '../../src/stories/fixtures.js';
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

// Productive components with their real CSS. The only synthetic parts: the chat transcript shown in two canvas cards,
// and the host API, which the test wires to the real agent-traces / workspace-supervisor modules (window.hostCall).
// The provider behind every record is a fixture: nothing here ran Claude, OpenCode or Codex.
const listeners = new Set();
window.phantom = { onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
window.emitHost = event => listeners.forEach(listener => listener(event));

const WORKSPACE_ID = 'ws-obs';
const tool = (id, detail, status, agent = {}) => ({ type: 'tool', id, name: 'Agent', detail, status, agent: { steps: [], total: 0, ...agent } });
const CHATS = {
  'node-x': [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Revisa el proyecto con tres ayudantes.' }] },
    { id: 'a1', role: 'assistant', status: 'done', createdAt: '2026-01-01T10:00:00Z', parts: [{ type: 'text', text: 'Delego en tres subagentes.' },
      tool('toolu_A1', 'Explorar', 'done', { type: 'Explore', prompt: 'Lee a.txt' }), tool('toolu_A2', 'Probar', 'running'), tool('toolu_A3', 'Revisar mucho', 'done')] },
  ],
  'node-y': [
    { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Audita el módulo de pagos.' }] },
    { id: 'a2', role: 'assistant', status: 'done', createdAt: '2026-01-01T10:00:00Z', parts: [tool('toolu_B1', 'Auditar', 'done', { type: 'Explore' })] },
  ],
};
const chatOf = nodeId => ({ provider: 'claude', permissionMode: 'ask', models: { claude: 'claude-sonnet-5-5' }, reasoning: {}, running: false, messages: CHATS[nodeId] ?? [], queue: [], meta: { model: 'claude-sonnet-5-5' } });
const cola = { auto: false, stats: { queued: 0, returned: 0, oldestWaitMs: null, mergedToday: 0, filesToday: 0, mergedTotal: 0, medianWaitMs: null, medianChecksMs: null, autoMerged: 0 }, available: true, enabled: false, plan: '', planUpdatedAt: null, guard: { installed: false }, orchestrator: null, active: [], queue: [], history: [], observedAt: 0, base: { branch: 'main', oid: 'abc', uncommitted: 0 }, checks: { command: '', configured: false } };

let root;
window.mountObservability = ({ surface = 'both', width = 900 } = {}) => {
  root?.unmount();
  window.fixture = { calls: [], unknown: [], requests: [], panels: [] };
  const nodes = ['node-x', 'node-y'].map((id, index) => ({ ...chatNode, id, title: `Conversación ${id.slice(-1).toUpperCase()}`, y: index * 440, data: { chat: chatOf(id), agent: { status: 'idle' } } }));
  const workspace = { ...exampleWorkspace, id: WORKSPACE_ID, nodes };
  function Fixture() {
    const [tab, setTab] = React.useState('orchestrator');
    const api = React.useCallback(async (method, payload) => {
      window.fixture.calls.push({ method, payload });
      if (method.startsWith('agent.traces.') || method.startsWith('supervisor.')) return window.hostCall(method, payload);
      if (method === 'chat.get') return chatOf(payload.nodeId);
      if (method === 'chat.models') return { items: [{ id: 'claude-sonnet-5-5', group: 'Modelos sintéticos' }] };
      if (method === 'state.get') return { settings: {} };
      if (method === 'phantom.controllers') return { items: [] };
      if (method === 'phantom.list') return { available: true, items: [] };
      if (method === 'merge.status') return { ...cola, observedAt: Date.now() };
      if (method === 'repo.changes') return { files: [], base: 'main', truncated: false };
      if (method === 'voice.stream.warm' || method === 'voice.stream.cancel') return {};
      window.fixture.unknown.push(method);
      throw new Error(`Método sin fixture: ${method}`);
    }, []);
    // Same wiring as App.jsx, with the same code: ChatCard reaches the opener through AgentOpenContext (no onOpenAgent
    // prop is passed to the card, as the canvas does not pass one), useAgentOpener — the hook App.jsx itself uses —
    // validates the request, the dock goes to its Orquestador tab and the productive PhantomChat hands the request to
    // PhantomOrchestrator, which consumes it. Only the dock tab state (App's openPhantomChat) is reproduced here.
    const openOrchestrator = React.useCallback(() => setTab('orchestrator'), []);
    const { agentRequest: request, openAgent, consumeAgentRequest } = useAgentOpener(WORKSPACE_ID, openOrchestrator);
    React.useEffect(() => { if (request) window.fixture.requests.push(request); }, [request]);
    window.fixture.open = openAgent;
    return <div className="ao-layout" data-surface={surface}>
      {surface !== 'dock' && <div className="ao-canvas" aria-label="Canvas">
        <AgentOpenContext.Provider value={openAgent}>
          {nodes.map(node => <div key={node.id} className="ao-card" data-card={node.id}>
            <ChatCard node={node} workspace={workspace} api={api} connected focused />
          </div>)}
        </AgentOpenContext.Provider>
      </div>}
      {surface !== 'canvas' && <PhantomChat workspace={workspace} api={api} notify={() => {}} connected tab={tab} onTab={setTab} status={{ tone: 'working', orchestrator: null }} onOpenPanel={(type, data) => window.fixture.panels.push({ type, data })} agentRequest={request} onAgentRequestConsumed={consumeAgentRequest} onTask={() => {}} />}
    </div>;
  }
  const container = document.getElementById('fixture');
  container.style.width = `${width}px`;
  root = createRoot(container);
  root.render(<Fixture />);
};
window.disposeObservability = () => { root?.unmount(); root = null; };
