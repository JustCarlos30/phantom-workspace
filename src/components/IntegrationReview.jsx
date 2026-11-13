import React, { useState } from 'react';
import { activityTitle, cardIdOf, integrationState } from '../hooks/activityModel.mjs';
import { contractOf } from '../hooks/plugin-model.mjs';
import { checkResultsOf } from '../hooks/card-view.mjs';
import { runsOf } from '../hooks/phantom-desk.mjs';
import { ErrorNotice, useResource } from './PluginPrimitives';
import '../incorporaciones.css';

function CardRequirements({ id, workspace, api }) {
  const resource = useResource(api, 'phantom.detail', { workspaceId: workspace.id, topic: 'tasks', id });
  if (resource.error) return <ErrorNotice error={resource.error} retry={resource.reload} />;
  if (!resource.data) return <p role="status">Leyendo requisitos de la Card…</p>;
  const native = resource.data.task || resource.data;
  if (native.available === false || resource.data.available === false) return <p>Requisitos no disponibles: {native.reason || resource.data.reason || 'sin lectura de Phantom'}.</p>;
  const contract = contractOf(native), run = runsOf(resource.data)[0];
  const checks = checkResultsOf(contract, run);
  return <section aria-label="Requisitos de Card">
    <h4>Lo pedido en la Card</h4>
    <p className="inc-full-text">{contract.goal || 'Objetivo no informado.'}</p>
    <p>Alcance declarado: {Array.isArray(contract.scope) ? contract.scope.join(', ') || 'vacío en la fuente' : 'no disponible'}.</p>
    <p>Dependencias: {Array.isArray(contract.dependencies) ? contract.dependencies.join(', ') || 'ninguna declarada' : 'no disponibles'}.</p>
    <h4>Evidencia de Card</h4>
    {checks.length ? <ul>{checks.map(check => <li key={check.name}><strong>{check.name}</strong> · {check.state === 'passed' ? 'Resultado registrado: pasó' : check.state === 'failed' ? 'Resultado registrado: falló' : 'Sin resultado'}{check.command && <code>{check.command}</code>}<small>{check.detail}</small></li>)}</ul> : <p>Checks o resultados no disponibles.</p>}
    <p>La evidencia de Card no acredita este commit enviado. Cumplimiento de lo pedido: pendiente de revisión del orquestador.</p>
  </section>;
}

function SubmittedDiff({ item, workspace, api }) {
  const resource = useResource(api, 'merge.status', { workspaceId: workspace.id, requestId: item.id });
  if (resource.error) return <ErrorNotice error={resource.error} retry={resource.reload} />;
  if (!resource.data) return <p role="status">Leyendo diff del commit enviado…</p>;
  const current = resource.data.queue?.find(row => row.id === item.id);
  if (!current || current.headOid !== item.headOid || current.inspection?.headOid !== item.headOid) return <p>La solicitud cambió o salió de la cola. Actualiza la actividad para revisar su estado actual.</p>;
  const inspection = current.inspection;
  if (!inspection?.available || inspection.diffError || typeof inspection.diff !== 'string') return <p>Diff no disponible: {inspection?.reason || inspection?.diffError || 'la API no lo informó'}.</p>;
  return <><p>Comparación desde la base común · destino observado <code>{inspection.baseOid}</code></p><pre className="inc-diff">{inspection.diff || 'Sin diferencias respecto a la base común.'}</pre>{inspection.diffTruncated && <p>Diff parcial: se muestran los primeros 64 000 caracteres.</p>}</>;
}

