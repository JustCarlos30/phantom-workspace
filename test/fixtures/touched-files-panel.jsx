import React from 'react';
import { createRoot } from 'react-dom/client';
import TouchedFiles from '../../src/components/TouchedFiles.jsx';
import '../../src/styles.css';
import '../../src/studio.css';
import '../../src/menus.css';

const files = [
  { path: 'README.md', status: 'M', added: 2, removed: 1, uncommitted: true },
  { path: 'src/app.js', status: 'M', added: 3, removed: 1, uncommitted: false },
  { path: 'src/util/math.js', status: 'A', added: 4, removed: 0, uncommitted: true },
];
const diffFor = path => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,2 @@\n context line\n-old line of ${path}\n+new line of ${path}\n`;
const calls = [];
const api = async (method, args) => {
  calls.push({ method, path: args.path });
  if (method === 'repo.changes') return { files, base: 'main', truncated: false };
  if (method === 'repo.diff') return { text: diffFor(args.path), truncated: false };
  throw new Error(`unexpected ${method}`);
};
window.fixture = { calls };

let root;
window.mountPanel = () => {
  root = createRoot(document.getElementById('fixture'));
  root.render(<div className="pt-card" style={{ position: 'absolute', left: 40, top: 40, width: 400, height: 600 }}>
    <TouchedFiles node={{ x: 40, y: 40, data: { worktree: { path: '/tmp/tree' } } }} workspace={{ id: 'w1' }} api={api} />
  </div>);
};
window.disposePanel = () => root?.unmount();
