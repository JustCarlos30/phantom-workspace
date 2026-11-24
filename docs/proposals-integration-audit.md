# Auditoría de integración · Propuestas → producción

Fecha: 2026-11-23. Auditoría **solo lectura**: no se ha tocado código. Las fuentes son `src/stories/Proposals*.stories.jsx`, los `src/stories/proposals-*.css`, el CSS de `src/*.css`, el JSX de `src/components` y `src/App.jsx`, `docs/design-v2.md` (Etapas 6·1–6·6) y `docs/component-inventory.md`.

Leyenda de evidencia: `archivo:línea` leída en esta auditoría. Cuando algo **no se verificó** se indica expresamente; no se infiere cobertura de lo que no se leyó. Ningún check (`npm test`, `build-storybook`, `test:storybook`) se ejecutó durante la auditoría.

---

## 1. Estado por story

Las seis familias de `Propuestas/` (catálogo en `src/stories/Proposals.stories.jsx:17-24`). Estado global de cada familia y detalle por story.

| Familia | Estado | Resumen |
|---|---|---|
| Feel | **integrado** (salvo flash/FLIP, sin verificar) | Foco «luz», acento, contador y entrada de mensajes ya están en producción. |
| Fundamentos | **parcial** | Material 6·1 integrado; las recetas `.px-after` de campos, insignias, menús y estados vacíos no se trasladaron. Algunas contradicen design-v2. |
| Shell | **parcial** | 6·3 (dock) y 6·4 (cabecera del rail, «Te necesitan») integrados; reglas de filas del rail, minimapa y nodo sin trasladar o sin verificar. |
| Sesiones | **parcial** | Isla 6·2a/6·2b, cita y línea de estado integradas; permiso, error, terminal y orquestador `.px-after` sin trasladar. |
| Derecha | **parcial** | 6·5: configuración, bandeja «Te necesitan», muesca y voz en gran parte integradas; overlay, búsqueda, respuesta, Apariencia y punto de la muesca no. |
| Paneles | **parcial** | 6·5: centro de mando y botones/filtros Git integrados; búsquedas de Ramas, toolbar del navegador, pestañas de Cards y filas de Skills no. |

### Feel (`src/stories/ProposalsFeel.stories.jsx`, `proposals-feel.css`)

| Story | Estado | Evidencia |
|---|---|---|
| FocoIsla (`ProposalsFeel.stories.jsx:25`) | integrado (variante «luz») | Story: `proposals-feel.css:26-37` (relleno 5 % + `::after` con luz superior). Prod: `src/chat.css:319-323` (`.pc-field` con `--composer-fill`/`--composer-ring`, `::after` con `--composer-light-top`, `:focus-within` → `--composer-fill-lit`, movimiento reducido). Tokens: `src/canvas-ui.css:174`. Doc: `design-v2.md:213`. |
| Acento (`:78`) | integrado | Prod: `--primary: var(--accent)` y hover en `src/canvas-ui.css:54-55`; primaria de Configuración en `src/settings.css:96-98`; Enviar en `src/chat.css:425`; dock en `src/shell.css:127`. Doc: `design-v2.md:282-286`. No se verificaron `caret-color` en todos los campos ni el color de selección de texto. |
| ContadorContexto (`:136`) | integrado | Story: `proposals-feel.css:73-92`. Prod: `src/chat.css:372-384` (anillo, pista blanca 12 %, `--danger` con `data-danger`, `.pc-context-low`) y `src/chat.css:338` (se oculta en isla estrecha). Doc: `design-v2.md:215`. No se verificaron los umbrales 70/90/95 % en JSX. |
| Movimiento (`:210`) | parcial (verificado solo en parte) | Entrada de mensajes: `src/chat.css:65-66` (`@starting-style`, `--dur-enter` en `src/canvas-ui.css:115`). Interruptor a 160 ms: `src/settings.css:129`. **No verificado:** destello del mapa (900 ms), FLIP de 320 ms ni apertura de menús. Doc: `design-v2.md:267-278`. |

### Fundamentos (`ProposalsFoundations.stories.jsx`, `proposals-foundations.css`)

