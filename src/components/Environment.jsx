import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Play, RefreshCw, RotateCcw, Square, Trash2 } from 'lucide-react';
import '../tools.css';
import '../environment.css';
import EmptyState from './EmptyState.jsx';
import { Button, DataView, ErrorNotice, Field, OperationState, ResourceState, useOperation, useResource } from './PluginPrimitives';
import { checksView, envLead, healthView, operatorProcess, processesView, scriptRunning, setupView } from '../hooks/processes-view.mjs';

const PROBE_EVERY = 15000;
const items = data => Array.isArray(data?.items) ? data.items : [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function Section({ title, hint, action, children }) {
  return <section className="tw-section env-section"><div className="tw-heading"><h3>{title}</h3>{action}</div>{hint && <p className="tw-muted">{hint}</p>}{children}</section>;
}
const Help = ({ what, todo }) => <details className="tw-details env-help"><summary>¿Qué pasó? / ¿Qué hago?</summary><p><b>¿Qué pasó? </b>{what}</p><p><b>¿Qué hago? </b>{todo}</p></details>;
const Badge = ({ tone, children }) => <span className={`tw-badge env-badge env-${tone || 'none'}`}>{children}</span>;

// Recent output is read only when the row is opened; terminal.tail is bounded by the host.
function Output({ api, sessionId }) {
  const [state, setState] = useState({ open: false, text: '', error: null });
  const load = useCallback(async () => {
    try { const tail = await api('terminal.tail', { sessionId, lines: 40 }); setState(old => ({ ...old, text: Array.isArray(tail?.lines) ? tail.lines.join('\n') : String(tail?.text || ''), error: null })); }
    catch (error) { setState(old => ({ ...old, error })); }
  }, [api, sessionId]);
  if (!sessionId) return null;
  return <details className="tw-details" onToggle={event => { const open = event.currentTarget.open; setState(old => ({ ...old, open })); if (open) load(); }}>
    <summary>Salida reciente</summary>
    {state.open && <><pre className="tw-code" aria-live="polite">{state.text || 'Sin salida.'}</pre><ErrorNotice error={state.error} retry={load} /><Button icon={RefreshCw} onClick={load}>Actualizar salida</Button></>}
  </details>;
}

export default function Environment({ workspace, api, refresh, notify, onOpenPanel }) {
  const workspaceId = workspace.id;
  const board = useResource(api, 'services.list', { workspaceId, probe: true, scripts: true });
  const sessions = useResource(api, 'terminal.list', { workspaceId });
  const merge = useResource(api, 'merge.status', { workspaceId });
  const op = useOperation(notify);
  const [url, setUrl] = useState(''), [title, setTitle] = useState('');
  const reloadBoard = board.reload, reloadSessions = sessions.reload;
  const reload = useCallback(() => { reloadBoard(); reloadSessions(); }, [reloadBoard, reloadSessions]);
  // Health is probed on a slow cadence while the panel is visible, never per render.
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) reloadBoard(); }, PROBE_EVERY);
    return () => clearInterval(timer);
  }, [reloadBoard]);
  useEffect(() => window.phantom?.onEvent?.(event => {
    if (event.workspaceId === workspaceId && ['terminal.exit', 'terminal.setup'].includes(event.type)) reloadSessions();
  }), [workspaceId, reloadSessions]);

  const list = Array.isArray(sessions.data) ? sessions.data : [];
  const ports = items(board.data);
  const scripts = Array.isArray(board.data?.scripts) ? board.data.scripts : [];
  const rows = processesView(workspace.nodes, list, ports);
  const setup = setupView(list);
  const checks = merge.data?.available === false ? null : checksView(merge.data?.checks);
  const lead = envLead({ setup, rows, ports, scripts });

  const stopSession = async sessionId => {
    await api('terminal.stop', { sessionId });
    for (let i = 0; i < 25; i++) {
      const current = await api('terminal.list', { workspaceId });
      if (!current.some(session => session.id === sessionId && session.status === 'running')) return;
      await sleep(200);
    }
    throw new Error('El proceso no se detuvo a tiempo. Vuelve a intentarlo.');
  };
  const run = script => op.run(async () => {
    const process = operatorProcess(script, crypto.randomUUID(), new Date().toISOString());
    const node = await api('node.create', { workspaceId, type: 'terminal', title: `Proceso: ${process.title}`, data: { process } });
    const { session } = await api('terminal.create', { workspaceId, nodeId: node.id, cols: 120, rows: 32 });
    await api('terminal.write', { sessionId: session.id, data: `${script.command}\r` });
    await refresh?.(); reload();
  }, `${script.name}: en marcha`);
  const restart = row => op.run(async () => {
    if (row.status === 'running') await stopSession(row.sessionId);
    const { session } = await api('terminal.create', { workspaceId, nodeId: row.nodeId, cols: 120, rows: 32 });
    await api('terminal.write', { sessionId: session.id, data: `${row.command}\r` });
    await refresh?.(); reload();
  }, `${row.title}: reiniciado`);
  const stop = row => op.run(async () => { await api('terminal.stop', { sessionId: row.sessionId }); reload(); }, `${row.title}: detenido`);
  const retrySetup = sessionId => op.run(async () => { await api('terminal.setup.retry', { sessionId }); reloadSessions(); }, 'Preparación reiniciada');
  const act = { retry: () => retrySetup(lead.action?.id), restart: () => restart(rows.find(row => row.processId === lead.action?.id)), run: () => run(scripts.find(script => script.id === lead.action?.id)) };

  return <>
    <Section title="Lo que necesita tu atención" action={<Button icon={RefreshCw} disabled={board.loading || sessions.loading} onClick={() => { reload(); merge.reload(); }}>Actualizar</Button>}>
      {board.loading && !board.data ? <p className="tw-muted" role="status">Consultando el entorno…</p> : <div className={`env-lead env-${lead.tone}`} role="status">
        <strong>{lead.text}</strong><span>{lead.why}</span>
        {lead.action && <Button tone="primary" icon={lead.action.kind === 'retry' ? RefreshCw : lead.action.kind === 'restart' ? RotateCcw : Play} disabled={op.busy} onClick={act[lead.action.kind]}>{lead.action.label}</Button>}
      </div>}
      <OperationState op={op} />
    </Section>

    <Section title="Cómo arrancar" hint="Scripts de package.json del proyecto y de las copias de las sesiones.">
      <ResourceState resource={board} empty="" />
      {!board.loading && !board.error && !scripts.length && <EmptyState className="tw-empty" title="No hay scripts" description="Añade scripts a package.json (por ejemplo «dev») y aparecerán aquí para ejecutarlos con un clic." />}
      {scripts.map(script => <article className="tw-item" key={script.id}>
        <div className="tw-heading"><strong>{script.name}</strong><Badge>{script.origin === 'session' ? 'Copia de la sesión' : 'Proyecto'}</Badge></div>
        <small className="tw-process-command">{script.command}</small>
        <div className="tw-row"><Button icon={Play} disabled={op.busy || scriptRunning(script, rows)} onClick={() => run(script)}>{scriptRunning(script, rows) ? 'En marcha' : 'Ejecutar'}</Button></div>
        <DataView label="Detalles" value={{ script: script.body, carpeta: script.cwd, sessionId: script.sessionId }} />
      </article>)}
    </Section>

    <Section title="Procesos vivos" hint="Servidores y tareas largas lanzados desde aquí o por un agente.">
      <ResourceState resource={sessions} empty="" />
      {!rows.length && <EmptyState className="tw-empty" title="Aún no hay procesos" description="Ejecuta un script de «Cómo arrancar» o pide a un agente que lance un servidor: aparecerá aquí con su salida." />}
      {rows.map(row => <article className="tw-item" key={row.processId}>
        <div className="tw-heading"><strong>{row.title}</strong><Badge tone={row.status === 'running' ? 'ok' : row.exitCode > 0 ? 'bad' : 'none'}>{row.status === 'running' ? 'En marcha' : row.exitCode == null ? 'Detenido' : `Terminó (código ${row.exitCode})`}</Badge></div>
        <small className="tw-process-command">{row.command}</small>
        {row.services.map(service => <div className="tw-row" key={service.id}><small>{service.url} · {healthView(service).text}</small></div>)}
        {row.status === 'stopped' && row.exitCode > 0 && <Help what={`El proceso terminó con el código ${row.exitCode}, que suele indicar un error.`} todo="Abre «Salida reciente» para ver el motivo y luego pulsa Reiniciar." />}
        <div className="tw-row">
          <Button icon={RotateCcw} disabled={op.busy} onClick={() => restart(row)}>Reiniciar</Button>
          {row.status === 'running' && <Button icon={Square} disabled={op.busy} onClick={() => stop(row)}>Detener</Button>}
          <Button icon={ArrowUpRight} disabled={op.busy || !onOpenPanel} onClick={() => op.run(() => onOpenPanel('terminal', { focusNodeId: row.nodeId }, row.title))}>Ver sesión</Button>
        </div>
        <Output api={api} sessionId={row.sessionId} />
        <DataView label="Detalles" value={{ processId: row.processId, nodeId: row.nodeId, sessionId: row.sessionId, carpeta: row.cwd, origen: row.from, createdAt: row.createdAt }} />
      </article>)}
    </Section>

    <PortsAndSites {...{ workspace, api, refresh, op, board, onOpenPanel, url, setUrl, title, setTitle }} />

    <Section title="Preparación de las copias de sesión" hint="Instalación de dependencias en la copia propia de cada sesión.">
      <ResourceState resource={sessions} empty="" />
      {!setup.length && <EmptyState className="tw-empty" description="Ninguna copia de sesión necesitó preparación. Aparecerán aquí cuando una sesión abra su copia propia." />}
      {setup.map(item => <article className="tw-item" key={item.sessionId}>
        <div className="tw-heading"><strong>{item.name}</strong><Badge tone={item.problem ? 'bad' : item.status === 'ready' ? 'ok' : 'none'}>{item.label}</Badge></div>
        <small>{item.why}</small>
        {item.problem && <Help what={item.why} todo={item.canRetry ? 'Pulsa Reintentar. Si vuelve a fallar, abre Detalles para ver la salida de la instalación.' : 'La sesión ya no está activa: abre una sesión nueva para volver a preparar la copia.'} />}
        {item.canRetry && <div className="tw-row"><Button icon={RefreshCw} disabled={op.busy} onClick={() => retrySetup(item.sessionId)}>Reintentar</Button></div>}
        <DataView label="Detalles" value={{ carpeta: item.cwd, sessionId: item.sessionId, salida: item.output, actualizado: item.updatedAt }} />
      </article>)}
    </Section>

    <Section title="Pruebas de integración" hint="Comando que debe pasar antes de que una sesión se integre en main.">
      <ResourceState resource={merge} empty="" />
      {!merge.loading && !merge.error && !checks && <EmptyState className="tw-empty" description="Activa la Cola de integración (Git → Cola) para configurar las pruebas." />}
      {checks && <article className="tw-item"><div className="tw-heading"><strong>{checks.empty ? 'Sin pruebas' : <code>{checks.command}</code>}</strong></div><small>{checks.source}</small>
        {checks.empty && <Help what="Las integraciones no ejecutan ninguna prueba antes de entrar en main." todo="Añade un script test a package.json o define el comando en Git → Cola." />}</article>}
    </Section>
  </>;
}

