import { RESEARCH_STATUS, statusOf } from '../../shared/research.mjs';

export function normalizedURL(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.href;
  } catch { return String(value || ''); }
}

export function sourcesFor(nodes, spaceId) {
  return (nodes || []).filter(node => node?.type === 'reference' && node.data?.kind === 'link' && node.data?.url && node.data?.spaceId === spaceId && statusOf(node))
    .sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
}

export function groupByStatus(sources) {
  const groups = Object.fromEntries(RESEARCH_STATUS.map(status => [status, []]));
  for (const source of sources || []) {
    const status = statusOf(source);
    if (status) groups[status].push(source);
  }
  return groups;
}

export function currentIndex(sources, url, readerRef) {
  const id = typeof readerRef === 'string' ? readerRef : readerRef?.id;
  const byId = (sources || []).findIndex(source => source.id === id);
  if (byId >= 0) return byId;
  const target = normalizedURL(url);
  return (sources || []).findIndex(source => normalizedURL(source.data?.url) === target);
}

export function next(sources, index) {
  for (let i = index + 1; i < (sources || []).length; i++) if (statusOf(sources[i]) !== 'discarded') return i;
  return -1;
}

export function prev(sources, index) {
  for (let i = index - 1; i >= 0; i--) if (statusOf(sources[i]) !== 'discarded') return i;
  return -1;
}

export function moreLikeThisText(text) {
  return `@phantom trae 5–10 fuentes como esta. Lo que me gusta: ${text}`;
}
