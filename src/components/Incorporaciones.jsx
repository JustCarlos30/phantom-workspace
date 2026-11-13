import React, { useEffect, useId } from 'react';
import { AlertTriangle, CheckCircle2, GitMerge, Loader2, Power, RefreshCw, TerminalSquare } from 'lucide-react';
import { Button, ErrorNotice, OperationState, useOperation, useResource } from './PluginPrimitives';
import { preferredCardMode } from './ChatCard';
import EmptyState from './EmptyState.jsx';
import { buildIncorporaciones } from '../hooks/incorporaciones-model.mjs';
import '../incorporaciones.css';

// Incorporaciones: how many integration requests exist, which branches are
// ready to merge and in which order, what came back and what is still being
// worked on. The panel observes; ordering and merging belong to the
// orchestrator session.
const REQUEST = { queued: 'En cola', merging: 'Incorporando…', conflict: 'Conflicto', failed: 'Checks fallidos', merged: 'Incorporada', rejected: 'Rechazada', withdrawn: 'Retirada' };
const WORK = { idle: 'En pausa', working: 'Trabajando', blocked: 'Bloqueada', review: 'Lista para revisión' };
const when = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const files = count => `${count} ${count === 1 ? 'archivo' : 'archivos'}`;
const commits = count => `${count} ${count === 1 ? 'commit' : 'commits'}`;
// Terminal branches end in the node's UUID; the title already names the terminal.
const short = branch => branch.replace(/^(phantom\/terminal-[0-9a-f]{8})[0-9a-f-]+$/, '$1…');

function Overlaps({ items }) {
  if (!items?.length) return null;
  const others = [...new Set(items.flatMap(item => item.with))];
  return <p className="inc-overlap"><AlertTriangle size={12} aria-hidden="true" />Comparte {files(items.length)} con {others.join(', ')}: {items.slice(0, 4).map(item => item.path).join(', ')}{items.length > 4 ? '…' : ''}. El orden importa.</p>;
}
function Files({ item }) {
  if (!item.fileCount) return null;
  return <details className="inc-files"><summary>{files(item.fileCount)}</summary><ul>{item.files.map(file => <li key={file}>{file}</li>)}</ul>{item.fileCount > item.files.length && <p className="tw-muted">y {item.fileCount - item.files.length} más</p>}</details>;
}
// Commits the branch adds and those it lacks from the base, as two small figures.
function Delta({ ahead, behind, base }) {
  if (ahead == null && behind == null) return null;
  const label = [ahead != null && `${commits(ahead)} por incorporar`, behind != null && `${commits(behind)} detrás de ${base}`].filter(Boolean).join(', ');
  return <span className="inc-delta" role="img" aria-label={label}>
    {ahead != null && <span className="is-ahead" title={`Commits por incorporar en ${base}`}>+{ahead}</span>}
    {behind != null && <span className={`is-behind${behind ? '' : ' is-zero'}`} title={`Commits de ${base} que le faltan`}>−{behind}</span>}
  </span>;
}
function Row({ item, marker, status, tone, focus, delta, children }) {
  return <li className="inc-item" data-tone={tone}>
    <span className="inc-position" aria-hidden="true">{marker ?? '·'}</span>
    <div className="inc-body">
      <div className="inc-title">
        <button type="button" className="inc-link" title="Ver esta terminal" onClick={() => focus(item.nodeId)}>{item.title}</button>
        <span className="inc-status" data-tone={tone}>{status}</span>
        {delta}
      </div>
      {children}
    </div>
  </li>;
}
function Section({ id, title, count, hint, tone, children }) {
  return <section id={id} className="inc-section" data-tone={tone} aria-labelledby={`${id}-h`}>
    <header className="inc-section-head"><h3 id={`${id}-h`} className="inc-heading">{title}<span className="inc-count">{count}</span></h3>{hint && <p className="inc-hint">{hint}</p>}</header>
    {children}
  </section>;
}
function Stat({ value, label, detail, tone, target }) {
  const jump = () => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return <button type="button" className="inc-stat" data-tone={tone} data-empty={value ? undefined : ''} disabled={!target} onClick={jump}>
    <span className="inc-stat-value">{value}</span><span className="inc-stat-label">{label}</span>{detail && <span className="inc-stat-detail">{detail}</span>}
  </button>;
}

