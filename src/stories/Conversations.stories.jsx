import React from 'react';
import { expect, userEvent, within } from 'storybook/test';
import TerminalPanel from '../components/TerminalPanel';
import TerminalCard from '../components/TerminalCard';
import ChatCard, { PermissionSwitch, ContextMeter, QueuedMessages, PhantomRunCard } from '../components/ChatCard';
import PhantomChat from '../components/PhantomChat';
import PhantomOrchestrator from '../components/PhantomOrchestrator';
import { demo, Panel } from './decorators';
import { terminalNode, chatNode, noop } from './fixtures';

export default { title: 'Conversaciones', parameters: { docs: { description: { component: 'Conversaciones y motor xterm reales. Salida, mensajes y permisos sintéticos; ninguna sesión de agente ni PTY se inicia.' } } } };
export const Terminal = { render: () => <Panel><TerminalPanel {...demo} node={terminalNode} active /></Panel> };
export const TarjetaTerminal = { render: () => <Panel><TerminalCard {...demo} node={terminalNode} onOpen={noop} /></Panel> };
export const Chat = {
  render: () => <Panel><ChatCard {...demo} node={chatNode} /></Panel>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole('textbox', { name: /^Mensaje para / });
    await userEvent.click(input);
    await userEvent.type(input, 'Mensaje sintético');
    await expect(input).toHaveFocus();
    await expect(input).toHaveValue('Mensaje sintético');
    await expect(canvas.getByRole('button', { name: 'Enviar mensaje' })).toBeEnabled();
  },
};
export const ChatVacio = { render: Chat.render, parameters: { host: { scenario: 'empty' } } };
export const ChatCargando = { render: Chat.render, parameters: { host: { scenario: 'loading' } } };
export const ChatError = { render: Chat.render, parameters: { host: { scenario: 'error' } } };
export const ChatTrabajando = { render: Chat.render, parameters: { host: { scenario: 'working' } } };
export const ChatAtencion = { render: Chat.render, parameters: { host: { scenario: 'attention' } } };
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
    if (method === 'repo.changes') return { files: [], base: 'main', truncated: false };
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
// Encargo Phantom: formas de datos compatibles con summarizePhantomRun / delegateView. Todo sintético y estable.
const RUN_ID = 'task_00000000-0000-4000-8000-000000000001';
const GOAL = '## Título\nRediseñar la tarjeta de encargos Phantom para que el objetivo se lea completo en el chat sin truncarse a una sola línea.\n\n## Propósito\nSintético.';
const CHECKS = [{ name: 'Estados y delegación', argv: ['node', '--test'] }, { name: 'Build app', argv: ['npm', 'run', 'build'] }];
const RUN_FIXTURES = {
  completed: { status: 'completed', run: { requestedModel: 'claude-code/sonnet', startedAt: '2026-11-26T10:00:00.000Z', endedAt: '2026-11-26T10:12:30.000Z', turns: 12, tools: 40, evidence: { verification: [{ available: true, checks: CHECKS.map(check => ({ ...check, passed: true, executed: true })) }] } }, controllers: [{ taskId: RUN_ID, status: 'completed', output: 'salida técnica del controlador' }], activity: { available: true, items: [], total: 0, runs: [] } },
  running: { status: 'running', run: { requestedModel: 'claude-code/sonnet', startedAt: '2026-11-26T10:00:00.000Z', turns: 3, tools: 8 }, controllers: [{ taskId: RUN_ID, status: 'running', startedAt: '2026-11-26T10:00:00.000Z', output: 'editando archivos' }], activity: { available: true, total: 1, items: [{ id: 's1', tool: 'edit', target: 'src/components/chat/ChatTools.jsx', status: 'running' }], runs: [] } },
  blocked: { status: 'blocked', reason: 'Falta una decisión material sobre el alcance.', run: { requestedModel: 'claude-code/sonnet', startedAt: '2026-11-26T10:00:00.000Z', endedAt: '2026-11-26T10:03:00.000Z' }, controllers: [{ taskId: RUN_ID, status: 'completed' }], activity: { available: true, items: [], total: 0, runs: [] } },
};
function runApi(kind, opened) {
  const fixture = RUN_FIXTURES[kind];
  return async method => {
    if (method === 'phantom.detail') return { available: true, task: { id: RUN_ID, status: fixture.status, goal: GOAL, reason: fixture.reason, contract: { goal: GOAL, checks: CHECKS }, run: fixture.run } };
    if (method === 'phantom.controllers') return { available: true, items: fixture.controllers };
    if (method === 'phantom.events') return fixture.activity;
    return { available: false };
  };
}
function RunExample({ kind, width }) {
  const [opened, setOpened] = React.useState('');
  const api = React.useMemo(() => runApi(kind), [kind]);
  const onOpenPanel = React.useCallback((panel, target) => setOpened(`Abre ${panel}${target.resolve ? ' (resolver bloqueo)' : ''}: ${target.cardId}`), []);
  return <div style={{ width, maxWidth: '100%' }}>
    <PhantomRunCard id={RUN_ID} api={api} workspaceId="ws-sintetico" onOpenPanel={onOpenPanel} />
    <p role="status" aria-label="Destino abierto" style={{ font: '12px/16px var(--mono)', color: 'var(--muted)' }}>{opened}</p>
  </div>;
}
const toggleDetails = async canvasElement => {
  const canvas = within(canvasElement);
  const summary = await canvas.findByText('Detalles de ejecución');
  const details = summary.closest('details');
  await expect(details).not.toHaveAttribute('open');
  await userEvent.click(summary);
  await expect(details).toHaveAttribute('open');
  await userEvent.click(summary);
  await expect(details).not.toHaveAttribute('open');
};
export const EncargoPhantomCompletada = { render: () => <RunExample kind="completed" width={720} />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText('2 de 2 checks pasados')).toBeVisible();
  await toggleDetails(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Ver resultado' }));
  await expect(canvas.getByRole('status', { name: 'Destino abierto' })).toHaveTextContent(`phantom-cards: ${RUN_ID}`);
} };
export const EncargoPhantomEnEjecucion = { render: () => <RunExample kind="running" width={720} />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole('status', { name: 'Actividad actual' })).toBeVisible();
  await expect(canvas.getByRole('progressbar', { name: '0 de 2 checks pasados' })).toBeVisible();
  await toggleDetails(canvasElement);
} };
export const EncargoPhantomBloqueada = { render: () => <RunExample kind="blocked" width={720} />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: 'Resolver bloqueo' }));
  await expect(canvas.getByRole('status', { name: 'Destino abierto' })).toHaveTextContent('resolver bloqueo');
} };
export const EncargoPhantomEstrecha = { render: () => <RunExample kind="completed" width={360} />, play: async ({ canvasElement }) => {
  await toggleDetails(canvasElement);
} };

export const PermisosProyectoGuardados = { ...Compositor320, args: { ...Compositor320.args, saved: 'auto' }, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByText('worktree-con-nombre-largo'));
} };
