import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The canvas toolbar draws its separators as bare <i> children. A descendant
// selector also reached the Phantom launcher's status dot (an <i> inside a
// button) and stretched it into a 1×16 px bar.
test('canvas navigation separators only style direct <i> children', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.canvas-navigation i[\s,{]/);
  assert.match(css, /\.canvas-navigation>i,\.dock-main>i\{display:block;width:1px;height:16px;background:var\(--hairline\);margin:0 4px\}/);
});
