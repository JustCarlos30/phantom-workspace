import React, { useEffect, useState } from 'react';
import { Button, Field, ErrorNotice, DataView, ResourceState, useResource, useOperation } from './PluginPrimitives';
import { itemsOf, linesOf, refOf } from '../hooks/plugin-model.mjs';

const exactRef = value => {
  const ref = refOf(value) || value;
  return ref && ['id', 'scope', 'version', 'sha256'].every(key => typeof ref[key] === 'string' && ref[key])
    ? { id: ref.id, scope: ref.scope, version: ref.version, sha256: ref.sha256 } : null;
};
const refKey = ref => ref ? JSON.stringify([ref.scope, ref.id, ref.version, ref.sha256]) : '';
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const sourceText = value => typeof value === 'string' ? value : value ? JSON.stringify(value) : 'Phantom';

function SkillForm({ existing, mode = 'create', workspace, api, notify, onSaved, onClose }) {
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
  return <section className="plugin-skill-form tw-section">
    <h3>{updating ? 'Publicar nueva versión' : copying ? 'Copiar a proyecto' : 'Nueva Skill'}</h3>
    {existing && <><p>{copying ? 'Se publicará una Skill de proyecto con identidad nueva.' : 'Se publicará una versión inmutable; la revisión original se conserva.'}</p><DataView value={originalRef} label="Referencia exacta de origen" /></>}
    <form className="plugin-form tw-form" onSubmit={submit}><fieldset disabled={op.busy || Boolean(result)}>
      <Field label="ID de Skill" hint={copying ? 'Elige una identidad distinta de la global, por ejemplo proyecto/mi-skill.' : 'Identidad nativa, por ejemplo proyecto/mi-skill.'}><input required readOnly={updating} value={form.id} onChange={e => patch('id', e.target.value)} /></Field>
      <Field label="Versión semver" hint={updating ? `Revisión leída: ${originalRef?.version}. Introduce una versión diferente.` : 'Por ejemplo 1.0.0.'}><input required value={form.version} onChange={e => patch('version', e.target.value)} /></Field>
      <Field label="Descripción"><textarea required rows={2} value={form.description} onChange={e => patch('description', e.target.value)} /></Field>
      <Field label="Acciones · una por línea"><textarea required rows={3} value={form.actions} onChange={e => patch('actions', e.target.value)} /></Field>
      <Field label="Instrucciones (body)"><textarea required rows={10} value={form.body} onChange={e => patch('body', e.target.value)} /></Field>
      <Field label="Herramientas requeridas · una por línea"><textarea rows={3} value={form.tools} onChange={e => patch('tools', e.target.value)} /></Field>
      <h4>Recursos</h4>
      {form.resources.map((resource, index) => <section className="plugin-resource tw-item" key={index} aria-label={`Recurso ${index + 1}`}>
        <Field label={`Nombre del recurso ${index + 1}`}><input required value={resource.name} onChange={e => resourcePatch(index, 'name', e.target.value)} /></Field>
        <Field label={`Tipo de contenido del recurso ${index + 1}`}><input required placeholder="text/plain" value={resource.mediaType} onChange={e => resourcePatch(index, 'mediaType', e.target.value)} /></Field>
        <Field label={`Contenido del recurso ${index + 1}`}><textarea rows={5} value={resource.content} onChange={e => resourcePatch(index, 'content', e.target.value)} /></Field>
        <Button onClick={() => patch('resources', form.resources.filter((_, i) => i !== index))}>Quitar recurso {index + 1}</Button>
      </section>)}
      <Button onClick={() => patch('resources', [...form.resources, { name: '', mediaType: 'text/plain', content: '' }])}>Añadir recurso</Button>
      <p className="tw-muted">Phantom valida el manifiesto y calcula los hashes al publicar.</p>
      <Button type="submit" tone="primary">{updating ? 'Publicar nueva versión' : copying ? 'Publicar copia en proyecto' : 'Publicar Skill'}</Button>
    </fieldset></form>
    <ErrorNotice error={op.error} clear={op.clear} />{op.busy && <p role="status">Publicando…</p>}
    {result && <><p role="status">Publicación guardada en Phantom.</p><DataView value={result} label="Resultado nativo de publicación" /></>}
    <Button disabled={op.busy} onClick={onClose}>Cerrar formulario</Button>
  </section>;
}

