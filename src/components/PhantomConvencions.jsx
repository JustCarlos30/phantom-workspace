import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, ListChecks, RefreshCw } from 'lucide-react';
import EmptyState from './EmptyState.jsx';
import { Button, Field, ErrorNotice, useResource } from './PluginPrimitives';
import { CONVENCION_STATES, filterConvencions, validateConvencionsSnapshot } from '../../shared/convencions.mjs';
import '../convencions.css';

const scopes = { project: 'Proyecto', path: 'Ruta', file: 'Archivo' };
const checks = { not_run: 'Sin ejecutar', passed: 'Superada', failed: 'Fallida', unavailable: 'No disponible' };
function Sources({ items }) {
  return items.length ? <ul className="cv-sources">{items.map((source, index) => <li key={index}><strong>{source.label}</strong><span>{source.reference}</span><small>Observada: {source.observedAt}</small></li>)}</ul> : <p className="tw-muted">Sin fuentes declaradas.</p>;
}
function Detail({ item, onClose }) {
  return <article className="cv-detail" aria-label="Detalle de convención">
    <div className="tw-heading"><h3>{item.title}</h3><Button onClick={onClose}>Cerrar detalle</Button></div>
    <p>{CONVENCION_STATES[item.state]} · {scopes[item.scope.kind]}: {item.scope.target}</p>
    {item.state === 'observed' && <p>Patrón con evidencia. No constituye una obligación.</p>}
    {item.state === 'proposed' && <p>Propuesta pendiente de adopción explícita.</p>}
    {item.state === 'adopted' && <p>Obligación vigente en el alcance declarado por la fuente.</p>}
    {Object.entries({ Qué: item.what, Cuándo: item.when, 'Por qué': item.why, 'Cómo comprobar': item.verification }).map(([label, value]) => <section key={label}><h4>{label}</h4><p>{value}</p></section>)}
    {item.exception && <section><h4>Excepción y motivo</h4><p>{item.exception.reason}</p><p>Hasta: {item.exception.until || 'Sin fecha de fin declarada'}</p></section>}
    <section><h4>Fuentes y evidencia</h4><Sources items={item.sources} /></section>
    <small>Identidad Phantom: {item.id}</small>
  </article>;
}

