import React from 'react';
import { expect, userEvent, within } from 'storybook/test';
import TerminalPanel from '../components/TerminalPanel';
import TerminalCard from '../components/TerminalCard';
import ChatCard, { PermissionSwitch, ContextMeter, QueuedMessages } from '../components/ChatCard';
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
