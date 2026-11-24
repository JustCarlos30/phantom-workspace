import React from 'react';
import TerminalPanel from '../components/TerminalPanel';
import TerminalCard from '../components/TerminalCard';
import ChatCard, { PermissionSwitch, ContextMeter, QueuedMessages } from '../components/ChatCard';
import PhantomChat from '../components/PhantomChat';
import PhantomOrchestrator from '../components/PhantomOrchestrator';
import { demo, Panel } from './decorators';
import { terminalNode, chatNode, noop } from './fixtures';
import { within, userEvent } from 'storybook/test';

export default { title: 'Conversaciones', parameters: { docs: { description: { component: 'Conversaciones y motor xterm reales. Salida, mensajes y permisos sintéticos; ninguna sesión de agente ni PTY se inicia.' } } } };
export const Terminal = { render: () => <Panel><TerminalPanel {...demo} node={terminalNode} active /></Panel> };
export const TarjetaTerminal = { render: () => <Panel><TerminalCard {...demo} node={terminalNode} onOpen={noop} /></Panel> };
export const Chat = { render: () => <Panel><ChatCard {...demo} node={chatNode} /></Panel> };
export const ChatVacio = { ...Chat, parameters: { host: { scenario: 'empty' } } };
export const ChatCargando = { ...Chat, parameters: { host: { scenario: 'loading' } } };
export const ChatError = { ...Chat, parameters: { host: { scenario: 'error' } } };
export const ChatTrabajando = { ...Chat, parameters: { host: { scenario: 'working' } } };
export const ChatAtencion = { ...Chat, parameters: { host: { scenario: 'attention' } } };
export const ChatDesconectado = { render: () => <Panel><ChatCard {...demo} node={chatNode} connected={false} /></Panel> };
export const Dock = { render: () => <Panel><PhantomChat {...demo} status={{ tone: 'idle', orchestrator: null }} /></Panel> };
export const Orquestador = { render: () => <Panel><PhantomOrchestrator {...demo} status={{ tone: 'working', orchestrator: { id: chatNode.id, title: 'Orquestador sintético', agent: 'working', step: 'Revisando el catálogo', chat: true } }} /></Panel> };
export const Controles = { render: () => { const [mode, setMode] = React.useState('ask'); return <div className="catalog-page"><PermissionSwitch provider="claude" mode={mode} onChange={setMode} /><ContextMeter meta={{ contextSource: 'claude:request-v1', contextTokens: 150000, contextWindow: 200000 }} onCompact={noop} onNew={noop} /><QueuedMessages queue={[{ id: 'queue-demo', text: 'Mensaje sintético en espera' }]} running connected unqueue={noop} resume={noop} notify={noop} /></div>; } };

function ComposerExample({ width, surface, saveError = false, saved = null }) {
  const [project, setProject] = React.useState({ ...demo.workspace, canonicalPath: '/synthetic/proyectos/proyecto-con-un-nombre-muy-largo-para-revisar-el-truncado', sessionDefaults: saved === null ? undefined : { permissionMode: saved } });
  const [config, setConfig] = React.useState({ provider: 'claude', permissionMode: 'ask', models: { claude: 'claude-modelo-sintetico-con-un-nombre-muy-largo' }, reasoning: { claude: 'high' } });
  const current = React.useRef(config); current.current = config;
  const api = React.useCallback(async (method, payload) => {
    if (method === 'workspace.update') {
      if (payload.id !== project.id || Object.keys(payload.patch).some(key => key !== 'sessionDefaults') || !Object.hasOwn(payload.patch, 'sessionDefaults')) throw new Error('Unsupported workspace patch');
      const defaults = payload.patch.sessionDefaults;
      if (defaults !== null && (!defaults || typeof defaults !== 'object' || Array.isArray(defaults) || Object.keys(defaults).length !== 1 || !Object.hasOwn(defaults, 'permissionMode') || !['ask', 'auto', 'full'].includes(defaults.permissionMode))) throw new Error('Invalid sessionDefaults');
      if (saveError) throw new Error('Fallo sintético de guardado; puedes reintentar.');
      setProject(value => ({ ...value, sessionDefaults: defaults ?? undefined }));
      return { ...demo.workspace, sessionDefaults: defaults ?? undefined };
    }
    if (method === 'chat.configure') {
      const next = { ...current.current, ...(payload.provider ? { provider: payload.provider } : {}), ...(payload.permissionMode ? { permissionMode: payload.permissionMode } : {}) };
      if ('model' in payload) next.models = { ...next.models, [next.provider]: payload.model };
      if ('reasoning' in payload) next.reasoning = { ...next.reasoning, [next.provider]: payload.reasoning };
      current.current = next; setConfig(next);
      window.__storybookHost.emit({ type: 'chat.update', reset: true, workspaceId: project.id, nodeId: payload.nodeId });
      return next;
    }
    const result = await demo.api(method, payload);
    return method === 'chat.get' ? { ...result, ...current.current, meta: { ...result.meta, contextSource: 'claude:request-v1', contextTokens: 150000, contextWindow: 200000 } } : result;
  }, [project.id, saveError]);
  const node = { ...chatNode, data: { chat: config, worktree: { path: `${project.canonicalPath}/worktree-con-nombre-largo`, branch: 'feature/compositor-estrecho' } } };
  return <div data-composer-example style={{ width, height: 720, position: 'relative', containerType: 'inline-size' }}>
    <style>{'[data-composer-example] > .phantom-chat { position: relative; inset: auto; width: 100%; height: 100%; }'}</style>
    {surface === 'dock' ? <PhantomChat {...demo} workspace={project} api={api} onTask={noop} /> : <ChatCard {...demo} workspace={project} api={api} node={node} focused={width > 640} />}
  </div>;
}

export const Compositor320 = { args: { width: 320, surface: 'card', saveError: false, saved: null }, argTypes: { width: { control: 'select', options: [320, 480, 640, 960] }, surface: { control: 'select', options: ['card', 'dock'] }, saved: { control: 'select', options: [null, 'ask', 'auto', 'full'] } }, render: args => <ComposerExample key={`${args.width}:${args.surface}:${args.saved}:${args.saveError}`} {...args} /> };
export const Compositor480 = { ...Compositor320, args: { ...Compositor320.args, width: 480 } };
export const Compositor640 = { ...Compositor320, args: { ...Compositor320.args, width: 640 } };
export const CompositorExpandido = { ...Compositor320, args: { ...Compositor320.args, width: 960 } };
export const Dock320 = { ...Compositor320, args: { ...Compositor320.args, surface: 'dock' } };
export const Dock480 = { ...Compositor480, args: { ...Compositor480.args, surface: 'dock' } };
export const Dock640 = { ...Compositor640, args: { ...Compositor640.args, surface: 'dock' } };
export const DockExpandido = { ...CompositorExpandido, args: { ...CompositorExpandido.args, surface: 'dock' } };
export const PermisosProyecto = { ...Compositor320, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByText('worktree-con-nombre-largo'));
  await userEvent.click(await canvas.findByRole('checkbox', { name: 'Usar estos permisos en nuevas conversaciones de este proyecto' }));
} };
export const PermisosProyectoError = { ...PermisosProyecto, args: { ...Compositor320.args, saveError: true } };
export const PermisosProyectoGuardados = { ...Compositor320, args: { ...Compositor320.args, saved: 'auto' }, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByText('worktree-con-nombre-largo'));
} };
