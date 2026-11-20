import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ErrorNotice, OperationState, useOperation, useResource } from './PluginPrimitives';
import { preferredCardMode } from './ChatCard';
import EmptyState from './EmptyState.jsx';
import { IntegrationChanges } from './IntegrationReview.jsx';
import { MergeMissing, FailureCard } from './MergePath.jsx';
import { agentFixPrompt, failureHelp } from '../hooks/failure-help.mjs';
import { buildCola, buildResumen, mergePath } from '../hooks/incorporaciones-model.mjs';
import '../incorporaciones.css';

const files = count => `${count} ${count === 1 ? 'archivo' : 'archivos'}`;

// A returned item says why on top, always visible; "Ver cambios" keeps the technical rest.
function Row({ row, open, onToggle, onSession, top, children }) {
  return <li className={`inc-item${open ? ' is-open' : ''}`} data-state={row.state}>
    <div className="inc-line">
      <div className="inc-main"><span className="inc-title">{row.item.title}</span>{row.detail && <span className="inc-sub">{row.detail}</span>}</div>
      <span className="inc-chip" data-tone={row.tone}>{row.label}</span>
      <span className="inc-slot">
        <button type="button" className="inc-button is-quiet" aria-expanded={open} onClick={onToggle}>Ver cambios</button>
        {onSession && <button type="button" className="inc-button" onClick={onSession}>Ir a la sesión</button>}
      </span>
    </div>
    {top}
    {open && children}
  </li>;
}

