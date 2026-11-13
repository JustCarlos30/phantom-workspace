const providerLabels = { claude: 'Claude', opencode: 'OpenCode', codex: 'Codex', terminal: 'Terminal' };

export function providerOf(node) {
  const provider = node.data?.chat?.provider;
  return ['claude', 'opencode', 'codex'].includes(provider) ? provider : 'terminal';
}

export function sessionTitle(node) {
  let title = (node.title || '').trim();
  if (!title || title === 'Terminal') return providerLabels[providerOf(node)];
  title = title.replace(/…$/, '').trimEnd();
  // Remove unfinished punctuation left by a previously truncated title.
  title = title.replace(/[\s(]+$/, '');
  while (title.endsWith(')') && (title.match(/\)/g) || []).length > (title.match(/\(/g) || []).length) {
    title = title.slice(0, -1).trimEnd();
  }
  const sentenceEnd = title.indexOf('. ');
  if (sentenceEnd !== -1) return title.slice(0, sentenceEnd);
  if (title.length > 60) {
    const space = title.lastIndexOf(' ', 59);
    title = `${title.slice(0, space > 0 ? space : 60).trimEnd()}…`;
  }
  return title;
}

export function buildSessionRows(nodes = [], sessions = {}) {
  const visible = nodes.filter(node => !node.data?.hidden);
  const rows = visible.filter(node => node.type === 'terminal').map(node => {
    const provider = providerOf(node);
    const session = sessions[node.id];
    return {
      id: node.id, node, provider, providerLabel: providerLabels[provider],
      title: sessionTitle(node), fullTitle: node.title,
      tone: session?.tone || 'unknown', statusLabel: session?.label || 'Estado desconocido',
      needsYou: Boolean(session?.needsYou),
      model: node.data?.chat?.models?.[provider]?.split('/').pop() || '',
      resources: [],
    };
  });
  const counts = new Map();
  const occurrences = new Map();
  const owners = new Map();
  for (const row of rows) {
    counts.set(row.title, (counts.get(row.title) || 0) + 1);
    const sessionId = sessions[row.id]?.id || row.node.data?.sessionId;
    if (sessionId && !owners.has(sessionId)) owners.set(sessionId, row);
  }
  for (const row of rows) {
    if (counts.get(row.title) > 1) {
      const number = (occurrences.get(row.title) || 0) + 1;
      occurrences.set(row.title, number);
      row.title = `${row.title} ${number}`;
    }
  }
  const resources = [];
  for (const node of visible) {
    if (node.type === 'terminal') continue;
    const owner = node.type === 'browser' && owners.get(node.data?.agentTerminal);
    (owner ? owner.resources : resources).push(node);
  }
  const priority = row => row.needsYou ? 0 : row.tone === 'working' ? 1 : 2;
  rows.sort((a, b) => priority(a) - priority(b));
  return { rows, resources };
}
