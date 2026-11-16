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

  const children = chat.match(/(?:^|\n)\.pc-subagent\s*>\s*\*\s*\{([^}]*)\}/)?.[1];
  assert.ok(children, '.pc-subagent > * rule exists');
  assert.match(children, /(?:^|;)\s*min-width:\s*0\s*(?:;|$)/);
});
