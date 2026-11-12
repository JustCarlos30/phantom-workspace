import React from 'react';
import { ArrowUpRight, GitBranch, Folder, RotateCcw } from 'lucide-react';
import { ProviderTile, providerKey } from './Glyphs';
import { AGENT_LABELS } from './AgentIdentity';
import { useTerminalTail } from '../hooks/useTerminalTail';
import { ModeSwitch } from './ChatCard';

const LINE_HEIGHT = 18;

// Who drives this terminal, and how we know: a live foreground process the
// host recognised wins over a declared OpenCode link; otherwise it is a shell.
export function providerOf(node, foreground) {
  const agent = node.data?.agent || {};
  if (foreground?.agent) return { kind: 'agent', name: foreground.agent, source: `Detectado en ejecución · ${foreground.command}` };
  if (agent.providerSessionId) return { kind: 'agent', name: 'OpenCode', source: `Sesión vinculada · ${agent.providerSessionId}` };
  if (foreground?.command && !foreground.shell) return { kind: 'process', name: foreground.command, source: 'Proceso en primer plano' };
  return { kind: 'shell', name: foreground?.command || 'Shell', source: foreground ? 'Shell en espera' : 'Sin proceso observado' };
}

export function sessionLabel(status, preparing) {
  if (preparing) return 'Creando worktree…';
  return { running: 'En ejecución', connecting: 'Conectando…', disconnected: 'Sin conexión', exited: 'Finalizada', lost: 'Sin sesión activa' }[status] || 'Sin sesión activa';
}

export function ProviderBadge({ provider }) {
  return <span className={`pt-provider is-${provider.kind}`} title={provider.source}><ProviderTile provider={providerKey(provider.name, provider.kind)} /><span>{provider.name}</span></span>;
}

const SCREEN_LABELS = { approval: 'Pide tu aprobación', turn: 'Terminó · tu turno' };

// The screen outranks a declared 'working': a visible question means it waits on you.
export function effectiveStatus(agent, screenState) {
  const declared = agent?.status || null;
  if (screenState === 'awaiting_approval') return 'approval';
  if (screenState === 'awaiting_input' && declared !== 'blocked') return 'turn';
  if (declared) return declared;
  return screenState === 'working' ? 'working' : null;
}

export function AgentState({ agent, status = agent?.status || 'idle' }) {
  return <span className={`pt-state is-${status}`}><i aria-hidden="true" />{SCREEN_LABELS[status] || AGENT_LABELS[status] || AGENT_LABELS.idle}</span>;
}

export function locationOf(node, workspace) {
  const cwd = node.data?.cwd || node.data?.worktree?.path || workspace.canonicalPath || workspace.path || '';
  const folder = cwd.split('/').filter(Boolean).pop() || cwd || 'Carpeta desconocida';
  const branch = node.data?.worktree ? node.data.worktree.branch || 'HEAD separado' : null;
  return { cwd, folder, branch };
}

export default function TerminalCard({ node, workspace, api, notify, overview = false, connected = true, onOpen, onRelaunch }) {
  const sessionId = node.data?.sessionId;
  const lines = Math.max(4, Math.min(40, Math.floor(((node.height || 400) - 150) / LINE_HEIGHT)));
  const { tail, error } = useTerminalTail({ sessionId, api, lines: overview ? 1 : lines, connected });
  const agent = node.data?.agent || {};
  const provider = providerOf(node, tail?.foreground);
  const state = effectiveStatus(agent, tail?.screenState);
  const preparing = !sessionId && node.data?.launchState === 'creating';
  const status = !connected ? 'disconnected' : !sessionId ? 'lost' : tail?.status || 'connecting';
  const { cwd, folder, branch } = locationOf(node, workspace);
  const alternate = tail?.screen === 'alternate';
  const ended = !preparing && (status === 'lost' || status === 'exited');
  const emptyText = preparing ? 'Preparando el worktree de esta terminal…'
    : !sessionId ? node.data?.launchError || 'Sin sesión activa. Inicia una nueva para continuar.'
    : error ? `No se pudo leer la salida: ${error}`
    : !tail ? 'Leyendo la salida…' : 'Sin salida todavía.';
  return <div className={`pt-card ${overview ? 'is-overview' : ''}`} data-agent={state || 'idle'} data-session={status} onDoubleClick={e => { if (!e.target.closest('button')) onOpen(); }}>
    <div className="pt-card-identity">
      {!overview && <ModeSwitch node={node} workspace={workspace} api={api} notify={notify} />}
      <ProviderBadge provider={provider} />
      {state && <AgentState agent={agent} status={state} />}
      {agent.step && <p className="pt-card-step" title={agent.step}>{agent.step}</p>}
    </div>
    {!overview && <div className={`pt-card-screen ${alternate ? 'is-alternate' : ''}`} role="log" aria-label={`Últimas líneas de ${node.title}`} aria-live="off" style={alternate ? { '--rows': tail.lines.length || 1, '--cols': tail.cols || 80 } : undefined}>
      {tail?.lines?.length ? <pre>{tail.lines.join('\n')}</pre> : <p className="pt-card-empty">{emptyText}</p>}
    </div>}
    {!overview && <footer className="pt-card-footer">
      <span className="pt-card-session"><i className={`status-dot ${status}`} aria-hidden="true" />{sessionLabel(status, preparing)}</span>
      <span className="pt-card-location" title={cwd}>{branch ? <GitBranch size={12} aria-hidden="true" /> : <Folder size={12} aria-hidden="true" />}{branch ? `${branch} · ${folder}` : folder}</span>
      {ended && <button type="button" className="pt-card-action" onClick={() => onRelaunch(node)}><RotateCcw size={13} aria-hidden="true" />Nueva sesión</button>}
      <button type="button" className="pt-card-action is-primary" onClick={onOpen} title="Abrir terminal · doble clic">Abrir<ArrowUpRight size={13} aria-hidden="true" /></button>
    </footer>}
  </div>;
}
