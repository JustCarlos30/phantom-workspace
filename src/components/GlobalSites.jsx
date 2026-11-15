import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import '../sites.css';

export default function GlobalSites({ api, onClose, embedded = false }) {
  const [projects, setProjects] = useState(null), [filter, setFilter] = useState(''), [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [logs, setLogs] = useState(null);
  const root = useRef(null);
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
    const key = `${project.workspaceId}:${service.name}`; setBusy(key); setError('');
    try {
      const payload = { scope: 'sites', workspaceId: project.workspaceId, service: service.name };
      if (action === 'logs') { const result = await api('docker.logs', payload); setLogs({ title: `${project.name} · ${service.name}`, text: result.text }); }
      else { await api('docker.action', { ...payload, action }); await refresh(); }
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const visible = (projects || []).filter(p => !filter || p.workspaceId === filter);
  return <section ref={root} className={`global-sites${embedded ? ' is-embedded' : ''}`} aria-label="Servicios de todos los proyectos">
    <header className="sites-header"><div>{!embedded && <h1>Servicios de todos los proyectos</h1>}<p>Lo que declara el archivo Compose de cada proyecto.</p></div><div className="sites-header-actions"><button className="button" disabled={loading || !!busy} onClick={refresh}><RefreshCw size={15} /> Actualizar</button>{!embedded && <button className="icon-button" aria-label="Cerrar Sitios" onClick={onClose}><X size={18} /></button>}</div></header>
    <div className="sites-filter"><label htmlFor="sites-project">Proyecto</label><select id="sites-project" value={filter} onChange={e => setFilter(e.target.value)}><option value="">Todos los proyectos</option>{(projects || []).map(p => <option key={p.workspaceId} value={p.workspaceId}>{p.name}</option>)}</select></div>
    {error && <p className="sites-error" role="alert">{error}</p>}
    {loading && <p role="status">Actualizando sitios…</p>}
    {projects && !projects.length && <p className="sites-empty">Aún no hay proyectos registrados. Abre una carpeta para comenzar.</p>}
    <div className="sites-projects">{visible.map(project => <article className="sites-project" key={project.workspaceId}><div className="sites-project-heading"><div><h2>{project.name}</h2><small>{project.root}</small></div>{project.project && <span>Compose · {project.project}</span>}</div>
      {project.error ? <p className="sites-error" role="status">No se pudo consultar Docker o Compose: {project.error}</p> : !project.compose ? <p className="sites-empty">No se encontró un archivo Compose en la raíz. Añade compose.yaml o compose.yml al proyecto para gestionar sus servicios aquí.</p> : !project.services.length ? <p className="sites-empty">Compose no declara servicios.</p> : <div className="sites-services">{project.services.map(service => <div className="sites-service" key={service.name}><div className="sites-service-info"><strong>{service.name}</strong><span className="sites-status">{({ running: 'En marcha', exited: 'Detenido', 'not created': 'Sin crear' })[service.status] || service.status}</span><div className="sites-urls">{service.urls.length ? service.urls.map(url => <button key={url} className="sites-link" onClick={() => api('desktop.openExternal', { url }).catch(e => setError(e.message))}>{url} <ExternalLink size={13} /></button>) : <small>Sin URL HTTP publicada o identificable</small>}</div></div><div className="sites-actions">{[['start', 'Iniciar'], ['stop', 'Detener'], ['restart', 'Reiniciar'], ['logs', 'Logs']].map(([action, label]) => <button className="button" key={action} disabled={!!busy || loading} onClick={() => run(project, service, action)} aria-label={`${label} ${service.name} en ${project.name}`}>{busy === `${project.workspaceId}:${service.name}` ? 'Espera…' : label}</button>)}</div></div>)}</div>}
    </article>)}</div>
    {logs && <section className="sites-logs" aria-label={`Logs de ${logs.title}`}><div><h2>Logs · {logs.title}</h2><button className="icon-button" aria-label="Cerrar logs" onClick={() => setLogs(null)}><X size={16} /></button></div><pre>{logs.text || 'Sin registros.'}</pre></section>}
  </section>;
}
