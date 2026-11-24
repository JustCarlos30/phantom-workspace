import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import '../sites.css';

const serviceKey = (project, service) => `${project.workspaceId}:${service.name}`;
const summary = services => `${services.filter(s => s.status === 'running').length} en marcha · ${services.length} servicios`;

function ServiceLog({ logs, disabled, onRefresh, onClose }) {
  const pre = useRef(null);
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [logs]);
  return <section className="sites-logs" aria-label={`Registro de ${logs.title}`}>
    <div>
      <h3>Registro · {logs.title}</h3>
      <div className="sites-actions">
        <button className="button" disabled={disabled} onClick={onRefresh}>Actualizar registro</button>
        <button className="button" onClick={onClose}>Cerrar registro</button>
      </div>
    </div>
    <pre ref={pre} tabIndex={0}>{logs.text || 'Sin registros.'}</pre>
  </section>;
}

function ServiceRow({ project, service, busy, loading, logs, run, closeLogs, openExternal, onOpenPanel }) {
  const key = serviceKey(project, service);
  const running = service.status === 'running';
  const actions = running ? [['stop', 'Detener'], ['restart', 'Reiniciar']] : [['start', 'Iniciar']];
  if (service.status !== 'not created') actions.push(['logs', 'Registro']);
  const status = ({ running: 'En marcha', exited: 'Detenido', 'not created': 'Sin crear' })[service.status] || service.status;
  return <div className="sites-service-group">
    <div className="sites-service" aria-busy={busy === key}>
      <div className="sites-service-info">
        <strong>{service.name}</strong>
        <span className={`sites-status${running ? ' is-running' : ''}`}><span aria-hidden="true" className="sites-status-dot" />{status}</span>
        <div className="sites-urls">
          {service.urls.length ? service.urls.map(url => <div className="sites-url" key={url}>
            <span>{url}</span>
            {onOpenPanel && <button className="sites-link" disabled={!!busy || loading} onClick={() => onOpenPanel('browser', { url }, service.name)}>Abrir aquí</button>}
            <button className="sites-link" disabled={!!busy || loading} onClick={() => openExternal(url)} aria-label={`Abrir fuera ${url}`}>Abrir fuera <ExternalLink size={13} /></button>
          </div>) : <small>Sin URL publicada</small>}
        </div>
      </div>
      <div className="sites-actions">
        {busy === key && <span className="sites-progress" role="status">En curso…</span>}
        {actions.map(([action, label]) => <button className="button" key={action} disabled={!!busy || loading}
          onClick={() => run(project, service, action)} aria-label={`${label} ${service.name} en ${project.name}`}>{label}</button>)}
      </div>
    </div>
    {logs?.key === key && <ServiceLog logs={logs} disabled={!!busy || loading}
      onRefresh={() => run(project, service, 'logs')} onClose={closeLogs} />}
  </div>;
}

function ProjectHeading({ project, services }) {
  return <div className="sites-project-heading">
    <div><h2>{project.name}</h2><small className="sites-path" title={project.root}>{project.root}</small></div>
    <span>{summary(services)}</span>
  </div>;
}