export function PhantomConvencions({ type, workspace, api, onOpenPanel }) {
  const baseView = type === 'convencions-base';
  // PluginPanels remounts by workspace + node. useResource also invalidates its
  // sequence on cleanup, so old project responses never populate the new view.
  const read = useCallback(async (method, payload) => validateConvencionsSnapshot(await api(method, payload), workspace), [api, workspace.id, workspace.canonicalPath, workspace.path]);
  const resource = useResource(read, 'plugins.status', { workspaceId: workspace.id, id: 'convencions' });
  const [baseId, setBaseId] = useState(''), [versionId, setVersionId] = useState('');
  const [query, setQuery] = useState(''), [state, setState] = useState('all'), [scope, setScope] = useState('all'), [selectedId, setSelectedId] = useState(null);
  const snapshot = resource.data;
  const ready = !resource.loading && !resource.error && snapshot?.state === 'ready';
  const base = baseId ? snapshot?.bases.find(item => item.id === baseId) : snapshot?.bases[0];
  // No "latest" fallback: absent selection starts at the first source-ordered
  // version, explicitly labelled. Reading never updates the project's pin.
  const version = versionId ? base?.versions.find(item => item.version === versionId) : base?.versions[0];
  useEffect(() => {
    if (!ready) return;
    if (!baseId && base) setBaseId(base.id);
    if (!versionId && version) setVersionId(version.version);
  }, [ready, baseId, versionId, base?.id, version?.version]);
  const project = snapshot?.project;
  const items = ready ? (baseView ? version?.conventions || [] : project?.conventions || []) : [];
  const filtered = filterConvencions(items, { query, state, scope });
  const selected = filtered.find(item => item.id === selectedId);
  const Icon = baseView ? BookOpen : ListChecks;
  const navigate = () => onOpenPanel?.(baseView ? 'convencions-project' : 'convencions-base', { pluginId: 'convencions', panelId: baseView ? 'project' : 'base' });
  return <section className="convencions tw-content" aria-label={baseView ? 'Base madre de Convencions' : 'Integración de Convencions'} aria-busy={resource.loading}>
    <header className="tw-heading cv-heading"><h2><Icon size={18} strokeWidth={1.75} aria-hidden="true" />{baseView ? 'Base madre / versiones' : 'Proyecto / integración'}</h2><Button icon={RefreshCw} onClick={resource.reload} disabled={resource.loading}>Reintentar lectura</Button></header>
    <p className="cv-authority">Autoridad: Phantom · Solo lectura · Contrato v1</p>
    <p className="cv-repository">Repositorio: {workspace.canonicalPath || workspace.path}</p>
    <nav className="tw-row" aria-label="Vistas de Convencions"><Button onClick={navigate}>{baseView ? 'Ver Proyecto / integración' : 'Ver Base madre / versiones'}</Button><Button onClick={() => onOpenPanel?.('plugins')}>Configurar en Centro</Button></nav>
    <p className="cv-semantics">Adoptada: obligación vigente. Observada: patrón con evidencia, sin obligación. Propuesta: pendiente de adopción. Exceptuada: excepción con motivo.</p>
    <p>Registrar identifica el repositorio; integrar fija base, versión y perfil mediante una decisión explícita. Consultar otra versión no cambia la integración.</p>
    {resource.loading && <p role="status">Cargando Convencions…</p>}
    <ErrorNotice error={resource.error} retry={resource.reload} />
    {!resource.loading && !resource.error && snapshot?.state !== 'ready' && <EmptyState icon={Icon} title={snapshot?.state === 'disabled' ? 'Plugin desactivado' : 'Backend aún no disponible'} description={snapshot?.reason || 'No se recibió una capacidad de lectura.'} actions={<Button onClick={resource.reload}>Reintentar</Button>} />}
    {ready && <>
      <p className="cv-freshness" role="status">Lectura disponible · Observada: {snapshot.observedAt}</p>
      {baseView ? <section className="cv-context" aria-label="Base y versión consultadas">
        <p>Los estados del catálogo pertenecen a la base consultada. No declaran adopción por este repositorio; sus obligaciones se consultan en Proyecto / integración.</p>
        <div className="cv-selectors"><Field label="Base madre"><select value={baseId || base?.id || ''} onChange={event => { setBaseId(event.target.value); setVersionId(''); setSelectedId(null); }}><option value="" disabled>Sin bases</option>{baseId && !base && <option value={baseId} disabled>Base no disponible: {baseId}</option>}{snapshot.bases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Versión consultada" hint="Selección de lectura, sin adopción ni actualización del proyecto."><select value={versionId || version?.version || ''} onChange={event => { setVersionId(event.target.value); setSelectedId(null); }}><option value="" disabled>Sin versiones</option>{versionId && !version && <option value={versionId} disabled>Versión no disponible: {versionId}</option>}{base?.versions.map(item => <option key={item.version} value={item.version}>{item.version}</option>)}</select></Field></div>
        {version && <><p>{version.description}</p><small>Publicada: {version.publishedAt}</small></>}
        {(baseId && !base || versionId && !version) ? <p role="status">La base o versión consultada ya no está en esta lectura. Selecciona otra explícitamente; no se ha sustituido ni actualizado la integración.</p> : !base && <EmptyState icon={BookOpen} description="La fuente no tiene bases madre registradas." />}
      </section> : <section className="cv-context" aria-label="Estado de integración">
        <h3>Registro e integración</h3>
        {!project ? <EmptyState icon={ListChecks} title="Repositorio sin registrar" description="La fuente no declara registro ni integración para este repositorio." /> : <>
          <p>Registrado: {project.registration.registeredAt} · Fuente: {project.registration.source}</p>
          {!project.integration ? <p>Sin integración. Registrar no implica adoptar convenciones.</p> : <dl className="cv-metadata"><dt>Base fijada</dt><dd>{project.integration.baseId}</dd><dt>Versión fijada</dt><dd>{project.integration.version}</dd><dt>Perfil</dt><dd>{project.integration.profile}</dd><dt>Integrada</dt><dd>{project.integration.integratedAt}</dd><dt>Motivo</dt><dd>{project.integration.reason}</dd></dl>}
        </>}
        <p className="tw-muted">Registro, integración, adopción y cambios de versión requieren operaciones backend explícitas. Este adaptador solo permite lectura.</p>
      </section>}
      <section className="cv-index" aria-label="Índice de convenciones">
        <h3>{baseView ? 'Convenciones de la versión consultada' : 'Convenciones efectivas y estados del proyecto'}</h3>
        <div className="cv-filters"><Field label="Buscar convenciones"><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Texto, motivo, ruta o evidencia" /></Field><Field label="Estado"><select value={state} onChange={event => setState(event.target.value)}><option value="all">Todos los estados</option>{Object.entries(CONVENCION_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Alcance"><select value={scope} onChange={event => setScope(event.target.value)}><option value="all">Todos los alcances</option>{Object.entries(scopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
        <p role="status">{filtered.length} de {items.length} convenciones</p>
        {!items.length ? <EmptyState icon={Icon} description={baseView ? 'No hay convenciones en esta versión.' : 'No hay convenciones efectivas declaradas para este repositorio.'} /> : !filtered.length ? <EmptyState icon={Icon} description="Ninguna convención coincide con los filtros." actions={<Button onClick={() => { setQuery(''); setState('all'); setScope('all'); }}>Limpiar filtros</Button>} /> : <div className="cv-reading"><ul className="cv-list">{filtered.map(item => <li key={item.id}><button type="button" aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><strong>{item.title}</strong><span>{CONVENCION_STATES[item.state]} · {scopes[item.scope.kind]}: {item.scope.target}</span></button></li>)}</ul>{selected && <Detail key={selected.id} item={selected} onClose={() => setSelectedId(null)} />}</div>}
      </section>
      {!baseView && project && <>
        <section className="cv-decisions"><h3>Decisiones y adaptaciones</h3>{!project.decisions.length ? <p>Sin decisiones declaradas.</p> : project.decisions.map(item => <article key={item.id}><h4>{item.title}</h4><p>{item.kind === 'adaptation' ? 'Adaptación' : 'Decisión'} · {item.at} · {scopes[item.scope.kind]}: {item.scope.target}</p><p>{item.reason}</p><Sources items={item.sources} /></article>)}</section>
        <section className="cv-checks"><h3>Comprobaciones</h3>{!project.checks.length ? <p>Sin comprobaciones declaradas. La lectura no ejecuta checks.</p> : project.checks.map(item => <article key={item.id}><h4>{item.title} · {checks[item.status]}</h4><p>{item.detail}</p><p>{item.at || 'Sin ejecución observada'}</p><Sources items={item.sources} /></article>)}</section>
      </>}
    </>}
  </section>;
}
