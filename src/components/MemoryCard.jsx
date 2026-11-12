import React, { useState } from 'react';
import { ShieldCheck, GitBranch, BadgeCheck, FlaskConical, CircleHelp, Clock, Copy, Check, History, Link } from 'lucide-react';
import './../memory.css';
import Markdown from './Markdown.jsx';
import { Button, Field, DataView, ErrorNotice, useOperation, useResource } from './PluginPrimitives.jsx';
import { kindMeta, scopeLabel, spaceLabel, memoryView, revisionsOf, lineDiff } from '../hooks/memory-view.mjs';

const icons = { ShieldCheck, GitBranch, BadgeCheck, FlaskConical, CircleHelp };
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('es') : 'No informada';
const relativePath = path => path && !path.startsWith('/') && !path.split(/[\\/]/).includes('..') && !path.includes('\0') && !/^[A-Za-z]:/.test(path);
const localDate = value => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function MemoryForm({ existing, workspace, api, refresh, notify, onSaved }) {
  const seed = memoryView(existing);
  const [form, setForm] = useState(() => ({ key: seed.key, title: existing ? seed.title : '', body: seed.body, scope: seed.scope || '.', space: seed.space || 'workspace', expiresAt: localDate(seed.expiry.at), evidence: seed.evidence.map(e => e.path).join('\n') }));
  const [preview, setPreview] = useState(false), [saved, setSaved] = useState(false);
  const op = useOperation(notify), patch = (key, value) => { setSaved(false); setForm(old => ({ ...old, [key]: value })); };
  return <form className="mem-form tw-form" onSubmit={event => { event.preventDefault(); op.run(async () => {
    const evidence = form.evidence.split('\n').map(s => s.trim()).filter(Boolean);
    if (!form.key.trim() || form.key.trim().length > 120) throw new Error('La clave debe tener entre 1 y 120 caracteres.');
    if (!form.title.trim() || form.title.trim().length > 200) throw new Error('El título debe tener entre 1 y 200 caracteres.');
    if (!form.body.trim() || form.body.length > 6000) throw new Error('El cuerpo debe tener entre 1 y 6000 caracteres.');
    if (!relativePath(form.scope.trim()) || evidence.some(path => !relativePath(path))) throw new Error('Usa rutas relativas del proyecto, sin segmentos «..».');
    if (evidence.length > 12) throw new Error('Puedes declarar como máximo 12 evidencias.');
    if (!['workspace', 'project'].includes(form.space)) throw new Error('Selecciona un espacio válido.');
    if (form.expiresAt && !Number.isFinite(Date.parse(form.expiresAt))) throw new Error('Introduce una fecha de caducidad válida.');
    if (existing && (!existing.id || !Number.isSafeInteger(seed.revision))) throw new Error('Falta la identidad o revisión fuente. Actualiza la memoria antes de editar.');
    const input = { key: form.key.trim(), kind: 'decision', title: form.title.trim(), body: form.body, scope: form.scope.trim(), space: form.space, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null, evidence };
    const result = await api(existing ? 'phantom.update' : 'phantom.create', { workspaceId: workspace.id, kind: 'decision', ...(existing ? { id: existing.id, revision: seed.revision } : {}), input });
    setSaved(true); await refresh?.(); onSaved?.(result);
  }, existing ? 'Revisión guardada en Phantom' : 'Decisión declarada en Phantom'); }}>
    <fieldset disabled={op.busy || saved} className="mem-fields">
      <Field label="Clave estable"><input required maxLength={120} value={form.key} onChange={e => patch('key', e.target.value)} /></Field>
      <Field label="Título"><input required maxLength={200} value={form.title} onChange={e => patch('title', e.target.value)} /></Field>
      <Field label={`Cuerpo en Markdown · ${form.body.length}/6000`}><textarea required maxLength={6000} rows={6} value={form.body} onChange={e => patch('body', e.target.value)} /></Field>
      <Button aria-expanded={preview} onClick={() => setPreview(!preview)}>{preview ? 'Ocultar vista previa' : 'Vista previa Markdown'}</Button>
      {preview && <div className="mem-body mem-preview"><Markdown source={form.body} /></div>}
      <div className="mem-form-grid"><Field label="Alcance"><input required value={form.scope} onChange={e => patch('scope', e.target.value)} /></Field><Field label="Espacio"><select value={form.space} onChange={e => patch('space', e.target.value)}><option value="workspace">Workspace</option><option value="project">Proyecto</option></select></Field></div>
      <Field label="Caducidad (hora local, opcional)"><input type="datetime-local" value={form.expiresAt} onChange={e => patch('expiresAt', e.target.value)} /></Field>
      <Field label="Evidencia · una ruta por línea" hint="Hasta 12 rutas. Phantom registra sus hashes y fecha de observación."><textarea rows={3} value={form.evidence} onChange={e => patch('evidence', e.target.value)} /></Field>
    </fieldset>
    <ErrorNotice error={op.error} clear={op.clear} />
    <Button type="submit" tone="primary" disabled={op.busy || saved}>{op.busy ? 'Guardando…' : existing ? 'Guardar revisión' : 'Declarar decisión'}</Button>
    {saved && <p role="status" className="mem-muted">Guardado en Phantom.</p>}
  </form>;
}