function SkillDetail({ selection, workspace, api, notify, onOpenPanel, onPublished }) {
  const requestedRef = exactRef(selection);
  const detail = useResource(api, 'phantom.detail', { workspaceId: workspace.id, pluginId: 'phantom', topic: 'skills', id: selection.id, ...(requestedRef ? { ref: requestedRef } : {}) });
  const [editor, setEditor] = useState(null);
  const native = detail.data, manifest = native?.manifest, ref = exactRef(native);
  const valid = manifest && ref && native.available !== false && !detail.loading && !detail.error;
  return <section className="plugin-detail tw-section" aria-label={`Detalle de Skill ${selection.id}`}>
    <header className="plugin-heading tw-heading"><h3>Detalle · {selection.id}</h3><Button onClick={detail.reload}>Actualizar detalle</Button></header>
    <ResourceState resource={detail} empty={false} />
    {native && native.available !== false && !detail.loading && !detail.error && !valid && <ErrorNotice error="La fuente no devolvió manifiesto y referencia exacta válidos. Actualiza el detalle." retry={detail.reload} />}
    {valid && <>
      <h4>{manifest.description || ref.id}</h4>
      <p>Fuente: {sourceText(native.source)} · Scope: {ref.scope} · Revisión: {ref.version}</p>
      <DataView value={ref} label="Referencia exacta · scope / id / versión / sha256" />
      <p className="plugin-identity">{ref.id} · {ref.version} · SHA256: {ref.sha256}</p>
      <h4>Instrucciones</h4><pre className="plugin-skill-body tw-code" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{manifest.body || 'Sin instrucciones.'}</pre>
      <h4>Acciones</h4><ul>{(manifest.actions || []).map((action, i) => <li key={i}>{action}</li>)}</ul>
      <h4>Herramientas requeridas</h4>{manifest.requiresTools?.length ? <ul>{manifest.requiresTools.map((tool, i) => <li key={i}>{tool}</li>)}</ul> : <p>No declaradas.</p>}
      <h4>Recursos</h4>{!manifest.resources?.length && <p>Sin recursos.</p>}
      {(manifest.resources || []).map((resource, index) => <article className="plugin-resource tw-item" key={`${resource.name}:${index}`}>
        <h5>{resource.name}</h5><p>Tipo: {resource.mediaType} · Hash: {resource.sha256 || resource.hash || 'No informado'}</p>
        <DataView value={resource.content} label={`Contenido · ${resource.name}`} />
      </article>)}
      <DataView value={native} label="Fuente nativa completa" />
      {ref.scope === 'global' ? <><p>Skill global de solo lectura.</p><Button aria-expanded={editor?.mode === 'copy'} onClick={() => setEditor(editor ? null : { mode: 'copy', existing: native })}>Copiar a proyecto</Button></> : <Button aria-expanded={editor?.mode === 'version'} onClick={() => setEditor(editor ? null : { mode: 'version', existing: native })}>Preparar nueva versión</Button>}
      {onOpenPanel && <Button onClick={() => onOpenPanel('phantom-skills', { pluginId: 'phantom', panelId: 'skills', skillId: ref.id, ref }, manifest.description || ref.id)}>Abrir referencia exacta en otro panel</Button>}
    </>}
    {editor && <SkillForm key={`${refKey(exactRef(editor.existing))}:${editor.mode}`} existing={editor.existing} mode={editor.mode} workspace={workspace} api={api} notify={notify} onSaved={onPublished} onClose={() => setEditor(null)} />}
  </section>;
}

