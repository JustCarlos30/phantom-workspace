import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../src/chat.css', import.meta.url), 'utf8');

test('subagent card and its children shrink within the available width', () => {
  const card = chat.match(/(?:^|\n)\.pc-subagent\s*\{([^}]*)\}/)?.[1];
  assert.ok(card, '.pc-subagent rule exists');
  assert.match(card, /(?:^|;)\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*(?:;|$)/);
  assert.match(card, /(?:^|;)\s*min-width:\s*0\s*(?:;|$)/);
  assert.match(card, /(?:^|;)\s*max-width:\s*100%\s*(?:;|$)/);
  assert.match(card, /(?:^|;)\s*background:\s*none\s*(?:;|$)/, 'delegation remains a line on the thread, not another card');

  const children = chat.match(/(?:^|\n)\.pc-subagent\s*>\s*\*\s*\{([^}]*)\}/)?.[1];
  assert.ok(children, '.pc-subagent > * rule exists');
  assert.match(children, /(?:^|;)\s*min-width:\s*0\s*(?:;|$)/);
  // The row is one 40 px line: the title gives way (ellipsis) so state and time stay visible on narrow sessions.
  const row = chat.match(/(?:^|\n)\.pc-subagent-head\s*\{([^}]*)\}/)?.[1];
  assert.ok(row, '.pc-subagent-head rule exists');
  assert.match(row, /(?:^|;)\s*min-height:\s*var\(--activity-row-height\)\s*(?:;|$)/);
  assert.match(row, /(?:^|;)\s*min-width:\s*0\s*(?:;|$)/);
  assert.doesNotMatch(row, /flex-wrap:\s*wrap/);
  const title = chat.match(/(?:^|\n)\.pc-delegate-title\s*\{([^}]*)\}/)?.[1];
  assert.ok(title, '.pc-delegate-title rule exists');
  for (const pattern of [/min-width:\s*0\s*(?:;|$)/, /overflow:\s*hidden/, /text-overflow:\s*ellipsis/, /white-space:\s*nowrap/]) assert.match(title, pattern);
  assert.match(chat, /\.pc-delegate-state\s*\{[^}]*flex-shrink:\s*0/, 'the state never gives way to the title');
  assert.match(chat, /\.pc-delegate-body\s*\{[^}]*min-width:\s*0/, 'the details body shrinks too');
});

test('phantom link and its children shrink within the available width', () => {
  const link = chat.match(/(?:^|\n)\.pc-phantom-link\s*\{([^}]*)\}/)?.[1];
  assert.ok(link, '.pc-phantom-link rule exists');
  assert.match(link, /(?:^|;)\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*(?:;|$)/);
  assert.match(link, /(?:^|;)\s*min-width:\s*0\s*(?:;|$)/);

  const children = chat.match(/(?:^|\n)\.pc-phantom-link\s*>\s*\*\s*\{([^}]*)\}/)?.[1];
  assert.ok(children, '.pc-phantom-link > * rule exists');
  assert.match(children, /(?:^|;)\s*min-width:\s*0\s*(?:;|$)/);
});
