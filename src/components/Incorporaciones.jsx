import React, { useEffect } from 'react';
import { GitMerge, Power, RefreshCw, TerminalSquare } from 'lucide-react';
import { Button, ErrorNotice, OperationState, useOperation, useResource } from './PluginPrimitives';
import { preferredCardMode } from './ChatCard';
import IntegrationReview from './IntegrationReview.jsx';
import '../incorporaciones.css';

// Incorporaciones: what is being integrated, what waits and in which order, and
// what each terminal is still working on. The panel observes; ordering and
// merging belong to the orchestrator session.
const when = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const files = count => `${count} ${count === 1 ? 'archivo' : 'archivos'}`;

export default function Incorporaciones({ workspace, api, onOpenPanel, notify, active = true }) {
  const resource = useResource(api, 'merge.status', { workspaceId: workspace.id });
  const op = useOperation(notify), { data, reload } = resource;
  // The queue lives in workspace state; branch facts only change in Git, so poll while shown.
  const queueKey = JSON.stringify(workspace.integration ?? null);
  useEffect(() => { reload(); }, [queueKey, reload]);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 5000);
    return () => clearInterval(timer);
  }, [active, reload]);
  const focus = nodeId => onOpenPanel?.('terminal', { focusNodeId: nodeId });
  const openCard = cardId => onOpenPanel?.('phantom-cards', { pluginId: 'phantom', panelId: 'cards', cardId }, 'Card');
  const configure = enabled => op.run(async () => { await api('merge.configure', { workspaceId: workspace.id, enabled }); await reload(); }, enabled ? 'Incorporaciones activado' : 'Incorporaciones desactivado');
  const openOrchestrator = () => data?.orchestrator ? focus(data.orchestrator.nodeId) : onOpenPanel?.('terminal', { role: 'orchestrator', chat: { provider: preferredCardMode() } }, 'Orquestador');

  if (!data) return resource.error ? <ErrorNotice error={resource.error} retry={reload} /> : <p className="tw-muted" role="status">Consultando el repositorio…</p>;
  if (!data.available) return <div className="inc"><p className="tw-warning" role="status">{data.reason || 'Incorporaciones no está disponible en esta carpeta.'}</p><Button icon={RefreshCw} onClick={reload}>Reintentar</Button></div>;
  const base = data.base.branch, merging = data.queue.find(item => item.status === 'merging');
  if (!data.enabled) return <div className="inc">
    <h3 className="inc-heading">Incorporaciones está desactivado</h3>
    <p>Al activarlo, cada terminal solo puede escribir en su propia rama y una única sesión orquestadora ordena e incorpora el trabajo en <b>{base}</b>. Aquí verás qué se está incorporando, qué espera y qué se planea.</p>
    <p className="tw-muted">Instala dos hooks en <code>.git/hooks</code> de este proyecto (<code>reference-transaction</code> y <code>pre-push</code>). Solo afectan a las terminales de Phantom; tu Git fuera de ellas no cambia. Desactivar los quita.</p>
    <Button icon={Power} tone="primary" disabled={op.busy} onClick={() => configure(true)}>Activar Incorporaciones</Button>
    <OperationState op={op} />
    {resource.error && <ErrorNotice error={resource.error} retry={reload} />}
  </div>;

  return <div className="inc">
    <header className="inc-summary">
      <p><GitMerge size={15} aria-hidden="true" /> Se incorpora en <b>{base}</b> · {data.guard.installed ? 'guard de Git instalado' : 'sin guard de Git'}</p>
      <div className="tw-row">
        <Button icon={TerminalSquare} tone={data.orchestrator ? undefined : 'primary'} onClick={openOrchestrator}>{data.orchestrator ? `Ver ${data.orchestrator.title}` : 'Abrir sesión orquestadora'}</Button>
        <Button icon={Power} disabled={op.busy} onClick={() => configure(false)}>Desactivar</Button>
      </div>
    </header>
    <OperationState op={op} />
    {!data.guard.installed && <p className="tw-warning" role="status">{data.guard.reason} Sin guard, la regla depende solo de las instrucciones que reciben los agentes.</p>}
    {!data.orchestrator && <p className="tw-muted">Todavía no hay sesión orquestadora: las solicitudes esperan en la cola hasta que abras una.</p>}
    {data.base.uncommitted > 0 && <p className="tw-muted">El checkout del proyecto tiene {files(data.base.uncommitted)} con cambios sin commitear. Las terminales nuevas parten del último commit y no los ven.</p>}

    <section className="inc-section" aria-label="Plan del orquestador">
      <h3 className="inc-heading">Plan del orquestador</h3>
      {data.plan ? <><p className="inc-plan">{data.plan}</p>{data.planUpdatedAt && <p className="tw-muted">Actualizado {when(data.planUpdatedAt)}</p>}</> : <EmptyState className="tw-empty" size="compact" description="El orquestador aún no ha publicado un plan." />}
    </section>

    <section className="inc-section" aria-label="Cola de incorporación">
      <h3 className="inc-heading">Cola{data.queue.length ? ` · ${data.queue.length}` : ''}</h3>
      {merging && <p className="inc-now" role="status">Incorporando ahora: <b>{merging.title}</b> en {base}</p>}
      {!data.queue.length && <EmptyState className="tw-empty" size="compact" description="Nada espera a ser incorporado." />}
      <ol className="inc-list">{data.queue.map(item => <li key={`${item.id}:${item.headOid}`}><IntegrationReview item={item} workspace={workspace} api={api} onCard={openCard} onTerminal={focus} base={base} /></li>)}</ol>
    </section>

    <section className="inc-section" aria-label="Trabajo en curso">
      <h3 className="inc-heading">En curso{data.active.length ? ` · ${data.active.length}` : ''}</h3>
      {!data.active.length && <EmptyState className="tw-empty" size="compact" description="Ninguna terminal tiene trabajo sin solicitar." />}
      <ul className="inc-list">{data.active.map(item => <li key={item.nodeId}><IntegrationReview item={item} workspace={workspace} api={api} onCard={openCard} onTerminal={focus} base={base} /></li>)}</ul>
    </section>

    {data.history.length > 0 && <details className="inc-section inc-history">
      <summary className="inc-heading">Historial · {data.history.length}</summary>
      <ul className="inc-list">{data.history.map(item => <li key={item.id}><IntegrationReview item={item} workspace={workspace} api={api} onCard={openCard} onTerminal={focus} base={item.base} /></li>)}</ul>
    </details>}
  </div>;
}
import EmptyState from './EmptyState.jsx';