| Story | Estado | Evidencia |
|---|---|---|
| Fondos (`:36`) | no verificado | `proposals-foundations.css:19,22` (`--bg:#020203`, canvas al 55 %). No localicé el equivalente en producción. |
| Material (`:61`) | integrado | `--object-top`/`--object-sheen` en `src/canvas-ui.css:17,19`, iguales a la variante «cenital» de `proposals-kit.css:62-65`. Doc 6·1: `design-v2.md:48-63`. La muesca (`proposals-foundations.css:27`) se trata en Derecha. |
| Tinta (`:97`) | no verificado | `proposals-foundations.css:50-52` (apoyo/mono en `--muted` sobre objeto). No se comparó con producción. |
| Insignias (`:118`) | no integrado | Story: `.pt-glyph` círculo neutro 32 px (`proposals-foundations.css:57-62`). Prod: `src/terminal.css:18` (radio `--r-mark`, tinte por `--hue`). |
| Botones (`:143`) | parcial | Prod tiene primaria/hover (`src/canvas-ui.css:643,1267`). No se verificó si `.tw-button`/`.icon-button` globales ya son planas y de 36 px (`proposals-foundations.css:65-79`). |
| Campos (`:165`) | no integrado | Story: `.tw-field/.plugin-field` con aro de 1 px (`proposals-foundations.css:83-96`). Prod: `src/plugins.css:20` (borde `1px solid var(--hairline)`). JSX: `PluginPrimitives.jsx:14`, `ToolPanels.jsx:56`. |
| Selectores (`:191`) | no se debe trasladar tal cual | Interruptor de la story de 40×24 y thumb de 18 (`proposals-foundations.css:103-113`) contradice design-v2 44×26/20 (`design-v2.md:304`), que ya está en prod: `src/settings.css:129`. |
| Menus (`:215`) | parcial | Prod: `.context-menu` con `--r-obj`, padding 6 (`src/canvas-ui.css:720`, `src/menus.css:29`). La story usa padding 8, filas `--r-row` de 36 px y `--shadow-chrome` (`proposals-foundations.css:136-146`). |
| EstadosVacios (`:229`) | no integrado | Story: icono circular con relleno (`proposals-foundations.css:151-157`). Prod: `src/empty-state.css:21` (sin relleno). |

### Shell (`ProposalsShell.stories.jsx`, `proposals-shell.css`)

| Story | Estado | Evidencia |
|---|---|---|
| Rail (`:70`) | integrado (6·4) | `div.brand.rail-head` en `src/App.jsx:532`; grid en `src/sidebar.css:23-29`. Doc: `design-v2.md:182`. |
| RailFilas (`:84`) | parcial | «Te necesitan» como primera fila: `src/App.jsx:536`, `src/sidebar.css:133-147`. Filas: `src/sidebar.css:118-131`. Ocultar `.rail-session-type` y colorear el estado (`proposals-shell.css:36-39`) no se verificó en prod; los nodos existen en `SidebarPanels.jsx:29`. |
| BarraSuperior (`:118`) | no verificado | Maqueta propia `.px-shell-topbar` (`proposals-shell.css:46-74`), sin selectores reales. design-v2 6·4 la describe (`design-v2.md:182`); no se auditó `workspace-header`. |
| Dock (`:146`) | integrado (6·3) | `src/canvas-ui.css:1158` («One level below the stage (etapa 6·3)»). Doc: `design-v2.md:292`. |
| Zoom (`:172`) | integrado por 6·3 (sin verificar en detalle) | Lo cubre la misma etapa 6·3; no se leyó el bloque completo desde `canvas-ui.css:1158`. |
| Minimapa (`:187`) | no verificado | `.minimap-node/.minimap-view` existen (`Minimap.jsx:106-107`). Reglas `proposals-shell.css:77-80` no localizadas en prod. |
| PanelEnMapa (`:214`) | no verificado | `.canvas-node` (`Canvas.jsx:48`, entre otras). Reglas `proposals-shell.css:87-90`. El aro y la cometa dependen de design-v2 §4, no de esta story. |

### Sesiones (`ProposalsSessions.stories.jsx`, `proposals-sessions.css`)

| Story | Estado | Evidencia |
|---|---|---|
| SesionNueva (`:77`) | parcial | Maqueta `.px-newsession*` (`proposals-sessions.css:6-18`). Prod tiene filas proveedor/contexto con divisores (`src/chat.css:280-282`). No se verificó la semántica de radio. |
| ChatReposo / ChatTrabajando (`:89`, `:100`) | integrado (6·2a/6·2b) | Isla `src/chat.css:319-334`; cita `src/chat.css:68` (`--quote-width` en `src/canvas-ui.css:168`); línea de estado `ChatCard.jsx:812`, `src/chat.css:304`; chip de contexto `src/chat.css:293`. La regla `.px-after .pc-field` de la story (`proposals-sessions.css:22-23`: `--object-fill`, aro 10 %/28 %) quedó **sustituida** por la receta 6·2a, que es la que está en prod. |
| ChatAtencion (`:111`) | no integrado | `.pc-ask` existe (`ChatCard.jsx:86-98`); las reglas `proposals-sessions.css:40-45` no están en prod (no localizadas). |
| ChatError (`:122`) | no integrado | `.pc-error` (`ChatCard.jsx:963`, `PhantomChat.jsx:121`); regla `proposals-sessions.css:48`. |
| ChatVacio (`:132`) | no verificado | Sin reglas `.px-after` específicas. |
| Dictado (`:142`) | integrado | Aro de dictado: `src/chat.css:317`; medidor y finalizar: `src/voice.css:13-26`. |
| Terminal (`:153`) | no integrado | `.pt-bar`, `.pt-context`, `.terminal-host` (`TerminalPanel.jsx:209-238`); reglas `proposals-sessions.css:51-54`. |
| TarjetaTerminal (`:165`) | no integrado | `.pt-card` (`TerminalCard.jsx:96-118`); regla `proposals-sessions.css:57`. |
| PhantomChat (`:173`) | parcial | Comparte compositor; `.pc-session-row` (`ChatCard.jsx:134,774`), regla `proposals-sessions.css:36-37` no verificada. |
| Orquestador (`:184`) | no integrado | `.pd-session/.pd-deleg` (`PhantomOrchestrator.jsx:21-88`); regla `proposals-sessions.css:58`. |