export default function Incorporaciones({ workspace, api, onOpenPanel, notify, active = true }) {
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
  const configure = enabled => op.run(async () => { await api('merge.configure', { workspaceId: workspace.id, enabled }); await reload(); }, enabled ? 'Incorporaciones activado' : 'Incorporaciones desactivado');
  const openOrchestrator = () => data?.orchestrator ? focus(data.orchestrator.nodeId) : onOpenPanel?.('terminal', { role: 'orchestrator', chat: { provider: preferredCardMode() } }, 'Orquestador');

  if (!data) return resource.error ? <ErrorNotice error={resource.error} retry={reload} /> : <p className="tw-muted" role="status">Consultando el repositorio…</p>;
  if (!data.available) return <div className="inc"><p className="tw-warning" role="status">{data.reason || 'Incorporaciones no está disponible en esta carpeta.'}</p><Button icon={RefreshCw} onClick={reload}>Reintentar</Button></div>;
  const base = data.base.branch;
  if (!data.enabled) return <div className="inc">
    <h3 className="inc-heading">Incorporaciones está desactivado</h3>
    <p>Al activarlo, cada terminal solo puede escribir en su propia rama y una única sesión orquestadora ordena e incorpora el trabajo en <b>{base}</b>. Aquí verás cuántas solicitudes hay, qué ramas están listas para mergear y qué se planea.</p>
    <p className="tw-muted">Instala dos hooks en <code>.git/hooks</code> de este proyecto (<code>reference-transaction</code> y <code>pre-push</code>). Solo afectan a las terminales de Phantom; tu Git fuera de ellas no cambia. Desactivar los quita.</p>
    <Button icon={Power} tone="primary" disabled={op.busy} onClick={() => configure(true)}>Activar Incorporaciones</Button>
    <OperationState op={op} />
  </div>;

  const model = buildIncorporaciones(data), { counts, merging } = model;
  const cardsDetail = counts.cards ? [counts.queued && `${counts.queued} en cola`, merging && '1 incorporando', counts.attention && `${counts.attention} devueltas`].filter(Boolean).join(' · ') : 'ninguna abierta';
  const readyDetail = counts.ready ? [counts.queued && `${counts.queued} solicitadas`, counts.unrequested && `${counts.unrequested} sin solicitar`].filter(Boolean).join(' · ') : 'nada por mergear';

  return <div className="inc">
    <header className="inc-summary">
      <p className="inc-target"><GitMerge size={15} aria-hidden="true" /> Se incorpora en <b>{base}</b><span className={`inc-guard${data.guard.installed ? ' is-on' : ''}`}>{data.guard.installed ? 'guard activo' : 'sin guard'}</span></p>
      <div className="tw-row">
        <Button icon={TerminalSquare} tone={data.orchestrator ? undefined : 'primary'} onClick={openOrchestrator}>{data.orchestrator ? `Ver ${data.orchestrator.title}` : 'Abrir sesión orquestadora'}</Button>
        <Button icon={Power} disabled={op.busy} onClick={() => configure(false)}>Desactivar</Button>
      </div>
    </header>

    <div className="inc-stats" role="group" aria-label="Resumen de Incorporaciones">
      <Stat value={counts.cards} label={counts.cards === 1 ? 'Solicitud abierta' : 'Solicitudes abiertas'} detail={cardsDetail} tone="cards" target={counts.cards ? anchor(counts.attention ? 'attention' : 'ready') : null} />
      <Stat value={counts.ready} label="Listas para mergear" detail={readyDetail} tone="ready" target={counts.ready ? anchor('ready') : null} />
      <Stat value={counts.attention} label="Necesitan atención" detail={counts.attention ? 'conflicto o checks' : 'sin devoluciones'} tone="attention" target={counts.attention ? anchor('attention') : null} />
      <Stat value={counts.working} label="En curso" detail={counts.working ? 'sin commits listos' : 'nadie trabajando'} tone="working" target={counts.working ? anchor('working') : null} />
      <Stat value={counts.merged} label="Incorporadas" detail="recientes" tone="merged" target={counts.merged ? anchor('history') : null} />
    </div>

    <OperationState op={op} />
    {!data.guard.installed && <p className="tw-warning" role="status">{data.guard.reason} Sin guard, la regla depende solo de las instrucciones que reciben los agentes.</p>}
    {!data.orchestrator && <p className="inc-callout">Todavía no hay sesión orquestadora: las solicitudes esperan en la cola hasta que abras una.</p>}
    {data.base.uncommitted > 0 && <p className="tw-muted">El checkout del proyecto tiene {files(data.base.uncommitted)} con cambios sin commitear. Las terminales nuevas parten del último commit y no los ven.</p>}

    {merging && <p className="inc-now" role="status"><Loader2 size={14} className="spinning" aria-hidden="true" />Incorporando ahora <b>{merging.title}</b> en {base}<span className="inc-meta" title={merging.branch}>{short(merging.branch)}</span></p>}

    {model.attention.length > 0 && <Section id={anchor('attention')} title="Necesitan atención" count={model.attention.length} tone="attention" hint={`Devueltas a su terminal: deben traer ${base} a la rama, corregir y volver a enviarla.`}>
      <ul className="inc-list">{model.attention.map(item => <Row key={item.id} item={item} marker={<AlertTriangle size={13} />} status={REQUEST[item.status]} tone={item.status} focus={focus} delta={<Delta ahead={null} behind={item.behind} base={base} />}>
        {item.summary && <p>{item.summary}</p>}
        {item.status === 'conflict' && <p className="inc-conflict">Conflicto en {item.conflicts?.join(', ') || 'archivos sin identificar'}.</p>}
        {item.note && <p className="inc-note">Orquestador: {item.note}</p>}
        <p className="inc-meta" title={item.branch}>{short(item.branch)} · solicitada {when(item.requestedAt)}</p>
        <Files item={item} />
      </Row>)}</ul>
    </Section>}

    <Section id={anchor('ready')} title="Listas para mergear" count={model.ready.length} tone="ready" hint={`Primero la cola, en el orden en que el orquestador las incorporará en ${base}; después las ramas con commits limpios que nadie ha solicitado.`}>
      {!model.ready.length ? <EmptyState className="tw-empty" size="compact" icon={CheckCircle2} description={`Ninguna rama está lista para mergear en ${base}.`} />
        : <ol className="inc-list">{model.ready.map(({ kind, item }) => kind === 'request'
          ? <Row key={item.id} item={item} marker={item.position} status="En cola" tone="queued" focus={focus} delta={<Delta ahead={null} behind={item.behind} base={base} />}>
            {item.summary && <p>{item.summary}</p>}
            <p className="inc-meta" title={item.branch}>{short(item.branch)} · solicitada {when(item.requestedAt)}{item.behind ? ` · ${commits(item.behind)} detrás de ${base}` : ''}</p>
            {item.note && <p className="inc-note">Orquestador: {item.note}</p>}
            {item.stale && <p className="inc-meta">La rama tiene commits posteriores a la solicitud; se incorporará el commit enviado ({item.headOid.slice(0, 8)}).</p>}
            <Overlaps items={item.overlaps} /><Files item={item} />
          </Row>
          : <Row key={item.nodeId} item={item} marker="–" status="Sin solicitar" tone="unrequested" focus={focus} delta={<Delta ahead={item.ahead} behind={item.behind} base={base} />}>
            {(item.step || item.cardTitle) && <p>{item.step || item.cardTitle}</p>}
            <p className="inc-meta" title={item.branch}>{short(item.branch)} · {commits(item.ahead)} guardados, worktree limpio{item.running ? '' : ' · sin sesión activa'}. Su terminal debe enviarla a la cola.</p>
            <Overlaps items={item.overlaps} /><Files item={item} />
          </Row>)}</ol>}
    </Section>

    <Section id={anchor('working')} title="En curso" count={model.working.length} tone="working" hint="Terminales con cambios sin commitear o trabajando todavía: aún no se pueden mergear.">
      {!model.working.length ? <EmptyState className="tw-empty" size="compact" description="Ninguna terminal tiene trabajo a medias." />
        : <ul className="inc-list">{model.working.map(item => <Row key={item.nodeId} item={item} status={WORK[item.status] || item.status} tone={item.status} focus={focus} delta={item.missing ? null : <Delta ahead={item.ahead} behind={item.behind} base={base} />}>
          {(item.step || item.cardTitle) && <p>{item.step || item.cardTitle}</p>}
          <p className="inc-meta" title={item.branch}>{item.missing ? `${short(item.branch)} · rama no encontrada` : `${short(item.branch)}${item.uncommitted ? ` · ${files(item.uncommitted)} sin commitear` : ''}${item.ahead ? '' : ' · sin commits nuevos'}${item.running ? '' : ' · sin sesión activa'}`}</p>
          <Overlaps items={item.overlaps} /><Files item={item} />
        </Row>)}</ul>}
    </Section>

    <details className="inc-section inc-fold" open={Boolean(data.plan)}>
      <summary className="inc-heading">Plan del orquestador{data.planUpdatedAt ? <span className="inc-hint"> · {when(data.planUpdatedAt)}</span> : null}</summary>
      {data.plan ? <p className="inc-plan">{data.plan}</p> : <EmptyState className="tw-empty" size="compact" description="El orquestador aún no ha publicado un plan." />}
    </details>

    {data.history.length > 0 && <details id={anchor('history')} className="inc-section inc-fold">
      <summary className="inc-heading">Historial<span className="inc-count">{data.history.length}</span></summary>
      <ul className="inc-list">{data.history.map(item => <Row key={item.id} item={item} status={REQUEST[item.status]} tone={item.status} focus={focus}>
        {item.summary && <p>{item.summary}</p>}
        <p className="inc-meta" title={item.branch}>{short(item.branch)}{item.mergedOid ? ` · ${item.mergedOid.slice(0, 8)}` : ''} · {when(item.finishedAt || item.updatedAt)}</p>
        {item.status === 'rejected' && item.note && <p className="inc-note">Motivo: {item.note}</p>}
      </Row>)}</ul>
    </details>}
  </div>;
}