export default function GlobalSites({ api, onClose, onOpenPanel, embedded = false }) {
  const [projects, setProjects] = useState(null);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [runningOnly, setRunningOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState(null);
  const root = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!embedded) root.current?.querySelector('[aria-label="Cerrar Sitios"]')?.focus();
  }, [embedded]);
  useEffect(() => {
    const handleKey = event => {
      if (!embedded && event.key === 'Escape' && root.current?.contains(event.target)) {
        event.preventDefault(); event.stopPropagation(); onClose();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [onClose, embedded]);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await api('docker.list', { scope: 'sites' }); setProjects(result.projects); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { refresh(); }, [refresh]);
  const run = async (project, service, action) => {
    const key = serviceKey(project, service);
    setBusy(key); setError('');
    try {
      const payload = { scope: 'sites', workspaceId: project.workspaceId, service: service.name };
      if (action === 'logs') {
        const result = await api('docker.logs', payload);
        setLogs({ key, title: `${project.name} · ${service.name}`, text: result.text });
      } else { await api('docker.action', { ...payload, action }); await refresh(); }
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const query = search.trim().toLocaleLowerCase();
  const visible = (projects || []).filter(p => !filter || p.workspaceId === filter).map(project => {
    const matchesProject = project.name.toLocaleLowerCase().includes(query);
    const services = project.services.filter(s => (!runningOnly || s.status === 'running') && (matchesProject || s.name.toLocaleLowerCase().includes(query)));
    return { project, services, matches: services.length > 0 || (!runningOnly && matchesProject) };
  }).filter(item => item.matches);
  const groups = visible.filter(({ project }) => project.compose || project.error);
  const withoutCompose = visible.filter(({ project }) => !project.compose && !project.error);
  const services = (projects || []).flatMap(p => p.services);
  const clearFilters = () => { setFilter(''); setSearch(''); setRunningOnly(false); };
  return <section ref={root} className={`global-sites${embedded ? ' is-embedded' : ''}`} aria-label="Servicios de todos los proyectos">
    <header className="sites-header">
      <div>{!embedded && <h1>Servicios de todos los proyectos</h1>}<p>{summary(services)} · {projects?.length || 0} proyectos</p></div>
      <div className="sites-header-actions">
        <button className="button" disabled={loading || !!busy} onClick={refresh}><RefreshCw size={15} />{loading ? 'Actualizando…' : 'Actualizar'}</button>
        {!embedded && <button className="icon-button" aria-label="Cerrar Sitios" onClick={onClose}><X size={18} /></button>}
      </div>
    </header>
    <span className="sites-live" aria-live="polite">{projects && (loading ? 'Actualizando servicios.' : 'Servicios actualizados.')}</span>
    <div className="sites-filter">
      <div><label htmlFor={`${id}-project`}>Proyecto</label><select id={`${id}-project`} value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="">Todos los proyectos</option>{(projects || []).map(p => <option key={p.workspaceId} value={p.workspaceId}>{p.name}</option>)}
      </select></div>
      <div><label htmlFor={`${id}-search`}>Buscar</label><input id={`${id}-search`} type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Proyecto o servicio" /></div>
      <button className="button" aria-pressed={runningOnly} onClick={() => setRunningOnly(value => !value)}>Solo en marcha</button>
    </div>
    {error && <p className="sites-error" role="alert">No se pudieron completar los cambios o consultar los servicios: {error}</p>}
    {!projects && !error && <p role="status">Cargando servicios…</p>}
    {projects && !projects.length && <p className="sites-empty">Aún no hay proyectos registrados. Abre una carpeta para comenzar.</p>}
    {projects?.length > 0 && !visible.length && <div className="sites-empty"><p>No hay resultados con estos filtros.</p><button className="button" onClick={clearFilters}>Quitar filtros</button></div>}
    <div className="sites-projects">
      {groups.map(({ project, services: filteredServices }) => <article className="sites-project" key={project.workspaceId}>
        <ProjectHeading project={project} services={project.services} />
        {project.error ? <div className="sites-error"><p>No se pudieron consultar los servicios de este proyecto: {project.error}</p>
          <button className="button" disabled={loading || !!busy} onClick={refresh}>Reintentar</button></div>
          : !project.services.length ? <p className="sites-empty">El archivo Compose no declara servicios.</p>
            : <div className="sites-services">{filteredServices.map(service => <ServiceRow key={service.name}
              project={project} service={service} busy={busy} loading={loading} logs={logs} run={run}
              closeLogs={() => setLogs(null)} onOpenPanel={onOpenPanel}
              openExternal={url => api('desktop.openExternal', { url }).catch(e => setError(e.message))} />)}</div>}
      </article>)}
      {!!withoutCompose.length && <section className="sites-without-compose" aria-label="Sin Compose">
        <h2>Sin Compose</h2><p className="sites-empty">Añade un archivo compose.yaml o compose.yml en la raíz para gestionar los servicios.</p>
        <ul>{withoutCompose.map(({ project }) => <li key={project.workspaceId}><strong>{project.name}</strong><small className="sites-path" title={project.root}>{project.root}</small></li>)}</ul>
      </section>}
    </div>
  </section>;
}