### Derecha (`ProposalsRight.stories.jsx`, `proposals-right.css`)

| Story | Estado | Evidencia |
|---|---|---|
| Inspector (`:31`) | parcial | `.tw-inspector` transparente (`src/canvas-ui.css:767`), cabecera `src/settings.css:25`. No se trasladaron los iconos de cabecera de 36 px (`proposals-right.css:32-33`) ni el material de la regla `proposals-right.css:26`. |
| Configuracion (`:44`) | integrado en gran parte | Campos con aro 12 % → 40 % al enfocar: `src/settings.css:106,155`; secundarios planos y primaria: `src/settings.css:92-100`; filas de navegación: `src/settings.css:34-37,161-163`. **No** trasladados: el contenedor `.st` con material y aro 10 % y la lista con relleno 6 % (`proposals-right.css:13-19`). |
| Apariencia (`:60`) | no integrado | `.st-thumb` en prod sin aro de selección (`src/settings.css:90`); `.accent-options button` (`src/studio.css:198-202`). Reglas `proposals-right.css:62-65`. |
| Bandeja (`:75`) | integrado (variante `needs-tray`) | `src/activity.css:29-33` (segmento plano, numeral ámbar sin fondo); filas tonales `src/activity.css:55-57`; superficie `src/canvas-ui.css:803`. **Pendiente:** la variante genérica `.activity-tray .activity-filters button` sigue con `--accent-soft` (`src/canvas-ui.css:977-979`), y los botones de la bandeja tienen relleno `--fill-2` (`src/canvas-ui.css:804-805`) frente al plano de `src/activity.css:37-39`. Hay que verificar cuál gana en cascada. Respuesta: `src/activity.css:72-73` (relleno + outline de acento) frente a `proposals-right.css:42-43`. |
| Notch (`:88`) | parcial | `.notch-count` ámbar sin píldora: `src/activity.css:9`. `.notch-dot` sigue `--muted` a 0.7 (`src/activity.css:10`) frente a `--ink-3` (`proposals-right.css:59`). |
| Paleta (`:114`) | parcial | Superficie con `--r-isle` y sin borde: `src/canvas-ui.css:749`. Velo `.tw-overlay` sigue opaco (`src/canvas-ui.css:748`, `src/studio.css:155`) frente a transparente (`proposals-right.css:28`). Buscador: `src/canvas-ui.css:751-754`; filas de resultados no verificadas. |
| Herramientas (`:132`) | parcial | `.tool-picker` con `--r-isle` (`src/canvas-ui.css:701`). `.tool-search:focus-within` usa aro de **acento** 55 % (`src/canvas-ui.css:704`) frente a tinta 40 % (`proposals-right.css:42-43`). `.tool-item` con `--r-obj` (`src/canvas-ui.css:709`) frente a `--r-row`. |
| Voz (`:165`) | parcial | Finalizar marfil: `src/voice.css:24-26`; isla de dictado: `src/chat.css:317`. `.voice-meter` conserva relleno `--voice-meter-fill` (`src/voice.css:13`, que es lo que pide design-v2 `design-v2.md:224`). La regla de la story `proposals-right.css:70` lo vacía y **contradice** design-v2. |

### Paneles (`ProposalsPanels.stories.jsx`, `proposals-panels.css`)

| Story | Estado | Evidencia |
|---|---|---|
| Navegador (`:29`) | no integrado | `.browser-toolbar input` con `--shadow-well` y outline de acento (`src/panels.css:75-76`) frente a aro de 1 px (`proposals-panels.css:16-17`). Los iconos de 36 px (`proposals-panels.css:14`) no se verificaron. |
| Repositorio (`:40`) | integrado en botones; grupos sin verificar | `.rp-button` plano/primaria marfil: `src/repository.css:26-29`. `.rp-file/.rp-diff/.rp-editor/.rp-filerow` (`Repository.jsx:40-196`): reglas `proposals-panels.css:20-26` no comprobadas en `repository.css`. |
| Ramas (`:51`) | parcial | Filtros como segmento plano: `src/branches.css:14-17`; botones: `src/branches.css:59-70`. **No:** `.br-search` (`src/branches.css:19-21`, `--shadow-well` + outline de acento) y `.br-field input` (`src/branches.css:83`) frente a `proposals-panels.css:29-30`. |
| Incorporaciones (`:63`) | integrado en botones | `src/incorporaciones.css:47-53`. `.inc-line/.inc-group` no verificados frente a `proposals-panels.css:20,25`. |
| Cards (`:75`) | parcial | `.pc-card` ya tiene hover y seleccionado tonales (`src/plugins.css:137-139`). `.pc-tablist` sigue con pista `--fill` y seleccionado `--surface-2` (`src/plugins.css:332-335`) frente a segmento plano (`proposals-panels.css:33-34`). |
| Skills (`:87`) | no integrado | `.sk-row:hover` usa `--surface-2` (`src/skills.css:60`) frente a `--row-hover` (`proposals-panels.css:26`). |
| Memoria (`:99`) | no verificado | `.mem-chips` (`MemoryCard.jsx:76`); `src/memory.css:4` es una línea larga que no se leyó completa. |
| Markdown (`:110`) | no verificado | Sin reglas `.px-after` dedicadas. |
| CentroDeMando (`:118`) | integrado | `src/plugins.css:79-96` («6·5: ritmo y jerarquía»), con ritmo 16/8/20/4, frescura en una línea y filas tonales. Diferencia: en prod `.cc-task.selected` usa `--row-selected` (`:93`) y el título se limita a 2 líneas (`:94`); la story usaba `--row-hover`. |

