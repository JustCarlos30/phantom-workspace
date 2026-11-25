import React from 'react';
import { createRoot } from 'react-dom/client';
import ChatCard from '../../src/components/ChatCard.jsx';
import PhantomChat from '../../src/components/PhantomChat.jsx';
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

const listeners = new Set();
window.phantom = { onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
const emit = event => listeners.forEach(listener => listener(event));
const sources = [];
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
  const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain(), output = context.createMediaStreamDestination();
  gain.gain.value = .02;
  oscillator.connect(gain); gain.connect(output); oscillator.start();
  sources.push({ context, oscillator, stream: output.stream });
  await context.resume();
  return output.stream;
} } });

let root;
window.mountComposer = async ({ surface = 'card', width = 320, saved = null, failSaves = 0, running = false, catalog = 0 } = {}) => {
  root?.unmount();
  window.fixture = { calls: [], unknown: [], failSaves, finish: null };
  const initialWorkspace = { ...exampleWorkspace, canonicalPath: '/synthetic/proyectos/proyecto-con-un-nombre-muy-largo-para-revisar-el-truncado', sessionDefaults: saved === null ? undefined : { permissionMode: saved } };
  let chat = { provider: 'claude', permissionMode: 'ask', models: { claude: 'claude-modelo-sintetico-con-un-nombre-muy-largo' }, reasoning: { claude: 'high' }, running, messages: [{ id: 'composer-message', role: 'user', parts: [{ type: 'text', text: 'Conversación sintética existente.' }] }], queue: [], meta: { model: 'claude-modelo-sintetico-con-un-nombre-muy-largo', contextSource: 'claude:request-v1', contextTokens: 150000, contextWindow: 200000 } };
  function Fixture() {
    const [workspace, setWorkspace] = React.useState(initialWorkspace);
    const [config, setConfig] = React.useState(chat);
    const api = React.useCallback(async (method, payload) => {
      window.fixture.calls.push({ method, payload });
      if (method === 'workspace.update') {
        await window.validateProjectUpdate(payload);
        if (window.fixture.failSaves > 0) { window.fixture.failSaves--; throw new Error('Fallo sintético de guardado'); }
        setWorkspace(value => ({ ...value, sessionDefaults: payload.patch.sessionDefaults ?? undefined }));
        return { ...initialWorkspace, sessionDefaults: payload.patch.sessionDefaults ?? undefined };
      }
      if (method === 'chat.get') return chat;
      if (method === 'chat.configure') {
        chat = { ...chat, ...(payload.permissionMode ? { permissionMode: payload.permissionMode } : {}) };
        if ('model' in payload) chat.models = { ...chat.models, claude: payload.model };
        if ('reasoning' in payload) chat.reasoning = { ...chat.reasoning, claude: payload.reasoning };
        setConfig(chat);
        emit({ type: 'chat.update', reset: true, nodeId: payload.nodeId });
        return chat;
      }
      if (method === 'chat.models') return { items: [{ id: 'claude-modelo-sintetico-con-un-nombre-muy-largo', group: 'Modelos sintéticos' }, ...Array.from({ length: catalog }, (_, i) => ({ id: `proveedor-sintetico/modelo-${String(i).padStart(3, '0')}-con-sufijo-largo`, group: `Grupo ${i % 4}` }))] };
      if (method === 'state.get') return { settings: {} };
      if (method === 'phantom.controllers') return { items: [] };
      if (method === 'repo.changes') return { files: [], base: 'main', truncated: false };
      if (method === 'voice.stream.warm' || method === 'voice.stream.cancel') return {};
      if (method === 'voice.stream.start') return { sessionId: 'synthetic-audio' };
      if (method === 'voice.stream.push') return { confirmed: 'Texto sintético', partial: 'para revisar…' };
      if (method === 'voice.stream.finish') return new Promise(resolve => { window.fixture.finish = () => resolve({ confirmed: 'Texto sintético revisable.' }); });
      if (method === 'chat.send') return {};
      if (method === 'chat.stop' || method === 'chat.clear') return {};
      window.fixture.unknown.push(method);
      throw new Error(`Método sin fixture: ${method}`);
    }, []);
    const node = { ...chatNode, data: { chat: config, worktree: { path: `${workspace.canonicalPath}/worktree-con-nombre-largo`, branch: 'feature/compositor-estrecho' } } };
    return surface === 'dock'
      ? <PhantomChat workspace={workspace} api={api} connected onTask={() => {}} />
      : <ChatCard node={node} workspace={workspace} api={api} connected focused={width > 640} />;
  }
  const container = document.getElementById('fixture');
  container.style.width = `${width}px`;
  root = createRoot(container);
  root.render(<Fixture />);
};
window.disposeComposer = () => {
  root?.unmount(); root = null;
  for (const source of sources.splice(0)) { source.stream.getTracks().forEach(track => track.stop()); source.oscillator.stop(); source.context.close(); }
};
