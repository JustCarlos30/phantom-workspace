export function sendAction({ status, draft, armed }) {
  if (armed) return 'none';
  if (status === 'recording') return 'stop-and-send';
  if (status === 'transcribing') return 'await-voice';
  return draft.trim() ? 'send' : 'none';
}
export function canSubmit({ status, draft, armed, sending, connected, ready = true }) {
  return !!(connected && ready && !sending && sendAction({ status, draft, armed }) !== 'none');
}
export function mergeDictation(draft, text) {
  return draft.trim() ? `${draft.trimEnd()} ${text}` : text;
}

const wordsOf = text => text.split(/\s+/).filter(Boolean);
const norm = word => word.toLocaleLowerCase('es').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// Word-level diff between what was dictated and what the user left after editing.
// Returns {heard, meant} pairs for small substitutions (1-3 words each side) only:
// insertions, deletions and rewrites are not corrections of a mis-heard word.
export function suggestCorrections(dictated, edited, existing = []) {
  const a = wordsOf(dictated), b = wordsOf(edited);
  if (!a.length || !b.length || a.length > 400 || b.length > 400) return [];
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    rows[i][j] = norm(a[i]) === norm(b[j]) ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  }
  const known = new Set(existing.map(item => item.heard.toLocaleLowerCase('es')));
  const found = new Map();
  let i = 0, j = 0, from = [], to = [];
  const flush = () => {
    if (from.length && to.length && from.length <= 3 && to.length <= 3) {
      const heard = from.map(norm).join(' '), meant = to.join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (heard && meant && heard !== meant.toLocaleLowerCase('es') && !known.has(heard)) found.set(heard, meant);
    }
    from = []; to = [];
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && norm(a[i]) === norm(b[j])) { flush(); i++; j++; }
    else if (j < b.length && (i === a.length || rows[i][j + 1] >= rows[i + 1][j])) to.push(b[j++]);
    else from.push(a[i++]);
  }
  flush();
  return [...found].map(([heard, meant]) => ({ heard, meant }));
}

// "heard => meant" lines, the format the dictation worker reads.
export function parseCorrectionLines(text) {
  return text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const [heard, ...rest] = line.split('=>');
    return { heard: heard.trim(), meant: rest.join('=>').trim() };
  });
}
export function addCorrectionLine(text, { heard, meant }) {
  const line = `${heard} => ${meant}`;
  return text.trim() ? `${text.trimEnd()}\n${line}` : line;
}