function PortsAndSites({ workspace, api, refresh, op, board, onOpenPanel, url, setUrl, title, setTitle }) {
  const ports = items(board.data);
  return <Section title="Puertos y sitios" hint="Se comprueba si cada uno responde cada pocos segundos." action={board.loading && board.data ? <span className="tw-muted">Comprobando…</span> : null}>
    {!board.loading && !board.error && !ports.length && <EmptyState className="tw-empty" description="Fija una URL o arranca un servidor en una sesión para verlo aquí." />}
    {ports.map((service, index) => {
      const health = healthView(service), label = service.title || service.url || 'Servicio';
      return <article className="tw-item" key={service.id || index}>
        <div className="tw-heading"><strong>{label}</strong><Badge tone={health.tone}>{health.text}</Badge></div>
        {service.url && service.url !== label && <small>{service.url}</small>}
        {health.tone === 'bad' && <Help what="Nada contesta en esa dirección." todo="Comprueba que el proceso siga en marcha y vuelve a actualizar; si es un sitio fijado, quítalo si ya no existe." />}
        <div className="tw-row"><Button icon={ArrowUpRight} disabled={op.busy || !service.url || !onOpenPanel} onClick={() => op.run(() => onOpenPanel('browser', { url: service.url }, label))}>Abrir</Button>
          {service.source === 'pinned' && typeof service.id === 'string' && <Button icon={Trash2} disabled={op.busy} onClick={() => op.run(async () => { await api('services.remove', { workspaceId: workspace.id, id: service.id }); await refresh?.(); board.reload(); })}>Quitar</Button>}</div>
        <DataView label="Detalles" value={service} />
      </article>;
    })}
    {board.data?.processReason && <DataView label="Detalles de la atribución de puertos" value={board.data.processReason} />}
    <form className="tw-form" onSubmit={e => { e.preventDefault(); op.run(async () => {
      const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Usa una URL http o https.');
      await api('services.pin', { workspaceId: workspace.id, url: parsed.href, title: title.trim() || parsed.host }); await refresh?.(); board.reload(); setUrl(''); setTitle('');
    }, 'Sitio fijado'); }}>
      <Field label="Fijar un sitio (URL)"><input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:3000" /></Field>
      <Field label="Nombre"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Opcional" /></Field>
      <Button type="submit" disabled={op.busy}>Fijar</Button>
    </form>
  </Section>;
}