// Read-only review. Ordering, rejection and integration remain orchestrator actions.
export default function IntegrationReview({ item, workspace, api, onCard, onTerminal, base }) {
  const [expanded, setExpanded] = useState(false), [diff, setDiff] = useState(false);
  const cardId = cardIdOf(item), submitted = Boolean(item.id);
  const inspection = item.inspection;
  const exact = Boolean(item.headOid) && inspection?.available === true && inspection.headOid === item.headOid;
  const paths = submitted ? exact ? inspection.files : null : item.missing ? null : item.files;
  return <article className="inc-review" data-request-id={item.id}>
    <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary><span className="inc-review-title">{activityTitle(item)}</span><span className="inc-status">{submitted ? integrationState(item) : item.status === 'working' ? 'Trabajando' : item.status === 'blocked' ? 'Bloqueada' : 'Trabajo sin solicitar'}</span></summary>
      {expanded && <div className="inc-review-body">
        <p className="inc-full-text">{item.summary || item.step || 'Sin resumen declarado.'}</p>
        <p>Rama <code>{item.branch || 'no informada'}</code> → destino <code>{base || item.base || 'no informado'}</code></p>
        {!submitted && <p>{item.missing ? 'Rama no encontrada.' : `Commits por incorporar: ${item.ahead ?? 'desconocidos'} · detrás: ${item.behind ?? 'desconocidos'} · archivos sin commitear: ${item.uncommitted ?? 'desconocidos'}.`} {item.running === false ? 'Sin sesión activa.' : item.running === true ? 'Sesión activa; esto no acredita progreso.' : 'Sesión sin confirmar.'} No hay solicitud de integración para este trabajo.</p>}
        {submitted && <><p>Commit enviado <code>{item.headOid || 'no informado'}</code></p><p>{item.stale === true ? 'La rama avanzó: se integrará el commit enviado, no su HEAD actual.' : item.stale === false ? 'La rama conserva el commit enviado.' : 'HEAD actual de la rama sin confirmar.'}</p></>}
        <p>Orquestador: {item.note || 'sin comentarios para esta solicitud.'}</p>
        {item.conflicts?.length ? <p className="inc-conflict">Conflictos comprobados en el intento registrado: {item.conflicts.join(', ')}.</p> : <p>Conflictos: sin comprobación disponible para la integración actual.</p>}
        {item.overlaps?.length > 0 && <p className="inc-overlap">Solapes de archivos con otras ramas: {item.overlaps.map(overlap => `${overlap.path} (${overlap.with.join(', ')})`).join('; ')}. Son coincidencias de archivos, no conflictos comprobados.</p>}
        {submitted && <p>Checks de integración: {item.headOid && item.checks?.headOid === item.headOid && typeof item.checks?.ok === 'boolean' ? `${item.checks.ok ? 'pasaron' : 'fallaron'} · ${item.checks.command} · salida ${item.checks.code} · base ${item.checks.baseOid}` : 'sin evidencia registrada para el commit enviado.'}</p>}
        <h4>Archivos {submitted ? 'del commit enviado' : 'de la rama actual'}</h4>
        {exact && <p>Destino observado <code>{inspection.baseOid}</code> · comparación desde la base común.</p>}
        {Array.isArray(paths) ? <><p>{(submitted ? inspection.fileCount : item.fileCount) ?? paths.length} archivos{paths.length < (submitted ? inspection.fileCount : item.fileCount) ? ' · listado parcial' : ''}</p><ul>{paths.map(file => <li key={file}><code>{file}</code></li>)}</ul></> : <p>Archivos desconocidos: {inspection?.reason || 'sin inspección del commit enviado'}.</p>}
        {submitted && item.headOid && <details onToggle={event => setDiff(event.currentTarget.open)}><summary>Ver diff del commit enviado</summary>{diff && <SubmittedDiff key={`${item.id}:${item.headOid}`} item={item} workspace={workspace} api={api} />}</details>}
        {cardId ? <CardRequirements key={cardId} id={cardId} workspace={workspace} api={api} /> : <p>Card asociada desconocida. Requisitos y evidencia de Card no disponibles.</p>}
      </div>}
    </details>
    <div className="inc-review-actions">
      {cardId && onCard && <button type="button" onClick={() => onCard(cardId)}>Ver Card</button>}
      {item.nodeId && onTerminal && workspace.nodes?.some(node => node.id === item.nodeId && node.type === 'terminal') && <button type="button" onClick={() => onTerminal(item.nodeId)}>Ir a terminal</button>}
    </div>
  </article>;
}