function MemoryHistory({ resource }) {
  const revisions = revisionsOf(resource.data);
  const [selection, setSelection] = useState('');
  const index = selection === '' ? revisions.length - 1 : revisions.findIndex(r => String(r.revision) === selection);
  const current = revisions[index], previous = revisions[index - 1];
  return <section className="mem-history" aria-label="Historial de revisiones">
    {resource.loading && <p role="status">Leyendo historial…</p>}
    <ErrorNotice error={resource.error} retry={resource.reload} />
    {resource.data?.available === false && <p className="mem-warning">{resource.data.reason || 'Historial no disponible.'}</p>}
    {revisions.length > 0 ? <><Field label="Revisión"><select value={current?.revision ?? ''} onChange={e => setSelection(e.target.value)}>{revisions.map((r, i) => <option key={`${r.revision}:${i}`} value={r.revision}>Revisión {r.revision} · {date(r.at)}</option>)}</select></Field>
      <p className="mem-muted">{previous ? `Cambios de r${previous.revision} a r${current?.revision}` : 'Primera revisión frente a documento vacío'}{current?.reason ? ` · ${current.reason}` : ''}</p>
      <dl className="mem-revision-meta">{[['Título', 'title'], ['Tipo', 'kind'], ['Alcance', 'scope'], ['Espacio', 'space'], ['Estado', 'state'], ['Caducidad', 'expiresAt']].filter(([, key]) => current?.[key] !== previous?.[key]).map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{String(previous?.[key] ?? '—')} → {String(current?.[key] ?? '—')}</dd></div>)}</dl>
      <pre className="mem-diff" aria-label="Diferencias del cuerpo por líneas">{lineDiff(previous?.body, current?.body).map((line, i) => <span className={`mem-diff-${line.type}`} key={i}><span aria-label={line.type === 'add' ? 'Añadida' : line.type === 'del' ? 'Eliminada' : 'Sin cambios'}>{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</span> {line.text}{'\n'}</span>)}</pre>
    </> : !resource.loading && !resource.error && <p className="mem-muted">Sin revisiones disponibles.</p>}
  </section>;
}

export default function MemoryCard({ item, workspace, api, refresh, notify, onChange }) {
  const view = memoryView(item), meta = kindMeta(view.kind), Icon = icons[meta.icon];
  const [history, setHistory] = useState(false), [editing, setEditing] = useState(false), [copied, setCopied] = useState(false);
  const resource = useResource(api, 'phantom.detail', { workspaceId: workspace.id, topic: 'memories', id: item.id }, { enabled: history });
  const op = useOperation(notify);
  return <article className={`mem-card mem-${meta.tone}${view.state === 'retired' ? ' mem-retired' : ''}`}>
    <header className="mem-heading"><span className="mem-kind"><Icon size={14} aria-hidden="true" />{meta.label}</span><span className="mem-muted">r{view.revision ?? '—'}{view.state === 'retired' ? ' · Retirada' : view.state === 'active' ? ' · Activa' : ' · Estado no informado'}</span></header>
    <h4 className="mem-title">{view.title}</h4>{view.key && <code className="mem-key">{view.key}</code>}
    <div className="mem-chips"><span>{scopeLabel(view.scope)}</span><span>{spaceLabel(view.space)}</span></div>
    <div className="mem-body">{view.body ? <Markdown source={view.body} /> : <p className="mem-muted">Sin cuerpo informado.</p>}</div>
    {view.expiry.state !== 'none' && <p className={`mem-expiry mem-${view.expiry.state}`}><Clock size={14} aria-hidden="true" />{view.expiry.state === 'expired' ? 'Caducada' : view.expiry.state === 'soon' ? 'Caduca pronto' : 'Caduca'} · {date(view.expiry.at)}</p>}
    <section className="mem-evidence" aria-label="Evidencia"><h5>Evidencia · {view.evidence.length}</h5>{view.evidence.length ? <ul>{view.evidence.map((e, i) => <li key={i}><code title={e.root}>{e.path}</code><span title={e.hash}>{e.hash.slice(0, 12) || 'Sin hash'} · {date(e.observedAt)}</span></li>)}</ul> : <p className="mem-muted">Sin evidencia registrada.</p>}</section>
    {view.updatedAt && <p className="mem-muted">Actualizada: {date(view.updatedAt)}</p>}
    <div className="mem-actions"><Button icon={History} aria-expanded={history} onClick={() => setHistory(!history)}>{history ? 'Ocultar historial' : 'Ver historial'}</Button><Button icon={copied ? Check : Copy} disabled={op.busy || !item.id} onClick={() => op.run(async () => { await navigator.clipboard.writeText(item.id); setCopied(true); })}>{copied ? 'ID copiado' : 'Copiar ID'}</Button>
      <Button icon={Link} disabled={op.busy || !item.id} onClick={() => op.run(async () => { await api('context.pin', { workspaceId: workspace.id, kind: view.kind, title: view.title, ...(item.source != null ? { source: item.source } : {}), ref: item.raw?.ref || item.ref || { id: item.id, ...(view.revision !== null ? { revision: view.revision } : {}) } }); await refresh?.(); }, 'Referencia guardada')}>Vincular referencia</Button>
      {view.kind === 'decision' && <Button aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? 'Cerrar edición' : 'Editar decisión'}</Button>}
    </div><ErrorNotice error={op.error} clear={op.clear} />
    {history && <MemoryHistory resource={resource} />}
    {editing && <MemoryForm existing={item} workspace={workspace} api={api} refresh={refresh} notify={notify} onSaved={() => { setEditing(false); onChange?.(); if (history) resource.reload(); }} />}
    <DataView label="Ver fuente nativa" value={{ registro: item.raw || item, ...(resource.data ? { historial: resource.data } : {}) }} />
  </article>;
}
