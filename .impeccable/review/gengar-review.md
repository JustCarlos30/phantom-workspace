# Gengar oscuro · revisión acotada

Fecha: 2026-11-11. Dirección solicitada: paleta Gengar más oscura y menos iconografía genérica «AI slop».

## Resultado

**SHIP para esta capa visual.** Ciruela casi negra con elevaciones violetas distinguibles, selección violeta menos pastel, herramientas neutras sin teselas coloreadas, símbolos por función compartidos entre navegación y canvas, marca angular Phantom y CPU en lugar del robot genérico. Se conservan los glifos de proveedores identificados.

## Comprobaciones realizadas

- `npm run build`: correcto. Vite mantiene el aviso de tamaño de bundle >500 kB.
- Electron real, host aislado y contenido **sintético**: mapa, lanzador y Apariencia inspeccionados en capturas. Escritorio 1520×980; escritorio estrecho 1100×760 con inspector abierto.
- Contraste calculado sobre tokens aplicados: texto, secundario y acento en fondo, superficie y superficie elevada; nueve pares ≥4.5:1.
- Selección Iris, recarga y persistencia comprobadas. Restablecer devuelve Gengar/Violeta.
- Cero excepciones del renderizador durante el recorrido.
- `git diff --check`: correcto.
- Detector Impeccable: solo avisos de colores/radios/tamaños fuera de la documentación o sus rampas auxiliares. La bruma Gengar nueva es intencional; el resto corresponde a estilos preexistentes. No hubo hallazgos bloqueantes.

## Evidencia local

- Antes: `/tmp/opencode/gengar-cll7Tk/workspace.png`, `tools.png` (captura inicial con tamaño gestionado por el escritorio).
- Después: `/tmp/opencode/gengar-lunH0e/workspace.png`, `tools.png`, `appearance.png`, `narrow.png`.
- Recorrido de verificación: `/tmp/opencode/gengar-review.mjs --verify`, ejecutado con Node desde la raíz del repositorio.

Las rutas temporales son evidencia local de esta sesión. Esta revisión cubre paleta, iconografía y controles de apariencia recorridos; no acredita una ejecución de la suite general ni pruebas prolongadas de terminal/chat.
