# Refinamiento de formularios · 2026-11-18

Pasada sobre producción y sus stories: Configuración (Agentes, Voz, Git, Conexiones), creación/reemplazo de Cards y creación/nueva versión de Skills, búsquedas y filtros. Se continuaron los cambios anteriores: al iniciar esta etapa los inputs de Configuración ya medían 466 px en el catálogo desktop y estaban alineados a la izquierda; seguían las diferencias de superficie, espaciado, esquinas y cascada del canvas.

## Defecto → cambio → evidencia

Rutas de evidencia bajo `.test-artifacts/`; las capturas `refinement-…` usan 1440×900, 390×844 y 320×844.

| Defecto observado | Cambio de producción | Evidencia |
|---|---|---|
| Campos de Voz más claros que Skills; variantes distintas en canvas | Plano `--surface-2`, padding 8×12, mínimo 38 px, borde hairline y radio 8; sombras de campos retiradas en estas familias | `refinement-ajustes--voz-catalog-1440.png`, `refinement-phantom--nueva-skill-canvas-1440.png`; estilos computados en `ui-refinement-styles.json` |
| Placeholder de Vocabulario recortado en compacto | Pista breve y explicación persistente enlazada con `aria-describedby`; insets compactos permiten ver también URL y rutas automáticas | `refinement-ajustes--voz-canvas-320.png`, `refinement-ajustes--configuracion-sheet-320-focus.png` |
| Filas cuadradas tras retirar overflow de los grupos; textarea de Detalles heredaba flex-basis vertical | Esquinas en las filas extremas y Detalles; stack con bases automáticas, ayuda separada 4 px y control 8 px | `refinement-ajustes--voz-catalog-1440.png`, `refinement-ajustes--voz-canvas-320-textarea-synthetic-focus.png` |
| Búsquedas con capas y alturas diferentes, filtros apretados | Una caja de 38 px con input transparente y foco exterior; gap 12 px. Skills compacto cede el icono decorativo al texto y reserva espacio para limpiar la búsqueda nativa | `refinement-phantom--cards-catalog-1440.png`, `refinement-phantom--skills-catalog-390.png`, `refinement-phantom--catalogo-skills-canvas-320.png` |
| Formularios largos y ritmo desigual entre hosts | Ancho editable máximo 640 px, campos separados 16 px y label/campo/ayuda 8 px; columnas que apilan por espacio disponible; cantidades alineadas a la derecha | `refinement-phantom--nueva-card-canvas-1440.png`, `refinement-phantom--nueva-skill-inspector-390.png` |
| Modelo de ejecución de Card solapaba Ejecutar/Cancelar por compartir clase con el compositor | Corrección de altura y padding limitada a `.pc-root .pc-model`; acciones después del campo y su ayuda | `refinement-phantom--contrato-card-catalog-1440.png`; aserción de separación vertical |
| No había prueba de acceso a las acciones inferiores | Scroll real, foco por Tab/Shift+Tab, hit testing y orden entre acciones; Descartar restaura el borrador; reemplazar exige checkbox nativo | `refinement-ajustes--conexiones-sheet-320-actions.png`, `refinement-phantom--nueva-card-canvas-320-actions.png`, `refinement-phantom--nueva-skill-canvas-390-actions.png`, `refinement-phantom--contrato-card-canvas-320-replacement-actions.png` |
| Estados de campos sin evidencia específica | Hover editable, foco sólido sin clipping, disabled sin hover y solo lectura enfocable/no editable; fieldset disabled sin atenuación doble | `refinement-ajustes--voz-canvas-390-select-synthetic-disabled.png`, `refinement-phantom--nueva-skill-canvas-320-fieldset-disabled-synthetic.png`, `refinement-phantom--detalle-skill-inspector-320-readonly.png` |

## Comparación y reproducción

- El ANTES conservado por la etapa anterior en `/tmp/phantom-refinement-before-0a2c0169` se copió sin regenerarlo a `.test-artifacts/refinement-before/`. Son artefactos ignorados dentro del worktree.
- Un comando calculó y cotejó los SHA256 de las cuatro fuentes originales y sus copias: todas coincidieron. Los valores están en el [manifiesto interno](../.test-artifacts/refinement-before/sha256.json).
- Pares comparables, ANTES ↔ DESPUÉS:
  - Voz 1440×900: `.test-artifacts/refinement-before/ajustes--voz-desktop.png` ↔ `.test-artifacts/ajustes--voz-desktop.png`.
  - Voz 390×844: `.test-artifacts/refinement-before/ajustes--voz-compacto.png` ↔ `.test-artifacts/ajustes--voz-compacto.png`.
  - Nueva Skill 1440×900: `.test-artifacts/refinement-before/phantom--nueva-skill-desktop.png` ↔ `.test-artifacts/phantom--nueva-skill-desktop.png`.
  - Nueva Skill 390×844: `.test-artifacts/refinement-before/phantom--nueva-skill-compacto.png` ↔ `.test-artifacts/phantom--nueva-skill-compacto.png`.
- Comparación visual: en Voz los controles pasan de superficies grises a campos oscuros con borde; Vocabulario sustituye el placeholder recortado por una pista breve y ayuda visible. En Nueva Skill los campos también tienen borde y, en desktop, el formulario ocupa un ancho de lectura menor; en compacto los campos siguen apilados. Las capturas de 320 px no tienen baseline histórico; Detalles abiertos, foco y acciones aportan cobertura adicional sin pareja histórica.
- `npm run build-storybook` genera las stories con el grafo CSS real. Se mantienen las 99 stories y 61 fuentes. Las stories existentes de estas familias añaden el control `host`: `catalog`, `canvas`, `sheet` (Configuración) o `inspector` (Phantom).
- `node test/storybook-smoke.mjs` conserva los checks anteriores y añade geometría, etiquetas/ayudas, foco y acciones de seis formularios a los tres anchos. `node test/ui-refinement.mjs` comprueba 11 escenas × 3 hosts × 3 anchos, guarda los estilos/errores en JSON y captura los estados; ambos cierran navegador y servidor efímero en `finally`.
- Aserciones: ausencia de overflow horizontal, superficie/borde/radio/tipo, placeholder completo (incluye reserva del control search nativo), ritmo y ancho de lectura, contorno visible sin recorte por ancestros, acciones no ocultas/interceptadas, inmutabilidad del ID de Skill y checkbox de reemplazo no convertido en campo de texto.

## Límites concretos

Las fixtures usan componentes y clases de composición reales con datos sintéticos, no el host de producción ni una sesión de Electron. Los estados con sufijo `synthetic` aplican atributos nativos temporalmente al control montado para comprobar CSS sin depender de la latencia del host; la identidad readonly de «Preparar nueva versión» y la confirmación de reemplazo sí proceden de la interacción real del componente. No se ejecutan ni publican Cards/Skills en el servicio real.

Revisión visual realizada sobre capturas desktop, compactas y estados: permite comparar jerarquía, superficie, foco y acceso por scroll. No acredita aprobación humana ni integración. Los resultados de regresiones completas, builds, smoke y Docker corresponden a los checks del controlador. No se cambia persistencia, permisos, callbacks, menús abiertos ni dependencias; los estilos de formularios se acotan para no transferirlos al terminal, compositor o cliente móvil independiente.
