import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDiff } from 'lucide-react';
import { groupByFolder, parseDiffLines, sameFiles, summarize } from '../hooks/touched-files.mjs';
import '../touched-files.css';

const POLL_MS = 5000;
const STATUS = { A: 'Nuevo', M: 'Modificado', D: 'Eliminado', R: 'Renombrado' };

function plural(count) { return `${count} ${count === 1 ? 'archivo' : 'archivos'}`; }

function Stat({ added, removed }) {
  if (added === null && removed === null) return null;
  return <span className="tf-stat">{added !== null && <span className="tf-add">+{added}</span>}{removed !== null && <span className="tf-del">−{removed}</span>}</span>;
}

function InlineDiff({ api, workspaceId, tree, file }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    api('repo.diff', { workspaceId, tree, path: file.path, ...(file.originalPath ? { originalPath: file.originalPath } : {}), against: 'base' })
      .then(value => { if (live) setState({ text: value?.text || '', truncated: !!value?.truncated }); })
      .catch(err => { if (live) setState({ error: err?.message || String(err) }); });
    return () => { live = false; };
  }, [api, workspaceId, tree, file.path, file.originalPath]);
  const lines = useMemo(() => parseDiffLines(state.text), [state.text]);
  if (state.loading) return <p className="tf-note" role="status">Cargando diff…</p>;
  if (state.error) return <p className="tf-note" role="alert">No se pudo leer el diff: {state.error}</p>;
  if (!lines.length) return <p className="tf-note">Sin diff de texto para este archivo.</p>;
  return <div className="tf-diff" role="group" aria-label={`Diff de ${file.path}`}>
    {lines.map((line, index) => <div key={index} className={`tf-line is-${line.kind}`}><span aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span><code>{line.text || ' '}</code></div>)}
    {state.truncated && <p className="tf-note">diff recortado</p>}
  </div>;
}

export default function TouchedFiles({ node, workspace, api, enabled = true }) {
  const tree = node.data?.worktree?.path;
  const root = useRef(null), button = useRef(null), pop = useRef(null);
  const [visible, setVisible] = useState(true);
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden);

  useEffect(() => {
    if (!tree || typeof IntersectionObserver === 'undefined') return;
    const target = root.current?.closest('.pt-card') || root.current?.parentElement;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(target);
    return () => observer.disconnect();
  }, [tree]);
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const active = !!tree && enabled && visible && !hidden && typeof api === 'function';
  useEffect(() => { setResult(null); setOpen(false); setExpanded(null); }, [tree]);
  useEffect(() => {
    if (!active) return;
    let live = true, busy = false, timer = null;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = await api('repo.changes', { workspaceId: workspace.id, tree });
        if (live && Array.isArray(value?.files)) setResult(prev => prev && sameFiles(prev.files, value.files) && prev.base === value.base && prev.truncated === value.truncated ? prev : { files: value.files, base: value.base, truncated: !!value.truncated });
      } catch { /* Keeps the last list; the next tick retries. */ }
      finally { busy = false; }
    };
    poll();
    timer = setInterval(poll, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [active, api, workspace.id, tree]);

  const close = useCallback((restore = true) => {
    setOpen(false); setExpanded(null);
    if (restore) button.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!open) return;
    pop.current?.focus({ preventScroll: true });
    const onPointer = event => { if (!root.current?.contains(event.target)) close(false); };
    const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onPointer, true); document.removeEventListener('keydown', onKey, true); };
  }, [open, close]);

  const files = result?.files;
  const groups = useMemo(() => groupByFolder(files), [files]);
  const total = useMemo(() => summarize(files), [files]);
  useEffect(() => { if (open && files && !files.length) close(false); }, [open, files, close]);

  if (!tree) return null;
  return <span ref={root} className="tf" onDoubleClick={e => e.stopPropagation()}>
    {files?.length > 0 && <button ref={button} type="button" className="tf-badge" aria-haspopup="dialog" aria-expanded={open} title="Archivos tocados en esta sesión" onClick={() => (open ? close() : setOpen(true))}>
      <FileDiff size={14} aria-hidden="true" />
      <span>{plural(total.count)}</span>
      {(total.added > 0 || total.removed > 0) && <span className="tf-stat"><span className="tf-add">+{total.added}</span><span className="tf-del">−{total.removed}</span></span>}
    </button>}
    {open && files?.length > 0 && <div ref={pop} className="tf-pop" role="dialog" aria-label="Archivos tocados" tabIndex={-1}>
      <p className="tf-base">{result.base ? `contra ${result.base}` : 'sin rama base'}{result.truncated ? ' · lista recortada' : ''}</p>
      {groups.map(group => <section key={group.folder} className="tf-group">
        <h4>{group.folder || 'Raíz'}</h4>
        <ul>
          {group.files.map(file => {
            const shown = expanded === file.path;
            return <li key={file.path}>
              <button type="button" className="tf-file" aria-expanded={shown} onClick={() => setExpanded(shown ? null : file.path)} title={file.path}>
                <b className={`tf-letter is-${file.status}`} title={STATUS[file.status] || file.status}>{file.status}</b>
                <span className="tf-name">{file.name}</span>
                <Stat added={file.added ?? null} removed={file.removed ?? null} />
                <em className="tf-saved">{file.uncommitted ? 'sin guardar' : 'guardado'}</em>
              </button>
              {shown && <InlineDiff api={api} workspaceId={workspace.id} tree={tree} file={file} />}
            </li>;
          })}
        </ul>
      </section>)}
    </div>}
  </span>;
}
