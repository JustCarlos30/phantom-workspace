import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, ExternalLink, FileText, GitBranch, Lock, Plus, RefreshCw, Search, X } from 'lucide-react';
import { PANEL_ICONS } from './PanelIcons';
import { Button, Field, ErrorNotice, DataView, useResource, useOperation } from './PluginPrimitives';
import { Markdown } from './SkillsMarkdown';
import '../skills.css';
import { itemsOf, linesOf, refOf } from '../hooks/plugin-model.mjs';
const unavailableReason = reason => reason?.replace(/^Phantom unavailable: /, '') || 'sin motivo informado';

const SkillsIcon = PANEL_ICONS['phantom-skills'];

const exactRef = value => {
  const ref = refOf(value) || value;
  return ref && ['id', 'scope', 'version', 'sha256'].every(key => typeof ref[key] === 'string' && ref[key])
    ? { id: ref.id, scope: ref.scope, version: ref.version, sha256: ref.sha256 } : null;
};
const refKey = ref => ref ? JSON.stringify([ref.scope, ref.id, ref.version, ref.sha256]) : '';
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const sourceText = value => typeof value === 'string' ? value : value ? JSON.stringify(value) : 'Phantom';

export function SkillForm({ existing, mode = 'create', workspace, api, notify, onSaved, onClose }) {
  const manifest = existing?.manifest || {};
  const originalRef = exactRef(existing);
  const updating = mode === 'version', copying = mode === 'copy';
  const [form, setForm] = useState(() => ({
    id: copying ? '' : manifest.id || '', version: updating ? '' : copying ? '1.0.0' : manifest.version || '1.0.0',
    description: manifest.description || '', body: manifest.body || '',
    actions: (manifest.actions || []).join('\n'), tools: (manifest.requiresTools || []).join('\n'),
    resources: (manifest.resources || []).map(resource => ({ name: resource.name || '', mediaType: resource.mediaType || 'text/plain', content: resource.content ?? '' })),
  }));
  const [result, setResult] = useState(null);
  const op = useOperation(notify);
  const patch = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const resourcePatch = (index, key, value) => patch('resources', form.resources.map((resource, i) => i === index ? { ...resource, [key]: value } : resource));
  const submit = event => {
    event.preventDefault();
    op.run(async () => {
      const id = form.id.trim(), version = form.version.trim();
      if (!id || !semver.test(version)) throw new Error('Indica una identidad y una versión semver válida.');
      if (!form.description.trim() || !form.body.trim() || !linesOf(form.actions).length) throw new Error('Completa descripción, acciones e instrucciones.');
      if (updating && (!originalRef || originalRef.scope === 'global' || id !== originalRef.id || version === originalRef.version)) throw new Error('La nueva versión requiere la misma identidad de proyecto y una versión distinta de la revisión leída.');
      if (copying && id === originalRef?.id) throw new Error('La copia a proyecto requiere una identidad nueva y explícita.');
      const names = new Set();
      const resources = form.resources.map(resource => {
        const name = resource.name.trim(), mediaType = resource.mediaType.trim();
        if (!name || !mediaType || names.has(name)) throw new Error('Cada recurso requiere nombre único y tipo de contenido.');
        names.add(name);
        return { name, mediaType, content: resource.content };
      });
      const input = { ...manifest, id, version, description: form.description.trim(), actions: linesOf(form.actions), body: form.body, requiresTools: linesOf(form.tools), resources };
      const value = await api(updating ? 'phantom.update' : 'phantom.create', {
        workspaceId: workspace.id, pluginId: 'phantom', kind: 'skill', input,
        ...(updating ? { id: originalRef.id, ref: originalRef, revision: originalRef.version } : {}),
      });
      setResult(value);
      onSaved?.(value);
    }, updating ? 'Nueva versión publicada en Phantom' : 'Skill publicada en el proyecto');
  };
  return <section className="plugin-skill-form pc-sheet pc-form" aria-label={updating ? 'Publicar nueva versión' : copying ? 'Copiar a proyecto' : 'Nueva Skill'}>
    <header className="pc-form-head"><div><h3>{updating ? 'Publicar nueva versión' : copying ? 'Copiar a proyecto' : 'Nueva Skill'}</h3>
      <p>{existing ? (copying ? `Se publicará una Skill de proyecto con identidad nueva a partir de ${originalRef?.id} ${originalRef?.version}.` : `Se publicará una versión inmutable; la revisión ${originalRef?.version} se conserva.`) : 'Phantom valida el manifiesto y calcula los hashes al publicar.'}</p></div>
      <button type="button" className="pc-icon" aria-label="Cerrar formulario de Skill" disabled={op.busy} onClick={onClose}><X size={15} /></button></header>
    <form className="plugin-form tw-form" onSubmit={submit}><fieldset disabled={op.busy || Boolean(result)}>
      <div className="pc-form-pair">
        <Field label="ID de Skill" hint={copying ? 'Distinta de la global, por ejemplo proyecto/mi-skill.' : 'Identidad nativa, por ejemplo proyecto/mi-skill.'}><input className="pc-mono" required readOnly={updating} value={form.id} onChange={e => patch('id', e.target.value)} /></Field>
        <Field label="Versión semver" hint={updating ? `Revisión leída: ${originalRef?.version}. Introduce una versión diferente.` : 'Por ejemplo 1.0.0.'}><input className="pc-mono" required value={form.version} onChange={e => patch('version', e.target.value)} /></Field>
      </div>
      <Field label="Descripción"><textarea required rows={2} value={form.description} placeholder="Cuándo debe usarse y qué produce" onChange={e => patch('description', e.target.value)} /></Field>
      <div className="pc-form-pair">
        <Field label="Acciones · una por línea"><textarea className="pc-mono" required rows={3} value={form.actions} onChange={e => patch('actions', e.target.value)} /></Field>
        <Field label="Herramientas requeridas · una por línea"><textarea className="pc-mono" rows={3} value={form.tools} onChange={e => patch('tools', e.target.value)} /></Field>
      </div>
      <Field label="Instrucciones (body)" hint="Markdown. Se mostrará formateado en la biblioteca."><textarea className="pc-mono" required rows={9} value={form.body} onChange={e => patch('body', e.target.value)} /></Field>
      <div className="pc-form-group"><h4>Recursos</h4>{!form.resources.length && <EmptyState size="compact" description="Sin recursos adjuntos." />}
        {form.resources.map((resource, index) => <section className="plugin-resource pc-check-edit" key={index} aria-label={`Recurso ${index + 1}`}>
          <div className="pc-form-pair">
            <Field label={`Nombre del recurso ${index + 1}`}><input required value={resource.name} onChange={e => resourcePatch(index, 'name', e.target.value)} /></Field>
            <Field label={`Tipo de contenido del recurso ${index + 1}`}><input required placeholder="text/plain" value={resource.mediaType} onChange={e => resourcePatch(index, 'mediaType', e.target.value)} /></Field>
          </div>
          <Field label={`Contenido del recurso ${index + 1}`}><textarea className="pc-mono" rows={4} value={resource.content} onChange={e => resourcePatch(index, 'content', e.target.value)} /></Field>
          <Button onClick={() => patch('resources', form.resources.filter((_, i) => i !== index))}>Quitar recurso {index + 1}</Button>
        </section>)}
        <Button icon={Plus} onClick={() => patch('resources', [...form.resources, { name: '', mediaType: 'text/plain', content: '' }])}>Añadir recurso</Button></div>
    </fieldset>
      <div className="pc-form-actions"><Button type="submit" tone="primary" disabled={op.busy || Boolean(result)}>{updating ? 'Publicar nueva versión' : copying ? 'Publicar copia en proyecto' : 'Publicar Skill'}</Button><Button disabled={op.busy} onClick={onClose}>Cerrar formulario</Button></div>
    </form>
    <ErrorNotice error={op.error} clear={op.clear} />{op.busy && <p role="status" className="pc-status">Publicando…</p>}
    {result && <><p role="status" className="pc-status is-ok">Publicación guardada en Phantom.</p><DataView value={result} label="Ver respuesta de Phantom" /></>}
  </section>;
}

