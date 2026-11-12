import React, { useEffect } from 'react';
import { GitMerge, Power, RefreshCw, TerminalSquare } from 'lucide-react';
import { Button, ErrorNotice, OperationState, useOperation, useResource } from './PluginPrimitives';
import { preferredCardMode } from './ChatCard';
import '../incorporaciones.css';

// Incorporaciones: what is being integrated, what waits and in which order, and
// what each terminal is still working on. The panel observes; ordering and
// merging belong to the orchestrator session.
const REQUEST = { queued: 'En cola', merging: 'Incorporando…', conflict: 'Conflicto · devuelta', merged: 'Incorporada', rejected: 'Rechazada', withdrawn: 'Retirada' };
const WORK = { idle: 'En pausa', working: 'Trabajando', blocked: 'Bloqueada', review: 'Lista para revisión' };
const when = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const files = count => `${count} ${count === 1 ? 'archivo' : 'archivos'}`;
const commits = count => `${count} ${count === 1 ? 'commit' : 'commits'}`;
// Terminal branches end in the node's UUID; the title already names the terminal.
const short = branch => branch.replace(/^(phantom\/terminal-[0-9a-f]{8})[0-9a-f-]+$/, '$1…');

function Overlaps({ items }) {
  if (!items?.length) return null;
  const others = [...new Set(items.flatMap(item => item.with))];
  return <p className="inc-overlap">Toca {files(items.length)} que también cambia {others.join(', ')}: {items.slice(0, 4).map(item => item.path).join(', ')}{items.length > 4 ? '…' : ''}. El orden importa.</p>;
}
function Files({ item }) {
  if (!item.fileCount) return null;
  return <details className="inc-files"><summary>{files(item.fileCount)}</summary><ul>{item.files.map(file => <li key={file}>{file}</li>)}</ul>{item.fileCount > item.files.length && <p className="tw-muted">y {item.fileCount - item.files.length} más</p>}</details>;
}
function Row({ item, position, status, tone, focus, children }) {
  return <li className="inc-item" data-tone={tone}>
    <span className="inc-position" aria-hidden="true">{position ?? '·'}</span>
    <div className="inc-body">
      <div className="inc-title"><button type="button" className="inc-link" title="Ver esta terminal" onClick={() => focus(item.nodeId)}>{item.title}</button><span className="inc-status">{status}</span></div>
      {children}
    </div>
  </li>;
}

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
      {data.plan ? <><p className="inc-plan">{data.plan}</p>{data.planUpdatedAt && <p className="tw-muted">Actualizado {when(data.planUpdatedAt)}</p>}</> : <p className="tw-empty">El orquestador aún no ha publicado un plan.</p>}
    </section>

    <section className="inc-section" aria-label="Cola de incorporación">
      <h3 className="inc-heading">Cola{data.queue.length ? ` · ${data.queue.length}` : ''}</h3>
      {merging && <p className="inc-now" role="status">Incorporando ahora: <b>{merging.title}</b> en {base}</p>}
      {!data.queue.length && <p className="tw-empty">Nada espera a ser incorporado.</p>}
      <ol className="inc-list">{data.queue.map(item => <Row key={item.id} item={item} position={item.position} status={REQUEST[item.status]} tone={item.status} focus={focus}>
        {item.summary && <p>{item.summary}</p>}
        <p className="inc-meta" title={item.branch}>{short(item.branch)}{item.behind ? ` · ${commits(item.behind)} detrás de ${base}` : ''} · solicitada {when(item.requestedAt)}</p>
        {item.note && <p className="inc-note">Orquestador: {item.note}</p>}
        {item.status === 'conflict' && <p className="inc-conflict">Conflicto en {item.conflicts?.join(', ') || 'archivos sin identificar'}. Su terminal debe actualizar la rama desde {base} y volver a enviarla.</p>}
        {item.stale && item.status === 'queued' && <p className="inc-meta">La rama tiene commits posteriores a la solicitud; se incorporará el commit enviado ({item.headOid.slice(0, 8)}).</p>}
        <Overlaps items={item.overlaps} /><Files item={item} />
      </Row>)}</ol>
    </section>

    <section className="inc-section" aria-label="Trabajo en curso">
      <h3 className="inc-heading">En curso{data.active.length ? ` · ${data.active.length}` : ''}</h3>
      {!data.active.length && <p className="tw-empty">Ninguna terminal tiene trabajo sin solicitar.</p>}
      <ul className="inc-list">{data.active.map(item => <Row key={item.nodeId} item={item} status={WORK[item.status] || item.status} tone={item.status} focus={focus}>
        {(item.step || item.cardTitle) && <p>{item.step || item.cardTitle}</p>}
        <p className="inc-meta" title={item.branch}>{item.missing ? `${short(item.branch)} · rama no encontrada` : `${short(item.branch)} · ${item.ahead ? `${commits(item.ahead)} por incorporar` : 'sin commits nuevos'}${item.behind ? ` · ${commits(item.behind)} detrás de ${base}` : ''}${item.uncommitted ? ` · ${files(item.uncommitted)} sin commitear` : ''}${item.running ? '' : ' · sin sesión activa'}`}</p>
        <Overlaps items={item.overlaps} /><Files item={item} />
      </Row>)}</ul>
    </section>

    {data.history.length > 0 && <details className="inc-section inc-history">
      <summary className="inc-heading">Historial · {data.history.length}</summary>
      <ul className="inc-list">{data.history.map(item => <Row key={item.id} item={item} status={REQUEST[item.status]} tone={item.status} focus={focus}>
        {item.summary && <p>{item.summary}</p>}
        <p className="inc-meta" title={item.branch}>{short(item.branch)}{item.mergedOid ? ` · ${item.mergedOid.slice(0, 8)}` : ''} · {when(item.finishedAt || item.updatedAt)}</p>
        {item.status === 'rejected' && item.note && <p className="inc-note">Motivo: {item.note}</p>}
      </Row>)}</ul>
    </details>}
  </div>;
}
