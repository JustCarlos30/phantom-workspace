import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, LoaderCircle, Pause, Play, Power, RefreshCw, Search } from 'lucide-react';
import { buildCommandCenter, getCommandCenterMonitor } from '../plugins/commandCenter.js';
import { usePluginSettings } from './Plugins.jsx';
import '../plugins.css';

const printable = value => typeof value === 'string' ? value : value == null ? 'No informado por la fuente' : JSON.stringify(value, null, 2);
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('es') : 'No informada';
const status = value => value ?? 'No informado';
function SourceData({ title, value }) { return <section className="cc-section"><h4>{title}</h4><pre>{printable(value)}</pre></section>; }

export default function CommandCenter(props) {
  const { api, workspace, active = true } = props;
  const { settings, busy, error: saveError, update } = usePluginSettings(props);
  const monitor = useMemo(() => getCommandCenterMonitor(api, workspace.id), [api, workspace.id]);
  const [snapshot, setSnapshot] = useState(() => monitor.getState());
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [visible, setVisible] = useState(false), [foreground, setForeground] = useState(!document.hidden), [clock, setClock] = useState(Date.now());
  const root = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const change = () => setForeground(!document.hidden);
    document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change);
  }, []);
  const reading = settings.enabled && active && visible && foreground;
  useEffect(() => monitor.subscribe(setSnapshot, reading), [monitor, reading]);
  useEffect(() => { monitor.setInterval(settings.refreshMs); }, [monitor, settings.refreshMs]);
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [monitor, reading]);
  const items = buildCommandCenter({ tasks: snapshot.tasks, controllers: snapshot.controllers });
  const filtered = items.filter(item => (`${item.title} ${item.id} ${item.raw?.contract?.workspace || ''}`).toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'active' ? item.sourceStatus === 'running' || item.controllerStatus === 'running' : item.sourceStatus === filter)));
  const selected = items.find(item => item.id === snapshot.selectedId);
  const stale = !settings.enabled || snapshot.paused || !reading || !snapshot.connected || !!snapshot.error || !snapshot.observedAt || clock - Date.parse(snapshot.observedAt) > settings.refreshMs * 2;
  const raw = selected?.raw || {}, contract = raw.contract || {};
  const blocker = raw.blockReason ?? raw.blockedReason ?? raw.blocker ?? raw.blocked?.reason ?? raw.reason;
  return <section ref={root} className="command-center" aria-label="Centro de mando">
    <header className="cc-header"><h3>Centro de mando</h3><span className="plugin-muted">Phantom · familia de worktrees</span></header>
    {!settings.enabled && <div className="cc-notice"><Power size={17} /><div><strong>Phantom desactivado</strong><p>Los datos y paneles se conservan. Reactiva el plugin para consultar la fuente.</p><button className="tw-button" disabled={busy} onClick={() => update({ enabled: true })}>Reactivar Phantom</button></div></div>}
     {saveError && <p role="alert" className="plugin-error">{saveError} <button className="tw-button" disabled={busy} onClick={() => update({})}>Reintentar guardado</button></p>}
    <div className="cc-toolbar"><button className="tw-button" disabled={!settings.enabled} onClick={() => monitor.pause(!snapshot.paused)}>{snapshot.paused ? <Play size={15} /> : <Pause size={15} />}{snapshot.paused ? 'Reanudar' : 'Pausar'}</button><button className="tw-button" disabled={!reading || !snapshot.connected || snapshot.loading} onClick={() => monitor.refresh()}>{snapshot.loading ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />}Actualizar</button><button className="tw-button" disabled={!settings.enabled || busy} onClick={() => update({ enabled: false })}>Desactivar Phantom</button></div>
    <label className="plugin-preference">Frecuencia de actualización<select aria-label="Frecuencia de actualización" value={settings.refreshMs} disabled={busy} onChange={event => update({ refreshMs: Number(event.target.value) })}>{[3000,4000,5000].map(ms => <option key={ms} value={ms}>{ms / 1000} segundos</option>)}</select></label>
    <div className="cc-freshness" role="status"><span>{snapshot.loading ? 'Consultando fuente…' : !snapshot.connected ? 'Sin conexión · esperando reconexión' : snapshot.paused ? 'Actualización pausada' : settings.enabled ? `Automático · cada ${settings.refreshMs / 1000} s` : 'Consultas detenidas'}</span><span className={stale ? 'cc-stale' : ''}>{stale ? 'Datos desactualizados' : 'Lectura reciente'} · Última lectura: {date(snapshot.observedAt)}</span></div>
    {snapshot.error && <div className="cc-notice plugin-error" role="alert"><AlertCircle size={17} /><div><strong>No se pudo actualizar</strong><p>{snapshot.error}</p><p>Se conserva la última lectura válida. {snapshot.paused ? 'Reanuda o reintenta manualmente.' : snapshot.connected ? 'Reintentaremos en la siguiente consulta automática.' : 'Reintentaremos al recuperar la conexión.'}</p><button className="tw-button" disabled={!reading || !snapshot.connected || snapshot.loading} onClick={() => monitor.refresh()}>Reintentar</button></div></div>}
    <div className="cc-filters"><label><Search size={15} /><input aria-label="Buscar tareas" placeholder="Buscar objetivo, ID o worktree…" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filtrar tareas" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todas</option><option value="blocked">Bloqueadas</option><option value="active">Activas (fuente o controlador)</option><option value="completed">Completadas en fuente</option><option value="failed">Fallidas en fuente</option><option value="ready">Preparadas en fuente</option></select></div>
    <div className="cc-list" aria-label="Tareas Phantom">{filtered.map(item => <button className={`cc-task ${item.id === selected?.id ? 'selected' : ''}`} key={item.id} aria-pressed={item.id === selected?.id} onClick={() => monitor.select(item.id)}><strong>{item.title || item.id}</strong><span className={item.sourceStatus === 'blocked' ? 'cc-blocked' : ''}>Fuente: {status(item.sourceStatus)} · Controlador: {item.controllerStatus ?? 'Sin controlador local'}</span>{item.sourceStatus === 'blocked' && <span className="cc-blocked">Bloqueo: {printable(item.raw?.blockReason ?? item.raw?.blockedReason ?? item.raw?.blocker ?? item.raw?.blocked?.reason ?? item.raw?.reason)}</span>}<span className="cc-path">{item.raw?.contract?.workspace || 'Worktree no informado'}</span><small>{item.id} · Actualizada: {date(item.raw?.updatedAt)} · Creada: {date(item.raw?.createdAt)}</small></button>)}</div>
    {!filtered.length && <p className="cc-empty">{snapshot.loading && !snapshot.observedAt ? 'Cargando tareas de Phantom…' : query || filter !== 'all' ? 'No hay tareas que coincidan con estos filtros.' : snapshot.observedAt ? 'No hay tareas de Phantom en esta familia de worktrees.' : 'Todavía no hay una lectura disponible.'}</p>}
    {selected && <article className="cc-detail" aria-label="Detalle de tarea"><h3>{selected.title || selected.id}</h3><p>Fuente: <strong>{status(selected.sourceStatus)}</strong> · Controlador: <strong>{selected.controllerStatus ?? 'Sin controlador local'}</strong></p>
      <SourceData title="Objetivo" value={contract.goal} /><SourceData title="Worktree exacto" value={contract.workspace} />
      {selected.sourceStatus === 'blocked' && <SourceData title="Motivo del bloqueo" value={blocker} />}
      <SourceData title="Alcance" value={contract.scope} /><SourceData title="Checks declarados" value={contract.checks} /><SourceData title="Evidencias de la fuente" value={raw.evidence ?? raw.evidences ?? raw.result?.evidence ?? raw.result?.artifacts} />
      {selected.controller && <section className="cc-section"><h4>Controlador local</h4><p>Inicio: {date(selected.controller.createdAt)} · Fin: {date(selected.controller.endedAt)}</p><p>Estado: {selected.controller.status} · Salida: {selected.controller.exitCode ?? 'No informada'}</p>{selected.controller.error && <p className="plugin-error">{selected.controller.error}</p>}<h4>Salida real del controlador</h4><pre aria-label="Salida real del controlador">{selected.controller.output || 'Sin salida recibida.'}</pre>{selected.controller.truncated && <p className="cc-stale">Salida truncada por el límite del host.</p>}</section>}
      <section className="cc-section"><h4>Últimos eventos</h4><p className="plugin-muted">Última lectura: {date(snapshot.eventsAt)} · Hasta 100 eventos nativos.{snapshot.eventsTruncated ? ' Se muestran los últimos 100; hay eventos anteriores en Phantom.' : ''}</p>{(stale || !snapshot.eventsAt || clock - Date.parse(snapshot.eventsAt) > settings.refreshMs * 2) && <p className="cc-stale">Eventos pendientes de actualización.</p>}{snapshot.eventsError && <p role="alert" className="plugin-error">Eventos desactualizados: {snapshot.eventsError}</p>}{snapshot.eventsId === selected.id && snapshot.events.length ? <ol className="cc-events">{snapshot.events.map((event, index) => <li key={event.id ?? index}><pre>{printable(event)}</pre></li>)}</ol> : <p>{snapshot.loading ? 'Consultando eventos de la tarea seleccionada…' : 'Sin eventos recibidos para esta tarea.'}</p>}</section>
      <details className="cc-section"><summary>Objeto canónico completo</summary><pre>{printable(raw)}</pre></details>
    </article>}
  </section>;
}
