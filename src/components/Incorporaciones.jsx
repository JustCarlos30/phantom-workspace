import React, { useEffect, useId } from 'react';
import { AlertTriangle, CheckCircle2, GitMerge, Power, RefreshCw, TerminalSquare } from 'lucide-react';
import { Button, ErrorNotice, OperationState, useOperation, useResource } from './PluginPrimitives';
import { preferredCardMode } from './ChatCard';
import EmptyState from './EmptyState.jsx';
import IntegrationReview from './IntegrationReview.jsx';
import { buildBranchBoard } from '../hooks/incorporaciones-model.mjs';
import '../incorporaciones.css';

// Incorporaciones: how many integration requests exist, which branches are
// ready to merge and in which order, what came back and what is still being
// worked on. The panel observes; ordering and merging belong to the
// orchestrator session.
const REQUEST = { queued: 'En cola', merging: 'Incorporando…', conflict: 'Conflicto', failed: 'Checks fallidos', merged: 'Incorporada', rejected: 'Rechazada', withdrawn: 'Retirada' };
const when = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const files = count => `${count} ${count === 1 ? 'archivo' : 'archivos'}`;
function Row({ item, marker, status, tone, children }) {
  return <li className="inc-item" data-tone={tone}>
    <span className="inc-position" aria-hidden="true">{marker ?? '·'}</span>
    <div className="inc-body">
      <div className="inc-title">
        <strong className="inc-row-title">{item.title}</strong>
        <span className="inc-status" data-tone={tone}>{status}</span>
      </div>
      {children}
    </div>
  </li>;
}
function Section({ id, title, count, hint, tone, children }) {
  return <section id={id} tabIndex={-1} className="inc-section" data-tone={tone} aria-labelledby={`${id}-h`}>
    <header className="inc-section-head"><h3 id={`${id}-h`} className="inc-heading">{title}<span className="inc-count">{count}</span></h3>{hint && <p className="inc-hint">{hint}</p>}</header>
    {children}
  </section>;
}
function Stat({ value, label, detail, tone, target }) {
  const jump = () => { const section = document.getElementById(target); section?.focus({ preventScroll: true }); section?.scrollIntoView({ block: 'start' }); };
  return <button type="button" className="inc-stat" data-tone={tone} data-empty={value ? undefined : ''} disabled={!target} aria-controls={target} onClick={jump}>
    <span className="inc-stat-value">{value}</span><span className="inc-stat-label">{label}</span>{detail && <span className="inc-stat-detail">{detail}</span>}
  </button>;
}