function SkillDetail({ selection, workspace, api, notify, onOpenPanel, onPublished, onClose }) {
  const requestedRef = exactRef(selection);
  const detail = useResource(api, 'phantom.detail', { workspaceId: workspace.id, pluginId: 'phantom', topic: 'skills', id: selection.id, ...(requestedRef ? { ref: requestedRef } : {}) });
  const [editor, setEditor] = useState(null), [openResource, setOpenResource] = useState(null);
  const native = detail.data, manifest = native?.manifest, ref = exactRef(native);
  const valid = manifest && ref && native.available !== false && !detail.error;
  const name = ref?.id || selection.id;
  const copyRef = async () => {
    try { await navigator.clipboard.writeText(`${ref.scope}/${ref.id}@${ref.version}#${ref.sha256}`); notify?.('Referencia exacta copiada'); }
    catch (error) { notify?.(`No se pudo copiar: ${error.message}`, 'error'); }
  };
  return <article className="sk-detail plugin-detail" aria-label={`Detalle de Skill ${selection.id}`}>
    <header className="sk-detail-head">
      <button type="button" className="sk-icon sk-back" aria-label="Volver a la biblioteca" onClick={onClose}><ArrowLeft size={15} /></button>
      <span className="sk-mono sk-phantom is-large" aria-hidden="true">{(name.split('/').pop()[0] || '?').toUpperCase()}</span>
      <div className="sk-detail-title"><h3>{name}</h3>
        <div className="sk-detail-tags">{ref && <span className="sk-pill sk-phantom"><i />{ref.scope === 'global' ? 'Global · solo lectura' : 'Proyecto'}</span>}{ref && <span className="sk-tag">v{ref.version}</span>}{sourceText(native?.source).toLowerCase() !== 'phantom' && <span className="sk-tag">{sourceText(native?.source)}</span>}</div></div>
      <button type="button" className="sk-icon" aria-label="Actualizar detalle" title="Actualizar" onClick={detail.reload}><RefreshCw size={14} className={detail.loading ? 'spinning' : ''} /></button>
      <button type="button" className="sk-icon sk-close" aria-label="Cerrar detalle" onClick={onClose}><X size={15} /></button>
    </header>
    {detail.loading && !native && <div className="sk-skeleton" role="status" aria-label="Leyendo Skill"><i /><i /><i /></div>}
    {detail.error && <ErrorNotice error={detail.error} retry={detail.reload} />}
    {native?.available === false && <p className="sk-notice">Phantom no está disponible: {unavailableReason(native.reason)}.</p>}
    {native && native.available !== false && !detail.loading && !detail.error && !valid && <ErrorNotice error="La fuente no devolvió manifiesto y referencia exacta válidos. Actualiza el detalle." retry={detail.reload} />}
    {valid && <>
      {manifest.description && <p className="sk-lede">{manifest.description}</p>}
      <div className="pc-sheet-actions">
        {ref.scope === 'global'
          ? <Button icon={Lock} aria-expanded={editor?.mode === 'copy'} onClick={() => setEditor(editor ? null : { mode: 'copy', existing: native })}>Copiar a proyecto</Button>
          : <Button tone="primary" icon={GitBranch} aria-expanded={editor?.mode === 'version'} onClick={() => setEditor(editor ? null : { mode: 'version', existing: native })}>Preparar nueva versión</Button>}
        {onOpenPanel && <Button icon={ExternalLink} onClick={() => onOpenPanel('phantom-skills', { pluginId: 'phantom', panelId: 'skills', skillId: ref.id, ref }, manifest.description || ref.id)}>Abrir referencia exacta en otro panel</Button>}
      </div>
      {editor && <SkillForm key={`${refKey(exactRef(editor.existing))}:${editor.mode}`} existing={editor.existing} mode={editor.mode} workspace={workspace} api={api} notify={notify} onSaved={onPublished} onClose={() => setEditor(null)} />}
      <dl className="sk-facts">
        <div className="sk-fact"><dt>Herramientas</dt><dd>{manifest.requiresTools?.length ? manifest.requiresTools.join(', ') : 'No declaradas'}</dd></div>
        <div className="sk-fact"><dt>Recursos</dt><dd>{manifest.resources?.length ? `${manifest.resources.length} ${manifest.resources.length === 1 ? 'adjunto' : 'adjuntos'}` : 'Sin recursos'}</dd></div>
        <div className="sk-fact"><dt>Referencia exacta</dt><dd><span className="sk-path plugin-identity" title={ref.sha256}>{ref.id} · {ref.version} · {ref.sha256.slice(0, 12)}…</span><button type="button" className="sk-icon" aria-label="Copiar referencia exacta" title="Copiar referencia exacta" onClick={copyRef}><Copy size={13} /></button></dd></div>
      </dl>
      {manifest.actions?.length > 0 && <section><h4 className="sk-section-title">Acciones</h4><div className="sk-actions">{manifest.actions.map((action, i) => <span key={i} className="sk-chip">{action}</span>)}</div></section>}
      <section className="sk-instructions" aria-label="Instrucciones"><h4 className={`sk-section-title${/^\s*#/.test(manifest.body || '') ? ' sk-hidden' : ''}`}>Instrucciones</h4><Markdown source={manifest.body} /></section>
      {manifest.resources?.length > 0 && <section className="pc-resource-section"><h4 className="sk-section-title">Recursos</h4><ul className="pc-resources">{manifest.resources.map((resource, index) => {
        const open = openResource === index;
        return <li key={`${resource.name}:${index}`}><button type="button" className="sk-disclosure" aria-expanded={open} onClick={() => setOpenResource(open ? null : index)}><FileText size={13} />{resource.name}<span>{resource.mediaType}</span></button>
          {open && (/markdown/.test(resource.mediaType || '') || /\.md$/.test(resource.name) ? <div className="pc-resource-body"><Markdown source={String(resource.content ?? '')} /></div> : <pre className="pc-output">{typeof resource.content === 'string' ? resource.content : JSON.stringify(resource.content, null, 2)}</pre>)}</li>;
      })}</ul></section>}
      <div className="pc-source"><DataView value={native} label="Ver fuente nativa" /></div>
    </>}
  </article>;
}