**Discrepancia documental.** `Proposals.stories.jsx:64-72` (`PENDING`) sigue listando como pendientes material, dock unificado, cabecera del rail y acento, aunque `design-v2.md:63,182,282,292` los declara aprobados (6·1, 6·4, 6·6, 6·3). La story Resumen/Decisiones está desactualizada frente a la doc. Esta auditoría no la corrige.

---

## 2. Reglas `.px-after` no trasladadas

Criterio de 6·5 (`design-v2.md:184`): solo se trasladan reglas cuyos selectores **existen en el JSX real** y **cambian lo visible**. Riesgo: **B** = cosmético y local; **M** = toca foco, contraste o cascada compartida, o cambia el presupuesto de bordes; **A** = contradice design-v2 o afecta a accesibilidad o a una superficie global.

| Regla (story:línea) | Selector | ¿En JSX? | Destino propuesto | Riesgo |
|---|---|---|---|---|
| `proposals-right.css:13-19` | `.st`, `.st-nav`, `.st :is(.st-list, .st-nav ul)`, `.st-row` margen 4 | Sí: `Settings.jsx:40-42`, `PluginPrimitives.jsx:88` | `src/settings.css` | M: añade aro al contenedor (presupuesto de bordes, DESIGN.md «Presupuesto 6·5» `DESIGN.md:430`) y choca con la excepción de grupos planos (`design-v2.md:73`). |
| `proposals-right.css:26` | `.tw-inspector, .activity-tray, .tw-palette, .tool-picker, .activity-notch` → material + `--r-isle` | Sí: `Inspector.jsx:13`, `ActivityNotch.jsx:134`, `CommandPalette.jsx:43`, `ToolPicker.jsx:22` | `src/canvas-ui.css` | M: parte ya integrada (`canvas-ui.css:701,749,803`); `.tw-inspector` es transparente a propósito (`canvas-ui.css:767`). |
| `proposals-right.css:28` | `.tw-overlay { background: transparent }` | Sí, vía paleta y voz | `src/canvas-ui.css:748` / `src/studio.css:155` | A: retira el velo de modales; afecta a la legibilidad y a la señal de modalidad. |
| `proposals-right.css:31-33` | `.tw-inspector-header/.activity-head/.popover-heading … .icon-button` 36 px | Sí: `Inspector.jsx:13`, `ActivityNotch.jsx:134`, `App.jsx:566,579`, `ToolPicker.jsx:22`, `VoiceDictation.jsx:45` | `src/canvas-ui.css` | M: el tamaño táctil de 44 px con puntero grueso debe conservarse (`design-v2.md:128`). |
| `proposals-right.css:37-39` | `.tool-item` `--r-row` + hover; `.tw-palette-results button` | Sí: `ToolPicker.jsx:28,48`, `CommandPalette.jsx:43` | `src/canvas-ui.css:709` | B. |
| `proposals-right.css:42-43` | `.tool-search`, `.tw-palette-search input`, `.activity-reply textarea` → aro 12 %/40 % | Sí: `ToolPicker.jsx:23`, `CommandPalette.jsx:43`, `ActivityNotch.jsx:78` | `src/canvas-ui.css:704`, `src/activity.css:72-73` | M: sustituye el foco de acento por tinta; design-v2 6·6 asigna al acento el foco de teclado (`design-v2.md:284`). Es una contradicción a resolver, no a copiar. |
| `proposals-right.css:47-48` | `.activity-actions button` plano | Sí: `ActivityNotch.jsx:62` | `src/canvas-ui.css:804-805` (relleno `--fill-2`) | M: hay dos reglas en conflicto entre `activity.css:37-39` y `canvas-ui.css:804-805`; el orden de carga decide. |
| `proposals-right.css:59` | `.notch-dot` → `--ink-3` | Sí: `ActivityNotch.jsx:40` | `src/activity.css:10` | B. |
| `proposals-right.css:62-65` | `.st-thumb[aria-pressed]`, `.accent-options button[aria-pressed]` aro marfil | Sí: `Appearance.jsx:40,47` | `src/settings.css:90`, `src/studio.css:198-202` | M: añade contorno (presupuesto); el aro de selección no debe confundirse con foco. |
| `proposals-right.css:70` | `.voice-meter` sin relleno | Sí | — | A: **no trasladar**, contradice `design-v2.md:224` (`--voice-meter-fill`). |
| `proposals-right.css:71-72` | `.voice-discard` círculo 36 transparente | Sí: `VoiceActivity.jsx:52` | `src/voice.css` | B: sin verificar el estado actual. |
| `proposals-right.css:53` | `.activity-filters button` genérico | Sí | `src/canvas-ui.css:977-979` (`--accent-soft`) | M: el acento en un filtro contradice 6·6 («nunca lleva acento: segmentados», `design-v2.md:285`). |
| `proposals-panels.css:8` | `.catalog-panel` | **No**: solo `src/stories/decorators.jsx:9-11` | — | No trasladar: es un envoltorio de Storybook. |
| `proposals-panels.css:12-17` | `.browser-toolbar` iconos 36 y `input` con aro | Sí: `BrowserPanel.jsx` | `src/panels.css:75-76` (también `styles.css:95`, `studio.css:164`) | M: hay tres reglas en cascada; sustituye el outline de acento del foco. |
| `proposals-panels.css:12` | `.cc-header, .pc-head, .sk-head, .rp-file-bar` cabecera transparente | Sí: `PhantomSkills.jsx:175`, `SkillsCatalog.jsx:128`, `Repository.jsx:41,94` | `src/plugins.css`, `src/skills.css`, `src/repository.css` | B: sin verificar en prod. |
| `proposals-panels.css:20-22` | grupos planos `rp-*`, `br-*`, `inc-*`, `cc-*`, `sk-*`, `pc-sheet`, `pc-tabs`, `mem-chips > *` | Sí (ver §1) | `repository.css`, `branches.css`, `incorporaciones.css`, `plugins.css`, `skills.css`, `memory.css` | M: reduce bordes, así que hay que actualizar el presupuesto. Sin verificar regla a regla. |
| `proposals-panels.css:25-26` | `.sk-row`, `.rp-filerow`, `.br-line`, `.inc-line` hover `--row-hover` | Sí: `SkillsCatalog.jsx:17-22`, `PhantomSkills.jsx:200-205`, `Repository.jsx:119,196`, `Branches.jsx:128`, `Incorporaciones.jsx:17` | `src/skills.css:59-60` y otros | B. |
| `proposals-panels.css:29-30` | `.br-search`, `.br-field` aro 12 %/40 % | Sí: `Branches.jsx:34,245` | `src/branches.css:19-21,83` | M: quita `--shadow-well` (ya derogada, `design-v2.md:121`) y el outline de acento del foco; misma tensión que con 6·6. |
| `proposals-panels.css:33-34` | `.pc-tablist button` segmento plano | Sí: `PhantomCards.jsx:96` | `src/plugins.css:332-335` | B. Hay que conservar `role=tab`/`aria-selected`. |
| `proposals-panels.css:33-34` | `.cc-filters button` | **No**: `CommandCenter.jsx:51` solo tiene `input` y `select` | — | No trasladar: el selector no existe. |
| `proposals-panels.css:44` | `.mem-chips > *` transparente | Sí: `MemoryCard.jsx:76` | `src/memory.css` | B: sin verificar `memory.css:4`. |
| `proposals-sessions.css:21,25-27` | `.pc-composer` padding, `.pc-controls` 36, `.pc-composer > :is(.pc-meta, .pc-session-settings) {display:none}` | `.pc-session-settings` sí (`ChatCard.jsx:833`); `.pc-meta` **no** está en JSX | — | A: **no trasladar**. 6·2a/6·2b ya define el compositor (`design-v2.md:213-215`) y el `display:none` ocultaría ajustes reales. |
| `proposals-sessions.css:22-24` | `.pc-field` (variante de la story) | Sí | — | No trasladar: está sustituida por la receta 6·2a de `chat.css:319-323`. |
| `proposals-sessions.css:32-33` | `.pc-column`, `.pc-dock` con 720 | Sí (en el compositor) | `src/chat.css` | B: sin verificar; `--composer-max` ya es 720. |
| `proposals-sessions.css:36-37` | `.pc-session-row` sin anillo | Sí: `ChatCard.jsx:75,134,502,774` | `src/chat.css` | B: sin verificar. |
| `proposals-sessions.css:40-45` | `.pc-ask` isla, acciones planas y `button[title^='No volver'] {display:none}` | Sí: `ChatCard.jsx:86-98` | `src/chat.css` | A: ocultar «No volver a preguntar» elimina una acción de permisos real (`design-v2.md:192` pide conservar los permisos). Trasladar solo el material y los botones. |
| `proposals-sessions.css:48` | `.pc-error` sin caja | Sí: `ChatCard.jsx:963`, `PhantomChat.jsx:121-123`, `PhantomOrchestrator.jsx:155-156` | `src/chat.css`, `src/phantom-chat.css` | M: el error debe seguir siendo perceptible (`role`, `--danger` en la palabra). |
| `proposals-sessions.css:51-54` | `.terminal-panel`, `.terminal-host` margen, `.pt-bar`, `.pt-context` | Sí: `TerminalPanel.jsx:209-238` | `src/terminal.css` | M: el margen de `.terminal-host` cambia el tamaño de xterm y su ajuste (fit) y la geometría del PTY. |
| `proposals-sessions.css:57-58` | `.pt-card`, `.pd-session`, `.pd-deleg` | Sí: `TerminalCard.jsx:96-118`, `PhantomOrchestrator.jsx:21-88`, `PlanPhases.jsx:16-19` | `src/terminal.css`, `src/phantom-chat.css` | B/M: `.pd-deleg` también lo usa `PlanPhases`. |
| `proposals-shell.css:31-43` | `.rail-panel-row`, `.rail-panel-focus` (opacidad 0), `.rail-session-type {display:none}`, color de estado | Sí: `SidebarPanels.jsx:10,29` | `src/sidebar.css` | A: `display:none` del tipo rompe el apoyo «tipo · estado · tiempo» (`design-v2.md:168`); con opacidad 0 el foco tiene que seguir visible. |
| `proposals-shell.css:77-80` | `.canvas-minimap`, `.minimap-node`, `.minimap-view` | Sí: `Minimap.jsx:106-107` | `src/canvas-ui.css` | B. |
| `proposals-shell.css:87-90` | `.canvas-node` material, sin sombra al seleccionar, `.panel-state` | Sí: `Canvas.jsx:48`, `ActivityNotch.jsx:9` | `src/canvas-ui.css` | A: interfiere con el aro, la cometa y la selección de design-v2 §4 (`design-v2.md:89,109`). |
| `proposals-foundations.css:27` | `.activity-notch` material + `--shadow-chrome` | Sí | `src/activity.css` | B. |
| `proposals-foundations.css:57-62` | `.pt-glyph` círculo neutro 32 | Sí: `Glyphs.jsx:59` | `src/terminal.css:18` | A: sustituye el tinte por `--hue` y el radio de marca; colisiona con las insignias por concepto (`design-v2.md:162-164`, decisión «por estado frente a por tipo» pendiente). |
| `proposals-foundations.css:65-79` | `.tw-button`, `.button`, `.icon-button` globales | Sí (en muchos sitios) | `src/canvas-ui.css` | A: es global; afecta a todas las familias y al presupuesto. |
| `proposals-foundations.css:83-96` | `.tw-field`, `.plugin-field` aro y `aria-invalid` | Sí: `PluginPrimitives.jsx:14`, `ToolPanels.jsx:56` | `src/plugins.css:20`, `src/tools.css` | M: depende de la consolidación P1 de `Field` (§3). |
| `proposals-foundations.css:102-124` | `.st-switch` 40×24, `.st-seg` | Sí: `PluginPrimitives.jsx:94,97` | — | A: **no trasladar** `.st-switch`, contradice `design-v2.md:304`. `.st-seg` coincide con la receta de `design-v2.md:126`; hay que verificarlo frente a `settings.css`. |
| `proposals-foundations.css:136-146` | `.context-menu` | Sí: `App.jsx:575`, `ProjectSwitcher.jsx:73`, `Spaces.jsx:45` | `src/menus.css` (dueño, `design-v2.md:67`) | M. |
| `proposals-foundations.css:150-157` | `.empty-state__*` | Sí: `EmptyState.jsx:7` | `src/empty-state.css:21` | B. |
| `proposals-foundations.css:19,22,50-52` | `.px-fd-*` | **No**: son clases de laboratorio | — | Sin traslado directo. |