export default function Incorporaciones({ workspace, api, onOpenPanel, notify, active = true, sessionVisible = false }) {
  const resource = useResource(api, 'merge.status', { workspaceId: workspace.id });
  const op = useOperation(notify), { data, reload } = resource;
  const uid = useId().replace(/:/g, ''), anchor = name => `inc-${uid}-${name}`;
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
  const base = data.base.branch;
  if (!data.enabled) return <div className="inc">
    <h3 className="inc-heading">Incorporaciones está desactivado</h3>
    <p>Organiza las solicitudes de tus terminales para incorporarlas en <b>{base}</b>.</p>
    <Button icon={Power} tone="primary" disabled={op.busy} onClick={() => configure(true)}>Activar Incorporaciones</Button>
    <details className="inc-fold"><summary>Cómo funciona · hooks</summary><p>Cada terminal escribe en su propia rama y una sesión orquestadora ordena e incorpora el trabajo. Instala <code>reference-transaction</code> y <code>pre-push</code> en <code>.git/hooks</code>. Solo afectan a las terminales de Phantom; tu Git fuera de ellas no cambia. Desactivar los quita.</p></details>
    <OperationState op={op} />
    {resource.error && <ErrorNotice error={resource.error} retry={reload} />}
  </div>;

  const board = buildBranchBoard(data);
  const groups = [
    { name: 'attention', title: 'Necesitan atención', tone: 'attention', rows: board.rows.filter(row => ['conflict', 'failed', 'blocked'].includes(row.state)) },
    { name: 'ready', title: 'Para revisar', tone: 'ready', rows: board.rows.filter(row => ['queued', 'ready'].includes(row.state)) },
    { name: 'working', title: 'En curso', tone: 'working', rows: board.rows.filter(row => !['conflict', 'failed', 'blocked', 'queued', 'ready'].includes(row.state)) },
  ];

  return <div className="inc">
    <header className="inc-summary">
      <p className="inc-target"><GitMerge size={15} aria-hidden="true" /> Se incorpora en <b>{base}</b><span className={`inc-guard${data.guard.installed ? ' is-on' : ''}`}>{data.guard.installed ? 'guard activo' : 'sin guard'}</span></p>
      {!sessionVisible && <div className="tw-row">
        <Button icon={TerminalSquare} tone={data.orchestrator ? undefined : 'primary'} onClick={openOrchestrator}>{data.orchestrator ? `Ver ${data.orchestrator.title}` : 'Abrir sesión orquestadora'}</Button>
      </div>}
    </header>

    <div className="inc-stats" role="group" aria-label="Resumen de Incorporaciones">
      {groups.map(group => <Stat key={group.name} value={group.rows.length} label={group.title} tone={group.tone} target={group.rows.length ? anchor(group.name) : !board.rows.length ? anchor('empty') : undefined} />)}
    </div>

    <OperationState op={op} />
    {!data.guard.installed && <p className="tw-warning" role="status">{data.guard.reason} Sin guard, la regla depende solo de las instrucciones que reciben los agentes.</p>}
    {!data.orchestrator && <p className="inc-callout">Todavía no hay sesión orquestadora: las solicitudes esperan en la cola hasta que abras una.</p>}
    {data.base.uncommitted > 0 && <p className="tw-muted">El checkout del proyecto tiene {files(data.base.uncommitted)} con cambios sin commitear. Las terminales nuevas parten del último commit y no los ven.</p>}

    {groups.map(group => group.rows.length > 0 && <Section key={group.name} id={anchor(group.name)} title={group.title} count={group.rows.length} tone={group.tone}>
      <ol className="inc-list">{group.rows.map(({ key, item, state, label, path }) => <Row key={key} item={item} marker={state === 'queued' ? item.position : group.name === 'attention' ? <AlertTriangle size={13} aria-hidden="true" /> : '·'} status={label} tone={state}>
        <p className="inc-brief">{item.summary || item.step || item.cardTitle || 'Sin resumen declarado.'}</p>
        <p className="inc-next"><span>Siguiente</span> {path.missing[0] || 'Sin pasos pendientes'}</p>
        {(item.status === 'conflict' || item.status === 'failed') && item.note && <p className="inc-conflict">{item.note}</p>}
        {item.stale && <p className="inc-hint">La rama avanzó: se revisa el commit enviado.</p>}
        <IntegrationReview item={item} workspace={workspace} api={api} onCard={openCard} onTerminal={focus} base={base} label="Revisar" compact path={path} />
      </Row>)}</ol>
    </Section>)}
    {!board.rows.length && <div id={anchor('empty')} tabIndex={-1} className="inc-empty">
      <EmptyState size="compact" icon={CheckCircle2} description="Todo al día. No hay solicitudes ni trabajo pendiente de incorporación." />
    </div>}

    <details className="inc-section inc-fold">
      <summary className="inc-heading">Plan del orquestador{data.planUpdatedAt ? <span className="inc-hint"> · {when(data.planUpdatedAt)}</span> : null}</summary>
      {data.plan ? <p className="inc-plan">{data.plan}</p> : <p className="inc-hint">El orquestador aún no ha publicado un plan.</p>}
    </details>

    {data.history.length > 0 && <details id={anchor('history')} className="inc-section inc-fold">
      <summary className="inc-heading">Historial<span className="inc-count">{data.history.length}</span></summary>
      <ul className="inc-list">{data.history.map(item => <Row key={item.id} item={item} status={REQUEST[item.status]} tone={item.status}>
        <IntegrationReview item={item} workspace={workspace} api={api} onCard={openCard} onTerminal={focus} base={item.base || base} label="Revisar" />
        {item.status === 'rejected' && item.note && <p className="inc-note">Motivo: {item.note}</p>}
      </Row>)}</ul>
    </details>}
    <details className="inc-section inc-fold">
      <summary className="inc-heading">Configuración</summary>
      <p className="inc-hint">Los hooks <code>reference-transaction</code> y <code>pre-push</code> en <code>.git/hooks</code> protegen las ramas de las terminales Phantom. Desactivar los quita; Git fuera de Phantom no cambia.</p>
      <Button icon={Power} disabled={op.busy} onClick={() => configure(false)}>Desactivar</Button>
    </details>
  </div>;
}
