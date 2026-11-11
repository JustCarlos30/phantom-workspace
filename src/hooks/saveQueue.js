// Durable, serialized renderer writes. Entries remain optimistic until the final
// host read succeeds, including writes acknowledged before a failed read.
export function createSaveQueue({ invoke, refresh, onSaving = () => {}, onError = () => {}, onSaved = () => {} }) {
  const entries = new Map();
  let drain = null;
  return {
    entries,
    get draining() { return drain; },
    enqueue(key, method, payload, patch) {
      const merged = { ...entries.get(key)?.patch, ...patch };
      entries.set(key, { method, payload, patch: merged, saved: false });
    },
    flush() {
      if (drain) return drain;
      if (!entries.size) return Promise.resolve();
      onSaving(true);
      drain = Promise.resolve().then(async () => {
        do {
          let next;
          while ((next = [...entries].find(([, entry]) => !entry.saved))) {
            const [key, entry] = next;
            await invoke(entry.method, { ...entry.payload, patch: entry.patch });
            if (entries.get(key) === entry) entry.saved = true;
          }
          const acknowledged = [...entries];
          await refresh();
          for (const [key, entry] of acknowledged) {
            if (entry.saved && entries.get(key) === entry) entries.delete(key);
          }
          // Edits made during state.get must also be saved before any waiter
          // proceeds to a project switch or acknowledges a controlled close.
        } while (entries.size);
        onSaved();
      }).catch(error => { onError(error); throw error; }).finally(() => {
        drain = null; onSaving(false);
      });
      return drain;
    },
  };
}
