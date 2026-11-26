import React from 'react';
import OrchestratorHub, { OrchestratorHubButton, OrchestratorRailEntry } from '../components/OrchestratorHub';
import { demo } from './decorators';
import { orchestratorHubWorkspaces } from './host-mock';
import { noop } from './fixtures';

// Same family as the dock orchestrator; autodocs stays in Conversations.stories.jsx.
export default { title: 'Conversaciones', tags: ['!autodocs'], parameters: { host: { scenario: 'orchestrator-hub' }, docs: { description: { component: 'Sección global del Orquestador con tres proyectos SYNTHETIC (host-mock, escenario orchestrator-hub). orchestrator.send responde sin enviar nada.' } } } };

const Frame = ({ width = 720, children }) => <div style={{ width, maxWidth: '100%', height: 720, containerType: 'inline-size' }}>{children}</div>;
const hub = props => <OrchestratorHub workspaces={orchestratorHubWorkspaces} selectedWorkspaceId="hub-alfa" api={demo.api} connected notify={noop} onOpenPanel={noop} onSelectWorkspace={noop} onClose={noop} {...props} />;

export const OrquestadorGlobal = { render: () => <Frame>{hub()}</Frame> };
export const OrquestadorGlobalConversacion = { render: () => <Frame>{hub()}</Frame> };
export const OrquestadorGlobal320= { render: () => <Frame width={320}>{hub()}</Frame> };
export const OrquestadorGlobalVacio = { render: () => <Frame>{hub({ workspaces: [] })}</Frame> };
export const OrquestadorGlobalCargando = { render: () => <Frame>{hub()}</Frame>, parameters: { host: { scenario: 'loading' } } };
export const OrquestadorGlobalError = { render: () => <Frame>{hub()}</Frame>, parameters: { host: { scenario: 'error' } } };
export const OrquestadorGlobalSinConexion = { render: () => <Frame>{hub({ connected: false })}</Frame> };
export const OrquestadorGlobalAccesos = { render: () => <div style={{ display: 'grid', gap: 12, width: 272 }}>
  <OrchestratorHubButton pending={2} broken={1} active={false} onClick={noop} />
  <OrchestratorRailEntry pending={2} broken={1} active onClick={noop} />
</div> };
