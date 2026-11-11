import React, { useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { pluginCall, skillDraft, skillInput } from '../plugins/phantom';
import { Button, DataView, ErrorNotice, Field, ResourceNotice, TextList, useOperation, usePluginResource } from './pluginPrimitives';

const reference = item => item?.ref || item?.raw?.ref;
const identity = item => JSON.stringify(reference(item) || item.id);

export function SkillEditor({ workspace, api, initial, onSaved, onCancel }) {
  const [draft, setDraft] = useState(() => ({ ...skillDraft(initial), ...(initial ? { version: '' } : {}) }));
  const request = useRef(crypto.randomUUID());
  const op = useOperation();
  const change = patch => { request.current = crypto.randomUUID(); setDraft(old => ({ ...old, ...patch })); };
  const resourceChange = (index, patch) => change({ resources: draft.resources.map((resource, i) => {
    if (i !== index) return resource;
    const next = { ...resource, ...patch };
    if (patch.content !== undefined && patch.content !== resource.content) delete next.sha256;
    if (patch.source === '') delete next.source;
    return next;
  }) });
  return <form className="tw-form plugin-editor" aria-label={initial ? 'Nueva versión de skill' : 'Nueva skill'} onSubmit={e => { e.preventDefault(); op.run(async () => {
    const input = skillInput(draft, initial);
    const result = await pluginCall(api, workspace.id, initial ? 'update' : 'create', { kind: 'skill', input, idempotencyKey: request.current, ...(initial ? { id: initial.ref.id, ref: initial.ref, revision: initial.ref.version } : {}) });
    await onSaved(result);
  }); }}>
    <div className="plugin-heading"><div><h3>{initial ? 'Publicar nueva versión' : 'Nueva skill'}</h3><p className="tw-muted">Instrucciones y recursos reutilizables. Cada publicación es inmutable.</p></div><Button icon={X} aria-label="Cancelar formulario de skill" disabled={op.busy} onClick={onCancel} /></div>
    <fieldset disabled={op.busy}>
      <div className="plugin-fields-pair"><Field label="Identificador de skill" hint="Minúsculas, sin espacios. Ejemplo: review/frontend"><input autoFocus={!initial} value={draft.id} readOnly={!!initial} required maxLength={96} onChange={e => change({ id: e.target.value })} /></Field><Field label="Versión" hint={initial ? `Versión actual: ${initial.ref.version}. Escribe una nueva.` : 'Versión exacta, por ejemplo 1.0.0'}><input autoFocus={!!initial} value={draft.version} required onChange={e => change({ version: e.target.value })} /></Field></div>
      <Field label="Descripción"><textarea rows={2} maxLength={512} value={draft.description} required onChange={e => change({ description: e.target.value })} /></Field>
      <TextList label="Acciones de la skill" values={draft.actions} onChange={actions => change({ actions })} hint="Una por línea. Por ejemplo: frontend.review" />
      <Field label="Instrucciones"><textarea className="plugin-instructions" rows={10} value={draft.body} required onChange={e => change({ body: e.target.value })} placeholder="Explica cuándo usarla, el procedimiento y qué debe verificar." /></Field>
      <TextList label="Herramientas requeridas" values={draft.requiresTools} onChange={requiresTools => change({ requiresTools })} hint="Identificadores de herramientas, uno por línea. Opcional." />
      <section className="plugin-form-section"><div className="plugin-heading"><h4>Recursos de texto</h4><Button icon={Plus} disabled={draft.resources.length >= 8} onClick={() => change({ resources: [...draft.resources, { name: '', mediaType: 'text/plain', content: '' }] })}>Añadir recurso</Button></div><p className="tw-muted">Hasta 8 recursos. Su contenido queda incluido en la versión publicada.</p>
        {draft.resources.map((resource, index) => <fieldset className="plugin-check" key={index}><legend>Recurso {index + 1}</legend><Field label="Nombre del recurso"><input required value={resource.name} onChange={e => resourceChange(index, { name: e.target.value })} placeholder="references/usage.md" /></Field><Field label="Tipo de contenido"><input required value={resource.mediaType || 'text/plain'} onChange={e => resourceChange(index, { mediaType: e.target.value })} /></Field><Field label="Contenido del recurso"><textarea rows={5} value={resource.content} onChange={e => resourceChange(index, { content: e.target.value })} /></Field>{resource.source && <Field label="Ruta fuente del recurso"><input value={resource.source} onChange={e => resourceChange(index, { source: e.target.value })} /></Field>}<Button icon={Trash2} tone="danger" onClick={() => change({ resources: draft.resources.filter((_, i) => i !== index) })}>Quitar recurso</Button></fieldset>)}
      </section>
      <details className="tw-details"><summary>Metadatos avanzados</summary>{draft.bodySource && <p>Ruta fuente de instrucciones conservada: <code>{draft.bodySource}</code></p>}<pre className="tw-code">{JSON.stringify(draft, null, 2)}</pre></details>
    </fieldset>
    <ErrorNotice error={op.error} /><div className="tw-row"><Button type="submit" tone="primary" disabled={op.busy}>{op.busy ? 'Publicando…' : initial ? 'Publicar nueva versión' : 'Publicar skill en Phantom'}</Button><Button disabled={op.busy} onClick={onCancel}>Cancelar</Button></div>
  </form>;
}

function SkillDetail({ item, workspace, api, refresh, onBack, onSaved }) {
  const ref = reference(item);
  const resource = usePluginResource(() => pluginCall(api, workspace.id, 'detail', { topic: 'skills', id: item.id, ...(ref ? { ref } : {}) }), `${workspace.id}:${identity(item)}`);
  const [editing, setEditing] = useState(false);
  const op = useOperation();
  const detail = resource.data, manifest = detail?.manifest;
  if (editing && detail) return <SkillEditor workspace={workspace} api={api} initial={detail} onSaved={onSaved} onCancel={() => setEditing(false)} />;
  return <section className="plugin-detail"><div className="tw-row"><Button icon={ArrowLeft} onClick={onBack}>Todas las skills</Button><Button icon={RefreshCw} disabled={resource.loading} onClick={() => resource.reload()}>Actualizar fuente</Button></div><ResourceNotice resource={resource} />{manifest && <>
    <header className="plugin-detail-title"><span className="plugin-status">{detail.ref?.scope === 'global' ? 'Global · Solo lectura' : 'Proyecto'} · {detail.ref?.version}</span><h3>{manifest.id}</h3><p>{manifest.description}</p></header>
    <div className="tw-row">{detail.ref?.scope !== 'global' && <Button tone="primary" onClick={() => setEditing(true)}>Nueva versión</Button>}<Button disabled={op.busy} onClick={() => op.run(async () => { await api('context.pin', { workspaceId: workspace.id, kind: 'skill', title: manifest.id, source: 'phantom', ref: detail.ref }); await refresh(); })}>Fijar referencia exacta</Button></div><ErrorNotice error={op.error} />
    <section className="plugin-form-section"><h4>Acciones</h4><div className="plugin-tags">{manifest.actions.map(action => <code key={action}>{action}</code>)}</div>{manifest.requiresTools?.length > 0 && <><h4>Herramientas requeridas</h4><p>{manifest.requiresTools.join(', ')}</p></>}</section>
    <section className="plugin-form-section"><h4>Instrucciones</h4><div className="plugin-prose">{manifest.body}</div></section>
    <section className="plugin-form-section"><h4>Recursos · {manifest.resources?.length || 0}</h4>{!manifest.resources?.length && <p className="tw-muted">Esta versión no incluye recursos adicionales.</p>}{manifest.resources?.map(resource => <details className="plugin-resource" key={resource.name}><summary>{resource.name} <small>{resource.mediaType}</small></summary><pre className="tw-code">{resource.content}</pre>{resource.source && <small>Fuente: {resource.source}</small>}</details>)}</section>
    <DataView value={detail.ref} label="Identidad, versión y hash de la fuente" /><DataView value={detail} label="Paquete nativo completo" />
  </>}</section>;
}

export default function PhantomSkills({ workspace, api, refresh }) {
  const [query, setQuery] = useState(''), [versions, setVersions] = useState(false), [selected, setSelected] = useState(null), [creating, setCreating] = useState(false), [saved, setSaved] = useState('');
  const resource = usePluginResource(() => pluginCall(api, workspace.id, 'list', { topic: 'skills', allVersions: versions }), `${workspace.id}:${versions}`);
  const items = resource.error || resource.data?.available === false ? [] : resource.data?.items || [];
  const matches = items.filter(item => `${item.title} ${item.id} ${item.raw?.description || ''} ${(item.raw?.actions || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const onSaved = async result => { setCreating(false); setSelected({ id: result.id, ref: result.ref }); setSaved(`Versión publicada en Phantom: ${result.ref?.version || result.id}`); await resource.reload(); await refresh(); };
  if (creating) return <SkillEditor workspace={workspace} api={api} onSaved={onSaved} onCancel={() => setCreating(false)} />;
  if (selected) return <><p className="plugin-save-status" role="status">{saved}</p><SkillDetail key={identity(selected)} item={selected} workspace={workspace} api={api} refresh={refresh} onSaved={onSaved} onBack={() => { setSelected(null); setSaved(''); resource.reload(); }} /></>;
  return <section className="phantom-skills"><div className="plugin-heading"><div><h3>Skills</h3><p className="tw-muted">Tu biblioteca de procedimientos · Fuente Phantom</p></div><Button icon={Plus} tone="primary" onClick={() => setCreating(true)}>Nueva skill</Button></div><div className="plugin-toolbar"><Field label="Buscar skills"><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Identificador, descripción o acción" /></Field><Button icon={RefreshCw} aria-label="Actualizar skills" disabled={resource.loading} onClick={() => resource.reload()} /></div><label className="tw-check"><input type="checkbox" checked={versions} onChange={e => setVersions(e.target.checked)} />Mostrar todas las versiones</label><ResourceNotice resource={resource} />
    {!resource.loading && !resource.error && resource.data?.available !== false && !matches.length && <div className="plugin-empty"><BookOpen size={26} /><h4>{query ? 'Sin coincidencias' : 'Dale un lugar a tus procedimientos'}</h4><p>{query ? 'Prueba con otro identificador, descripción o acción.' : 'Publica instrucciones y recursos como una skill reutilizable y versionada.'}</p></div>}
    <div className="plugin-skills-list">{matches.map(item => <button className="plugin-skill-row" key={identity(item)} onClick={() => setSelected(item)}><BookOpen size={18} /><span><strong>{item.id}</strong><span>{item.raw?.description || item.title}</span><small>{reference(item)?.scope === 'global' ? 'Global · Solo lectura' : 'Proyecto'} · v{reference(item)?.version || item.revision || 'desconocida'}</small></span></button>)}</div>
  </section>;
}
