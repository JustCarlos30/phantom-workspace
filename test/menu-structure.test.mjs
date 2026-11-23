import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('menus.css define la regla reutilizable de separador', () => {
  const css = read('src/menus.css');
  assert.match(css, /\.menu-separator/);
  assert.match(css, /\.menu-separator[^}]*height:\s*var\(--divider-width/s);
});

test('ChatCard renderiza separadores role=separator entre grupos de sus menús', () => {
  const jsx = ['src/components/ChatCard.jsx', 'src/components/chat/ChatPermissions.jsx', 'src/components/chat/ChatPickers.jsx', 'src/components/chat/ChatTools.jsx'].map(read).join('\n');
  const count = (jsx.match(/className="menu-separator" role="separator"/g) || []).length;
  assert.ok(count >= 3, `separadores encontrados: ${count}`);
  assert.match(jsx, /pc-models-list[\s\S]*menu-separator/);
  assert.match(jsx, /pc-effort-menu[\s\S]*menu-separator/);
});