---

## 3. Deuda técnica (`docs/component-inventory.md:97-105`)

| Prio. | Deuda | Evidencia | Archivos exactos | Orden |
|---|---|---|---|---|
| P1 | Primitivas duplicadas | `PluginPrimitives.jsx:6` (`Button`), `:10` (`Field`), `:17` (`ErrorNotice`), `:23` (`DataView`), `:78` (`ResourceState`). `ToolPanels.jsx:54` (`Field`), `:70` (`ErrorNotice`, añade `onOpenPanel`), `:104` (`ResourceState` privado, añade `onOpenPanel`), `:110` (`DataView`, añade `open`). En `ToolPanels.jsx` no se localizó `Button` con la búsqueda usada. | `src/components/PluginPrimitives.jsx`, `src/components/ToolPanels.jsx` y sus consumidores (no enumerados en esta auditoría; requiere `grep` de imports por símbolo). | 1º: contrato y tests de props; 2º: migración por consumidor. |
| P1 | Dos CopyButton | `CopyButton.jsx:4` (`text`, `value`, `variant`). `PluginPrimitives.jsx:103-105` lo envuelve forzando `variant="text"`. `Markdown.jsx:5` lo reexporta y `ChatCard.jsx:14` lo importa desde `./Markdown`. Otros consumidores: `MarkdownTable.jsx:2`, `ToolOutput.jsx:3`, `Settings.jsx:10`. | `src/components/CopyButton.jsx`, `PluginPrimitives.jsx`, `Markdown.jsx`, `MarkdownTable.jsx`, `ToolOutput.jsx`, `Settings.jsx`, `ChatCard.jsx` (solo el import). | Antes de extraer ChatCard, para no chocar en su import. |
| P1 | Componentes grandes | Recuento de líneas: `ChatCard.jsx` 992, `Canvas.jsx` 692, `ToolPanels.jsx` 463, `Repository.jsx` 401 (también `Settings.jsx` 440). | Cada uno en un hijo propio: `src/components/ChatCard.jsx`, `Canvas.jsx`, `Repository.jsx`, `ToolPanels.jsx` y los archivos nuevos extraídos. | Después de P1 primitivas (ToolPanels) y CopyButton (ChatCard). |
| P2 | Estados de recursos | Dos `ResourceState` con vocabulario distinto (`PluginPrimitives.jsx:78` «No hay elementos.» frente a `ToolPanels.jsx:104` «Aún no hay nada aquí.» con `onOpenPanel`). Comportamiento de datos obsoletos: `CommandCenter.jsx:49-50` («Se conserva la última lectura válida»). | `PluginPrimitives.jsx`, `ToolPanels.jsx`, `CommandCenter.jsx` (solo lectura del patrón). | Junto con o tras P1 primitivas. |
| P2 | Densidad y a11y | Tamaño táctil de 44 px (`design-v2.md:128`). Conflictos de foco de §2 (acento frente a tinta: `canvas-ui.css:704`, `branches.css:21`, `panels.css:76`, `activity.css:73`). | CSS de cada familia; sin código nuevo hasta revisar capturas y a11y. | En paralelo, por familia. |
| P2 | Tokens locales | Reglas en cascada duplicadas para el mismo selector: `.browser-toolbar input` (`styles.css:95`, `studio.css:164`, `panels.css:75`); `.activity-tray button` (`activity.css:37-39` frente a `canvas-ui.css:804-805`); `.tw-overlay` (`canvas-ui.css:748`, `studio.css:155`); `.tool-picker` (`styles.css:109`, `canvas-ui.css:476,701`). | `src/styles.css`, `src/studio.css`, `src/canvas-ui.css`, `src/panels.css`, `src/activity.css`. | Antes de trasladar las reglas de §2 que tocan esos selectores. |
| P3 | Integraciones nativas | PTY, WebContentsView, ASR, video y móvil: suites aparte (`component-inventory.md:105`). Hay suites `test/*-desktop.mjs` (por ejemplo `test/desktop-smoke.mjs`, `test/branches-desktop.mjs`), que **no** están entre los checks del plan. | Ninguno en esta card. | Fuera de alcance; mantener separado. |

