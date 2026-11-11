export function createDraftRegistry() {
  const callbacks = new Set();
  return {
    register(callback) { callbacks.add(callback); return () => { callbacks.delete(callback); }; },
    prepare() { for (const callback of callbacks) callback(); },
  };
}

export function createInlineName({ value, stage, flush, update, end }) {
  const original = value;
  let draft = value, staged = null, ended = false, pending = null;
  const prepare = () => {
    if (ended) return;
    const name = draft.trim();
    if (!name || name.length > 512) {
      const error = new Error(!name ? 'Escribe un nombre para guardar.' : 'El nombre admite hasta 512 caracteres.');
      update({ value: draft, error: error.message, saving: false }); throw error;
    }
    if (name !== (staged ?? original)) { stage(name); staged = name; }
    return name;
  };
  return {
    change(next) { if (!ended && !pending) { draft = next; update({ value: draft, error: '', saving: false }); } },
    prepare,
    commit(returnFocus = false) {
      if (ended) return Promise.resolve(false);
      if (pending) return pending;
      try { prepare(); } catch { return Promise.resolve(false); }
      update({ value: draft, error: '', saving: true });
      pending = Promise.resolve().then(flush).then(() => {
        if (ended) return false;
        ended = true; end(returnFocus); return true;
      }).catch(error => {
        if (!ended) update({ value: draft, error: error.message, saving: false });
        return false;
      }).finally(() => { pending = null; });
      return pending;
    },
    cancel(returnFocus = true) {
      if (ended) return;
      // Mark ended before removing the input: its ensuing blur cannot commit.
      ended = true;
      if (staged !== null && staged !== original) stage(original);
      end(returnFocus);
    },
  };
}
