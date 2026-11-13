export const RESEARCH_STATUS = ['inbox', 'liked', 'discarded'];
export const RESEARCH_LABELS = { inbox: 'Bandeja', liked: 'Me gusta', discarded: 'Descartadas' };

export function statusOf(node) {
  const tags = node?.data?.tags;
  if (!Array.isArray(tags)) return null;
  for (const status of RESEARCH_STATUS) if (tags.includes(`research:${status}`)) return status;
  return null;
}

export function withStatus(tags, status) {
  if (!Array.isArray(tags)) throw new Error('Research tags must be an array');
  if (status !== null && !RESEARCH_STATUS.includes(status)) throw new Error('Invalid research status');
  const result = tags.filter(tag => typeof tag === 'string' && !tag.startsWith('research:'));
  if (status !== null) result.push(`research:${status}`);
  if (result.length > 32) throw new Error('Too many research tags');
  return result;
}