export function PhantomSkills({ workspace, api, refresh, notify, onOpenPanel, node, plugin }) {
  const initialRef = exactRef(node?.data?.ref);
  const [selected, setSelected] = useState(() => initialRef || (node?.data?.skillId ? { id: node.data.skillId } : null));
  const [query, setQuery] = useState(''), [allVersions, setAllVersions] = useState(false), [creating, setCreating] = useState(false);
  const nodeRefKey = refKey(initialRef);
  useEffect(() => {
    setSelected(initialRef || (node?.data?.skillId ? { id: node.data.skillId } : null));
    setCreating(false);
  }, [workspace?.id, nodeRefKey, node?.data?.skillId]);
  const source = useResource(api, 'phantom.list', { workspaceId: workspace?.id, pluginId: 'phantom', topic: 'skills', allVersions }, { enabled: Boolean(workspace?.id) });
  const items = itemsOf(source.data);
  const text = query.trim().toLowerCase();
  const filtered = items.filter(item => `${item.id || ''} ${item.title || ''} ${item.raw?.description || ''} ${item.ref?.scope || ''} ${item.ref?.version || ''}`.toLowerCase().includes(text));
  const published = value => {
    const ref = exactRef(value);
    if (ref) { setSelected(ref); setCreating(false); }
    source.reload();
    Promise.resolve().then(() => refresh?.()).catch(error => notify?.(`Publicación guardada; no se pudo actualizar el workspace: ${error.message}`, 'error'));
  };
  if (!workspace?.id) return <p className="plugin-empty tw-empty">Selecciona un proyecto.</p>;
  return <div className="plugin-skills tw-content">
    <header className="plugin-header tw-heading"><h2>Biblioteca de Skills · Phantom</h2><div className="tw-row"><Button disabled={source.loading} onClick={source.reload}>Actualizar biblioteca</Button><Button aria-expanded={creating} onClick={() => setCreating(old => !old)}>Nueva Skill</Button></div></header>
    {plugin?.enabled === false && <p className="plugin-unavailable tw-warning">Activa Phantom en el Centro de Plugins para publicar.</p>}
    {creating && <SkillForm key={workspace.id} workspace={workspace} api={api} notify={notify} onSaved={published} onClose={() => setCreating(false)} />}
    <div className="plugin-filters tw-row"><Field label="Buscar Skills por ID, descripción, scope o versión"><input type="search" value={query} onChange={e => setQuery(e.target.value)} /></Field><Field label="Historial de versiones"><select value={allVersions ? 'all' : 'latest'} onChange={e => setAllVersions(e.target.value === 'all')}><option value="latest">Versiones actuales</option><option value="all">Todas las versiones (allVersions)</option></select></Field></div>
    <ResourceState resource={source} empty="No hay Skills nativas disponibles. Publica la primera Skill del proyecto." />
    {source.data && source.data.available !== false && !Array.isArray(source.data.items) && <ErrorNotice error="La fuente no devolvió una biblioteca válida." retry={source.reload} />}
    {!source.loading && items.length > 0 && !filtered.length && <p className="plugin-empty tw-empty">Sin resultados para esta búsqueda.</p>}
    <div className="plugin-skill-list">{filtered.map((item, index) => {
      const ref = exactRef(item);
      return <article className="plugin-skill tw-item" key={ref ? refKey(ref) : `${item.id}:${index}`}>
        <Button disabled={!ref} aria-pressed={Boolean(ref && refKey(exactRef(selected)) === refKey(ref))} onClick={() => setSelected(ref)}>{item.title || item.id}</Button>
        <p className="plugin-identity">{ref?.id || item.id} · {ref?.scope || 'Scope no informado'} · {ref?.version || 'Versión no informada'}</p>
        <small>Fuente: {sourceText(item.source)} · SHA256: {ref?.sha256 || 'Referencia exacta no disponible; actualiza la biblioteca.'}</small>
      </article>;
    })}</div>
    {selected && <><Button onClick={() => setSelected(null)}>Cerrar detalle</Button><SkillDetail key={`${workspace.id}:${refKey(exactRef(selected)) || selected.id}`} selection={selected} workspace={workspace} api={api} notify={notify} onOpenPanel={onOpenPanel} onPublished={published} /></>}
  </div>;
}
