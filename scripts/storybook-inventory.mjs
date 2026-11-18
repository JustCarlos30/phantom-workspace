import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { catalog, exclusions, storyId } from '../src/stories/catalog.mjs';

export function validateInventory(sources, entries, storyIds) {
  const errors = [];
  const knownSources = new Set(sources);
  const knownStories = new Set(storyIds);
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.source)) errors.push(`Fuente duplicada: ${entry.source}`);
    seen.add(entry.source);
    if (!knownSources.has(entry.source)) errors.push(`Fuente inexistente: ${entry.source}`);
    if (entry.story && !knownStories.has(entry.story)) errors.push(`Story inexistente: ${entry.story}`);
    if (entry.status === 'renderizado' && (!entry.story || !entry.selector)) errors.push(`Cobertura sin escenario ejecutable: ${entry.source}`);
    if (entry.status && entry.status !== 'renderizado' && !entry.limitation) errors.push(`Exclusión sin motivo: ${entry.source}`);
  }
  for (const source of sources) {
    if (!seen.has(source)) errors.push(`Fuente sin inventariar: ${source}`);
  }
  return errors;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['.git', 'node_modules', 'dist', 'out', 'storybook-static', '.test-artifacts']);
export async function productionStyles() {
  const files = new Set(await repositoryFiles()), visited = new Set(), styles = ['src/styles.css', 'src/tools.css', 'src/empty-state.css'];
  async function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const ast = parse(await readFile(resolve(root, file), 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    for (const node of ast.program.body.filter(n => n.type === 'ImportDeclaration')) {
      const specifier = node.source.value;
      if (specifier.endsWith('.css')) {
        const css = specifier.startsWith('.') ? relative(root, resolve(root, dirname(file), specifier)) : specifier;
        if (!styles.includes(css)) styles.push(css);
      } else if (specifier.startsWith('.')) {
        const base = relative(root, resolve(root, dirname(file), specifier));
        const dependency = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`].find(path => files.has(path) && /\.(jsx?|mjs)$/.test(path));
        if (dependency) await visit(dependency);
      }
    }
  }
  await visit('src/App.jsx');
  return styles;
}
export async function repositoryFiles(directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await repositoryFiles(path));
    else if (entry.isFile()) files.push(relative(root, path));
  }
  return files.sort();
}
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
export function analyzeSource(text, source) {
  const ast = parse(text, { sourceType: 'module', plugins: ['jsx', ...(source.endsWith('.tsx') ? ['typescript'] : [])] });
  const symbols = [], exports = new Set(), imports = [];
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') imports.push(node.source.value);
    if (node.type === 'ExportDefaultDeclaration') exports.add(node.declaration.id?.name || node.declaration.arguments?.find(arg => arg.type === 'FunctionExpression')?.id?.name || 'default');
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.id) exports.add(node.declaration.id.name);
      for (const d of node.declaration?.declarations || []) if (d.id.name) exports.add(d.id.name);
      for (const s of node.specifiers || []) exports.add(s.local?.name || s.exported?.name);
    }
  }
  walk(ast.program, node => {
    let name, value;
    if (['FunctionDeclaration', 'FunctionExpression', 'ClassDeclaration'].includes(node.type)) { name = node.id?.name; value = node; }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') { name = node.id.name; value = node.init; }
    if (!name || !/^[A-Z]/.test(name) || symbols.some(s => s.name === name && s.line === node.loc.start.line)) return;
    let jsx = false;
    walk(value, child => { if (['JSXElement', 'JSXFragment'].includes(child.type)) jsx = true; });
    symbols.push({ name, line: node.loc.start.line, exported: exports.has(name), kind: jsx ? 'componente o composición JSX' : 'helper, registro o alias (revisión semántica necesaria)', coverage: 'Sin afirmación de cobertura individual; consultar composición de la fuente' });
  });
  return { ast, symbols, imports, exports: [...exports] };
}
export async function inspectRepository() {
  const files = await repositoryFiles();
  const sources = files.filter(file => /\.(jsx|tsx)$/.test(file) && !file.startsWith('src/stories/'));
  const stories = [], sourceDetails = [];
  for (const source of sources) {
    const { symbols, exports } = analyzeSource(await readFile(resolve(root, source), 'utf8'), source);
    sourceDetails.push({ source, symbols, exports });
  }
  for (const file of files.filter(file => file.endsWith('.stories.jsx'))) {
    const { ast, imports } = analyzeSource(await readFile(resolve(root, file), 'utf8'), file);
    const meta = ast.program.body.find(n => n.type === 'ExportDefaultDeclaration')?.declaration;
    const title = meta?.properties?.find(p => p.key.name === 'title')?.value.value;
    if (!title) throw new Error(`Título CSF estático requerido: ${file}`);
    const declarations = new Map();
    for (const node of ast.program.body) for (const d of node.declarations || node.declaration?.declarations || []) declarations.set(d.id.name, d.init);
    for (const node of ast.program.body.filter(n => n.type === 'ExportNamedDeclaration')) {
      for (const d of node.declaration?.declarations || []) {
        const referenced = new Set();
        const collect = (value, visited = new Set()) => walk(value, child => {
          if (child.type === 'JSXIdentifier' || child.type === 'Identifier') {
            referenced.add(child.name);
            if (declarations.has(child.name) && !visited.has(child.name)) { visited.add(child.name); collect(declarations.get(child.name), visited); }
          }
        });
        collect(d.init);
        // A CSF component in the default metadata is rendered by args-only stories.
        const component = meta.properties.find(p => p.key.name === 'component');
        if (component) collect(component.value);
        const renderedImports = ast.program.body.filter(n => n.type === 'ImportDeclaration' && n.specifiers.some(s => referenced.has(s.local.name))).map(n => n.source.value);
        stories.push({ id: storyId(title, d.id.name), file, title, exportName: d.id.name, imports, renderedImports });
      }
    }
  }
  const importsSource = (story, source) => story.renderedImports.some(path => relative(root, resolve(root, dirname(story.file), path)).replace(/\.jsx$/, '') === source.replace(/\.jsx$/, ''));
  const entries = [...catalog, ...exclusions].map(entry => ({ ...entry, ...sourceDetails.find(d => d.source === entry.source), scenarios: stories.filter(story => importsSource(story, entry.source)).map(story => ({ id: story.id, name: story.exportName })) }));
  const errors = validateInventory(sources, entries, stories.map(s => s.id));
  const ids = new Set();
  for (const story of stories) { if (ids.has(story.id)) errors.push(`ID CSF duplicado: ${story.id}`); ids.add(story.id); }
  for (const entry of catalog) {
    const story = stories.find(s => s.id === entry.story);
    if (!story) continue;
    const candidates = story.renderedImports.map(path => relative(root, resolve(root, dirname(story.file), path)).replace(/\.jsx$/, ''));
    if (!candidates.includes(entry.source.replace(/\.jsx$/, ''))) errors.push(`Cobertura sin import renderizado en CSF: ${entry.source} → ${entry.story}`);
  }
  return { entries, stories, errors, files: files.map(source => ({ source, category: /\.(jsx|tsx)$/.test(source) ? source.startsWith('src/stories/') ? 'catálogo' : 'JSX inventariado' : source.startsWith('assets/') ? 'asset' : 'no JSX: soporte, documentación, host o test' })), excludedDirectories: [...ignored] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await inspectRepository();
  const index = JSON.parse(await readFile(resolve(root, 'storybook-static/index.json'), 'utf8'));
  const built = Object.values(index.entries).filter(e => e.type === 'story').map(e => e.id).sort();
  const declared = report.stories.map(s => s.id).sort();
  if (JSON.stringify(built) !== JSON.stringify(declared)) report.errors.push('El índice del build difiere de las exportaciones CSF actuales; reconstruye Storybook.');
  if (report.errors.length) { console.error(report.errors.join('\n')); process.exitCode = 1; }
  else console.log(`${catalog.length} fuentes renderizadas, ${exclusions.length} exclusiones explícitas, ${declared.length} stories, ${report.files.length} archivos inventariados por AST/clasificación.`);
}
