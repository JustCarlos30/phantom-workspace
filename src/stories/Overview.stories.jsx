import React, { useState } from 'react';
import inventory from 'virtual:phantom-inventory';
import { opportunities } from './catalog.mjs';

export default { title: 'Catálogo' };
export const Inventario = { render: () => {
  const [query, setQuery] = useState(''), [family, setFamily] = useState('');
  const entries = inventory.entries.filter(entry => (!family || entry.family === family) && JSON.stringify(entry).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <main className="catalog-page">
    <header><h1>Sistema UI Phantom Workspace</h1><p>Componentes de producción, datos sintéticos y límites explícitos. Las propuestas no sustituyen DESIGN.md.</p><p>{inventory.entries.filter(e => e.status === 'renderizado').length} fuentes con escenario · {inventory.stories.length} stories · {inventory.files.length} archivos clasificados.</p></header>
    <div className="catalog-row"><label>Buscar fuente, símbolo o escenario <input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label><label>Familia <select value={family} onChange={e => setFamily(e.target.value)}><option value="">Todas</option>{[...new Set(inventory.entries.map(e => e.family))].map(name => <option key={name}>{name}</option>)}</select></label></div>
    <p role="status">{entries.length} fuentes</p>
    <table className="catalog-table"><thead><tr><th>Fuente / familia</th><th>Cobertura y escenarios</th><th>Símbolos AST / límites</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.source}>
      <td data-label="Fuente / familia"><code>{entry.source}</code><p>{entry.family}</p></td>
      <td data-label="Cobertura y escenarios">{entry.status}{entry.story && <p><a href={`./?path=/story/${entry.story}`} target="_top">{entry.scenario} · principal</a></p>}<details><summary>Composiciones CSF con import real</summary><ul>{entry.scenarios.map(s => <li key={s.id}><a href={`./?path=/story/${s.id}`} target="_top">{s.name}</a></li>)}</ul></details></td>
      <td data-label="Símbolos AST / límites"><p>{entry.limitation}</p><details><summary>{entry.symbols?.length || 0} símbolos capitalizados</summary><p>AST identifica declaraciones y exportaciones; no demuestra ejecución de cada rama privada. El enlace lleva a una composición real de la fuente, no a una afirmación de cobertura individual.</p><ul>{entry.symbols?.map(s => <li key={`${s.name}:${s.line}`}><code>{s.name}:{s.line}</code> · {s.exported ? 'exportado' : 'privado'} · {s.kind}<p>{s.coverage}</p></li>)}</ul><p>Exportaciones, incluidos hooks y helpers: <code>{entry.exports?.join(', ') || 'Ninguna'}</code></p></details></td>
    </tr>)}</tbody></table>
    <details><summary>Mapa completo del repositorio</summary><p>Se excluyen artefactos/dependencias: {inventory.excludedDirectories.join(', ')}. El listado no publica cuerpos de archivos de soporte ni secretos.</p><ul>{inventory.files.filter(f => f.source.toLowerCase().includes(query.toLowerCase())).map(f => <li key={f.source}><code>{f.source}</code> · {f.category}</li>)}</ul></details>
    <section><h2>Propuestas pendientes de aprobación</h2>{opportunities.map(item => <article key={item.title}><h3>{item.priority} · {item.title}</h3><p>{item.detail}</p></article>)}</section>
  </main>;
} };
