import { timeOf, ago } from './activityModel.mjs';
import { planSummary } from './plan-view.mjs';

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

export function buildSessionRows(nodes = [], sessions = {}, now = Date.now()) {
  const visible = nodes.filter(node => !node.data?.hidden);
  const rows = visible.filter(node => node.type === 'terminal').map(node => {
    const provider = providerOf(node);
    const session = sessions[node.id];
    return {
      id: node.id, node, provider, providerLabel: providerLabels[provider],
      title: sessionTitle(node), fullTitle: node.title,
      tone: session?.tone || 'unknown', statusLabel: session?.label || 'Estado desconocido',
      needsYou: Boolean(session?.needsYou),
      time: ago(timeOf(session), now),
      model: node.data?.chat?.models?.[provider]?.split('/').pop() || '',
      resources: [],
      plan: planSummary(node.data?.plan),
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
  rows.sort((a, b) => sessionPriority(a) - sessionPriority(b));
  return { rows, resources };
}

export const sessionPriority = row => row.needsYou ? 0 : row.tone === 'working' ? 1 : 2;

const sessionGroups = [
  { key: 'attention', label: 'Necesitan tu atención' },
  { key: 'working', label: 'Trabajando' },
  { key: 'rest', label: 'En reposo' },
];

export function groupSessionRows(rows = []) {
  return sessionGroups
    .map((group, index) => ({ ...group, rows: rows.filter(row => sessionPriority(row) === index) }))
    .filter(group => group.rows.length);
}

// Ctrl+Shift+F: every panel of the project, terminals classified by what they
// need from you; the rest of the panels follow as one plain group.
export function groupPanelIndex(nodes = [], sessions = {}, now = Date.now()) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const terminals = buildSessionRows(nodes.map(n => (n.data?.hidden ? { ...n, data: { ...n.data, hidden: false } } : n)).filter(n => n.type === 'terminal'), sessions, now).rows;
  const groups = groupSessionRows(terminals).map(group => ({ ...group, items: group.rows.map(row => ({ node: byId.get(row.id), status: row.statusLabel, state: group.key, time: row.time, provider: row.providerLabel })) }));
  const others = nodes.filter(n => n.type !== 'terminal');
  if (others.length) groups.push({ key: 'other', label: 'Otros paneles', rows: others, items: others.map(node => ({ node, status: '', state: 'other', time: '', provider: '' })) });
  return groups;
}

// Ctrl+Shift+P: what each project is doing. Declared agent status is all a
// project that is not open has; the open one also passes its live sessions.
const NEEDS = new Set(['blocked', 'awaiting_approval', 'needs_approval', 'awaiting_input', 'waiting_for_input', 'needs_input', 'failed', 'error']);
const BUSY = new Set(['running', 'working', 'doing', 'verifying', 'recovering']);
export function projectStatus(project, sessions = null) {
  const terminals = (project?.nodes || []).filter(n => n.type === 'terminal' && !n.data?.hidden);
  let needs = 0, working = 0;
  for (const node of terminals) {
    const live = sessions?.[node.id], declared = node.data?.agent?.status;
    if (live ? live.needsYou : NEEDS.has(declared)) needs++;
    else if (live ? live.tone === 'working' : BUSY.has(declared)) working++;
  }
  const alerts = (project?.attention || []).filter(a => !a.acknowledgedAt && !a.acknowledged && !a.acked).length;
  const attention = needs || (sessions ? 0 : alerts);
  const state = attention ? 'attention' : working ? 'working' : 'rest';
  const label = attention ? `${attention} ${attention === 1 ? 'necesita' : 'necesitan'} tu atención` : working ? `${working} trabajando` : terminals.length ? 'En reposo' : 'Sin sesiones';
  return { state, label, needs: attention, working, sessions: terminals.length };
}