export default function Incorporaciones({ workspace, api, onOpenPanel, notify, active = true, sessionVisible = false }) {
  const resource = useResource(api, 'merge.status', { workspaceId: workspace.id });
  const op = useOperation(notify), { data, reload } = resource;
  const [openId, setOpenId] = useState(null);
  // The queue lives in workspace state; branch facts only change in Git, so poll while shown.
  const queueKey = JSON.stringify(workspace.integration ?? null);
  useEffect(() => { reload(); }, [queueKey, reload]);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 5000);
    return () => clearInterval(timer);
  }, [active, reload]);
  const focus = nodeId => onOpenPanel?.('terminal', { focusNodeId: nodeId });
  const configure = (settings, message) => op.run(async () => { await api('merge.configure', { workspaceId: workspace.id, ...settings }); await reload(); }, message);
  const openOrchestrator = () => data?.orchestrator ? focus(data.orchestrator.nodeId) : onOpenPanel?.('terminal', { role: 'orchestrator', chat: { provider: preferredCardMode() } }, 'Orquestador');

  if (!data) return resource.error ? <ErrorNotice error={resource.error} retry={reload} /> : <p className="tw-muted" role="status">Leyendo la cola…</p>;
  if (!data.available) return <div className="inc"><p className="tw-warning" role="status">{data.reason || 'La cola no está disponible en esta carpeta.'}</p><button type="button" className="inc-button" onClick={reload}><RefreshCw size={14} aria-hidden="true" />Reintentar</button></div>;
  const base = data.base.branch;
  if (!data.enabled) return <div className="inc inc-off">
    <h3 className="inc-off-title">Incorporaciones</h3>
    <p className="inc-off-copy">Reúne las ramas listas para probarlas e integrarlas en {base}.</p>
    <button type="button" className="inc-button is-primary" disabled={op.busy} onClick={() => configure({ enabled: true }, 'Incorporaciones activado')}>Activar</button>
    <details className="inc-fold"><summary>Detalles</summary><p className="inc-hint">Cada sesión trabaja en su propia rama y el orquestador las integra en {base} una a una. Al activar se instalan protecciones de Git en el repositorio (<code>reference-transaction</code> y <code>pre-push</code> en <code>.git/hooks</code>); solo afectan a las sesiones de Phantom y se quitan al desactivar.</p></details>
    <OperationState op={op} />
    {resource.error && <ErrorNotice error={resource.error} retry={reload} />}
  </div>;

  const cola = buildCola(data);
  const options = { base, checks: data.checks?.command || '', orchestrator: Boolean(data.orchestrator), auto: data.auto };
  const hasSession = item => item.nodeId && onOpenPanel && workspace.nodes?.some(node => node.id === item.nodeId && node.type === 'terminal');
  const sessionOf = item => workspace.nodes?.find(node => node.id === item.nodeId && node.type === 'terminal');
  const openCopy = async item => {
    const target = await api('branch.terminalTarget', { workspaceId: workspace.id, branch: item.branch });
    await onOpenPanel?.('terminal', { worktree: { path: target.path, branch: target.branch } }, `Copia · ${item.title}`);
  };
  // The failure goes to the worker's own session as one pasted message, then Enter.
  const askAgent = async item => {
    const sessionId = sessionOf(item)?.data?.sessionId;
    if (!sessionId) throw new Error('La sesión de este trabajo ya no está abierta.');
    await api('terminal.write', { sessionId, data: `\x1b[200~${agentFixPrompt(item, { base: item.base || base })}\x1b[201~` });
    await new Promise(resolve => setTimeout(resolve, 80));
    await api('terminal.write', { sessionId, data: '\r' });
  };
  const act = (row, id) => {
    const item = row.item, ids = { workspaceId: workspace.id, id: item.id }, branch = { workspaceId: workspace.id, branch: item.branch };
    if (id === 'session') return focus(item.nodeId);
    if (id === 'terminal') return op.run(() => openCopy(item));
    if (id === 'ask') return op.run(() => askAgent(item),'Se lo pedí al agente');
    if (id === 'retry') return op.run(async () => { await api('merge.retry', ids); await reload(); }, 'Vuelve a la cola');
    if (id === 'withdraw') return op.run(async () => { await api('merge.withdraw', ids); await reload(); }, 'Sacada de la cola');
    if (id === 'update') return op.run(async () => {
      const result = await api('branch.update', branch); await reload();
      if (result.status === 'conflict') throw new Error(`Al ponerla al día chocan: ${result.conflicts.slice(0, 3).join(', ')}. Usa «Resolver conflictos en su copia».`);
    }, `Al día con ${base}`);
    if (id === 'resolve') return op.run(async () => {
      const result = await api('branch.update', { ...branch, resolve: true }); await reload();
      if (result.status === 'resolving') { await openCopy(item); notify?.('Abrí su copia: resuelve los conflictos y guarda', 'success'); }
      else notify?.(`Ya quedó al día con ${base}`, 'success');
    });
    return undefined;
  };
  const rows = (list, { session = false, path = true, returned = false } = {}) => <ul className="inc-group">{list.map(row => {
    const withSession = session && hasSession(row.item), item = row.item;
    const help = returned ? failureHelp(item, { base: item.base || base, hasSession: Boolean(sessionOf(item) && onOpenPanel), queue: true }) : null;
    return <Row key={row.key} row={row}
      open={openId === row.key} onToggle={() => setOpenId(openId === row.key ? null : row.key)} onSession={withSession && !help ? () => focus(item.nodeId) : undefined}
      top={help && <div className="inc-why"><FailureCard help={help} entry={item} busy={op.busy} onAction={id => act(row, id)} /><MergeMissing path={mergePath(item, options)} /></div>}>
      <IntegrationChanges item={item} workspace={workspace} api={api} base={item.base || base} explained={Boolean(help)} path={path ? mergePath(item, options) : undefined} />
    </Row>;
  })}</ul>;
  const section = (title, list, props) => list.length > 0 && <section className="inc-section" aria-label={title}><h3 className="inc-heading">{title}</h3>{rows(list, props)}</section>;
  const closed = cola.today.length + cola.earlier.length;

  return <div className="inc">
    <dl className="inc-resumen" aria-label="Resumen de Incorporaciones">{buildResumen(data, Date.now()).map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    {data.autoBlocked && <p className="tw-warning" role="status">Integración automática detenida: {data.autoBlocked.reason} <button type="button" className="inc-button" disabled={op.busy} onClick={() => configure({ auto: true }, 'Integración automática reanudada')}>Reintentar</button></p>}
    <ul className="inc-group">
      <li className="inc-item"><div className="inc-line is-setting">
        <div className="inc-main"><span className="inc-title">Integrar sola al terminar</span><span className="inc-sub">{data.auto ? `Phantom prueba cada rama lista y la sube a ${base} sin esperar al orquestador` : 'Las ramas esperan a que el orquestador las integre'}</span></div>
        <button type="button" role="switch" aria-checked={Boolean(data.auto)} aria-label="Integrar sola al terminar" className="inc-switch" disabled={op.busy} onClick={() => configure({ auto: !data.auto }, data.auto ? 'Integración automática desactivada' : 'Integración automática activada')}><i aria-hidden="true" /></button>
      </div></li>
      <li className="inc-item"><div className="inc-line is-setting">
        <div className="inc-main"><span className="inc-title" role="status">{cola.orchestrator}</span></div>
        {!sessionVisible && <button type="button" className={`inc-button${data.orchestrator ? '' : ' is-primary'}`} onClick={openOrchestrator}>{data.orchestrator ? 'Ir al orquestador' : 'Abrir orquestador'}</button>}
      </div></li>
    </ul>

    <OperationState op={op} />
    {resource.error && <ErrorNotice error={resource.error} retry={reload} />}
    {!data.guard.installed && <p className="tw-warning" role="status">Las protecciones de Git no están activas en este repositorio.</p>}
    {data.base.uncommitted > 0 && <p className="inc-hint">{base} tiene {files(data.base.uncommitted)} sin guardar.</p>}

    {section('Ahora', cola.now)}
    {section('Siguen', cola.next)}
    {section('Devueltas', cola.returned, { session: true, returned: true })}
    {!cola.counts.open && <EmptyState size="compact" title="Nada en cola" description="Las ramas listas aparecen en Ramas." />}

    {data.plan && <details className="inc-fold"><summary>Plan del orquestador</summary><p className="inc-plan">{data.plan}</p></details>}
    {closed > 0 && <details className="inc-fold">
      <summary>Historial · {closed}</summary>
      {cola.today.length > 0 && <section className="inc-section" aria-label="Integradas hoy"><h4 className="inc-heading">Hoy</h4>{rows(cola.today, { path: false })}</section>}
      {cola.earlier.length > 0 && <section className="inc-section" aria-label="Integradas antes"><h4 className="inc-heading">Antes</h4>{rows(cola.earlier, { path: false })}</section>}
    </details>}
    <details className="inc-fold">
      <summary>Detalles</summary>
      <button type="button" className="inc-button" disabled={op.busy} onClick={() => configure({ enabled: false }, 'Incorporaciones desactivado')}>Desactivar Incorporaciones</button>
      <p className="inc-hint">{data.checks?.command ? <>Tests antes de integrar: <code>{data.checks.command}</code>. </> : 'Sin tests configurados. '}{data.guard.installed ? 'Las protecciones de Git están instaladas en el repositorio; se quitan al desactivar.' : data.guard.reason || ''}</p>
    </details>
  </div>;
}
