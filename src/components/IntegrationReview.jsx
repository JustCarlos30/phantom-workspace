import React, { useState } from 'react';
import { activityTitle, cardIdOf, integrationState } from '../hooks/activityModel.mjs';
import { ErrorNotice, useResource } from './PluginPrimitives';
import { MergeSteps } from './MergePath.jsx';
import '../incorporaciones.css';

const shortTime = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

function SubmittedDiff({ item, workspace, api }) {
  const resource = useResource(api, 'merge.status', { workspaceId: workspace.id, requestId: item.id });
  if (resource.error) return <ErrorNotice error={resource.error} retry={resource.reload} />;
  if (!resource.data) return <p role="status">Leyendo diferencias…</p>;
  const current = resource.data.queue?.find(row => row.id === item.id);
  if (!current || current.headOid !== item.headOid || current.inspection?.headOid !== item.headOid) return <p>La rama cambió o salió de la cola.</p>;
  const inspection = current.inspection;
  if (!inspection?.available || inspection.diffError || typeof inspection.diff !== 'string') return <p>Sin datos.</p>;
  return <><pre className="inc-diff">{inspection.diff || 'Sin diferencias.'}</pre>{inspection.diffTruncated && <p className="inc-hint">Solo se muestra el principio.</p>}</>;
}

// What a branch changes: its files, the test result when there is one, and the
// diff on demand. Ordering, rejecting and integrating belong to the orchestrator.
// `explained`: the row already says why it came back (FailureCard), so the note and clash are not repeated.
export function IntegrationChanges({ item, workspace, api, base, path, explained = false }) {
  const [diff, setDiff] = useState(false);
  const submitted = Boolean(item.id), inspection = item.inspection, target = base || item.base || 'main';
  const exact = Boolean(item.headOid) && inspection?.available === true && inspection.headOid === item.headOid;
  const paths = submitted ? exact ? inspection.files : null : item.missing ? null : item.files;
  const total = (submitted ? inspection?.fileCount : item.fileCount) ?? paths?.length ?? 0;
  const tested = submitted && item.headOid && item.checks?.headOid === item.headOid && typeof item.checks?.ok === 'boolean';
  const times = [['Enviada', item.requestedAt], ['Cerrada', item.finishedAt]].filter(([, value]) => value);
  return <div className="inc-review-body">
    {path && <MergeSteps path={path} />}
    {tested && <p className={item.checks.ok ? 'inc-ok' : 'inc-conflict'}>Tests: {item.checks.ok ? 'pasaron' : 'fallaron'}</p>}
    {!explained && item.conflicts?.length > 0 && <p className="inc-conflict">Chocan con {target}: {item.conflicts.join(', ')}</p>}
    {!explained && item.note && <p className="inc-note">{item.note}</p>}
    {Array.isArray(paths) && paths.length > 0
      ? <><h4>{total} {total === 1 ? 'archivo' : 'archivos'}</h4><ul className="inc-paths">{paths.map(file => <li key={file}><code>{file}</code></li>)}</ul>{paths.length < total && <p className="inc-hint">y {total - paths.length} más</p>}</>
      : <p className="inc-hint">{Array.isArray(paths) ? 'Sin archivos cambiados.' : 'Sin datos de archivos.'}</p>}
    {submitted && item.headOid && <details className="inc-fold" onToggle={event => setDiff(event.currentTarget.open)}><summary>Ver diferencias</summary>{diff && <SubmittedDiff key={`${item.id}:${item.headOid}`} item={item} workspace={workspace} api={api} />}</details>}
    <details className="inc-fold">
      <summary>Detalles</summary>
      <dl className="inc-facts">
        {item.branch && <><dt>Rama</dt><dd><code>{item.branch}</code></dd></>}
        {item.headOid && <><dt>Enviado</dt><dd><code>{item.headOid.slice(0, 10)}</code>{item.stale === true ? ' · la rama avanzó después' : ''}</dd></>}
        {item.mergedOid && <><dt>En {target}</dt><dd><code>{item.mergedOid.slice(0, 10)}</code></dd></>}
        {times.map(([name, value]) => <React.Fragment key={name}><dt>{name}</dt><dd>{shortTime(value)}</dd></React.Fragment>)}
        {tested && item.checks.command && <><dt>Tests</dt><dd><code>{item.checks.command}</code></dd></>}
        {item.overlaps?.length > 0 && <><dt>También los tocan</dt><dd>{[...new Set(item.overlaps.flatMap(overlap => overlap.with))].join(', ')}</dd></>}
      </dl>
    </details>
  </div>;
}

// "Ver cambios" as a disclosure, with links to the task and the session.
export default function IntegrationReview({ item, workspace, api, onCard, onTerminal, base, label, bare = false, compact = false, path }) {
  const [expanded, setExpanded] = useState(false);
  const cardId = cardIdOf(item), submitted = Boolean(item.id);
  return <article className={`inc-review${bare ? ' is-bare' : ''}${compact ? ' is-compact' : ''}`} data-request-id={item.id}>
    <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>{label ? <span className="inc-review-label">{label}</span> : <><span className="inc-review-title">{activityTitle(item)}</span><span className="inc-status">{submitted ? integrationState(item) : item.status === 'working' ? 'Trabajando' : item.status === 'blocked' ? 'Bloqueada' : 'Lista'}</span></>}</summary>
      {expanded && <IntegrationChanges item={item} workspace={workspace} api={api} base={base} path={path} />}
    </details>
    {!bare && <div className="inc-review-actions">
      {cardId && onCard && <button type="button" onClick={() => onCard(cardId)}>Ver tarea</button>}
      {item.nodeId && onTerminal && workspace.nodes?.some(node => node.id === item.nodeId && node.type === 'terminal') && <button type="button" onClick={() => onTerminal(item.nodeId)}>Ir a la sesión</button>}
    </div>}
  </article>;
}