---

## 4. Decisiones abiertas de Carlos

Se listan **sin decidirlas**. Junto a cada una se anota la evidencia documental en conflicto, porque cambia lo que un hijo podría hacer.

1. **Aro de foco de la isla**: luz, blanco, marfil, acento o sin aro.
   - Pendiente según `Proposals.stories.jsx:65` y `ProposalsFeel.stories.jsx:20-48` («Luz (recomendada)»).
   - Conflicto: `design-v2.md:73,213,321` ya describe el foco «luz» como parte de 6·2a aprobada, y producción lo implementa (`chat.css:319-323`). Carlos debe confirmar si 6·2a cerró esta elección o si sigue abierta.
2. **Contador de contexto**: anillo dentro de la isla que solo muestra número y aviso cerca del límite.
   - Pendiente según `Proposals.stories.jsx:67` y `ProposalsFeel.stories.jsx:136`.
   - Conflicto: `design-v2.md:215` (6·2b) fija umbrales 70/90/95 %, y producción ya lo implementa (`chat.css:372-384`). Falta confirmar si 6·2b se aprobó con este contador incluido.
3. **Mensaje del usuario: cita o burbuja.**
   - Pendiente según `Proposals.stories.jsx:69`; variantes en `proposals-kit.css:185-187`.
   - Conflicto: `design-v2.md:192,202,321` prescriben la cita marfil, y producción usa cita (`chat.css:68`).

