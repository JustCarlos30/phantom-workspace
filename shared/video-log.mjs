// Pure structural extraction. Text is preserved, never interpreted as measured proof.
export const normalizeSearch = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const videoHeadings = new Set(['lo que aprendi', 'que funciona y donde', 'produccion y aprendizaje', 'que funciona y que falta verificar']);
const crossHeadings = new Set(['lectura y limites', 'critica del guion · hipotesis prioritaria', 'decision de carlos y propuesta']);

export function parseVideoLog(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  let fence = null, comment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (comment) { if (line.includes('-->')) comment = false; continue; }
    if (/^\s*<!--/.test(line)) { comment = !line.includes('-->'); continue; }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = { char: marker[1][0], length: marker[1].length }; continue; }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) headings.push({ level: heading[1].length, title: heading[2], index: i });
  }
  const slice = (start, end) => {
    while (start < end && !lines[start].trim()) start++;
    while (end > start && !lines[end - 1].trim()) end--;
    return { markdown: lines.slice(start, end).join('\n'), startLine: start + 1, endLine: end };
  };
  const origins = [], insights = [];
  for (let h = 0; h < headings.length; h++) {
    const heading = headings[h];
    if (heading.level !== 2) continue;
    const name = normalizeSearch(heading.title);
    if (name === 'plantilla' || name.startsWith('plantilla ')) continue;
    const global = name === 'donde funciona y donde sigue abierto';
    const transversal = global || name.startsWith('corte tiktok ·') || name.startsWith('comparacion de los tres episodios ·');
    const video = !transversal && /^([^·]+)\s+·\s+(.+)$/.exec(heading.title);
    if (!video && !transversal) continue;
    let end = lines.length;
    for (let next = h + 1; next < headings.length; next++) if (headings[next].level <= 2) { end = headings[next].index; break; }
    const origin = { id: `origin-${heading.index + 1}`, title: heading.title, kind: transversal ? 'transversal' : 'video', video: video ? video[1].trim() : null, ...slice(heading.index, end) };
    origins.push(origin);
    const add = (title, start, stop, headingLine) => {
      const body = slice(start, stop);
      // Fenced examples alone do not constitute an insight.
      const plain = body.markdown.replace(/(^|\n) {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\2[^\n]*(?=\n|$)|$)/g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
      if (!plain) return;
      const summary = plain.split('\n').find(line => line.trim() && !/^\s*[#|]/.test(line))?.trim() || title;
      insights.push({ id: `insight-${headingLine}`, title, summary, originId: origin.id, video: origin.video, kind: origin.kind, headingLine, ...body });
    };
    if (global || name.startsWith('comparacion de los tres episodios ·')) add(heading.title, heading.index + 1, end, heading.index + 1);
    else for (let next = h + 1; next < headings.length && headings[next].index < end; next++) {
      const child = headings[next], childName = normalizeSearch(child.title);
      if (child.level !== 3) continue;
      const recognized = transversal ? crossHeadings.has(childName) || childName.startsWith('comparacion de los tres episodios · hipotesis editorial') : videoHeadings.has(childName);
      if (!recognized) continue;
      let stop = end;
      for (let after = next + 1; after < headings.length; after++) if (headings[after].level <= 3) { stop = Math.min(end, headings[after].index); break; }
      add(child.title, child.index + 1, stop, child.index + 1);
    }
  }
  return { origins, insights };
}

export function filterVideoInsights(document, { query = '', video = '' } = {}) {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  const origins = new Map(document.origins.map(origin => [origin.id, origin]));
  return document.insights.filter(insight => {
    if (video && (video === '__transversal__' ? insight.kind !== 'transversal' : insight.video !== video)) return false;
    const text = normalizeSearch(`${insight.title}\n${insight.markdown}\n${origins.get(insight.originId)?.markdown || ''}`);
    return terms.every(term => text.includes(term));
  });
}