export function PhantomSkills({ workspace, api, refresh, notify, onOpenPanel, node, plugin }) {
  const initialRef = exactRef(node?.data?.ref);
  const root = useRef(null);
  const [selected, setSelected] = useState(() => initialRef || (node?.data?.skillId ? { id: node.data.skillId } : null));
  const [query, setQuery] = useState(''), [allVersions, setAllVersions] = useState(false), [creating, setCreating] = useState(false), [scope, setScope] = useState('all');
  const [wide, setWide] = useState(true);
  const nodeRefKey = refKey(initialRef);
  useEffect(() => {
    setSelected(initialRef || (node?.data?.skillId ? { id: node.data.skillId } : null));
    setCreating(false);
  }, [workspace?.id, nodeRefKey, node?.data?.skillId]);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 720));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const source = useResource(api, 'phantom.list', { workspaceId: workspace?.id, pluginId: 'phantom', topic: 'skills', allVersions }, { enabled: Boolean(workspace?.id) });
  const items = itemsOf(source.data);
  const text = query.trim().toLowerCase();
  const scoped = items.filter(item => scope === 'all' || (scope === 'global' ? item.ref?.scope === 'global' : item.ref?.scope !== 'global'));
  const filtered = scoped.filter(item => `${item.id || ''} ${item.title || ''} ${item.raw?.description || ''} ${item.ref?.scope || ''} ${item.ref?.version || ''}`.toLowerCase().includes(text));
  const counts = { all: items.length, workspace: items.filter(item => item.ref?.scope !== 'global').length, global: items.filter(item => item.ref?.scope === 'global').length };
  const published = value => {
    const ref = exactRef(value);
    if (ref) { setSelected(ref); setCreating(false); }
    source.reload();
    Promise.resolve().then(() => refresh?.()).catch(error => notify?.(`Publicación guardada; no se pudo actualizar el workspace: ${error.message}`, 'error'));
  };
  if (!workspace?.id) return <EmptyState className="plugin-empty tw-empty" description="Selecciona un proyecto." />;
  const unavailable = source.data?.available === false;
  const side = creating || selected;
  const showList = wide || !side;
  return <div ref={root} className={`plugin-skills sk-root${wide ? ' is-wide' : ''}${side ? ' has-detail' : ''}`}>
    <header className="sk-head">
      <div className="sk-title"><SkillsIcon size={16} /><div><h2>Biblioteca de Skills · Phantom</h2><p>{source.loading && !source.data ? 'Leyendo Phantom…' : `${counts.all} ${allVersions ? 'revisiones' : 'Skills'} · ${counts.workspace} de proyecto, ${counts.global} globales`}</p></div></div>
      <div className="pc-head-actions">
        <button type="button" className="sk-icon" aria-label="Actualizar biblioteca" title="Actualizar" disabled={source.loading} onClick={source.reload}><RefreshCw size={14} className={source.loading ? 'spinning' : ''} /></button>
        <Button tone="primary" icon={Plus} aria-expanded={creating} onClick={() => { setCreating(old => !old); setSelected(null); }}>Nueva Skill</Button>
      </div>
    </header>
    <div className="sk-toolbar">
      <div className="sk-segments" role="tablist" aria-label="Alcance">{[['all', 'Todas'], ['workspace', 'Proyecto'], ['global', 'Globales']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={scope === key} className="sk-segment" onClick={() => setScope(key)}>{label}<span>{counts[key]}</span></button>)}</div>
      <label className="sk-search"><Search size={13} /><input type="search" aria-label="Buscar Skills por ID, descripción, scope o versión" placeholder="Buscar Skills…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }} /></label>
      <label className="pc-select"><span aria-hidden="true">Versiones</span><select aria-label="Historial de versiones" value={allVersions ? 'all' : 'latest'} onChange={e => setAllVersions(e.target.value === 'all')}><option value="latest">Versiones actuales</option><option value="all">Todas las versiones</option></select></label>
    </div>
    {plugin?.enabled === false && <p className="sk-notice">Activa Phantom en el Centro de Plugins para publicar.</p>}
    <div className="sk-body">
      {showList && <nav className="sk-list" aria-label="Skills de Phantom">
        {source.error && <ErrorNotice error={source.error} retry={source.reload} />}
        {unavailable && <p className="sk-notice">Phantom no está disponible: {unavailableReason(source.data.reason)}.</p>}
        {source.data && !unavailable && !Array.isArray(source.data.items) && <ErrorNotice error="La fuente no devolvió una biblioteca válida." retry={source.reload} />}
        {source.loading && !source.data && <div className="sk-skeleton is-list" role="status" aria-label="Leyendo Skills"><i /><i /><i /></div>}
        {source.data && !source.loading && !source.error && !unavailable && Array.isArray(source.data.items) && !items.length && <EmptyState className="sk-empty" icon={SkillsIcon} title="No hay Skills nativas disponibles." description="Publica la primera Skill del proyecto: instrucciones versionadas que cualquier agente puede cargar." actions={<Button tone="primary" icon={Plus} onClick={() => setCreating(true)}>Publicar la primera Skill</Button>} />}
        {items.length > 0 && !filtered.length && <EmptyState className="sk-empty" icon={Search} title="Sin resultados para esta búsqueda." actions={<button type="button" className="sk-link-button" onClick={() => { setQuery(''); setScope('all'); }}>Limpiar filtros</button>} />}
        {filtered.length > 0 && <div className="plugin-skill-list">{filtered.map((item, index) => {
          const ref = exactRef(item);
          const active = Boolean(ref && refKey(exactRef(selected)) === refKey(ref));
          const id = ref?.id || item.id;
          return <button type="button" className={`plugin-skill sk-row${active ? ' is-active' : ''}`} key={ref ? refKey(ref) : `${item.id}:${index}`} disabled={!ref} aria-pressed={active} onClick={() => { setSelected(ref); setCreating(false); }}>
            <span className={`sk-mono sk-phantom`} aria-hidden="true">{(String(id).split('/').pop()[0] || '?').toUpperCase()}</span>
            <span className="sk-row-main">
              <span className="sk-row-title"><strong>{id}</strong>{ref?.version && <span className="sk-tag">v{ref.version}</span>}</span>
              <span className="sk-row-desc">{item.raw?.description || (item.title !== id ? item.title : '') || 'Sin descripción declarada.'}</span>
              <span className="sk-row-meta"><span className="sk-chip">{ref?.scope === 'global' ? 'Global' : ref?.scope ? 'Proyecto' : 'Alcance no informado'}</span>{!ref && <span className="sk-chip is-copy">Referencia exacta no disponible</span>}</span>
            </span>
          </button>;
        })}</div>}
      </nav>}
      {creating ? <div className="sk-detail"><SkillForm key={workspace.id} workspace={workspace} api={api} notify={notify} onSaved={published} onClose={() => setCreating(false)} /></div>
        : selected ? <SkillDetail key={`${workspace.id}:${refKey(exactRef(selected)) || selected.id}`} selection={selected} workspace={workspace} api={api} notify={notify} onOpenPanel={onOpenPanel} onPublished={published} onClose={() => setSelected(null)} />
        : wide && items.length > 0 && <EmptyState className="sk-placeholder" icon={SkillsIcon} description="Elige una Skill para leer sus instrucciones, recursos y versiones." />}
    </div>
  </div>;
}
import EmptyState from './EmptyState.jsx';