Otras entradas que la story sigue marcando como pendientes aunque la doc las da por aprobadas (no son parte del encargo, pero están desalineadas): uso del acento (6·6), material (6·1), dock unificado (6·3) y cabecera del rail (6·4), en `Proposals.stories.jsx:66,68,70,71`. Hay además una pendiente propia de design-v2: insignias del rail **por estado frente a por tipo** (`design-v2.md:164`), que bloquea el traslado de `.pt-glyph`.

---

## 5. Plan de hijos para una card coordinada

Principios:
- Archivos **disjuntos** entre hijos.
- `src/canvas-ui.css` tiene un único dueño (H3).
- `test/design-budget.json` y `DESIGN.md` («Presupuesto») tienen un único dueño (H8), que se ejecuta **al final**, porque el presupuesto de bordes cambia con H1–H3.
- Ningún hijo traslada reglas marcadas como A en §2 sin una decisión explícita.

Checks existentes (`package.json`): `npm test` (= `node --test test/*.test.mjs src/hooks/*.test.mjs`), `npm run build-storybook` y `npm run test:storybook` (= `node test/storybook-smoke.mjs`, que requiere el build). Para cambios de tokens o presupuesto, el test pertinente es `node --test test/design-tokens.test.mjs`.

| Hijo | Alcance | Archivos exactos (disjuntos) | Depende de | Checks | Presupuesto estimado |
|---|---|---|---|---|---|
| H1 · Derecha restante (6·5) | `.notch-dot`, `.activity-reply`, `.voice-discard`, selección de `.st-thumb` y `.accent-options` (solo riesgo B/M) | `src/activity.css`, `src/voice.css`, `src/settings.css`, `src/studio.css` | — (decisión de foco para `.activity-reply`, §4.1/§2) | `npm test`, `npm run build-storybook`, `npm run test:storybook` | ~25 turnos, 60 herramientas, 150k tokens |
| H2 · Paneles restantes (6·5) | `.br-search`, `.br-field`, `.browser-toolbar`, `.pc-tablist`, `.sk-row`, `.mem-chips`, grupos planos de Repositorio | `src/branches.css`, `src/panels.css`, `src/plugins.css`, `src/skills.css`, `src/memory.css`, `src/repository.css`, `src/incorporaciones.css` | — | ídem | ~30 turnos, 80 herramientas, 180k tokens |
| H3 · Superficies compartidas | `.tw-overlay` (requiere decisión), `.tool-search`, `.tool-item`, filtros genéricos de bandeja sin acento, iconos de cabecera, minimapa; deduplicar cascada con `styles.css`/`studio.css` | `src/canvas-ui.css`, `src/styles.css`, `src/menus.css`, `src/empty-state.css` | — | ídem | ~30 turnos, 80 herramientas, 200k tokens |
| H4 · Sesiones restantes | `.pc-ask` (sin ocultar «No volver»), `.pc-error`, `.pc-session-row`, `.pt-bar`, `.pt-context`, `.pt-card`, `.pd-*` | `src/chat.css`, `src/phantom-chat.css`, `src/terminal.css` | — | ídem (+ revisar el ajuste de xterm de forma manual o en `test:desktop`, fuera de los checks declarados) | ~25 turnos, 60 herramientas, 160k tokens |
| H5 · CopyButton único | Resolver `text`/`value`, feedback y fallo de portapapeles; reexportación | `src/components/CopyButton.jsx`, `src/components/Markdown.jsx`, `src/components/MarkdownTable.jsx`, `src/components/ToolOutput.jsx` | — | `npm test`, `npm run build-storybook`, `npm run test:storybook` | ~20 turnos, 50 herramientas, 120k tokens |
| H6 · Primitivas compartidas (P1/P2) | Contrato único `Field`, `ErrorNotice`, `DataView`, `ResourceState`, `Button`; vocabulario de estados | `src/components/PluginPrimitives.jsx`, `src/components/ToolPanels.jsx`, `src/components/Settings.jsx` | H5 (Settings y PluginPrimitives importan CopyButton) | ídem | ~35 turnos, 100 herramientas, 250k tokens |
| H7 · Extracción de ChatCard (P1) | Límites testeables; sin cambio visual | `src/components/ChatCard.jsx` + archivos nuevos `src/components/chat/*` | H4 (comparten estilos del chat), H5 | ídem | ~40 turnos, 120 herramientas, 300k tokens |
| H8 · Presupuesto y doc | Actualizar los deltas del presupuesto de bordes y el estado de las stories Resumen/Decisiones | `test/design-budget.json`, `DESIGN.md`, `src/stories/Proposals.stories.jsx` | H1–H4 | `node --test test/design-tokens.test.mjs`, `npm test`, `npm run build-storybook`, `npm run test:storybook` | ~15 turnos, 40 herramientas, 100k tokens |

Fuera del plan, cada uno en su card propia y posterior: extracción de `Canvas.jsx` y `Repository.jsx` (P1, depende de H3 y H2 respectivamente), `.canvas-node`/`.pt-glyph`/`.button` globales (riesgo A, requieren decisión) e integraciones nativas (P3).

Orden sugerido: H1 ∥ H2 ∥ H3 ∥ H4 ∥ H5, después H6 (tras H5), después H7 (tras H4 y H5) y por último H8.

**Riesgo de coordinación.** Si un hijo CSS reduce bordes, el test de presupuesto puede fallar antes de H8. En ese caso hay dos salidas: dar a cada hijo CSS permiso para su delta en `test/design-budget.json`, lo que rompe la disjunción, o aceptar que H8 lo consolide. La segunda exige que la validación final se haga tras H8. Esta elección corresponde a quien coordine la card.
