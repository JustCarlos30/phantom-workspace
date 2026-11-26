import React from 'react';
import { createRoot } from 'react-dom/client';
import OrchestratorHub from '../../src/components/OrchestratorHub.jsx';
import { createHost, orchestratorHubWorkspaces } from '../../src/stories/host-mock.js';
import '../../src/styles.css';
import '../../src/studio.css';
import '../../src/canvas-ui.css';

// The productive OrchestratorHub with its real CSS. The host is the catalog's
// synthetic one (scenario 'orchestrator-hub'): three invented projects, and an
// orchestrator.send that records the call and sends nothing. `malformed` makes
// every read answer with unusable shapes; `scenario: 'error'` makes them fail.
const garbage = { 'terminal.list': () => 'x', 'phantom.list': () => ({ items: [null, 7, { id: 5 }] }), 'merge.status': () => [1], 'supervisor.read': () => 'roto' };
let root, host;
window.mountHub = ({ width = 900, selected = 'hub-alfa', connected = true, scenario = 'orchestrator-hub', malformed = false } = {}) => {
  root?.unmount(); host?.dispose();
  host = createHost({ scenario, overrides: malformed ? garbage : scenario === 'error' ? { 'supervisor.read': () => ({}) } : {} });
  window.hub = { calls: host.calls, unknown: host.unknown, opened: [], selections: [], closed: 0 };
  function Fixture() {
    const [workspaceId, setWorkspaceId] = React.useState(selected);
    const [online, setOnline] = React.useState(connected);
    window.hub.select = setWorkspaceId;
    window.hub.connect = setOnline;
    return <div className="oh-surface"><OrchestratorHub workspaces={orchestratorHubWorkspaces} selectedWorkspaceId={workspaceId} api={host.invoke} connected={online}
      notify={() => {}}
      onOpenPanel={(type, data, title, workspace) => window.hub.opened.push({ type, data, title, workspaceId: workspace })}
      onSelectWorkspace={(id, focus) => window.hub.selections.push({ workspaceId: id, focus: focus || null })}
      onClose={() => { window.hub.closed++; }} /></div>;
  }
  const container = document.getElementById('fixture');
  container.style.width = `${width}px`;
  root = createRoot(container);
  root.render(<Fixture />);
};
window.disposeHub = () => { root?.unmount(); root = null; host?.dispose(); host = null; };
